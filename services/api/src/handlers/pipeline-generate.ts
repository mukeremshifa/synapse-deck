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
 */

import { completeChunk, getChunkText } from '../data/jobs.ts';
import { resolveProvider, ProviderRetryableError } from '../lib/providers/index.ts';
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
      throw error;
    }
    await completeChunk(userId, jobId, chunkIndex, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'The card writer failed.',
    });
    return { chunkIndex, status: 'failed', cardCount: 0 };
  }

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
  });

  return { chunkIndex, status: 'succeeded', cardCount: valid.length };
}
