/**
 * The `cards` table: content, scheduling state, and the practice queue's reads.
 *
 * Every statement carries `where user_id = $1`. The bulk operations below take
 * arrays of ids from the client and are the sharpest case for it: a caller who
 * slips someone else's card id into a list of their own must have that one id
 * silently do nothing, not update a stranger's row. `= any($2)` combined with
 * `and user_id = $1` is what makes the mismatch a no-op rather than a leak, and
 * the returned id list is how the handler reports what actually happened.
 */

import { query } from '../lib/db.ts';
import type { CardRow, CardStatus, FsrsState } from '../lib/rows.ts';

/**
 * Cards are selected whole. Every column is used somewhere — content to render,
 * scheduling to grade against, `updated_at` as the optimistic-concurrency token
 * — and a hand-maintained list is one more place to forget a migration.
 *
 * `user_id` comes back too, unlike the Supabase version which had no reason to
 * select it. It is what lets a handler log which account a row belonged to
 * without a second query, and the client ignores it.
 */
const COLUMNS = '*';

export async function listDeckCards(userId: string, deckId: string): Promise<CardRow[]> {
  const result = await query<CardRow>(
    `select ${COLUMNS} from public.cards
      where user_id = $1 and deck_id = $2 and status <> 'archived'
      order by created_at asc`,
    [userId, deckId],
  );
  return result.rows;
}

export async function getCard(userId: string, cardId: string): Promise<CardRow | null> {
  const result = await query<CardRow>(
    `select ${COLUMNS} from public.cards where id = $2 and user_id = $1`,
    [userId, cardId],
  );
  return result.rows[0] ?? null;
}

export interface CardInsert {
  kind: string;
  payload: unknown;
  sourceExcerpt: string | null;
}

/** Fresh-card FSRS state, from `newCardScheduling` in `src/lib/fsrs.ts`. */
export interface FreshScheduling {
  fsrs_state: FsrsState;
  due: string;
  reps: number;
  lapses: number;
  scheduled_days: number;
  elapsed_days: number;
  learning_steps: number;
}

/**
 * Create one or more cards in a deck, all with the same fresh-card scheduling.
 *
 * `scheduling` is one value for the whole batch rather than a field on each
 * card, and that is the honest signature: every caller creates cards that have
 * never been reviewed, `newCardScheduling` returns the same thing for all of
 * them, and a per-card field would be a parameter that looks respected and is
 * not. A card with real FSRS state is written by `review_card`, never here.
 *
 * One statement for any number of cards, via `unnest`. The alternative — a
 * multi-row VALUES list built by string concatenation — is how a parameterised
 * query stops being parameterised, and RLS is no longer there to limit the
 * blast radius of an injection.
 *
 * **The deck is checked in the same statement.** Without it, a card could be
 * inserted with the caller's own `user_id` into a deck belonging to somebody
 * else: every row would pass an ownership check on `cards` and the deck would
 * still be poisoned. The `owned_deck` CTE is what makes an unowned deck insert
 * nothing at all — the cross join produces no rows.
 */
export async function createCards(
  userId: string,
  deckId: string,
  cards: readonly CardInsert[],
  scheduling: FreshScheduling,
): Promise<CardRow[]> {
  if (cards.length === 0) return [];

  const result = await query<CardRow>(
    `with owned_deck as (
       select id from public.decks where id = $2 and user_id = $1
     )
     insert into public.cards (
       user_id, deck_id, kind, payload, status, source_excerpt,
       fsrs_state, due, reps, lapses, scheduled_days, elapsed_days, learning_steps
     )
     select $1, owned_deck.id, k.kind::public.card_kind, k.payload, 'active',
            k.source_excerpt,
            $6::public.fsrs_state, $7::timestamptz, $8, $9, $10, $11, $12
       from owned_deck,
            unnest($3::text[], $4::jsonb[], $5::text[])
              as k(kind, payload, source_excerpt)
     returning ${COLUMNS}`,
    [
      userId,
      deckId,
      cards.map(c => c.kind),
      cards.map(c => JSON.stringify(c.payload)),
      cards.map(c => c.sourceExcerpt),
      scheduling.fsrs_state,
      scheduling.due,
      scheduling.reps,
      scheduling.lapses,
      scheduling.scheduled_days,
      scheduling.elapsed_days,
      scheduling.learning_steps,
    ],
  );
  return result.rows;
}

