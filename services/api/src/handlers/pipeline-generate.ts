/**
 * One chunk, one model call. The body of the Map state. P10 task 5.
 *
 * ── This function decides what the retry policy retries ───────────────────
 *
 * The brief's §6 names "a Step Functions retry loop calling Bedrock" as one of
 * five traps that produce a surprise bill, so what is and is not retryable is a
 * cost decision as much as a correctness one:
 *
 *   - **Throwing** propagates to Step Functions, which retries under the
 *     bounded policy in `pipeline-stack.ts`. Reserved for transient provider
 *     failures — timeouts, rate limits, 5xx.
 *   - **Returning a failed result** does not retry. Used for everything a retry
 *     cannot fix: a malformed response, a chunk whose text has expired, output
 *     that fails Zod. Asking the same model the same question again produces the
 *     same bad answer, so retrying burns budget for nothing.
 *
 * A chunk that fails either way is recorded and the job continues. Partial
 * failure is a normal outcome here, not an exception (task 6).
 *
 * ── Validation happens here, not at the review gate ───────────────────────
 *
 * Card content is untrusted LLM output (CLAUDE.md), and it is validated against
 * the same `CardPayload` schema the client uses — one definition, shared. A card
 * that fails validation is dropped and the rest of the chunk is kept: one bad
 * card in a batch of three is not a reason to discard the two good ones.
 *
 * ── Two consumers of one chunk, from two vendors (DS2 task 4) ─────────────
 *
 * This function now does two independent things with the same text: it asks a
 * model for cards, and it asks a *different vendor* for an embedding so the
 * chunk becomes searchable by grounded chat. The chunking happens once, in
 * `lib/chunking.ts`, and both consumers read its output — embedding is a second
 * consumer, never a second chunker.
 *
 * The call goes here rather than in a fourth pipeline step for a plain reason:
 * the chunk's text is already in hand, the retry and partial-failure machinery
 * already exists, and the per-chunk progress the UI polls stays meaningful. A
 * step after `finalise` would mean a second pass reading every chunk back out
 * of Postgres to embed it, for no benefit.
 *
 * **The two failures are independent, and that asymmetry is deliberate.** They
 * are separate capabilities from separate vendors with separate rate limits:
 *
 *   - Cards failed, embedding succeeded → the chunk failed. There is nothing to
 *     show the user, and the vector indexes text whose cards never landed.
 *   - Cards succeeded, embedding failed → **the chunk succeeded.** It is a
 *     usable chunk that is not yet searchable. Dropping good cards because an
 *     embedding vendor was down is strictly worse than shipping a notebook with
 *     a hole in its retrieval corpus.
 *
 * The second case must not be silent, or DS2 task 8's "your sources do not
 * cover that" becomes a lie told about a corpus with gaps in it. It is recorded
 * on the chunk's `error` field — see `embeddingNote` below for why that field
 * and not a new one.
 */

import { completeChunk, getChunkText } from '../data/jobs.ts';
import { upsertChunkEmbedding } from '../data/chunks.ts';
import { resolveProvider, ProviderRetryableError } from '../lib/providers/index.ts';
import { resolveEmbeddingProvider } from '../lib/embeddings/index.ts';
import { CardPayload, type CardKind } from '../lib/schemas.ts';

export interface GenerateChunkInput {
  userId: string;
  jobId: string;
  chunkIndex: number;
  cardCount: number;
  kinds: string[];
  depth: string;
}

export interface GenerateChunkOutput {
  chunkIndex: number;
  status: 'succeeded' | 'failed';
  cardCount: number;
}

const DEPTHS = ['recall', 'balanced', 'deep'] as const;

function asDepth(value: string): (typeof DEPTHS)[number] {
  return (DEPTHS as readonly string[]).includes(value)
    ? (value as (typeof DEPTHS)[number])
    : 'balanced';
}

/**
 * Embed the chunk, and never let that failure cost the chunk its cards.
 *
 * Returns `null` on success, or a sentence describing the failure. It does not
 * throw, and the `catch (unknown)` is deliberately total — including
 * `ProviderRetryableError`, which is the one case worth spelling out.
 *
 * ── Why a retryable embedding failure is not rethrown ─────────────────────
 *
 * Everywhere else in this pipeline, `ProviderRetryableError` propagates so the
 * runner retries the whole step. Here it must not, and the reason is that the
 * step is no longer one thing. By the time this runs the cards are already
 * generated and written; rethrowing would re-run the *card* call too — paying
 * for it a second time, against a different vendor's rate limit, to fix an
 * embedding. The brief's §6 names an unbounded retry loop against a paid model
 * as a way to produce a surprise bill, and that is precisely the shape it would
 * take.
 *
 * So a transient embedding failure degrades to the same outcome as a permanent
 * one: the chunk is usable and not searchable, and it says so. Re-embedding it
 * is idempotent by the upsert in `data/chunks.ts`, so a backfill can repair it
 * later without duplicating anything.
 */
