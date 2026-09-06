/**
 * The notebook vocabulary, and the one place it meets the wire's.
 *
 * P11 renamed the product's top-level object from **deck** to **notebook**. The
 * rename stops here. Postgres still has a `decks` table, the API still serves
 * `/decks/:deckId`, `schemas.ts` still exports `DeckInput`, and every hook in
 * `queries.ts` still says `useDecks`. Nothing below this file knows the word
 * notebook exists.
 *
 * **Why the rename does not cross the wire.** P10 left the pipeline coupled to
 * the frontend through exactly four routes, and P10-SESSION-4 is explicit that
 * keeping that coupling narrow is what makes task 10 (Bedrock) a backend-only
 * change. A rename that reached the API would touch handlers, the data layer and
 * the schemas to buy nothing but a consistent noun in files no user opens — and
 * it would do it in the same commit range as a full UI rewrite, so a regression
 * in either would be indistinguishable from a regression in the other.
 *
 * So: one adapter, and a rule. **A component says notebook. A hook says deck.**
 * The translation happens here and nowhere else, which also means the day the
 * backend does rename, this file is the diff.
 */

import type { DeckRow, DeckWithCounts } from './queries';

/**
 * A notebook, as the UI thinks of one.
 *
 * `sourceCount` is **not** on `DeckWithCounts` and is not faked here. The job
 * pipeline takes one document per job (P11 §3) and the API exposes no count of
 * a deck's sources, so this is `null` until an endpoint provides it. A zero
 * would be a lie that renders identically to the truth.
 */
export type Notebook = {
  id: string;
  title: string;
  /** ISO 8601, straight from the row. Formatting belongs to the component. */
  updatedAt: string;
  cardCount: number;
  dueCount: number;
  newCount: number;
  sourceCount: number | null;
  /**
   * Generation finished but the review gate was never passed, so there are
   * drafts waiting and the way back in is the gate.
   *
   * This reads `deck_status`, which kept its `'draft'` member. It is **not** the
   * `card_status` `'draft'` that migration 0003 removed — those meant different
   * things and only one of them still exists (P10-SESSION-4, P11 §5.3). A
   * rewrite-wide grep for the string `draft` that treats both the same is the
   * documented way this breaks, and it breaks silently: the notebook stops
   * offering the only route back to its own unaccepted cards.
   */
  resumable: boolean;
};

/** The wire's shape → the UI's. The only direction that needs a function. */
export function toNotebook(deck: DeckWithCounts): Notebook {
  return {
    id: deck.id,
    title: deck.title,
    updatedAt: deck.updated_at,
    cardCount: deck.cardCount,
    dueCount: deck.dueCount,
    newCount: deck.newCount,
    sourceCount: null,
    resumable: isResumable(deck),
  };
}

/**
 * Whether a deck row is a notebook the user can resume at the review gate.
 *
 * Kept as its own exported predicate rather than inlined, so the `deck_status`
 * comparison exists once in the frontend and the comment above `resumable` has
 * a single thing to guard.
 */
export function isResumable(deck: Pick<DeckRow, 'status'>): boolean {
  return deck.status === 'draft';
}

/** Where a notebook lives. Route construction in one place, for the same reason. */
export const notebookPath = {
  list: () => '/notebooks',
  open: (id: string) => `/notebooks/${id}`,
  /** The review gate. Still `/create/review/:deckId` on the router. */
  gate: (id: string) => `/create/review/${id}`,
  cards: (id: string) => `/notebooks/${id}/cards`,
  practice: (id: string) => `/notebooks/${id}/practice`,
  exam: (id: string) => `/notebooks/${id}/exam`,
  /** The exam blueprint — what an exam over this notebook should weigh. */
  blueprint: (id: string) => `/notebooks/${id}/blueprint`,
  /** Topic mastery and the plan derived from it. */
  diagnostic: (id: string) => `/notebooks/${id}/diagnostic`,
} as const;
