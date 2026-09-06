/**
 * OpenAI embeddings, behind the embedding seam. DS2 task 2.
 *
 * The one real implementation, and — unlike `CARD_PROVIDER` — the only one this
 * seam is allowed to have until a second vendor is genuinely wired up. There is
 * no stub beside it and there must not be; `types.ts` says why at length.
 *
 * ── Why this vendor ───────────────────────────────────────────────────────
 *
 * Groq has no embedding model at all (DS2 §0), so the chat completion and the
 * embedding call were always going to different vendors. Among the candidates
 * that fit the constraint — cheap, OpenAI-shaped, no SDK — `text-embedding-3-small`
 * is the default guess the plan named: 1536 dimensions natively, and a demo
 * corpus of a few hundred chunks costs cents to embed.
 *
 * **No SDK is added.** The call is one `fetch` with a JSON body, exactly as
 * `providers/groq.ts` deliberately does, and a dependency whose whole value
 * would be typing that body is one this repository does not need. `services/api`
 * has one runtime dependency (`pg`) and keeping it that way is what keeps a
 * Lambda bundle small enough that cold start is about the VPC and nothing else.
 *
 * ── What is retryable, and why the line is in the same place ──────────────
 *
 * The same classification `groq.ts` documents, for the same cost reason. The
 * shared `ProviderRetryableError` is what the pipeline's bounded retry looks
 * for, so this is not a parallel convention — it is the same one:
 *
 *   - **Retryable:** 429, 5xx, a network failure, a timeout. The same request
 *     may well succeed a moment later.
 *   - **Not retryable:** 400, 401, 403, 404. The request is wrong, or the key
 *     is; asking again spends an attempt to be told the same thing.
 *   - **Not retryable:** a 200 whose body is not shaped like an embedding
 *     response. A malformed reply to a well-formed request is not transient.
 */

import { ProviderRetryableError } from './types.ts';
import type { EmbeddingProvider } from './types.ts';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';

/**
 * How long one batch may take before it is abandoned.
 *
 * Thirty seconds. Embedding is a much cheaper operation than a chat completion
 * — no decoding, no long output — so a normal batch is under a second. This is
 * not a latency budget; it is the point past which something has gone wrong and
 * the runner should be told rather than left holding a socket.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** The longest a `retry-after` is honoured. `groq.ts`'s reasoning, same number. */
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Dimensions per model, so `resolveEmbeddingProvider()` can assert against the
 * column before anything is written.
 *
 * A lookup rather than a `dimensions` environment variable, because the number
 * is a **property of the model**, not a choice an operator gets to make. Two
 * variables that must agree are two variables that eventually disagree, and the
 * failure that produces is the silent one this seam exists to prevent.
 *
 * `text-embedding-3-*` do support a `dimensions` request parameter that
 * truncates the vector. It is deliberately not used: it would make the width a
 * second thing to keep in step with the column, to save a few hundred bytes a
 * row on a corpus measured in hundreds of rows.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  // Legacy, listed so a mismatch is a named error rather than "unknown model".
  'text-embedding-ada-002': 1536,
};

/**
 * Read at call time rather than at module load, as `groq.ts` does — a missing
 * key then produces an error naming itself, attached to the request that needed
 * it, instead of a crash during import that reads as the whole API failing to
 * start.
 */
function apiKey(): string {
  const key = process.env['OPENAI_API_KEY'];
  if (key === undefined || key === '') {
    throw new Error(
      'OPENAI_API_KEY is not set. It is a server-side secret and must never be ' +
        'VITE_-prefixed; see .env.example. In development it is loaded from ' +
        '.env.local by `npm run dev:api`.',
    );
  }
  return key;
}

/**
 * The model, named in configuration rather than hardcoded.
 *
 * `GROQ_MODEL`'s reason, and DS1 proved it: that phase was written against
 * `llama-3.3-70b-versatile`, Groq answered 404, and the fix was one line
 * because the id was configuration. Here the stakes are higher — an unknown
 * model id would mean an unknown dimension, so this refuses rather than
 * guessing a width.
 */
function modelName(): string {
  const name = process.env['EMBEDDING_MODEL'];
  if (name === undefined || name === '') {
    throw new Error(
      'EMBEDDING_MODEL is not set. Name the model explicitly — there is no ' +
        'default, because the model determines the vector width and the ' +
        'column is vector(1536). See .env.example.',
    );
  }
  return name;
}

