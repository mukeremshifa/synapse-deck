# FR5 — The study surfaces

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §1.2(3), §3.1.
**Depends on:** [FR4](FR4-generation.md) complete.
**Hands off to:** [FR6](FR6-the-overview.md).

> Contract altitude. Names no component files.

---

## 1. Preconditions

```bash
npm run check && npm run dev   # fake mode
```

FR4's §8 handoff must say how a runner is entered and where attempts are created.

## 1b. Reconcile — first, before any code

Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) rows naming FR5, and FR4 §6/§8 — **especially the
regeneration decision**, which determines whether a runner may assume its artifact is
stable mid-session.

Assumes: four runner routes exist from FR2, each naming its artifact id; the contract has
`Attempt`; `fixtures.ts` has artifacts of every kind with enough content to run.

### What FR2 delivered — appended 2026-09-08 by FR2

- **All four runner routes exist and name their artifact**:
  `/notebooks/:id/decks/:deckId/practice`, `/notebooks/:id/quizzes/:quizId`,
  `/notebooks/:id/exams/:examId`, `/notebooks/:id/notes/:noteSetId`. Quiz and notes render
  placeholders naming FR5; practice and exam render the **old** pages.
- **`ExamPage` ignores its `:examId`.** It still renders the hardcoded `SAMPLE_EXAM` from
  `src/features/exam/fixtures.ts` over `queries.ts`. The route is honest; the page is not
  yet, and making it honour the id is yours. `PracticePage` likewise reads `:notebookId`
  and hands it to the old stack as a deck id.
- **Both 500 against fake-fixture ids**, because they call the old backend while home
  calls the fake. That is the two-stack seam, not a bug in either — **re-pointing them at
  `@/lib/api` is your first task.**
- **`notebookPath` requires an artifact id** for every runner:
  `practice(notebookId, deckId)`, `quiz(id, quizId)`, `exam(id, examId)`,
  `notes(id, noteSetId)`.
- `ExamRunner`, `useExamTimer`, `useFocusMode`, `PracticeSession`, `RatingButtons`,
  `SessionSummary` and `FocusFrame` are untouched and still routed.

### What FR3 delivered — appended 2026-09-08 by FR3

- **Studio is how a runner is launched, and it always names its artifact.**
  `runnerPath` in `src/features/notebook/StudioPane.tsx` maps an artifact to its route via
  `notebookPath.practice/quiz/exam/notes`. So `PracticePage`, `QuizRoute`, `ExamPage` and
  `NotesRoute` are now reachable with a **real fake-fixture artifact id** in the URL, which
  is what FR2's "the route is honest; the page is not yet" row was waiting for.
- **Only `status: 'ready'` artifacts are links.** `generating` and `failed` rows render as
  non-links, so your runners are not entered with an artifact that has no contents. Do not
  rely on that alone — a pasted URL still reaches you — but the ordinary path is guarded.
- **`src/lib/notebooks.ts` lost `toNotebook` and `isResumable`**, and with them its local
  `Notebook` type. FR3's shell was the last consumer. The file is now `notebookPath` only,
  so it **outlives `queries.ts`** rather than dying with it. Import `Notebook` from
  `@/lib/api`.
- **`useProfile` is the hook that will outlast your phase.** After FR3, `queries.ts` serves
  settings, the two runners, `BlueprintPage`, `DiagnosticPage` and `ReviewGatePage`. When
  FR5 and FR6 have re-pointed theirs, `useProfile` still has `AccountMenu` and
  `SettingsPage` behind it — plan to re-point it rather than assuming the file evaporates.