/**
 * Edit a card's content, and only its content.
 *
 * Editing must never disturb the schedule — that is the point of keeping
 * content and scheduling in separate columns (SPEC §5.3). A user fixing a typo
 * on a card they have reviewed for months does not expect to lose the interval.
 */
export async function updateCardContent(
  userId: string,
  cardId: string,
  content: { kind: string; payload: unknown },
): Promise<CardRow | null> {
  const result = await query<CardRow>(
    `update public.cards
        set kind = $3::public.card_kind, payload = $4::jsonb
      where id = $2 and user_id = $1
      returning ${COLUMNS}`,
    [userId, cardId, content.kind, JSON.stringify(content.payload)],
  );
  return result.rows[0] ?? null;
}

/**
 * Suspend or restore cards: out of the queue without losing their history.
 *
 * Returns the ids that actually changed. A id in the request that is not the
 * caller's simply is not in the result — the handler reports the count rather
 * than 403-ing, because saying "that one wasn't yours" is the oracle this API
 * refuses to be.
 */
export async function setCardStatus(
  userId: string,
  cardIds: readonly string[],
  status: Extract<CardStatus, 'active' | 'suspended'>,
): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const result = await query<{ id: string }>(
    `update public.cards
        set status = $3::public.card_status
      where user_id = $1 and id = any($2::uuid[])
      returning id`,
    [userId, cardIds, status],
  );
  return result.rows.map(row => row.id);
}

/**
 * Accept cards at the review gate.
 *
 * ── What changed at P10, and the guard that had to replace itself ─────────
 *
 * This used to read `... and status = 'draft'`, and that clause was doing real
 * work: it made accepting the same gate twice a no-op rather than resurrecting
 * a card the user had since suspended. Migration 0003 removed `'draft'` from
 * the enum, so the clause could not stay — but **dropping it without a
 * replacement would reintroduce exactly that bug**, quietly, as a side effect
 * of an enum change.
 *
 * The replacement is `status = 'suspended'`, and the narrowness is the point.
 * Acceptance must not be able to *resurrect* a card: `<> 'active'` would look
 * natural and would let a stale gate submission pull an `'archived'` card --
 * one the user deliberately put away -- back into the practice queue. Archived
 * is a terminal state chosen by the user, so it is excluded; `'active'` is
 * excluded because accepting a card twice should be a no-op. That leaves
 * `'suspended'`, which is the only status a card awaiting acceptance can now
 * hold.
 *
 * The returned id list is what tells the handler which cards actually moved, so
 * a submission naming cards that did not qualify reports honestly rather than
 * claiming success.
 *
 * The scheduling columns are deliberately untouched — the card was created with
 * fresh-card state, so accepting it drops it into the `new` queue with no
 * change to `fsrs.ts` or `review_card` (SPEC §4.1 step 6).
 */
export async function acceptDrafts(
  userId: string,
  cardIds: readonly string[],
): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const result = await query<{ id: string }>(
    `update public.cards
        set status = 'active'
      where user_id = $1 and id = any($2::uuid[]) and status = 'suspended'
      returning id`,
    [userId, cardIds],
  );
  return result.rows.map(row => row.id);
}

export async function deleteCards(
  userId: string,
  cardIds: readonly string[],
): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const result = await query<{ id: string }>(
    `delete from public.cards
      where user_id = $1 and id = any($2::uuid[])
      returning id`,
    [userId, cardIds],
  );
  return result.rows.map(row => row.id);
}

// ---------------------------------------------------------------------------
// The practice queue's reads
// ---------------------------------------------------------------------------

/**
 * The four reads a queue is assembled from, in one round trip.
 *
 * The client used to issue these as four parallel supabase-js calls. Over an
 * API they become one request, which is the difference between four cold-start
 * round trips and one — and on a VPC Lambda that is the whole latency budget.
 *
 * `buildQueue` in `src/lib/queue.ts` still applies the §6 policy on the client:
 * the policy is shared with the queue preview and the dashboard, and moving it
 * server-side would be the second implementation of it. What moves here is only
 * the fetching.
 */
