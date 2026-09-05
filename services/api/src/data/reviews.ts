/**
 * The `reviews` table, and the two RPCs that write it.
 *
 * ── Why these are function calls and not statements ───────────────────────
 *
 * Rating a card writes a review row and reschedules the card, and a crash
 * between the two leaves a card whose schedule does not match its history. That
 * is why `review_card` exists: one transaction, in the database, with the
 * optimistic-concurrency check inside it (SPEC §4.2).
 *
 * Both functions take `p_user_id` as their **first parameter** and filter every
 * statement inside on it — see the header of
 * `services/api/migrations/0002_review_card.sql` for why that is the sharpest
 * edge in this phase. The Supabase originals filtered on nothing at all and
 * were correct anyway, because RLS refused the row first. They would not be
 * correct here.
 *
 * `p_user_id` arrives from the verified JWT, through the handler, and from
 * nowhere else.
 */

import { query } from '../lib/db.ts';
import type { CardRow, SchedulingUpdate } from '../lib/rows.ts';

/**
 * Rate a card: log the review and reschedule, atomically.
 *
 * `expectedUpdatedAt` is the optimistic-concurrency token — the `updated_at`
 * the client was shown. If the card has moved since (the same card rated in
 * another tab), the function raises `PT409` and nothing is written. It is
 * passed through exactly as it was received: a reformatted timestamp would
 * never match, which is why `lib/db.ts` hands timestamps back as the strings
 * Postgres produced rather than as `Date` objects.
 *
 * `durationMs` is genuinely nullable — a card can be rated before any timer
 * started, and `reviews.duration_ms` is nullable for exactly that. It is not
 * coerced to zero, which would read as "answered instantly".
 */
export async function reviewCard(
  userId: string,
  cardId: string,
  input: {
    rating: number;
    durationMs: number | null;
    expectedUpdatedAt: string;
    next: SchedulingUpdate;
  },
): Promise<CardRow> {
  const result = await query<CardRow>(
    `select * from public.review_card($1, $2, $3::smallint, $4::int, $5::timestamptz, $6::jsonb)`,
    [
      userId,
      cardId,
      input.rating,
      input.durationMs,
      input.expectedUpdatedAt,
      JSON.stringify(input.next),
    ],
  );
  const row = result.rows[0];
  // The function raises rather than returning nothing, so a missing row here
  // means the function's contract changed — not a case the caller can handle.
  if (!row) throw new Error('review_card returned no row.');
  return row;
}

/**
 * Undo the most recent rating on a card (SPEC §4.2).
 *
 * The review row is tombstoned, never deleted: an undone rating is real history
 * that a future FSRS optimiser may want, and the `reviews_tombstone_only`
 * trigger is what stops this laundering a bad rating out of the log.
 */
export async function undoLastReview(userId: string, cardId: string): Promise<CardRow> {
  const result = await query<CardRow>(
    `select * from public.undo_last_review($1, $2)`,
    [userId, cardId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('undo_last_review returned no row.');
  return row;
}

// ---------------------------------------------------------------------------
// Progress reads
//
// **Nothing calls these during P9.** /progress stays on Supabase for this phase
// (the split table in docs/plans/P9-aws-slice.md), because porting the whole
// aggregate is work Phase F has to do anyway and doing it now would mean
// building the page twice.
//
// They are written here, under the same `userId` rule as everything else, so
// Phase F inherits a correct data layer rather than repeating the analysis in
// 0002_review_card.sql's header — and so nobody discovers in Phase F that the
// obvious port of a `security invoker` aggregate reads every user's reviews.
// ---------------------------------------------------------------------------

export interface ReviewDayCount {
  day: string;
  reviews: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  introduced: number;
}

/**
 * Reviews per study day, aggregated in Postgres.
 *
 * A serious user's year is ~70,000 review rows and this returns at most 365 of
 * them. Fetching them to count them would not survive SPEC §10's performance
 * budget.
 */
export async function reviewDayCounts(
  userId: string,
  params: { timeZone: string; from: Date },
): Promise<ReviewDayCount[]> {
  const result = await query<ReviewDayCount>(
    `select day::text as day, reviews, again, hard, good, easy, introduced
       from public.review_day_counts($1, $2, $3::timestamptz)`,
    [userId, params.timeZone, params.from.toISOString()],
  );
  return result.rows;
}

/** The columns `countable()` in `src/lib/progress.ts` needs, and no more. */
export interface RetentionReviewRow {
  rating: number;
  state_before: string;
  reviewed_at: string;
  undone_at: string | null;
  stability_after: number | null;
  difficulty_after: number | null;
}

/**
 * Reviews inside the retention window.
 *
 * Six columns, because row count is the cost here — a heavy user's 90 days is
 * thousands of rows and `select *` would drag the whole FSRS snapshot along
 * with each one. `undone_at` is filtered *and* selected, so the client-side
 * `countable()` has something real to filter and the exclusion is provable
 * rather than assumed.
 */
export async function listRetentionReviews(
  userId: string,
  from: Date,
): Promise<RetentionReviewRow[]> {
  const result = await query<RetentionReviewRow>(
    `select rating, state_before, reviewed_at, undone_at,
            stability_after, difficulty_after
       from public.reviews
      where user_id = $1 and undone_at is null and reviewed_at >= $2
      order by reviewed_at asc`,
    [userId, from.toISOString()],
  );
  return result.rows;
}

/** The card-state mix behind the distribution and memory-strength charts. */
export interface CardStateRow {
  fsrs_state: string;
  stability: number | null;
  difficulty: number | null;
}

export async function listCardStates(userId: string): Promise<CardStateRow[]> {
  const result = await query<CardStateRow>(
    `select fsrs_state, stability, difficulty
       from public.cards
      where user_id = $1 and status = 'active'`,
    [userId],
  );
  return result.rows;
}

/** Scheduled cards inside the forecast horizon. */
export interface ForecastCardRow {
  due: string;
  fsrs_state: string;
}

export async function listForecastCards(
  userId: string,
  horizon: Date,
): Promise<ForecastCardRow[]> {
  const result = await query<ForecastCardRow>(
    `select due, fsrs_state
       from public.cards
      where user_id = $1 and status = 'active' and fsrs_state <> 'new' and due < $2`,
    [userId, horizon.toISOString()],
  );
  return result.rows;
}
