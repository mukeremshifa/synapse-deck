/**
 * Closing the books on a job. The state machine's last step. P10 task 5.
 *
 * ── The deck lifecycle this preserves ─────────────────────────────────────
 *
 * A job that produced cards leaves its deck `'draft'` — the review gate's
 * resumable state — and one that produced none leaves it `'failed'`, which is
 * what keeps an empty deck out of the deck list instead of leaving the user
 * something to tidy up.
 *
 * That contract is inherited from the Edge Function it replaces
 * (`supabase/functions/generate-cards/index.ts`), and it is load-bearing: after
 * P10 task 4 removed `cards.status = 'draft'`, `decks.status = 'draft'` is the
 * *only* thing marking a deck resumable, and it is what the deck list reads.
 * Getting this wrong does not throw — it silently loses the way back into the
 * review gate.
 *
 * ── Partial failure is a success ──────────────────────────────────────────
 *
 * "31 of 40 chunks produced cards" is the normal case (task 6). A job whose
 * chunks partly failed is `'succeeded'` if *any* cards arrived: discarding 31
 * good chunks because 9 failed is worse than admitting the gap, and the gap is
 * carried in the per-chunk records for the UI to report honestly.
 *
 * Only a job where nothing at all arrived is `'failed'`.
 */

import { getJobWithChunks, updateJobStatus } from '../data/jobs.ts';
import { setDeckStatus } from '../data/decks.ts';

export interface FinaliseInput {
  userId: string;
  jobId: string;
}

export interface FinaliseOutput {
  jobId: string;
  status: 'succeeded' | 'failed';
  cardsGenerated: number;
  chunksSucceeded: number;
  chunksFailed: number;
}

export async function handler(input: FinaliseInput): Promise<FinaliseOutput> {
  const { userId, jobId } = input;

  const { job, chunks } = await getJobWithChunks(userId, jobId);

  const succeeded = chunks.filter((chunk) => chunk.status === 'succeeded');
  const failed = chunks.filter((chunk) => chunk.status === 'failed');
  const cardsGenerated = succeeded.reduce((total, chunk) => total + chunk.cards.length, 0);

  const status = cardsGenerated > 0 ? 'succeeded' : 'failed';

  await updateJobStatus(userId, jobId, status, {
    error:
      status === 'failed'
        ? 'No cards could be written from this document.'
        : null,
  });

  // The deck follows the job. Guarded on `deckId` because a job may legitimately
  // have none yet — the deck is created with the job today, but a future entry
  // point that generates before a deck exists should not crash here.
  if (job?.deckId != null) {
    await setDeckStatus(userId, job.deckId, cardsGenerated > 0 ? 'draft' : 'failed');
  }

  return {
    jobId,
    status,
    cardsGenerated,
    chunksSucceeded: succeeded.length,
    chunksFailed: failed.length,
  };
}
