import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideGeneration,
  monthWindow,
  quotaCountFilter,
  rateWindowStart,
  remainingUnits,
  staleRunningBefore,
  type GenerationDecision,
} from '../../../src/lib/quota.ts';

/**
 * Counting the `generations` table, which is the only place quota lives.
 *
 * SPEC §5.5: no counter column, no cache. Three `head: true` counts against
 * `generations_user_time_idx` — the rows are never fetched, only counted — and
 * the policy that reads them is `src/lib/quota.ts`, shared with the client so
 * the remaining-budget figure on the screen is produced by the same code that
 * refuses the request.
 *
 * The counts run as the caller (SPEC §5.7), so RLS is what scopes them to this
 * user. The explicit `user_id` filter is not a substitute for that; it is what
 * lets Postgres use the index.
 */

export type QuotaCheck = GenerationDecision & {
  usedThisMonth: number;
  remaining: number;
};

export async function checkGenerationAllowed(
  supabase: SupabaseClient,
  userId: string,
  promptChars: number,
  now: Date,
): Promise<QuotaCheck> {
  const month = monthWindow(now);

  const [used, recent, running] = await Promise.all([
    supabase
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', month.start.toISOString())
      .lt('created_at', month.end.toISOString())
      // "Cards, or still running" — see countsTowardQuota. A generation that
      // ended with nothing costs the user nothing.
      .or(quotaCountFilter(now)),

    supabase
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', rateWindowStart(now).toISOString())
      // A row with no deck never reached the provider: the deck is created in
      // the same breath as the dispatch. Those are exactly the pre-flight
      // refusals, and refusing a request must not then rate-limit the user for
      // having asked.
      .not('deck_id', 'is', null),

    supabase
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'running')
      // Older than this and it is a crashed worker, not a generation in flight.
      .gte('created_at', staleRunningBefore(now).toISOString()),
  ]);

  if (used.error) throw used.error;
  if (recent.error) throw recent.error;
  if (running.error) throw running.error;

  const usedThisMonth = used.count ?? 0;
  const decision = decideGeneration({
    usedThisMonth,
    inWindow: recent.count ?? 0,
    running: running.count ?? 0,
    // One pasted passage is one model call, so it costs exactly one unit -- the
    // pricing this path has always had, now stated in the units the policy
    // counts in. Documents are the multi-unit case and they do not come through
    // here; they go through `POST /jobs` on the API, which prices the whole
    // fan-out before dispatching it (P10 task 8).
    //
    // This function is on borrowed time regardless: task 9 moves /create/text
    // onto the same pipeline and deletes it.
    units: 1,
    promptChars,
  });

  return {
    ...decision,
    usedThisMonth,
    remaining: remainingUnits(usedThisMonth),
  };
}
