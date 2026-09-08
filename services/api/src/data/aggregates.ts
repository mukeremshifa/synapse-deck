/**
 * The five notebook aggregates, reduced in SQL.
 *
 * **FR6 §8.3: three of these are not optional.** The row counts are the whole
 * argument, and they are the counts FR6 §6.3 measured rather than guessed:
 *
 *   getReviewHistory  ~70,000 review rows in for a serious user's year, ≤365 out
 *   getRetention      thousands of review rows in, one object out
 *   getTopicMastery   every active card in the notebook in, one row per topic out
 *   getCardStates     same shape, cheaper
 *   getDueForecast    same shape, cheaper
 *
 * A client cannot produce the first three without fetching data no API should
 * ship. The Supabase version fetched every review inside 90 days and reduced it
 * in the browser; this reduces it in Postgres, and the difference on the wire is
 * thousands of rows against one object.
 *
 * Every statement carries `where user_id = $1` (ADR 0008). Every one is
 * additionally notebook-scoped, joining `cards → artifacts` or
 * `reviews → cards → artifacts`, with `user_id` filtered on **each** table
 * rather than trusted through the join.
 *
 * ── Tombstoned reviews are excluded, everywhere ───────────────────────────
 *
 * `reviews.undone_at is not null` marks a rating the user undid. The row stays —
 * the log is append-only and a future FSRS optimiser may want it — but **every
 * aggregate must exclude it**, which the fake's `countableReviews` is the
 * reference for. A history that counts undone ratings reports study that did not
 * happen.
 *
 * ── The study day, and why the zone is passed in ──────────────────────────
 *
 * Days are bucketed in the *user's* timezone, not UTC. Computing a streak in UTC
 * silently breaks it for most of the world: a review at 23:00 in UTC+4 lands on
 * the previous UTC day and splits a streak that never broke. `at time zone $n`
 * does the conversion in Postgres, which is where the calendar arithmetic
 * belongs — `src/lib/day.ts` does the same thing client-side for display.
 */

import { query } from '../lib/db.ts';
import type { FsrsState } from '../lib/rows.ts';

/**
 * `reviews` joined to the notebook, tombstones excluded.
 *
 * Reused by the history and the retention summary, which is why it is a
 * fragment rather than repeated: the two must agree about what counts as a
 * review, and the way to guarantee that is to write it once.
 */
const COUNTABLE_REVIEWS = `
  from public.reviews r
  join public.cards c on c.id = r.card_id
  join public.artifacts a on a.id = c.artifact_id
 where r.user_id = $1
   and c.user_id = $1
   and a.user_id = $1
   and a.notebook_id = $2
   and r.undone_at is null`;

export interface DayCount {
  day: string;
  reviews: number;
}

/**
 * Reviews per study day, for the heatmap.
 *
 * Returns only days that have reviews; the caller fills the gaps, because a
 * year of zeroes is 365 rows of nothing and the client has to build a dense
 * grid anyway.
 */
export async function reviewHistory(
  userId: string,
  notebookId: string,
  timeZone: string,
  days: number,
): Promise<{ days: DayCount[]; total: number }> {
  const result = await query<{ day: string; reviews: string }>(
    `select to_char((r.reviewed_at at time zone $3)::date, 'YYYY-MM-DD') as day,
            count(*) as reviews
     ${COUNTABLE_REVIEWS}
       and r.reviewed_at >= now() - make_interval(days => $4)
     group by 1
     order by 1`,
    [userId, notebookId, timeZone, days],
  );

  const rows = result.rows.map(row => ({
    day: row.day,
    reviews: Number(row.reviews),
  }));
  return {
    days: rows,
    total: rows.reduce((sum, row) => sum + row.reviews, 0),
  };
}

export interface RetentionResult {
  overall: { reviewed: number; recalled: number };
  byState: Record<FsrsState, { reviewed: number; recalled: number }>;
}

/**
 * Retention over a window, bucketed by the state the card was in.
 *
 * **`rating >= 2` is a successful recall** — Hard or better, `RECALLED_FROM` in
 * `src/lib/progress.ts` (SPEC §4.4). Again (1) is the only failure. That
 * threshold is the one number in this file that is policy rather than
 * arithmetic, and it is duplicated from the client's reviewed implementation on
 * purpose: the alternative is shipping the enum to Postgres.
 *
 * Counted, not averaged, so the caller can render "recalled 47 of 52" beside the
 * percentage — a bare 90% over ten reviews and over a thousand are different
 * claims, and the contract carries both numbers for that reason.
 */