/** The subset of the response shape this reads. */
interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: unknown } | null> | null;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly dimensions: number;

  constructor() {
    this.model = modelName();

    const dimensions = MODEL_DIMENSIONS[this.model];
    if (dimensions === undefined) {
      throw new Error(
        `EMBEDDING_MODEL="${this.model}" is not a model this provider knows ` +
          `the vector width of. Known: ${Object.keys(MODEL_DIMENSIONS).join(', ')}.\n\n` +
          '  The width is not guessed, because guessing it wrong writes vectors ' +
          'that the column silently rejects — or worse, accepts at the wrong ' +
          'width. Add the model and its dimension to MODEL_DIMENSIONS in ' +
          'lib/embeddings/openai.ts if it is one you mean to use.',
      );
    }
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // An empty batch is a caller bug rather than a request worth making: the
    // API charges for the round trip and returns nothing useful.
    if (texts.length === 0) return [];

    let response: Response;
    try {
      response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        // `AbortSignal.timeout` rather than a manual controller and timer: it
        // cannot leak the timer, which a hand-rolled version does on every
        // path that returns before clearing it.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A network failure or the timeout firing. Both transient by definition.
      throw new ProviderRetryableError(
        `The embedder could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    if (!response.ok) {
      // Read for the message, deliberately not parsed: an error body's shape is
      // not a contract, and a parse failure here would replace a useful status
      // code with a confusing JSON error.
      const detail = await response.text().catch(() => '');
      const message = `The embedder returned ${response.status}: ${detail.slice(0, 300)}`;

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new ProviderRetryableError(message, {
          retryAfterMs:
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
              : undefined,
        });
      }
      throw new Error(message);
    }

    let body: EmbeddingResponse;
    try {
      body = (await response.json()) as EmbeddingResponse;
    } catch (error) {
      throw new Error(
        `The embedder returned a 200 that was not JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const data = body.data;
    if (!Array.isArray(data)) {
      throw new Error('The embedder returned a response with no "data" array.');
    }

    /*
     * ── Order is restored from `index`, never assumed ───────────────────────
     *
     * The interface promises one vector per input **in the same order**, and
     * the caller writes each vector against a chunk index on that promise. The
     * API documents that it returns items carrying their own `index`, and in
     * practice they arrive in order — but "in practice" is the wrong standard
     * for this particular guarantee.
     *
     * A mis-ordered batch is the invisible failure: every row still gets a
     * real, well-formed vector, so nothing errors and nothing looks wrong. The
     * vectors simply belong to the wrong passages, and the only symptom is that
     * citations point at chunks that do not contain the answer — which reads as
     * "retrieval quality is poor" rather than as a bug.
     *
     * So the response is placed by its own `index` rather than by arrival
     * order, and a batch that does not yield exactly one vector per input is
     * refused. A short array is not a partial success: there is no way to tell
     * which input was dropped.
     */
    const vectors: number[][] = new Array<number[]>(texts.length);
    let placed = 0;

    for (const item of data) {
      const index = item?.index;
      const embedding = item?.embedding;

      if (typeof index !== 'number' || index < 0 || index >= texts.length) {
        throw new Error(
          `The embedder returned an item with an out-of-range index (${String(index)}) ` +
            `for a batch of ${texts.length}.`,
        );
      }
      if (!Array.isArray(embedding) || embedding.length !== this.dimensions) {
        throw new Error(
          `The embedder returned a ${
            Array.isArray(embedding) ? `${embedding.length}-dimension` : 'malformed'
          } vector for input ${index}, but ${this.model} was expected to produce ` +
            `${this.dimensions}. The corpus and the query must share one vector space.`,
        );
      }
      if (vectors[index] !== undefined) {
        throw new Error(
          `The embedder returned two vectors for input ${index}. The batch cannot ` +
            'be zipped back to its inputs reliably.',
        );
      }

      vectors[index] = embedding as number[];
      placed += 1;
    }

    if (placed !== texts.length) {
      throw new Error(
        `The embedder returned ${placed} vectors for ${texts.length} inputs. A ` +
          'short batch is not a partial success — there is no way to tell which ' +
          'input was dropped.',
      );
    }

    return vectors;
  }
}
