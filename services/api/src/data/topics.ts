/**
 * The `topics` table, and the reconciliation that keeps it from fragmenting.
 * P10 task 7, the brief's D11, ADR 0009.
 *
 * Every statement here carries `where user_id = $1`, including the fetch by
 * primary key. A topic id is not a capability (ADR 0008).
 *
 * ── What the hard part actually is ────────────────────────────────────────
 *
 * Extraction is easy: the model names the topics while it writes the cards.
 * The work is deciding that the "Krebs cycle" in today's upload is the *same*
 * topic as the one from three uploads ago, because a user studying one subject
 * across five documents must not end up with five overlapping topic sets. A
 * mastery map over near-duplicate topics is not a weaker map; it is a
 * meaningless one.
 *
 * So nothing here creates a topic without first looking for an existing one.
 */

import { query, withTransaction } from '../lib/db.ts';
import type { TopicRow } from '../lib/rows.ts';

const COLUMNS = 'id, user_id, name, slug, created_at, updated_at';

/**
 * The match key: lower-case, collapsed whitespace, trimmed.
 *
 * Unicode-normalised first (NFKC) so that visually identical names differing
 * only in code points -- a non-breaking space, a full-width letter, a
 * decomposed accent -- collapse to the same key. Model output is exactly where
 * those come from, and two rows differing only in an invisible character is the
 * worst version of this bug: indistinguishable on screen, distinct in the
 * database.
 *
 * `toLowerCase()` runs after NFKC, because case folding in some scripts depends
 * on the composed form.
 *
 * Exported because ADR 0009's claim about what does and does not match is only
 * checkable against this function.
 */