export async function retention(
  userId: string,
  notebookId: string,
  days: number,
): Promise<RetentionResult> {
  const result = await query<{
    state_before: FsrsState;
    reviewed: string;
    recalled: string;
  }>(
    `select r.state_before,
            count(*) as reviewed,
            count(*) filter (where r.rating >= 2) as recalled
     ${COUNTABLE_REVIEWS}
       and r.reviewed_at >= now() - make_interval(days => $3)
     group by r.state_before`,
    [userId, notebookId, days],
  );

  const empty = () => ({ reviewed: 0, recalled: 0 });
  const byState: Record<FsrsState, { reviewed: number; recalled: number }> = {
    new: empty(),
    learning: empty(),
    review: empty(),
    relearning: empty(),
  };
  const overall = empty();

  for (const row of result.rows) {
    const bucket = byState[row.state_before];
    // A state Postgres returned that the enum does not name cannot happen —
    // the column is the enum — so this is a narrowing, not a case to handle.
    if (!bucket) continue;
    bucket.reviewed = Number(row.reviewed);
    bucket.recalled = Number(row.recalled);
    overall.reviewed += bucket.reviewed;
    overall.recalled += bucket.recalled;
  }

  return { overall, byState };
}

export interface CardStatesResult {
  counts: Record<FsrsState | 'suspended', number>;
  meanStability: number | null;
  meanDifficulty: number | null;
}

/**
 * The card-state mix across a notebook's decks.
 *
 * `suspended` is a *status*, not an FSRS state, so a suspended card is counted
 * only there and excluded from the four state buckets — otherwise the columns
 * sum to more than the deck holds.
 *
 * The means are over reviewed cards only. `avg` ignores nulls, and a new card
 * has null stability, so this falls out of SQL rather than needing a filter —
 * but the contract's "null when nothing has been reviewed, which is not zero"
 * still has to survive the trip, hence the explicit null check on the way out.
 */
export async function cardStates(
  userId: string,
  notebookId: string,
): Promise<CardStatesResult> {
  const result = await query<{
    new: string;
    learning: string;
    review: string;
    relearning: string;
    suspended: string;
    mean_stability: string | null;
    mean_difficulty: string | null;
  }>(
    `select
       count(*) filter (where c.status = 'active' and c.fsrs_state = 'new')        as new,
       count(*) filter (where c.status = 'active' and c.fsrs_state = 'learning')   as learning,
       count(*) filter (where c.status = 'active' and c.fsrs_state = 'review')     as review,
       count(*) filter (where c.status = 'active' and c.fsrs_state = 'relearning') as relearning,
       count(*) filter (where c.status = 'suspended')                              as suspended,
       avg(c.stability) filter (where c.status = 'active')  as mean_stability,
       avg(c.difficulty) filter (where c.status = 'active') as mean_difficulty
       from public.cards c
       join public.artifacts a on a.id = c.artifact_id
      where c.user_id = $1 and a.user_id = $1 and a.notebook_id = $2`,
    [userId, notebookId],
  );

  const row = result.rows[0];
  const n = (value: string | undefined) => Number(value ?? 0);
  return {
    counts: {
      new: n(row?.new),
      learning: n(row?.learning),
      review: n(row?.review),
      relearning: n(row?.relearning),
      suspended: n(row?.suspended),
    },
    meanStability: row?.mean_stability == null ? null : Number(row.mean_stability),
    meanDifficulty: row?.mean_difficulty == null ? null : Number(row.mean_difficulty),
  };
}

/**
 * Due cards per study day for the next `days`.
 *
 * **Day 0 carries the overdue**, which is what makes the forecast agree with
 * what practice would actually serve: a card three days late is due today, not
 * three days ago, and a forecast that buckets it in the past shows an empty
 * today beside a full queue. `greatest(due, now)` does that, and it is the one
 * place this query is not a straight `group by`.
 *
 * ── `fresh` is NOT computed here, and that is the deliberate fix ──────────
 *
 * FR6 §8.3 flagged this: the daily new-card cap is client-side policy by design
 * — one policy drives the practice queue, home's "new available" and this
 * forecast's day 0 — and a server-side `fresh` would be a *second*
 * implementation of it. Two implementations of one policy disagree, and then
 * the forecast and the queue report different numbers for the same minute.
 *
 * So this returns the **inputs**: how many new cards exist, and how many were
 * introduced today. The handler applies `dailyNewLimit` from the profile, once,
 * using the same arithmetic the queue uses. The cap stays one decision.
 */
