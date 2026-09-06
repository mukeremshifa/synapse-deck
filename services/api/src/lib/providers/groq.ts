/**
 * Groq, behind the provider seam. DS1 task 4, DEMO-SPRINT-BRIEF D1.
 *
 * The first implementation of `CardProvider` that calls a real language model.
 * Everything before it was `stub.ts`, which says at length why fake cards are
 * dangerous; this is the file that makes the stub optional.
 *
 * **It lands beside `bedrock.ts` rather than instead of it.** The seam was
 * built so that two providers can answer the same question — that is what
 * Phase E's eval harness needs to have anything to compare, and it is why the
 * brief chose Groq's free tier over rewriting the pipeline around one vendor.
 *
 * ── The OpenAI-compatible endpoint, and what that buys ────────────────────
 *
 * Groq serves `/openai/v1/chat/completions` with OpenAI's request and response
 * shapes. No SDK is added for it: the call is one `fetch` with a JSON body, and
 * a dependency whose whole value would be typing that body is a dependency this
 * repository does not need. `undici`'s `fetch` is in Node natively.
 *
 * ── What is retryable, and why that line is where the money is ────────────
 *
 * `pipeline-generate.ts` documents the contract this implements: throwing
 * `ProviderRetryableError` causes a bounded retry, and returning normally — or
 * throwing anything else — does not. The brief's §6 names an unbounded retry
 * loop against a paid model as one of the ways to produce a surprise bill, so
 * the classification below is a cost decision as much as a correctness one:
 *
 *   - **Retryable:** 429 (rate limit), 5xx, a network failure, a timeout. The
 *     same request may well succeed a moment later.
 *   - **Not retryable:** 400, 401, 403, 404. The request is wrong, or the key
 *     is; asking again changes nothing and costs the attempt.
 *   - **Not retryable:** a 200 whose body is not the JSON we asked for. This is
 *     the one that looks retryable and is not — the model is deterministic
 *     enough that the same prompt usually produces the same malformed answer,
 *     so a retry burns the budget and the latency for the same failure.
 *
 * ── This provider does not repair, validate, or filter ────────────────────
 *
 * It returns what the model produced. `pipeline-generate.ts` runs
 * `CardPayload.safeParse` on each card and keeps the ones that pass, which is
 * the single place card validation happens — a provider that also validated
 * would be a second definition of what a card is, and CLAUDE.md allows one.
 *
 * The one thing it does refuse is a response that is not shaped like a
 * response at all: no cards array means there is nothing to hand on, and
 * returning an empty result would present a broken call as a chunk that
 * genuinely produced nothing.
 */

import { ProviderRetryableError } from './types.ts';
import type {
  CardProvider,
  GenerateChunkRequest,
  GenerateChunkResult,
} from './types.ts';
import { CARD_SYSTEM_PROMPT, buildUserTurn } from './prompt.ts';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * How long one chunk's call may take before it is abandoned.
 *
 * Sixty seconds. A chunk is ~3,500 characters and Groq is fast enough that a
 * normal call is a few seconds, so this is not a latency budget — it is the
 * point past which something has gone wrong and the in-process runner should be
 * told rather than left holding a socket. A timeout is retryable: it is exactly
 * the transient failure a second attempt fixes.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The longest a `retry-after` will be honoured.
 *
 * Thirty seconds. Past that the wait is worse than the failure: the user is
 * watching a progress bar, and a chunk that reports "this section could not be
 * written" is more useful than one that stalls the job for minutes. The cap
 * turns a long rate-limit window into an honest partial failure, which the
 * pipeline already knows how to report.
 */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Read at call time rather than at module load.
 *
 * A missing key then produces an error naming itself, attached to the request
 * that needed it, instead of a crash during import that reads as the whole API
 * failing to start. This is the same shape `data/jobs-dynamo.ts` uses for
 * `JOB_TABLE_NAME` and for the same reason.
 */
function apiKey(): string {
  const key = process.env['GROQ_API_KEY'];
  if (key === undefined || key === '') {
    throw new Error(
      'GROQ_API_KEY is not set. It is a server-side secret and must never be ' +
        'VITE_-prefixed; see .env.example. In development it is loaded from ' +
        '.env.local by `npm run dev:api`.',
    );
  }
  return key;
}

/**
 * The model, named in configuration rather than hardcoded.
 *
 * No default, for `resolveProvider()`'s reason applied one level down: models
 * are retired and renamed on weeks of notice, and a hardcoded default is how a
 * deployment silently starts failing every call with a 404 that reads like an
 * outage. Naming it explicitly also means swapping models to compare quality is
 * a config change, which is what Phase E's harness will want.
 */
function model(): string {
  const name = process.env['GROQ_MODEL'];
  if (name === undefined || name === '') {
    throw new Error(
      'GROQ_MODEL is not set. Name the model explicitly — there is no default, ' +
        'because a retired model id fails every call with a 404 that reads like ' +
        'an outage. See .env.example.',
    );
  }
  return name;
}

