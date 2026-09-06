/**
 * The `generations` table: the audit trail, the cost record, and the only place
 * quota lives. P10 task 8, moving it off Supabase.
 *
 * Every statement carries `where user_id = $1` (ADR 0008).
 *
 * ── Quota is counted, never tracked ───────────────────────────────────────
 *
 * SPEC §5.5: no counter column, no cache. A counter drifts the first time a
 * write fails halfway; a sum over rows that already exist for audit reasons
 * cannot. What changed at P10 is only the arithmetic -- `sum(units)` rather
 * than `count(*)`, because one row is no longer one model call (see migration
 * 0005).
 *
 * ── The policy is not here ────────────────────────────────────────────────
 *
 * This module counts. `src/lib/quota.ts` decides, and is shared with the client
 * so the "units left" on the screen and the refusal from the API are the same
 * code rather than two readings of one comment. Adding a threshold here would
 * be the second implementation of a rule that already exists.
 */

import { query } from '../lib/db.ts';
import type { GenSource } from '../lib/rows.ts';

/**
 * Units already spent this calendar month, and how many jobs are in flight.
 *
 * Three numbers in one round trip rather than three queries: this runs on the
 * dispatch path of every job, before anything is spent, so it is directly in
 * the user's latency budget.
 *
 * `filter` rather than three separate scans -- one pass over
 * `generations_user_time_units_idx`, which includes `units` precisely so the
 * sum is index-only.
 *
 * **`coalesce` matters.** `sum()` over no rows is null, not zero, and a null
 * arriving where the policy expects a number would compare false against every
 * threshold -- a user with no history would be refused, or worse, allowed
 * without limit depending on which way the comparison fell.
 */
export interface GenerationCountsRow {
  usedThisMonth: number;
  inWindow: number;
  running: number;
}

export async function readGenerationCounts(
  userId: string,
  window: { monthStart: Date; monthEnd: Date; windowStart: Date; staleBefore: Date },
): Promise<GenerationCountsRow> {
  const result = await query<GenerationCountsRow>(
    `select
       coalesce(sum(units) filter (
         where created_at >= $2 and created_at < $3
           -- "You spend an allowance when you get cards, or while a generation
           -- is still running." A row that ended with nothing -- refused, or
           -- failed on a provider error -- cost the user nothing. Mirrors
           -- countsTowardQuota in src/lib/quota.ts.
           and (cards_returned > 0 or (status = 'running' and created_at >= $5))
       ), 0)::int as "usedThisMonth",
       count(*) filter (
         -- A row with no deck never reached the provider: the deck is created
         -- in the same breath as the dispatch. Refusing a request must not then
         -- rate-limit the user for having asked.
         where created_at >= $4 and deck_id is not null
       )::int as "inWindow",
       count(*) filter (
         where status = 'running' and created_at >= $5
       )::int as running
     from public.generations
     where user_id = $1`,
    [userId, window.monthStart, window.monthEnd, window.windowStart, window.staleBefore],
  );

  // `select` with aggregates always returns exactly one row, even over no data.
  const row = result.rows[0];
  if (!row) throw new Error('Aggregate query returned no row.');
  return row;
}

export interface GenerationInsert {
  deckId: string | null;
  source: GenSource;
  model: string;
  inputChars: number;
  cardsRequested: number;
  /**
   * What this job costs. One per chunk, from `unitsForChunks`.
   *
   * No default anywhere in the stack: the column is `not null` with its default
   * dropped (migration 0005), so a caller that forgets fails loudly rather than
   * under-charging a 40-chunk document as though it were one call.
   */
  units: number;
  status?: string;
}

/**
 * Record a generation at dispatch, after the quota check has allowed it.
 *
 * Written *before* the work runs, with `status = 'running'`, which is what makes
 * the concurrency limit real: three tabs opened at once each see the others'
 * rows. A row written afterwards would count nothing while it mattered most.
 */
export async function createGeneration(
  userId: string,
  input: GenerationInsert,
): Promise<{ id: string }> {
  const result = await query<{ id: string }>(
    `insert into public.generations
       (user_id, deck_id, source, model, input_chars, cards_requested, units, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      userId,
      input.deckId,
      input.source,
      input.model,
      input.inputChars,
      input.cardsRequested,
      input.units,
      input.status ?? 'running',
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

/**
 * Close a generation out once the job has finished.
 *
 * `units` is deliberately **not** updatable. What a job cost was decided before
 * it ran and is what the user was charged against; letting the finaliser revise
 * it would mean the number that refused a request and the number recorded
 * against it could differ, and a user could be charged for work they were never
 * told the price of. A job that fanned out over fewer chunks than expected is a
 * refund question, and this phase does not have one -- see the plan.
 */
export async function finishGeneration(
  userId: string,
  generationId: string,
  result: {
    status: 'succeeded' | 'failed' | 'refused';
    cardsReturned: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await query(
    `update public.generations
        set status = $3,
            cards_returned = $4,
            input_tokens = $5,
            output_tokens = $6,
            error = $7,
            finished_at = now()
      where id = $2 and user_id = $1`,
    [
      userId,
      generationId,
      result.status,
      result.cardsReturned,
      result.inputTokens ?? null,
      result.outputTokens ?? null,
      result.error ?? null,
    ],
  );
}