export async function dueForecast(
  userId: string,
  notebookId: string,
  timeZone: string,
  days: number,
): Promise<{
  days: { day: string; due: number }[];
  newAvailable: number;
  introducedToday: number;
}> {
  const dueRows = await query<{ day: string; due: string }>(
    `select to_char((greatest(c.due, now()) at time zone $3)::date, 'YYYY-MM-DD') as day,
            count(*) as due
       from public.cards c
       join public.artifacts a on a.id = c.artifact_id
      where c.user_id = $1
        and a.user_id = $1
        and a.notebook_id = $2
        and c.status = 'active'
        and c.fsrs_state <> 'new'
        and c.due < (now() at time zone $3)::date + make_interval(days => $4)
      group by 1
      order by 1`,
    [userId, notebookId, timeZone, days],
  );

  const inputs = await query<{ new_available: string; introduced_today: string }>(
    `select
       (select count(*)
          from public.cards c
          join public.artifacts a on a.id = c.artifact_id
         where c.user_id = $1 and a.user_id = $1 and a.notebook_id = $2
           and c.status = 'active' and c.fsrs_state = 'new') as new_available,
       (select count(*)
          from public.reviews r
          join public.cards c on c.id = r.card_id
          join public.artifacts a on a.id = c.artifact_id
         where r.user_id = $1 and c.user_id = $1 and a.user_id = $1
           and a.notebook_id = $2
           and r.undone_at is null
           and r.state_before = 'new'
           and (r.reviewed_at at time zone $3)::date
               = (now() at time zone $3)::date) as introduced_today`,
    [userId, notebookId, timeZone],
  );

  const row = inputs.rows[0];
  return {
    days: dueRows.rows.map(entry => ({ day: entry.day, due: Number(entry.due) })),
    newAvailable: Number(row?.new_available ?? 0),
    introducedToday: Number(row?.introduced_today ?? 0),
  };
}

/**
 * The cards topic mastery is computed over.
 *
 * **Only the five columns `mastery.ts` reads.** That module is the reviewed
 * arithmetic for this — the forgetting curve, the confidence weighting, the
 * divergence — and reimplementing it in SQL would mean two versions of a model
 * that is genuinely subtle. So the reduction that must happen server-side is the
 * *fetch*: one row per card, five columns, rather than the whole card table.
 *
 * `cardsConsidered` in the report is `rows.length`, which is why this returns
 * the rows rather than a count.
 */
export async function masteryCards(
  userId: string,
  notebookId: string,
): Promise<
  {
    topicId: string | null;
    topicName: string | null;
    fsrs_state: FsrsState;
    stability: number | null;
    difficulty: number | null;
    last_reviewed_at: string | null;
  }[]
> {
  const result = await query<{
    topicId: string | null;
    topicName: string | null;
    fsrs_state: FsrsState;
    stability: number | null;
    difficulty: number | null;
    last_reviewed_at: string | null;
  }>(
    `select c.topic_id as "topicId",
            t.name     as "topicName",
            c.fsrs_state,
            c.stability,
            c.difficulty,
            c.last_review as last_reviewed_at
       from public.cards c
       join public.artifacts a on a.id = c.artifact_id
       left join public.topics t on t.id = c.topic_id and t.user_id = $1
      where c.user_id = $1
        and a.user_id = $1
        and a.notebook_id = $2
        and c.status = 'active'`,
    [userId, notebookId],
  );
  return result.rows;
}

/** The attempt answers the exam half of mastery is computed over. */
export async function masteryAnswers(
  userId: string,
  notebookId: string,
): Promise<
  {
    topicId: string | null;
    topicName: string | null;
    correct: boolean;
    answered_at: string;
  }[]
> {
  const result = await query<{
    topicId: string | null;
    topicName: string | null;
    correct: boolean;
    answered_at: string;
  }>(
    `select aa.topic_id as "topicId",
            aa.topic_name as "topicName",
            aa.correct,
            aa.answered_at
       from public.attempt_answers aa
       join public.attempts att on att.id = aa.attempt_id
      where aa.user_id = $1
        and att.user_id = $1
        and att.notebook_id = $2
        and att.outcome = 'submitted'
        and aa.selected_option is not null`,
    [userId, notebookId],
  );
  return result.rows;
}

/**
 * A notebook's topics, reconciled and counted.
 *
 * `unfiledCards` is carried separately because it is neither a topic nor an
 * error: a card whose chunk yielded no topic is unfiled, and the contract's
 * `TopicSummary` keeps it out of the topic list rather than inventing a row
 * for it.
 */
export async function topicSummary(
  userId: string,
  notebookId: string,
): Promise<{
  topics: { id: string; name: string; cardCount: number }[];
  unfiledCards: number;
}> {
  const topics = await query<{ id: string; name: string; card_count: string }>(
    `select t.id, t.name, count(c.id) as card_count
       from public.topics t
       left join public.cards c
         on c.topic_id = t.id
        and c.user_id = $1
        and c.status = 'active'
        and c.artifact_id in (
          select id from public.artifacts where user_id = $1 and notebook_id = $2
        )
      where t.user_id = $1 and t.notebook_id = $2
      group by t.id, t.name
      order by t.name`,
    [userId, notebookId],
  );

  const unfiled = await query<{ n: string }>(
    `select count(*) as n
       from public.cards c
       join public.artifacts a on a.id = c.artifact_id
      where c.user_id = $1
        and a.user_id = $1
        and a.notebook_id = $2
        and c.status = 'active'
        and c.topic_id is null`,
    [userId, notebookId],
  );

  return {
    topics: topics.rows.map(row => ({
      id: row.id,
      name: row.name,
      cardCount: Number(row.card_count),
    })),
    unfiledCards: Number(unfiled.rows[0]?.n ?? 0),
  };
}
