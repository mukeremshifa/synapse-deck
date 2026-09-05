/**
 * The `decks` table.
 *
 * Every statement here carries `where user_id = $1`, including the fetches and
 * updates keyed by primary key. A deck id is not a capability: it arrives from
 * the client, and treating "the client knew the id" as "the client owns the
 * row" is exactly the leak RLS used to make impossible. See ADR 0008.
 */

import { query, withTransaction } from '../lib/db.ts';
import type { DeckRow } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, title, description, status, source, new_cards_per_day, created_at, updated_at';

/** A deck with the three counts the deck list renders. */
export interface DeckWithCounts extends DeckRow {
  cardCount: number;
  dueCount: number;
  newCount: number;
  /** Generated cards still waiting at the review gate (SPEC §4.1 step 5). */
  draftCount: number;
}

/**
 * The deck list, with counts.
 *
 * The Supabase version fetched every deck and then every card, and bucketed the
 * cards in JavaScript — because counting per deck would otherwise have been
 * three more round trips over the network. Here the counting happens in
 * Postgres, where it belongs: the aggregate is index-covered by
 * `cards_deck_status_idx`, and what crosses the wire is one row per deck
 * instead of one row per card.
 *
 * That is a genuine improvement the migration buys, rather than a like-for-like
 * port, and the reason is worth stating: a client fetching every card to count
 * them is a shape that only makes sense when the client *is* the API.
 *
 * `left join` so a deck with no cards still appears, with zeros. Draft cards
 * are counted but excluded from `cardCount`: a deck abandoned part-way through
 * the review gate has no active cards to advertise itself with and still has to
 * be findable from the deck list (SPEC §4.1).
 */
export async function listDecks(userId: string, now: Date): Promise<DeckWithCounts[]> {
  const result = await query<DeckRow & Record<string, number>>(
    `select d.id, d.user_id, d.title, d.description, d.status, d.source,
            d.new_cards_per_day, d.created_at, d.updated_at,
            coalesce(c.card_count, 0)::int  as "cardCount",
            coalesce(c.due_count, 0)::int   as "dueCount",
            coalesce(c.new_count, 0)::int   as "newCount",
            coalesce(c.draft_count, 0)::int as "draftCount"
       from public.decks d
       left join (
         select deck_id,
                count(*) filter (where status = 'active')                          as card_count,
                count(*) filter (where status = 'active'
                                   and fsrs_state <> 'new' and due <= $2)          as due_count,
                count(*) filter (where status = 'active' and fsrs_state = 'new')   as new_count,
                count(*) filter (where status = 'draft')                           as draft_count
           from public.cards
          where user_id = $1
          group by deck_id
       ) c on c.deck_id = d.id
      where d.user_id = $1
        and d.status <> 'failed'
      order by d.updated_at desc`,
    [userId, now.toISOString()],
  );
  return result.rows as unknown as DeckWithCounts[];
}

export async function getDeck(userId: string, deckId: string): Promise<DeckRow | null> {
  const result = await query<DeckRow>(
    `select ${COLUMNS} from public.decks where id = $2 and user_id = $1`,
    [userId, deckId],
  );
  return result.rows[0] ?? null;
}

export interface DeckInsert {
  title: string;
  description: string | null;
}

export async function createDeck(userId: string, input: DeckInsert): Promise<DeckRow> {
  const result = await query<DeckRow>(
    `insert into public.decks (user_id, title, description, source, status)
     values ($1, $2, $3, 'manual', 'active')
     returning ${COLUMNS}`,
    [userId, input.title, input.description],
  );
  const row = result.rows[0];
  // An insert with `returning` that produces no row cannot happen without the
  // statement having thrown first, so this is a type narrowing rather than a
  // case to handle.
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

export async function updateDeck(
  userId: string,
  deckId: string,
  input: DeckInsert,
): Promise<DeckRow | null> {
  const result = await query<DeckRow>(
    `update public.decks
        set title = $3, description = $4
      where id = $2 and user_id = $1
      returning ${COLUMNS}`,
    [userId, deckId, input.title, input.description],
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a deck and, by cascade, its cards and their reviews.
 *
 * Genuinely destructive — `cards.deck_id references public.decks on delete
 * cascade` — so the caller confirms first (SPEC §10). Returns whether a row was
 * actually deleted, which is how the handler distinguishes "gone" from "never
 * yours" without telling the caller which.
 */
export async function deleteDeck(userId: string, deckId: string): Promise<boolean> {
  const result = await query(
    `delete from public.decks where id = $2 and user_id = $1`,
    [userId, deckId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark the review gate closed and stamp the generation row with how many cards
 * survived it.
 *
 * Both statements filter on `user_id`, and the second one is the reason this is
 * a single function rather than two calls from a handler: `generations` is
 * reachable by `deck_id`, and a deck id the caller does not own must not be
 * able to touch a generation row either.
 *
 * One transaction, three statements, rather than one clever query. A
 * data-modifying CTE would work — Postgres runs one even when nothing
 * references it — but "this UPDATE runs even though it appears unused" is
 * exactly the kind of thing a later reader deletes as dead code. The
 * transaction says the same thing without depending on that knowledge.
 *
 * `cards_accepted` is counted from the cards rather than tallied by the client,
 * so resuming an abandoned gate corrects the number instead of double counting
 * it. SPEC §13 (2) measures the product on that figure.
 */
export async function finishReviewGate(
  userId: string,
  deckId: string,
): Promise<DeckRow | null> {
  return withTransaction(async client => {
    const deck = await client.query<DeckRow>(
      `update public.decks
          set status = 'active'
        where id = $2 and user_id = $1
        returning ${COLUMNS}`,
      [userId, deckId],
    );
    const row = deck.rows[0];
    // Not the caller's deck, or no such deck. Nothing else runs: without this
    // the generations update below would be reached with a deck id the caller
    // does not own, and would be relying on its own filter alone.
    if (!row) return null;

    const accepted = await client.query<{ n: number }>(
      `select count(*)::int as n
         from public.cards
        where deck_id = $2 and user_id = $1 and status = 'active'`,
      [userId, deckId],
    );

    await client.query(
      `update public.generations
          set cards_accepted = $3
        where deck_id = $2 and user_id = $1`,
      [userId, deckId, accepted.rows[0]?.n ?? 0],
    );

    return row;
  });
}