async function embedChunk(
  userId: string,
  jobId: string,
  chunkIndex: number,
  text: string,
): Promise<string | null> {
  try {
    const embedder = resolveEmbeddingProvider();
    // A batch of one. The interface is batched because vendors charge per
    // request, and a later change that embeds several chunks in one call
    // should not have to change this function's shape to do it.
    const [vector] = await embedder.embed([text]);
    if (vector === undefined) {
      // The provider promises one vector per input and throws otherwise, so
      // this is unreachable by contract. Handled anyway rather than asserted:
      // `noUncheckedIndexedAccess` makes the possibility visible, and a
      // non-null assertion here would be the one place the contract is trusted
      // rather than checked.
      return 'The embedder returned no vector for this section.';
    }
    await upsertChunkEmbedding(userId, jobId, chunkIndex, vector, embedder.model);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Logged as well as returned. The returned sentence reaches the user
    // through the job's progress response; this line is what makes a
    // widespread outage — a wrong key, a dead vendor — findable in the log as
    // something other than a scattering of individually unremarkable chunks.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'embedding failed',
        jobId,
        chunkIndex,
        error: message,
      }),
    );
    return `This section was not indexed for chat: ${message}`;
  }
}

export async function handler(input: GenerateChunkInput): Promise<GenerateChunkOutput> {
  const { userId, jobId, chunkIndex } = input;

  const text = await getChunkText(userId, jobId, chunkIndex);
  if (text === null) {
    // Not retryable: the text is not coming back. Recorded as a failed chunk so
    // the job can still finish with whatever else succeeded.
    await completeChunk(userId, jobId, chunkIndex, {
      status: 'failed',
      error: 'The chunk text was missing or had expired.',
    });
    return { chunkIndex, status: 'failed', cardCount: 0 };
  }

  const provider = resolveProvider();

  /*
   * ── Started before the card call, awaited after it ──────────────────────
   *
   * The two calls go to different vendors with independent rate limits, so
   * running them concurrently costs nothing either one is competing for and
   * saves the embedding's latency from the chunk's wall clock entirely.
   *
   * `embedChunk` never rejects — it returns a sentence instead — so this
   * promise cannot become an unhandled rejection while the card call is in
   * flight. That property is why it was written to return rather than throw,
   * and it is worth not undoing: a floating promise that can reject is exactly
   * how a Node process dies mid-job.
   *
   * It is awaited on every path below that writes a result, including the
   * failure paths. Abandoning it would leave a write to `chunk_embeddings`
   * racing the job's completion — and on the local runner, potentially racing
   * the process exiting.
   */
  const embedding = embedChunk(userId, jobId, chunkIndex, text);

  let result;
  try {
    result = await provider.generateChunk({
      text,
      cardCount: input.cardCount,
      kinds: input.kinds as CardKind[],
      depth: asDepth(input.depth),
    });
  } catch (error) {
    if (error instanceof ProviderRetryableError) {
      // Thrown on purpose: Step Functions' bounded retry policy handles it, and
      // the chunk is only recorded as failed once the attempts are exhausted.
      //
      // The embedding is awaited first so its write cannot outlive this
      // invocation. Its result is discarded: the retry will re-embed, and the
      // upsert makes that harmless.
      await embedding;
      throw error;
    }
    await embedding;
    await completeChunk(userId, jobId, chunkIndex, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'The card writer failed.',
    });
    return { chunkIndex, status: 'failed', cardCount: 0 };
  }

  // Both vendors have now answered. `embeddingError` is null on success, or a
  // sentence the user can be shown.
  const embeddingError = await embedding;

  // Validate each card independently, keeping the good ones. `safeParse` per
  // card rather than over the array, so one malformed card does not discard a
  // whole chunk's work.
  const valid = result.cards.filter((card) => CardPayload.safeParse(card).success);

  if (valid.length === 0) {
    await completeChunk(userId, jobId, chunkIndex, {
      status: 'failed',
      provider: result.provider,
      error: 'The card writer returned nothing usable for this section.',
    });
    return { chunkIndex, status: 'failed', cardCount: 0 };
  }

  await completeChunk(userId, jobId, chunkIndex, {
    status: 'succeeded',
    cards: valid,
    provider: result.provider,
    // Carried, not reconciled. Reconciliation writes to Postgres and happens at
    // the review gate, so a job the user abandons leaves no topics behind
    // (P10 task 7).
    topics: result.topics,
    /*
     * ── A succeeded chunk that carries an error, and why that is right ────
     *
     * `error` on a `succeeded` chunk reads like a contradiction, so it is worth
     * stating what it means: **the cards landed, and the search index did not.**
     * The status describes the chunk's cards, which is what the user came for
     * and what the progress UI counts.
     *
     * It rides this field rather than a new one because a new field would have
     * to be added to `ChunkRecord` — and that type is declared in
     * `data/jobs-dynamo.ts` and shared by both halves of the `JOB_STORE` seam.
     * Widening it means editing the DynamoDB module, which DS2's acceptance
     * criterion 10 requires to stay byte-identical to what P10 wrote, and means
     * a schema change to a table this phase has no other reason to touch.
     *
     * The alternative to recording it here is not recording it at all, and DS2
     * task 4 is explicit that a silent gap in the corpus turns the honest
     * "your sources do not cover that" into a lie.
     */
    error: embeddingError,
  });

  return { chunkIndex, status: 'succeeded', cardCount: valid.length };
}