/** The subset of the OpenAI response shape this reads. */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } | null } | null>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * What the model is asked to return. Deliberately loose.
 *
 * Typed as `unknown[]` rather than `CardPayload[]`: these are untrusted model
 * output until `pipeline-generate.ts` validates them, and giving them the
 * validated type here would be asserting the very thing that has not been
 * checked yet. The interface's `GenerateChunkResult.cards` is `CardPayload[]`,
 * so the cast at the return is the one place that claim is made — narrowed to a
 * single visible line rather than spread through the parse.
 */
interface ModelReply {
  cards?: unknown;
  topics?: unknown;
}

/**
 * Topic names, defensively.
 *
 * A provider that cannot extract topics returns `[]` rather than guessing:
 * `cards.topic_id` is nullable and untopiced cards are an ordinary state, so an
 * empty list degrades the mastery map rather than failing the chunk. Anything
 * that is not a non-empty string is dropped, because these become display names
 * in the user's own topic list once reconciled.
 */
function readTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((topic): topic is string => typeof topic === 'string')
    .map((topic) => topic.trim())
    .filter((topic) => topic !== '')
    .slice(0, 5);
}

export class GroqProvider implements CardProvider {
  readonly name = 'groq' as const;

  async generateChunk(request: GenerateChunkRequest): Promise<GenerateChunkResult> {
    // `AbortSignal.timeout` rather than a manual controller and timer: it
    // cannot leak the timer, which a hand-rolled version does on every path
    // that returns before clearing it.
    let response: Response;
    try {
      response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model(),
          messages: [
            { role: 'system', content: CARD_SYSTEM_PROMPT },
            { role: 'user', content: buildUserTurn(request) },
          ],
          // Constrains the decoder rather than asking the model nicely. See
          // prompt.ts for why this replaced v1's line-delimited contract.
          response_format: { type: 'json_object' },
          // Low but not zero. Flashcards are an extraction task, so creativity
          // is mostly a source of invented facts; a little variation stops a
          // regenerated chunk returning a byte-identical set the user has
          // already rejected.
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A network failure or the timeout firing. Both are transient by
      // definition, so both are worth one more attempt.
      throw new ProviderRetryableError(
        `The card writer could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    if (!response.ok) {
      // The body is read for the message and deliberately not parsed: an error
      // body's shape is not a contract, and a parse failure here would replace
      // a useful status code with a confusing JSON error.
      const detail = await response.text().catch(() => '');
      const message = `Groq returned ${response.status}: ${detail.slice(0, 300)}`;

      if (response.status === 429 || response.status >= 500) {
        /*
         * ── `retry-after` is honoured, and on the free tier it has to be ──
         *
         * Groq's free tier limits **tokens per minute**, not requests: this
         * account is allowed 8,000 TPM, and one chunk costs roughly 1,000 in
         * and 800 out. So a handful of chunks in flight exhausts the budget in
         * seconds, and the reset is measured in *tens of seconds* rather than
         * the hundreds of milliseconds a request-rate limit would take.
         *
         * DS1's first multi-chunk run failed two chunks of four for exactly
         * this reason. The classification was right — 429 was retried — but the
         * backoff was tuned as though the limit were on requests, so all the
         * attempts landed inside one still-exhausted window.
         *
         * The server knows when it will next accept work, so the answer is to
         * ask rather than guess. The value is carried on the error and the
         * runner waits at least that long. It is capped, because a header
         * asking for several minutes should surface as a failed chunk the user
         * is told about rather than a job that silently sits there.
         */
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new ProviderRetryableError(message, {
          retryAfterMs:
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
              : undefined,
        });
      }
      // 4xx other than 429. The request or the key is wrong; a retry spends an
      // attempt to be told the same thing.
      throw new Error(message);
    }

    let completion: ChatCompletion;
    try {
      completion = (await response.json()) as ChatCompletion;
    } catch (error) {
      throw new Error(
        `Groq returned a 200 that was not JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      // Not retryable. An empty completion on a well-formed request is a
      // refusal or a truncation, and the same prompt produces the same one.
      throw new Error('The card writer returned an empty response.');
    }

    let reply: ModelReply;
    try {
      reply = JSON.parse(content) as ModelReply;
    } catch (error) {
      throw new Error(
        `The card writer's reply was not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!Array.isArray(reply.cards)) {
      throw new Error(
        'The card writer\'s reply had no "cards" array. Nothing usable was ' +
          'produced for this section.',
      );
    }

    return {
      // The one place untrusted output is given the validated type, and it is
      // a claim `pipeline-generate.ts` immediately checks per card. See header.
      cards: reply.cards as GenerateChunkResult['cards'],
      topics: readTopics(reply.topics),
      provider: this.name,
      // The real figures, or null. Never a fabricated number: these flow into
      // cost accounting, and a made-up count corrupts the one figure that is
      // supposed to be measured honestly. `stub.ts` makes the same argument.
      inputTokens: completion.usage?.prompt_tokens ?? null,
      outputTokens: completion.usage?.completion_tokens ?? null,
    };
  }
}