- **Untrusted text has a renderer**: `src/features/notebook/AnswerText.tsx` produces
  elements and cannot produce HTML. The note reader should render `NoteBlock`s directly
  (the contract's discriminated union is there for exactly this) rather than reusing it —
  it handles inline forms, not structure. See the drift row.
- **`useMediaQuery` / `MEDIA_WIDE` are in `src/components/layout.tsx`** if a runner needs
  to branch layouts by width. Read the drift row first: `hidden md:flex` on a `PaneGroup`
  is silently dropped, and CSS hiding mounts both branches.

### What FR4 delivered — appended 2026-09-08 by FR4

**The regeneration question §1b tells you to check is decided: each generation is a NEW
artifact, never a replacement** (FR4 §6.3, and now brief §6.2). So **a runner may treat its
artifact's id, contents and `sourcesSnapshot` as stable for its whole life** — an attempt
you record can never be invalidated by a regeneration, because a regeneration produces a
different artifact. This is the strongest assumption FR4 hands you; build on it.

Four more things changed under you:

- **There is no review gate, and there are no draft cards.** The contract has none —
  `Card.status` is `active | suspended` — and FR4 did not add one. Nothing hands a runner a
  queue of cards to accept before first use: a `ready` deck's cards are `active` and
  `listCards` returns them. `useDraftCards`, `useAcceptDrafts` and `useFinishReviewGate`
  are deleted from `queries.ts`.
- **`src/features/generate/` is deleted in full** — `JobProgressPanel`, `PipelineStages`,
  `StagingList`, `useJobProgress`, `useUploadDocument`, `ReviewGatePage`. Recoverable from
  git history at `9c9280b` if you want to mine any of it. `useDeleteCards` survives in
  `queries.ts`, unused, for a card editor.
- **`useNotebookJobs(notebookId)` in `src/features/notebook/jobs.ts` is the only thing that
  watches generation**, and it already invalidates `artifacts` / `sources` / `detail` and
  home's grid when a job finishes. FR3's two `refetchInterval` polls are gone. **Do not add
  a third mechanism** — if a runner must react to a generation landing, subscribe to this.
- **Error copy is `failureFor(code)`** in `src/features/notebook/generation-errors.ts`, a
  closed `Record<ApiErrorCode, { title, detail, retry }>` — a new code in the contract
  fails to compile until someone writes its copy. Its `retry` field is what decides whether
  a "Try again" button appears at all; offering a retry that cannot work (`quota_exceeded`,
  `refused`) is worse than offering none. Reuse it rather than rendering `error.message`.

**An exam arrives with its blueprint already on it** (`basis: 'card-counts'`, server
derived). FR4 deliberately does not let the user author one at creation — blueprinting an
exam that does not exist yet is the problem per-exam blueprints were introduced to fix —
and the generate modal tells the user they can adjust it once the exam exists. **That
promise is unbuilt.** Whoever builds the editor, FR5 or FR6, is honouring it.



---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| The overview, diagnostics, heatmap, plan | **FR6** |
| The notes **editor** | Later phase — FR5 builds the **reader** (brief §1.2(2)) |
| Changing FSRS scheduling maths | Nowhere. `fsrs.ts`, `queue.ts`, `day.ts` keep their place (brief §1.4) — **re-point, do not rewrite** |
| Backend | FR7 |

---

## 3. The rule this phase runs under

> **Quiz and exam are separate kinds with separate runners.** Not one runner with a
> `timed` flag. (Brief §1.2(3) — settled; do not relitigate.)

They differ in delivery, state, and what they record:

| | Quiz | Exam |
| --- | --- | --- |
| Timing | none | **timed**, simulated real-exam environment |
| Delivery | **one question per page** | exam environment |
| Reveal | on answer or on demand | at the end |
| Repeatable | yes, resumable | one sitting = one `Attempt` |

Merging them looks like saving work and produces a surface that is a bad quiz *and* an
untrustworthy exam.

Second rule, and this one is a security constraint:

> **Card and question content is untrusted LLM output. Render it as text.**
> `dangerouslySetInnerHTML` is ESLint-blocked. Do not disable it — the notes reader is
> where this will be most tempting.

---

## 4. Tasks

### Task 1 — Practice (FSRS), by deck id

`/notebooks/:id/decks/:deckId/practice`. The existing runner is good work wired to the
wrong parent — `CardFace`, `ClozeText`, `McqOptions`, `RatingButtons` all earn their place
with rework (brief §1.4).

**The change that matters:** it runs *this deck*, named in the route. Today `PracticePage`
serves a guessed notebook, which is the audit's finding.

`fsrs.ts`, `queue.ts`, `day.ts` are model-independent and stay. Re-point them at the new
shapes; do not touch the maths.

### Task 2 — The quiz runner (new)

Untimed, **one question per page**, reveal on answer or on demand, repeatable, **resumable**.
Nothing in the current app does this — the closest thing is the exam runner, and copying it
produces a timed quiz.

Resumable means partial progress survives leaving. Decide where that lives and record it.

### Task 3 — The exam runner, by exam id

`ExamRunner` and `useExamTimer` are good components wired to the wrong parents. What
changes:

- it runs **an exam artifact named in the route**, not one assembled in the browser;
- its **blueprint belongs to it** (brief §1.2(9));
- one sitting produces one `Attempt`.

`0008_answers.sql:89` records the old state plainly: *"there is no `exams` table, because an
exam is currently assembled in the browser"* — loose answers grouped by a client-generated
uuid. That is what FR0's contract replaced.

DS3 left exam *questions* as a fixture and the UI says so. Under the fake they are real
contract data; **the honest statement is that no model has generated an exam question.**

### Task 4 — The notes reader

`/notebooks/:id/notes/:noteSetId`. Renders **structured blocks** (brief §1.2(2)).
Read-only; the editor is a later phase, and §1.2(2)'s block structure is what keeps it cheap.

**Render blocks as elements. Never HTML.** This is the single most likely place in the
whole re-architecture for `dangerouslySetInnerHTML` to be reached for.

### Task 5 — Long lists

`@tanstack/react-virtual` (FR1) for card and question lists. Only where a list is actually
long — virtualising a ten-item list adds bugs and no speed.

### Task 6 — Document, and update what follows

`SPEC.md`; [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md); FR6 where invalidated.

---

## 5. Acceptance criteria

1. Four runners, each entered by **artifact id from the route**. None guesses.
2. Practice runs the named deck; FSRS maths unchanged.
3. **Quiz is untimed, one-per-page, reveals on answer, and resumes** after leaving mid-way.
4. Exam is timed, runs its own blueprint, and records **one `Attempt` per sitting**.
5. Quiz and exam are **separate runners** — no shared component switching on a flag.
6. Notes reader renders structured blocks as elements; **no `dangerouslySetInnerHTML`**.
7. Keyboard operation works in all three interactive runners — they are keyboard-driven by
   design (brief §3.6).
8. Each runner sat through to completion in a browser at 1280px and 375px.
9. `npm run verify` passes.
10. §6 recorded; drift log appended.

---

## 6. Decisions to record

1. **Where quiz resume state lives**, and what happens if the artifact changed underneath it.
2. **What ends an exam** — submit, timeout, abandon — and what each records. `AttemptOutcome`
   in `schemas.ts:568` already has this vocabulary.
3. **Whether practice and quiz share any component**, and where the line is. §3 forbids one
   runner with a flag; it does not forbid a shared question-renderer. Say where you drew it.
4. Anything the notes block schema could not express.

## 7. What will go unverified

No tests. Report **"typechecks and builds"** plus which runners you actually sat through.

1. **FSRS intervals.** `check` cannot tell you an interval is right, and the suite that
   could is gone ([ADR 0005](../adr/0005-no-test-suite.md)). Re-pointing scheduling code at
   new shapes is exactly where a silent error lives.
2. **The timer** against wall-clock over a long sitting, tab-backgrounded, or across a sleep.
3. **Resume** across a real refresh, unless you do it by hand. Do it once.
4. **Every card kind × every runner.** You will check what fixtures contain.
5. **No model has generated a quiz or exam question.** Every question is fixture data.

## 8. Handoff to FR6

- **what `Attempt` records** per kind — FR6's diagnostics read them;
- **which aggregates the runners now emit** (reviews, answers), so FR6 re-points
  `progress.ts`, `mastery.ts`, `study-plan.ts` at real shapes;
- **the readiness contribution** per artifact kind (brief §1.3: a deck contributes due
  cards, a quiz unsat questions, a note set unread sections) — FR6 rolls these up;
- anything in FR6's assumptions you invalidated.
