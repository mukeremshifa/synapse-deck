/**
 * Where a notebook's surfaces live. **Route construction, and nothing else.**
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
 * ── What FR3 removed ─────────────────────────────────────────────────────
 *
 * **`toNotebook`, `isResumable` and the local `Notebook` type are gone.** They
 * mapped a `DeckWithCounts` that only the old stack produces, and FR2 called
 * them deprecated on arrival with instructions to delete each one as its last
 * caller went. FR3 was that moment: the notebook shell was their only consumer,
 * and it now reads `Notebook` from the contract (`@/lib/api`), where the wire
 * says notebook too and no translation is needed.
 *
 * So this file is **route construction and nothing else**. It is no longer a
 * deck→notebook adapter, which is why it now outlives `queries.ts` rather than
 * dying with it: `notebookPath` is where every surface's URL is built, and FR5
 * and FR6 still need it.
 */

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
