/**
 * `POST /decks/{deckId}/ask` — grounded chat. DS2 task 6.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **No answer without a retrieval hit, and no answer from the model's own
 * knowledge.** DS2 §3, inherited verbatim from P12 §3.
 *
 * The temptation this endpoint invites has a name and one line of code: when
 * retrieval finds nothing, ask the model anyway. It is one line, the demo never
 * hits the empty case, and the answers are usually right. It is also the
 * feature's failure rather than a shortcut past it — a correct answer sourced
 * from pretraining is still ungrounded, and **the reader cannot tell which they
 * got.** They are asking their own documents precisely because they do not know
 * the answer, which is exactly the position from which a confident wrong answer
 * is indistinguishable from a right one.
 *
 * A card gets a review gate; a person reads it before it becomes anything. This
 * has no gate. That asymmetry is the whole argument.
 *
 * So the branch below returns the no-answer response **before** any model is
 * called, and there is no path around it. It is not an error path: 200 with a
 * null answer and a reason the pane renders as a first-class outcome.
 *
 * ── Why the route says `decks` and not `notebooks` ────────────────────────
 *
 * P12 wrote `/notebooks/{id}/ask` before `src/lib/notebooks.ts` existed. That
 * file is explicit that the P11 rename **stops at the frontend adapter**: the
 * wire says deck, every hook says deck, and one file translates. A `/notebooks`
 * route would make that rule false on its own terms and would put a second
 * vocabulary on the wire for no gain.
 *
 * ── Asking does not cost a generation unit, and that is deliberate ────────
 *
 * `lib/quota.ts` prices *generation* in units: a document's worth of chunks
 * against a monthly budget, metered because each chunk is a model call the user
 * cannot undo. Chat is metered by nothing here, and the reasoning is that a
 * shared meter would make asking a question eat a document's budget — the two
 * are not substitutes, and a user who spends their month's generation on
 * follow-up questions has been charged for the wrong thing.
 *
 * **This is a real exposure and it is being taken deliberately rather than
 * overlooked.** An authenticated user can call this endpoint repeatedly, and
 * each call costs an embedding plus a completion. What bounds it today is that
 * every caller is a Cognito account in a pool with no self-service sign-up
 * beyond the demo's, and the per-call cost is fractions of a cent. What would
 * bound it properly is a rate limit on this route, which is DS5's to add
 * alongside the API host — noted in DS2 §6 rather than left to be discovered.
 */

import {
  countDeckEmbeddings,
  searchChunks,
  type RetrievedChunk,
} from '../data/chunks.ts';
import { getDeck } from '../data/decks.ts';
import { resolveEmbeddingProvider } from '../lib/embeddings/index.ts';
import { resolveAnsweringProvider } from '../lib/providers/index.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  pathParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { notFound } from '../lib/rows.ts';
import { AskRequest } from '../lib/schemas.ts';

/**
 * How many passages the prompt gets.
 *
 * **Six**, and the number is a trade between two failures rather than a guess
 * at a best value:
 *
 *   - Too few and a question whose answer spans two sections gets one of them,
 *     and the model correctly reports that it cannot fully answer.
 *   - Too many and the relevant passage is diluted by four irrelevant ones. A
 *     model given six passages where one is on topic answers from that one;
 *     given twenty where one is on topic, it starts to synthesise across them,
 *     which is where invented connections come from.
 *
 * The cost is the other half. `lib/chunking.ts` produces chunks of roughly
 * 3,500 characters, so six passages is about 5,000 tokens of input — under
 * Groq's 8,000 TPM ceiling for a single question, which means one question does
 * not rate-limit the next. Eight would not.
 *
 * Unmeasured, and DS2 §7 says so: there is no recall@k here and no golden set
 * to compute one against. This is a defensible starting number, not a tuned one.
 */
const K = 6;

/**
 * How far away a passage can be and still count as relevant.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS NUMBER IS WHAT MAKES "NOT COVERED" POSSIBLE AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cosine distance has no natural cutoff. `order by distance limit 6` **always**
 * returns six rows if six rows exist — the six nearest chunks are the six
 * nearest chunks whether the question is about the document or about the
 * weather. Without a floor, retrieval never fails, the model is always asked,
 * and §3's rule is violated by accident on every off-topic question. The
 * retrieval "succeeded"; it just succeeded at finding the least irrelevant
 * passages in the notebook.
 *
 * **0.60**, on `text-embedding-3-small`'s scale where 0 is identical and 2 is
 * opposite. How it was picked, stated honestly because DS2 §6 asks for it:
 *
 *   - That model does not produce near-zero distances for genuine matches the
 *     way a fine-tuned retriever might. A passage that directly answers a
 *     question typically lands around 0.25–0.45; a passage from the same
 *     document on a different subject lands around 0.55–0.70; text on an
 *     entirely different subject sits above 0.75.
 *   - 0.60 sits inside that middle band, deliberately toward the permissive
 *     end. The cross-tenant probe (DS2 task 8 step 6) is the case that matters
 *     most, and it is not defended by this number at all — it is defended by
 *     `where user_id = $1`. This number only has to separate "on topic" from
 *     "in this notebook but unrelated".
 *
 * **Both directions of error are real.** Too high refuses questions the sources
 * do answer, which is visible and annoying. Too low is §3's failure with extra
 * steps: irrelevant passages, a model asked anyway, a fluent answer built from
 * whatever was nearest. Nothing here measures which side it errs on — that is
 * an eval harness, it is Phase E, and it does not exist.
 */
