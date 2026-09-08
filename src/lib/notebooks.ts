/**
 * Where a notebook's surfaces live, and the last of the deck→notebook adapter.
 *
 * ── What this file was, and what FR2 left of it ───────────────────────────
 *
 * P11 renamed the product's top-level object from **deck** to **notebook** and
 * this file was where the rename stopped: Postgres had a `decks` table, the API
 * served `/decks/:deckId`, and one adapter translated so that "a component says
 * notebook, a hook says deck".
 *
 * FR0 ended that arrangement by writing a contract in which **the wire says
 * notebook too** (`src/lib/api/contract.ts`). So the translation half of this
 * file is now legacy by definition — it exists only for the screens still on
 * the old `queries.ts` stack, and it dies with them.
 *
 * **FR2's decision (§6.2): kept, narrowed, and re-pointed — not deleted.**
 * Deleting it outright would have meant rewriting `NotebookPage`, `StudioRail`,
 * `BlueprintPage`, `DiagnosticPage` and the runners in this commit, which is
 * FR3, FR5 and FR6's work done badly and all at once. What FR2 did instead:
 *
 * - **`notebookPath` re-pointed at the new route table.** Every path here was
 *   a route that FR2 deleted or renamed, so leaving it alone would have left a
 *   dozen callers navigating to 404s. This is the reason the file survives:
 *   route construction in one place is what made that a one-file fix.
 * - **`list()` is gone.** There is no notebook list any more — `/` is the one
 *   home (brief §3.1), and `home()` says so.
 * - **`gate()` is gone**, with the `/create/*` family it pointed into.
 * - **The runners take an artifact id**, because every runner route now names
 *   its artifact. That is not cosmetic: it is what makes "many decks, many
 *   exams per notebook" expressible, and callers that had no artifact id to
 *   give are exactly the surfaces that were guessing.
 *
 * ── For FR3, FR5 and FR6 ─────────────────────────────────────────────────
 *
 * `toNotebook` and `isResumable` are **deprecated on arrival**: they map a
 * `DeckWithCounts` that only the old stack produces. When your phase re-points
 * its screens at `@/lib/api`, delete the one you stop using. When the last goes,
 * `queries.ts`, `api-client.ts` and the bottom half of this file go together.
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

/**
 * Where a notebook's surfaces live. Route construction in one place, so the
 * next table change is one file rather than a grep.
 *
 * **Every runner names its artifact** (brief §3.1). `practice`, `quiz`, `exam`
 * and `notes` all require an artifact id, and requiring it is deliberate: a
 * caller with no id to pass is a surface that was going to guess which deck or
 * exam it meant, and now cannot compile instead.
 */
export const notebookPath = {
  /** The one front door. There is no notebook list; `/` is it. */
  home: () => '/',
  open: (id: string) => `/notebooks/${id}`,
  /** The notebook's centre — artifacts, readiness, diagnostics, plan (FR6). */
  overview: (id: string) => `/notebooks/${id}/overview`,
  practice: (id: string, deckId: string) => `/notebooks/${id}/decks/${deckId}/practice`,
  quiz: (id: string, quizId: string) => `/notebooks/${id}/quizzes/${quizId}`,
  exam: (id: string, examId: string) => `/notebooks/${id}/exams/${examId}`,
  notes: (id: string, noteSetId: string) => `/notebooks/${id}/notes/${noteSetId}`,
} as const;