export interface QueueReads {
  due: CardRow[];
  fresh: CardRow[];
  introducedToday: number;
  nextDueAt: string | null;
}

export async function readQueue(
  userId: string,
  params: {
    now: Date;
    dayStart: Date;
    dailyNewLimit: number;
    deckId: string | null;
    limit: number;
  },
): Promise<QueueReads> {
  const { now, dayStart, dailyNewLimit, deckId, limit } = params;
  const nowIso = now.toISOString();

  // `($4::uuid is null or deck_id = $4)` rather than building the clause
  // conditionally: one prepared statement shape, and no string concatenation
  // anywhere near a query.
  const [due, fresh, introduced, upcoming] = await Promise.all([
    query<CardRow>(
      `select ${COLUMNS} from public.cards
        where user_id = $1 and status = 'active'
          -- New cards come from the other stream; a new card is due at its
          -- creation time, so without this they appear twice and dodge the cap.
          and fsrs_state <> 'new'
          and due <= $2
          and ($4::uuid is null or deck_id = $4)
        order by due asc
        limit $3`,
      [userId, nowIso, limit, deckId],
    ),
    query<CardRow>(
      `select ${COLUMNS} from public.cards
        where user_id = $1 and status = 'active' and fsrs_state = 'new'
          and ($3::uuid is null or deck_id = $3)
        order by created_at asc
        limit $2`,
      [userId, Math.max(dailyNewLimit, 1), deckId],
    ),
    // Deliberately NOT deck-scoped. "How many new cards has this user started
    // today" is a fact about the account, not the deck: switching decks must
    // not hand out a second day's worth of new cards.
    query<{ n: number }>(
      `select count(*)::int as n from public.reviews
        where user_id = $1 and state_before = 'new' and undone_at is null
          and reviewed_at >= $2`,
      [userId, dayStart.toISOString()],
    ),
    query<{ due: string }>(
      `select due from public.cards
        where user_id = $1 and status = 'active' and fsrs_state <> 'new'
          and due > $2
          and ($3::uuid is null or deck_id = $3)
        order by due asc
        limit 1`,
      [userId, nowIso, deckId],
    ),
  ]);

  return {
    due: due.rows,
    fresh: fresh.rows,
    introducedToday: introduced.rows[0]?.n ?? 0,
    nextDueAt: upcoming.rows[0]?.due ?? null,
  };
}

/** The handful of numbers the dashboard shows. */
export interface DueSummaryReads {
  dueNow: number;
  newAvailable: number;
  reviewedToday: number;
  nextDueAt: string | null;
}

export async function readDueSummary(
  userId: string,
  params: { now: Date; dayStart: Date },
): Promise<DueSummaryReads> {
  const nowIso = params.now.toISOString();

  const [counts, reviewed, upcoming] = await Promise.all([
    // Two counts over the same partial index, in one pass rather than two.
    query<{ due_now: number; new_available: number }>(
      `select
         count(*) filter (where fsrs_state <> 'new' and due <= $2)::int as due_now,
         count(*) filter (where fsrs_state = 'new')::int                as new_available
       from public.cards
      where user_id = $1 and status = 'active'`,
      [userId, nowIso],
    ),
    query<{ n: number }>(
      `select count(*)::int as n from public.reviews
        where user_id = $1 and undone_at is null and reviewed_at >= $2`,
      [userId, params.dayStart.toISOString()],
    ),
    query<{ due: string }>(
      `select due from public.cards
        where user_id = $1 and status = 'active' and fsrs_state <> 'new' and due > $2
        order by due asc
        limit 1`,
      [userId, nowIso],
    ),
  ]);

  return {
    dueNow: counts.rows[0]?.due_now ?? 0,
    newAvailable: counts.rows[0]?.new_available ?? 0,
    reviewedToday: reviewed.rows[0]?.n ?? 0,
    nextDueAt: upcoming.rows[0]?.due ?? null,
  };
}