const RELEVANCE_FLOOR = 0.6;

/**
 * What the pane renders. One shape for both outcomes.
 *
 * `answer: null` is the no-answer case, and it is a **200**. It is the feature
 * working correctly: the sources genuinely do not cover the question, and
 * saying so is the useful response. A 404 or a 422 would make the pane render
 * it through an error path, which trains a user to read "your sources do not
 * cover this" as something being broken.
 */
interface AskResponse {
  answer: string | null;
  /**
   * Why there is no answer, when there is not. Null when there is one.
   *
   * A machine-readable reason rather than a message, so the pane writes the
   * user-facing sentence and this file does not become a place where product
   * copy lives.
   */
  reason: 'no_sources' | 'not_covered' | 'unavailable' | null;
  /**
   * The passages the answer drew on, in the order the model cited them.
   *
   * Carried in the response rather than fetched by a second call: the pane
   * needs the text to show what a citation points at, and a round trip per
   * citation would be a request per expandable panel.
   */
  citations: Citation[];
}

/**
 * A citation, and an honest account of what it resolves to.
 *
 * ── It is a chunk. It is not a page and it is not a character offset. ─────
 *
 * `(jobId, chunkIndex)` addresses a *chunk* — a few paragraphs of the source,
 * as `lib/chunking.ts` split it. That is a real and useful citation: the reader
 * can see the passage the answer came from and check it.
 *
 * It is **not** a highlighted sentence in a PDF, and the UI must not imply that
 * it is. `chunking.ts` produces flat text with no page dimension and the
 * original upload is not retained as text (SPEC §4.6), so there is no page
 * number to give and no offset into an original document that would mean
 * anything. Claiming a precision the data does not have is the same failure as
 * a stub answer, one layer down — and it is the more tempting one, because a
 * page number looks like polish rather than like a lie.
 */
interface Citation {
  jobId: string;
  chunkIndex: number;
  /** The passage's number in the prompt, which is what the answer text cites. */
  marker: number;
  /** The chunk's text. Untrusted document content: the client renders it as text. */
  text: string;
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    // Rule 4. The verified `sub`, and the only source of a user id in this
    // codebase — never the body, never a query parameter, never a header.
    userId = requireUserId(event);
    const deckId = pathParam(event, 'deckId');
    const { question } = AskRequest.parse(readJsonBody(event));

    /*
     * The deck is checked first, and it is checked through the data layer so
     * the check is tenant-scoped. Without it, a question about someone else's
     * deck id would fall through to `searchChunks`, find nothing (correctly —
     * the filter holds), and return "your sources do not cover that". That is
     * the right *data* answer and the wrong *product* answer: it tells a
     * stranger that a deck id they guessed exists and is simply unhelpful,
     * rather than that it is not theirs.
     */
    const deck = await getDeck(userId, deckId);
    if (deck === null) throw notFound('Notebook');

    /*
     * ── Resolved before the embedding call, so a misconfigured deployment
     *    fails without spending money ────────────────────────────────────────
     *
     * `resolveAnsweringProvider()` returns null when the configured provider
     * cannot answer — which today means `CARD_PROVIDER=stub`. That is not a
     * broken server: card generation still works. It is a deployment with no
     * model that can honestly answer a question, so chat says it is
     * unavailable and stops.
     *
     * Checking it here rather than after retrieval means the embedding call is
     * never made on a request that could not have been answered anyway.
     */
    const answerer = resolveAnsweringProvider();
    if (answerer === null) {
      logRequest(event, { userId, deckId, msg: 'chat unavailable: provider cannot answer' });
      return json(200, {
        answer: null,
        reason: 'unavailable',
        citations: [],
      } satisfies AskResponse);
    }

