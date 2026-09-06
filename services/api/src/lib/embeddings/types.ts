/**
 * The embedding-provider interface. DS2 task 2, the fifth runtime seam.
 *
 * ── Why this is not a method on `CardProvider` ────────────────────────────
 *
 * The cheap version of this file is `embed()` added to `lib/providers/types.ts`,
 * and it was rejected before it was written. `CardProvider` is a *chat*
 * interface with three named implementations: a deliberate stub, a real Groq
 * client, and an unwritten Bedrock one. Widening it would make all three owe an
 * implementation of a capability none of them has any business knowing about --
 * and `StubProvider` would have to answer it with exactly the fake vectors that
 * DS2 §3 forbids.
 *
 * There is also a plain fact behind it: **Groq has no embedding model.** The
 * account's catalogue was listed while planning DS2 and it is chat, audio and
 * prompt-guard only. So the chat completion and the embedding call go to two
 * different vendors with two different rate limits, and one interface spanning
 * both would be a fiction maintained for symmetry.
 *
 * ── The asymmetry with the other four seams, and it is the whole point ────
 *
 * `JOB_STORE`, `PIPELINE_RUNNER`, `UPLOAD_STORE` and `CARD_PROVIDER` all have a
 * local or offline implementation you can develop against. **This one may not**,
 * and the prohibition is a security property rather than a preference:
 *
 *   A stub embedder returns vectors whose neighbours are meaningless. Retrieval
 *   then returns arbitrary chunks, ranked confidently, and the model writes a
 *   fluent answer grounded in noise. Unlike a stub *card* -- which announces
 *   itself in its own text and passes a review gate before it becomes anything
 *   -- there is nothing on screen that says the answer is fake. It looks
 *   exactly like the feature working.
 *
 * So there is no `stub.ts` in this directory and one must not be added, not
 * behind a flag and not "just to develop against". See DS2 §3, corollary 3.
 *
 * ── Switching this seam is not a configuration change ─────────────────────
 *
 * **Read this before setting `EMBEDDING_PROVIDER` to something else on a
 * populated corpus.** The other four seams can be flipped between deploys and
 * the data is still the data: a job row means the same thing in DynamoDB and in
 * Postgres. Embeddings do not work that way.
 *
 * Two models embed into two *different vector spaces*. A corpus written by one
 * and queried by another returns real rows in a plausible order with no error
 * anywhere -- and the ordering is meaningless, so the answers are confident
 * nonsense. That is the same failure mode as the stub, arrived at by a
 * different route.
 *
 * **Changing the provider requires re-embedding the whole corpus**, which is a
 * paid pass over every chunk. When `BedrockProvider` arrives with Titan's
 * embeddings, that is the work -- not an edit to `.env.local`. Migration
 * `0007_chunk_embeddings.sql` says the same thing from the schema's side, and
 * `chunk_embeddings.model` is the column that lets you find out a table holds
 * two models' vectors.
 */

/**
 * The retryable/non-retryable distinction, shared rather than redeclared.
 *
 * `ProviderRetryableError` is imported from the card provider's types instead of
 * a second class being declared here. It is one concept -- "this failure is
 * worth another attempt and this one is not" -- and CLAUDE.md's rule for
 * schemas applies to it for the same reason: two definitions drift, and an
 * `instanceof` check against the wrong one silently stops retrying.
 *
 * The import direction is admittedly odd -- embeddings depending on the card
 * provider's module for an error class neither concept owns. The alternative
 * considered was lifting it to `lib/errors.ts` and re-exporting from both. That
 * is tidier and it was not done, because it would touch `providers/types.ts`,
 * `providers/groq.ts` and `pipeline-generate.ts` to move a class that is
 * already correct, in the same commit range as a new feature -- and a
 * regression in either would be indistinguishable from a regression in the
 * other. If a third consumer appears, that is the moment to lift it.
 */
export { ProviderRetryableError } from '../providers/types.ts';

/**
 * Which embedder produced a vector. Recorded on every row.
 *
 * Deliberately not `string`: the value is written to `chunk_embeddings.model`
 * and compared against what the search is querying with, so a typo needs to be
 * a compile error rather than a table quietly holding two vector spaces.
 *
 * There is no `'stub'` member. See the header -- that absence is load-bearing.
 */
export type EmbeddingProviderName = 'openai';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;

  /**
   * The model id, as configuration named it.
   *
   * Written to `chunk_embeddings.model` on every row, which is the only way to
   * discover after the fact that a corpus holds vectors from two models. The
   * provider name alone is not enough: OpenAI serves several embedding models
   * at different dimensions, and mixing two of *those* is as broken as mixing
   * two vendors.
   */
  readonly model: string;

  /**
   * How many floats a vector from this model has.
   *
   * On the interface rather than left implicit, because the column is
   * `vector(n)` and `n` has to match. `resolveEmbeddingProvider()` asserts this
   * against `EMBEDDING_DIMENSIONS` at resolution time so a mismatch is a
   * startup error naming both numbers -- not a Postgres type error arriving
   * mid-question, which reads like the database is broken rather than like a
   * model was swapped.
   */
  readonly dimensions: number;

  /**
   * Embed a batch, returning one vector per input **in the same order**.
   *
   * ── Batched, and the order guarantee is part of the contract ───────────
   *
   * Vendors charge and rate-limit per request, so embedding twenty chunks in
   * one call is both cheaper and far less likely to hit a limit than twenty
   * calls. But the real reason the signature is an array is the ordering: the
   * caller has a chunk index for every text and has to write each vector back
   * against the right one. A caller forced to zip results to inputs by hand is
   * a caller that will eventually zip them wrong -- and a mis-zipped embedding
   * is invisible, because every row still has a plausible vector. It just
   * belongs to a different passage.
   *
   * So implementations must return exactly `texts.length` vectors, in order,
   * or throw. Returning a short array is not an acceptable partial success:
   * there is no way for the caller to tell which input was dropped.
   */
  embed(texts: string[]): Promise<number[][]>;
}
