/**
 * Choosing an embedder. The fifth seam, resolved from configuration.
 *
 * ADR 0010's pattern, copied deliberately rather than reinvented: no default,
 * structurally typed implementations, and nothing above the data layer reads
 * the variable. `resolveProvider()` in `lib/providers/index.ts` is the file this
 * is modelled on, and the resemblance is intentional -- two seams that behave
 * differently for no reason are two things to remember.
 *
 * ── There is no default, and the reason is sharper here than elsewhere ────
 *
 * `CARD_PROVIDER` refuses to default because defaulting means silently
 * generating fake cards -- bad, but a fake card says so in its own text and a
 * human reads it at the review gate. `JOB_STORE` refuses because defaulting
 * means writing job state where nothing will look for it -- confusing, but it
 * fails visibly and immediately.
 *
 * This one refuses because **a wrong embedder does not fail at all.** It
 * returns plausible neighbours from a different vector space, retrieval reports
 * success, the model is handed passages that have nothing to do with the
 * question, and the user reads a confident answer with citations attached. The
 * only symptom is that the answers are wrong, and the person best placed to
 * notice is the one who asked because they did not know.
 *
 * ── No stub, and this file is where that is enforced ──────────────────────
 *
 * `EMBEDDING_PROVIDER=stub` is not unimplemented -- it is refused, by name,
 * with the reason. See `types.ts` and DS2 §3 corollary 3. The refusal lives
 * here rather than only in a comment because a comment does not stop anyone
 * from adding `stub.ts` in a hurry the night before a demo.
 */

import { OpenAIEmbeddingProvider } from './openai.ts';
import type { EmbeddingProvider, EmbeddingProviderName } from './types.ts';

const PROVIDER_NAMES = ['openai'] as const;

function isProviderName(value: string): value is EmbeddingProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * The dimension the schema was built for.
 *
 * `migrations/0007_chunk_embeddings.sql` declares `embedding vector(1536)`, and
 * a `vector(n)` column rejects anything that is not exactly `n` floats. This
 * constant is that number, restated in the one place that can check it before
 * a query runs.
 *
 * **It is not configuration.** Changing it does not change the column, and
 * changing the column does not re-embed the corpus -- see `types.ts` on why a
 * dimension change is a paid pass over every chunk rather than an edit. It
 * lives here so the assertion below can name both numbers when they disagree.
 */
const SCHEMA_DIMENSIONS = 1536;

let cached: EmbeddingProvider | undefined;

export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (cached !== undefined) return cached;

  const configured = process.env['EMBEDDING_PROVIDER'];

  if (configured === undefined || configured === '') {
    throw new Error(
      'EMBEDDING_PROVIDER is not set. It must name an embedder explicitly — ' +
        'there is no default, because a wrong embedder does not fail: it ' +
        'returns plausible neighbours from a different vector space and the ' +
        `chat looks like it is working. One of: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  // Named rather than lumped in with "unrecognised", because someone reaching
  // for it is trying to develop offline and deserves to be told why they
  // cannot, not just that the string is invalid.
  if (configured === 'stub') {
    throw new Error(
      'EMBEDDING_PROVIDER="stub" does not exist and must not be written. A ' +
        'stub embedder returns vectors whose neighbours are meaningless, so ' +
        'retrieval silently returns arbitrary passages and the answer is ' +
        'grounded in noise while looking perfect — with nothing on screen ' +
        'saying it is fake, unlike a stub card. See DS2 §3 corollary 3 and the ' +
        'header of lib/embeddings/types.ts.',
    );
  }

  if (!isProviderName(configured)) {
    throw new Error(
      `EMBEDDING_PROVIDER is "${configured}", which is not an embedder. ` +
        `One of: ${PROVIDER_NAMES.join(', ')}.`,
    );
  }

  const provider: EmbeddingProvider = new OpenAIEmbeddingProvider();

  /*
   * ── The dimension assertion, checked once, here ─────────────────────────
   *
   * Without this, a provider configured for a model at a different dimension
   * fails on the first insert with:
   *
   *     expected 1536 dimensions, not 3072
   *
   * — a Postgres type error, arriving in the middle of an ingestion run,
   * naming neither the environment variable that caused it nor the model that
   * was swapped. It reads like the database is broken.
   *
   * Checked at resolution rather than per call: the answer cannot change
   * between calls, and a check in the hot path is a check someone eventually
   * removes for being redundant.
   */
  if (provider.dimensions !== SCHEMA_DIMENSIONS) {
    throw new Error(
      `EMBEDDING_MODEL="${provider.model}" produces ${provider.dimensions}-` +
        `dimension vectors, but public.chunk_embeddings.embedding is ` +
        `vector(${SCHEMA_DIMENSIONS}). These must match exactly.\n\n` +
        '  This is not a configuration fix. Vectors from two models occupy ' +
        'different spaces, so an existing corpus cannot be queried by a new ' +
        'model even if the dimensions did match — changing the model means ' +
        're-embedding every chunk, which is a paid pass over the whole corpus. ' +
        'See lib/embeddings/types.ts and migrations/0007_chunk_embeddings.sql.',
    );
  }

  cached = provider;
  return cached;
}

/** Test seam: forget the cached provider so a changed env var takes effect. */
export function resetEmbeddingProviderCache(): void {
  cached = undefined;
}

export type { EmbeddingProvider, EmbeddingProviderName } from './types.ts';
export { ProviderRetryableError } from './types.ts';
