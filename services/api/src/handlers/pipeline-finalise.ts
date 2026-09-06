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
import {
  finishGeneration,
  findRunningGenerationForDeck,
} from '../data/generations.ts';

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

    /*
     * ── Close the generation row out. DS1, and it was missing. ────────────
     *
     * `handlers/jobs.ts` writes a `generations` row with `status = 'running'`
     * **before** the work starts, because that is what makes the concurrency
     * limit real — three tabs opened at once each see the others' rows. Nothing
     * ever closed it again: through all of P10 the pipeline had never actually
     * run, so the row stayed `running` and nobody saw it.
     *
     * Running it once made the consequence obvious and it is worse than an
     * untidy table. Two things follow from a row that never leaves `running`:
     *
     *   1. **The next job is refused.** `decideGeneration` counts running rows
     *      against the concurrency limit, so one finished generation blocks
     *      every subsequent one until the row ages past `staleRunningMinutes`.
     *      The user is told to "wait for it to finish" about a job that has
     *      already finished.
     *   2. **The cost trail is empty.** `cards_returned` stays 0 and the token
     *      counts stay null, so the audit trail records that something was
     *      charged for and nothing about what it produced.
     *
     * Guarded on finding an open row, so finalising a job twice is a no-op
     * rather than an error — which matters more here than it did on Step
     * Functions, because a retried execution is a normal event.
     */
    const generation = await findRunningGenerationForDeck(userId, job.deckId);
    if (generation !== null) {
      await finishGeneration(userId, generation.id, {
        status,
        cardsReturned: cardsGenerated,
        // Deliberately null rather than a sum over the chunks. Token counts are
        // returned per model call and are not carried on the chunk records, so
        // totalling them would mean widening the record shape in both job
        // stores. Recording null is honest; inventing a total is not, and
        // `stub.ts` makes the same argument about fabricated numbers.
        inputTokens: null,
        outputTokens: null,
        error:
          status === 'failed' ? 'No cards could be written from this document.' : null,
      });
    }
  }

  return {
    jobId,
    status,
    cardsGenerated,
    chunksSucceeded: succeeded.length,
    chunksFailed: failed.length,
  };
}