// data-access-lint-disable-next-line A pure string function that reaches no datastore, so there is no tenancy boundary for a userId to guard; it is exported only so ADR 0009's claims about what matches are checkable against the actual rule.
export function normaliseSlug(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A topic name from the model, before it is known whether it already exists. */
export interface TopicCandidate {
  name: string;
}

/** What reconciliation did, per resulting topic. */
export interface ReconciledTopic {
  topic: TopicRow;
  /**
   * True when this call inserted the row, false when it matched an existing
   * one. Not decoration: it is what lets a caller report "3 new topics, 4
   * existing" honestly, and what makes the reconciliation observable at all
   * given nothing here is tested (ADR 0005).
   */
  created: boolean;
}

export async function listTopics(userId: string): Promise<TopicRow[]> {
  const result = await query<TopicRow>(
    `select ${COLUMNS} from public.topics where user_id = $1 order by name asc`,
    [userId],
  );
  return result.rows;
}

export async function getTopic(userId: string, topicId: string): Promise<TopicRow | null> {
  const result = await query<TopicRow>(
    `select ${COLUMNS} from public.topics where id = $2 and user_id = $1`,
    [userId, topicId],
  );
  return result.rows[0] ?? null;
}

/**
 * Reconcile a document's extracted topic names against the user's existing
 * topics, creating only what is genuinely new. **This is the task-7 function**;
 * everything else in this file supports it.
 *
 * ── Why the insert resolves the race itself ───────────────────────────────
 *
 * The obvious implementation is: select the user's topics, diff in JavaScript,
 * insert the misses. It is wrong under concurrency. A document's chunks are
 * fanned out by Step Functions and run *in parallel*, so two chunks that both
 * mention "Krebs cycle" reach this code at the same time, both find nothing,
 * and both insert. The unique constraint then fails one of them -- turning a
 * routine collision into a failed chunk.
 *
 * `on conflict do nothing` followed by a select would leave the same race in a
 * narrower window. So the insert itself resolves it:
 *
 *   `on conflict (user_id, slug) do update set updated_at = now()`
 *
 * A no-op update rather than `do nothing`, because `do nothing` returns no row
 * and this needs the row back -- either the one it just wrote or the one that
 * was already there. Touching `updated_at` is also true: a topic named by a new
 * document has genuinely been seen again.
 *
 * `xmax = 0` distinguishes the two cases. It is a Postgres system column, zero
 * on a freshly inserted tuple and non-zero on one produced by the conflicting
 * update path -- the standard way to tell an upsert's insert from its update,
 * and the only way to report `created` honestly here.
 *
 * ── Why the display name is not overwritten ───────────────────────────────
 *
 * When "krebs cycle" matches an existing "Krebs Cycle", the existing name wins.
 * The alternative -- last writer renames the topic -- means a user's topic list
 * silently re-cases itself as documents arrive, and the model's capitalisation
 * is not more authoritative than what is already there.
 *
 * ── The limit of this, stated plainly ─────────────────────────────────────
 *
 * Matching is by normalised name only. "Krebs cycle" and "Citric acid cycle"
 * are one topic to a biologist and two rows here. That is a known, chosen
 * weakness: closing it needs embeddings, which is Phase G (ADR 0009).
 */
export async function reconcileTopics(
  userId: string,
  candidates: readonly TopicCandidate[],
): Promise<ReconciledTopic[]> {
  // Deduplicate within the batch before touching the database. One document
  // routinely names the same topic in several chunks, and two rows of the same
  // upsert in one statement would collide with themselves -- Postgres refuses
  // to update a row twice in a single command, which is a real error rather
  // than a tidiness concern.
  const bySlug = new Map<string, string>();
  for (const candidate of candidates) {
    const slug = normaliseSlug(candidate.name);
    // A name that normalises to nothing -- empty, or only whitespace -- is not
    // a topic. Models produce these occasionally and the check constraint would
    // reject them anyway; dropping them here keeps one bad name from failing a
    // whole chunk's reconciliation.
    if (slug === '') continue;
    // First spelling wins, matching the "existing name wins" rule above.
    if (!bySlug.has(slug)) bySlug.set(slug, candidate.name.trim());
  }

  if (bySlug.size === 0) return [];

  return withTransaction(async (client) => {
    const reconciled: ReconciledTopic[] = [];

    for (const [slug, name] of bySlug) {
      const result = await client.query<TopicRow & { inserted: boolean }>(
        `insert into public.topics (user_id, name, slug)
         values ($1, $2, $3)
         on conflict (user_id, slug) do update set updated_at = now()
         returning ${COLUMNS}, (xmax = 0) as inserted`,
        [userId, name, slug],
      );
      const row = result.rows[0];
      // An upsert with `returning` always produces a row on this path: the
      // conflict target is the only constraint that can fire, and it is
      // handled.
      if (!row) throw new Error('Topic upsert returned no row.');
      const { inserted, ...topic } = row;
      reconciled.push({ topic, created: inserted });
    }

    return reconciled;
  });
}

/**
 * File cards under a topic, at the review gate.
 *
 * Both ids are checked against `user_id`: the card update filters on it
 * directly, and the topic is confirmed to be the caller's by the `exists`
 * subquery rather than trusted because an id was supplied. Without that
 * subquery a caller could file their own cards under another user's topic --
 * which leaks nothing outward but corrupts the other user's mastery map, and is
 * exactly the class of bug that stops being impossible once RLS is gone.
 *
 * Returns how many cards were actually filed, which the caller compares against
 * what it asked for rather than assuming.
 */
export async function assignCardsToTopic(
  userId: string,
  topicId: string,
  cardIds: readonly string[],
): Promise<number> {
  if (cardIds.length === 0) return 0;

  const result = await query(
    `update public.cards
        set topic_id = $2
      where user_id = $1
        and id = any($3::uuid[])
        and exists (
          select 1 from public.topics
           where id = $2 and user_id = $1
        )`,
    [userId, topicId, [...cardIds]],
  );
  return result.rowCount ?? 0;
}

/**
 * A topic with the card counts the blueprint and the mastery map read.
 *
 * `cardCount` is every active card filed under the topic; `reviewedCount` is
 * the subset that has been seen at least once. Both are needed and neither is
 * derivable from the other: the blueprint weighs a topic by how much material
 * it holds, and the empty state has to distinguish "you have cards here but
 * have never studied them" from "you have nothing here at all".
 */
export interface TopicWithCounts extends TopicRow {
  cardCount: number;
  reviewedCount: number;
}

/**
 * The user's topics, with a card count each. DS3 task 2.
 *
 * **The count is in the same query on purpose.** The alternative — return the
 * topics, then have the client fetch every card and bucket them — is the exact
 * shape `listDecks` rejected, and its comment says why: a client fetching every
 * row to count them is a shape that only makes sense when the client *is* the
 * API. Here it would also be wrong at the boundary, because the blueprint's
 * weights are computed from these counts and a client-side count over a
 * paginated card fetch would silently weigh a partial deck.
 *
 * ── Tenancy: both sides of the join filter ────────────────────────────────
 *
 * `topics` filters `user_id = $1`, and so does the `cards` subquery. The join
 * predicate alone would be enough *given* correct data — a card's topic_id can
 * only reference a topic row, and topics are per-user — but "given correct
 * data" is precisely the assumption RLS used to make unnecessary. ADR 0008 rule
 * 2 says every statement, every table, no exceptions for joins whose safety is
 * inferable. It costs an index lookup and removes an argument.
 *
 * ── This replaced a narrower P10 version ─────────────────────────────────
 *
 * `listTopicsWithCounts` existed before DS3, returning `cardCount` alone, and
 * **nothing ever called it** — there was no route to reach it through. Rather
 * than leave two near-identical readers of the same table, it was widened in
 * place: `reviewedCount` is what the empty state needs to tell "no cards here"
 * from "cards here, never studied".
 *
 * ── Only `active` cards are counted ───────────────────────────────────────
 *
 * A suspended or archived card is not part of what the user is studying, so
 * counting it would weigh a blueprint towards material the user has explicitly
 * set aside. This matches `listDecks`, which counts the same way.
 *
 * `left join` so a topic whose cards were all deleted or unfiled still appears
 * with zero rather than vanishing — a topic that exists and holds nothing is a
 * true fact about the user's material, and the blueprint drops zero-weight
 * topics itself rather than having the query hide them.
 *
 * ── `deckId`: scoping a per-user table to one notebook (DS4 task 1) ───────
 *
 * Topics are per-user by construction and ADR 0009 needs them to stay that way:
 * reconciliation matches a name across *all* of a user's documents so that five
 * uploads about one subject do not produce five overlapping topic sets. But a
 * blueprint claims to describe *one notebook*, and DS3 shipped it reading every
 * topic the user owns — invisible with one notebook, and with two it weights a
 * biology exam towards the AWS topics.
 *
 * The fix derives the scope from `cards` rather than moving it into `topics`
 * (DS4 §0 option A; B would have broken cross-document reconciliation outright,
 * C would have duplicated a relation `cards` already records). A topic is *in*
 * this notebook when it has a card there, and the counts narrow to that deck
 * too — a topic with no cards in this notebook is not in this blueprint.
 *
 * **A topic can therefore appear in two notebooks, and that is correct**: it is
 * the same topic, which is the property ADR 0009 exists to protect. What
 * changes per notebook is its count, and so its weight.
 *
 * Passing no `deckId` keeps the unscoped read for anything that wants every
 * topic — the `inner join` collapses to the `left join` above.
 *
 * **`deckId` is not a capability.** It narrows a result set that `user_id`
 * already bounds; a deck id belonging to someone else matches no cards of
 * *this* user and yields an empty list rather than another tenant's rows.
 * `userId` stays `$1` (ADR 0008 rule 1).
 */
export async function listTopicsWithCounts(
  userId: string,
  deckId?: string,
): Promise<TopicWithCounts[]> {
  /*
   * One statement either way, differing in two places: the counted cards are
   * restricted to the deck, and the join stops being a `left join`.
   *
   * Both are required and neither implies the other. Narrowing the counts alone
   * would leave every other notebook's topics on the blueprint at zero cards --
   * present, named, and weighted at 0%, which is a *worse* lie than the bug
   * being fixed because it looks deliberate. Making the join inner alone would
   * drop them but still count their cards from elsewhere.
   *
   * Scoped, `inner join` is what drops a topic holding nothing here; unscoped,
   * `left join` is what keeps an emptied topic visible (see above).
   */
  const scoped = deckId !== undefined;

  const result = await query<TopicRow & Record<string, number>>(
    `select t.id, t.user_id, t.name, t.slug, t.created_at, t.updated_at,
            coalesce(c.card_count, 0)::int     as "cardCount",
            coalesce(c.reviewed_count, 0)::int as "reviewedCount"
       from public.topics t
       ${scoped ? 'join' : 'left join'} (
         select topic_id,
                count(*)                                        as card_count,
                count(*) filter (where fsrs_state <> 'new')     as reviewed_count
           from public.cards
          where user_id = $1
            and status = 'active'
            and topic_id is not null
            ${scoped ? 'and deck_id = $2' : ''}
          group by topic_id
       ) c on c.topic_id = t.id
      where t.user_id = $1
      order by t.name asc`,
    scoped ? [userId, deckId] : [userId],
  );
  return result.rows as unknown as TopicWithCounts[];
}

/**
 * How many of the user's active cards carry no topic at all, optionally within
 * one notebook.
 *
 * **This is the "Unfiled" bucket, and it exists because dropping these cards
 * would make the blueprint's weights wrong.** `cards.topic_id` is nullable by
 * design (migration 0004): hand-made cards have no topic, cards predating
 * topics have none, and a chunk whose model named none still produced good
 * cards. A blueprint computed only over topiced cards would present weights
 * summing to 100% of a subset of the user's material while claiming to describe
 * all of it — which is a plausible wrong number, the hardest kind to notice.
 *
 * Returned separately rather than as a synthetic topic row, because it has no
 * id: nothing can be filed under it, no exam can be scoped to it, and giving it
 * a fake uuid would let it flow into code paths that assume a real topic.
 */
export async function countUnfiledCards(userId: string, deckId?: string): Promise<number> {
  /*
   * `deckId` narrows this for the same reason it narrows the topic counts, and
   * it has to move with them: an "Unfiled" row counting every notebook's loose
   * cards into one notebook's weights is the same bug in the one place where it
   * would be least visible, because "Unfiled" has no name to look wrong.
   */
  const scoped = deckId !== undefined;

  const result = await query<{ n: number }>(
    `select count(*)::int as n
       from public.cards
      where user_id = $1
        and status = 'active'
        and topic_id is null
        ${scoped ? 'and deck_id = $2' : ''}`,
    scoped ? [userId, deckId] : [userId],
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Reconcile topic names **within one notebook** — FR7.
 *
 * ── Why this exists beside `reconcileTopics` ──────────────────────────────
 *
 * The function above reconciles per *user*, which was right when a user had
 * decks and nothing above them. It is the live cross-notebook bug the brief
 * names: two notebooks studying "Resistance mechanisms" shared one topic row,
 * so their mastery numbers contaminated each other and a diagnostic for
 * pharmacology counted microbiology's answers.
 *
 * Migration 0010 added `topics.notebook_id` and a partial unique index on
 * `(user_id, notebook_id, slug)`. This is the writer for that index. The
 * per-user version stays, unchanged, for the pre-FR7 deck path — the two do not
 * collide because the new index is partial on `notebook_id is not null` and the
 * old constraint governs the rows where it is null.
 *
 * Matching is still by normalised slug (ADR 0009), which is deliberately weaker
 * than embeddings would give: "Beta-lactams" and "Beta lactams" reconcile,
 * "Penicillins" and "Beta-lactams" do not.
 */
export async function reconcileNotebookTopics(
  userId: string,
  notebookId: string,
  candidates: readonly TopicCandidate[],
): Promise<ReconciledTopic[]> {
  const bySlug = new Map<string, string>();
  for (const candidate of candidates) {
    const slug = normaliseSlug(candidate.name);
    // A name that normalises to nothing is not a topic. See the sibling.
    if (slug === '') continue;
    if (!bySlug.has(slug)) bySlug.set(slug, candidate.name.trim());
  }
  if (bySlug.size === 0) return [];

  return withTransaction(async (client) => {
    const reconciled: ReconciledTopic[] = [];

    for (const [slug, name] of bySlug) {
      /*
       * `on conflict` needs a unique index to name, and the one that governs
       * these rows is partial — so the conflict target repeats its predicate.
       * Without `where notebook_id is not null` Postgres cannot match the
       * partial index and raises "no unique or exclusion constraint matching".
       */
      const result = await client.query<TopicRow & { inserted: boolean }>(
        `insert into public.topics (user_id, notebook_id, name, slug)
         values ($1, $2, $3, $4)
         on conflict (user_id, notebook_id, slug) where notebook_id is not null
           do update set updated_at = now()
         returning ${COLUMNS}, (xmax = 0) as inserted`,
        [userId, notebookId, name, slug],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Topic upsert returned no row.');
      const { inserted, ...topic } = row;
      reconciled.push({ topic, created: inserted });
    }

    return reconciled;
  });
}