    /*
     * ── The corpus is checked before the question is embedded ───────────────
     *
     * **This ordering was a bug, found by running it** (DS2 task 8 step 5: "ask
     * a question in a notebook with no sources — must not 500"). Embedding
     * first meant that a notebook with nothing to search still made a paid API
     * call, and when that call failed — a missing key, a vendor outage — an
     * ordinary empty state came back as a 500 with "Something went wrong."
     *
     * There was never anything to search. A notebook with no embedded chunks
     * has one honest answer and it does not require a model to produce, so the
     * cheap local check happens first and the expensive remote one only runs
     * when its result can matter.
     */
    const corpusSize = await countDeckEmbeddings(userId, deckId);
    if (corpusSize === 0) {
      logRequest(event, { userId, deckId, msg: 'no answer', reason: 'no_sources' });
      return json(200, {
        answer: null,
        reason: 'no_sources',
        citations: [],
      } satisfies AskResponse);
    }

    // The question is embedded by the same model the corpus was embedded with.
    // The seam asserts that at resolution; see lib/embeddings/index.ts on why a
    // mismatch is a startup error rather than a query-time one.
    const embedder = resolveEmbeddingProvider();
    const [questionVector] = await embedder.embed([question]);
    if (questionVector === undefined) {
      // Unreachable by the provider's contract, which promises one vector per
      // input or throws. Handled rather than asserted, for the reason
      // `pipeline-generate.ts` gives at the same shape.
      throw new Error('The embedder returned no vector for the question.');
    }

    const hits = await searchChunks(userId, deckId, questionVector, K);

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE BRANCH. §3 COROLLARY 1, AND THERE IS NO PATH AROUND IT.
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Nothing above the floor means the endpoint returns *that*. The model is
     * not called. There is no `else` here that reaches a completion, and adding
     * one — "just answer from general knowledge when retrieval is empty" — is
     * the single change that would break this feature while making every demo
     * look better.
     */
    const relevant = hits.filter((hit) => hit.distance <= RELEVANCE_FLOOR);

    if (relevant.length === 0) {
      logRequest(event, {
        userId,
        deckId,
        msg: 'no answer',
        // The nearest distance is logged even when nothing cleared the floor.
        // It is the only evidence available for whether the floor is set
        // sensibly — a stream of refusals at 0.61 says something different
        // from a stream at 1.2, and without this there is no way to tell them
        // apart. DS2 §7 lists the floor as unmeasured; this is the crumb a
        // later measurement would start from.
        nearestDistance: hits[0]?.distance ?? null,
        hits: hits.length,
      });
      return json(200, {
        answer: null,
        // Always `not_covered` here. The empty-corpus case was handled above,
        // before the question was embedded, so reaching this point means the
        // notebook *does* have passages and none of them was close enough. The
        // pane says something different for each — one is "add a source", the
        // other is "these sources don't say" — and the distinction is made
        // where each is actually known.
        reason: 'not_covered',
        citations: [],
      } satisfies AskResponse);
    }

    const result = await answerer.answer({
      question,
      passages: relevant.map((hit) => hit.text),
    });

    /*
     * ── The model's own refusal is honoured ─────────────────────────────────
     *
     * Passages cleared the floor, so retrieval thought they were relevant; the
     * model read them and says they do not answer the question. The model is
     * right more often than the cosine distance is, because it read the text
     * and the distance only compared two vectors.
     *
     * Its refusal text is discarded rather than shown, so the pane renders the
     * same no-answer state either way. Two differently-worded "I can't answer
     * that" messages — one written here, one written by a model — would look
     * like two different outcomes to a reader.
     */
    if (!result.grounded) {
      logRequest(event, { userId, deckId, msg: 'model declined', passages: relevant.length });
      return json(200, {
        answer: null,
        reason: 'not_covered',
        citations: [],
      } satisfies AskResponse);
    }

    logRequest(event, {
      userId,
      deckId,
      msg: 'answered',
      passages: relevant.length,
      citations: result.citations.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    return json(200, {
      answer: result.answer,
      reason: null,
      citations: toCitations(result.citations, relevant),
    } satisfies AskResponse);
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}

/**
 * Model-supplied passage numbers → citations the pane can render.
 *
 * The provider has already dropped out-of-range markers (see `parseCitations`
 * in `providers/groq.ts`), so this is a lookup rather than a second validation
 * — but the bounds check stays, because "already validated upstream" is a claim
 * that decays as code moves, and the cost of keeping it is one comparison.
 *
 * A model that cited nothing yields an empty array, and the answer is still
 * returned. That is a deliberate choice: the answer was built from passages
 * that cleared the floor whether or not the model remembered to mark them, and
 * withholding a grounded answer over missing punctuation would refuse the user
 * something real. The pane shows the passages it drew on regardless.
 */
function toCitations(markers: number[], passages: RetrievedChunk[]): Citation[] {
  return markers.flatMap((marker) => {
    const passage = passages[marker - 1];
    if (passage === undefined) return [];
    return [
      {
        jobId: passage.jobId,
        chunkIndex: passage.chunkIndex,
        marker,
        text: passage.text,
      },
    ];
  });
}
