# FR5 — The study surfaces

**Status:** ✅ **Executed 2026-09-08.** Four runners on the contract, each entered by the
artifact id in its route. See §6 for what was decided and §7 for what nothing checks.
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

### 6.1 Where quiz resume state lives — **in the attempt, server-side**

The contract had already decided this and it is the right answer: `startAttempt` on a quiz
with an `in-progress` attempt returns **that** attempt rather than opening a second one,
and `saveAttemptProgress` accumulates into it. So resume is not something the runner
implements — it is what the contract does. The runner seeds its answer map from
`attempt.answers` and opens on the first unanswered question.

Rejected, and why:

- **`localStorage`** — strands a half-finished sitting on one browser and diverges silently
  from the attempt the server already holds.
- **Component state alone** — loses the sitting on a refresh, which §5.3 makes a criterion
  against.

Progress saves **after every answer**, not on a timer and not on `beforeunload`: the latter
is unreliable on mobile and a timer loses whatever falls inside its last interval. One
answer is the unit of work, so it is the unit of save. The whole answer set is sent rather
than a delta, so a request that fails costs nothing.

**What happens if the artifact changed underneath it: it cannot.** FR4 §6.3 settled that a
regeneration is a *new* artifact, so a quiz's questions are stable for the life of every
attempt against it. `AttemptAnswer.questionText` still copies the stem (ADR 0013), so an
attempt stays legible even if the artifact is later deleted.

### 6.2 What ends an exam — and what each records

| Ends by | Outcome | Recorded |
| --- | --- | --- |
| The candidate confirms | `submitted` | Every question, answered or not |
| The timer runs out | `expired` | The same, auto-submitted where it stood |
| Walking away | `abandoned` | **Nothing here writes it** |

`abandoned` is deliberately written by nothing. A runner cannot tell "walked away" from
"lost the network" or "closed the laptop lid", and `beforeunload` is unreliable on mobile —
so writing it on unload would file real sittings under the one outcome that says the
candidate gave up. It needs a **server-side sweep** of attempts still `in-progress` well
past their exam's duration, which is the only place that distinction can be drawn. **FR7
owns it**; the contract already carries the value.

Unanswered questions submit as `selectedOption: null`, never as a wrong answer. The results
screen counts them apart, because telling someone they got a question wrong that they never
saw is a different claim. A sitting with nothing answered scores `null` rather than 0% —
the absence of a score, not a claim about performance.

### 6.3 What practice, quiz and exam share — and where the line is

§3 forbids one runner with a `timed` flag; it does not forbid a shared renderer. The line
drawn, and the principle behind it:

> **Delivery is not shared. The record is.**

| Shared | Not shared |
| --- | --- |
| `AttemptReview` — quiz and exam results, switching on **nothing** | The runners themselves |
| `scheduling.ts` — the one `Card` → FSRS adapter | `QuizOptions` vs `ExamOptions` |
| `WrongKind` / `NotReady` — the guards, all four runners | `ExamNavigator` (exam only) |
| `useExamTimer`, `useFocusMode` (exam only, but model-independent) | |

`AttemptReview` is shared because the contract is explicit that quiz and exam *"produce the
same record … the difference is delivery, and delivery lives in the runner"*. It takes an
`Attempt` and renders it, with no branch on kind — the caller varies only the label on the
button out.

`QuizOptions` and `ExamOptions` stay separate for the opposite reason, and it is the seam
that makes them different kinds at all: **a quiz reveals, an exam does not.** One component
switching on `revealed` would put the exam's correctness — the place it matters most —
behind a branch that is dead in one caller and live in the other.

Practice shares nothing with either. It grades against a schedule rather than an answer
key, and `CardFace` / `RatingButtons` / `SessionSummary` are reused from where they already
were.

### 6.4 What the note block schema could not express

Recorded in `NoteBlocks.tsx`, where they were found. None blocked FR5; all are contract
changes and none should be made from a consuming phase.

1. **No inline emphasis inside a block.** `paragraph.text` is one flat string, so a note
   cannot bold a term mid-sentence — which is exactly what a study note wants to do. The
   asymmetry is odd: `AnswerText` can do it for a chat answer and this cannot for a note.
2. **No nested lists**, and `items` is `string[]`, so a sub-point flattens or is lost.
3. **No code, table or image block.** Fine for the current material, a real gap for
   anything technical.
4. **A quote carries a `sourceId` but no locator** — no page, no offset — so a citation can
   name the document and never the place in it.

### 6.5 Long lists: `@tanstack/react-virtual` was deliberately not used

FR1 added it for task 5. Nothing here needs it, and the plan's own rule — virtualising a
short list "adds bugs and no speed" — is what decided it:

- Generation is capped at **50** cards and **50** questions by the contract.
- Practice renders **one card**; the quiz renders **one question**.
- The exam navigator and `AttemptReview` are bounded by that same cap.
- **It would have broken the notes reader**, whose read tracking is an
  `IntersectionObserver` over mounted blocks — a virtualised block is never observed and so
  is never marked read.

The dependency is still unused. If FR6 has no long list either, the honest move is to drop
it rather than keep carrying it.

## 7. What went unverified

**Typechecks and builds.** `npm run verify` passes: typecheck, repo-wide lint, production
build. Nothing here proves behaviour — there are no tests ([ADR 0005](../adr/0005-no-test-suite.md)).

### 7.1 No browser rendered any of this — say so plainly

**This session had no browser automation available**, so the criterion in §5.8 — each
runner sat through at 1280px and 375px — **was not met.** FR2 and FR3 each found four
defects that way and this phase had no equivalent pass. What that leaves unchecked is
everything visual and everything gestural: layout at 375px, focus order, whether the
keyboard bindings actually fire in a real event loop, whether the notes reader's
`IntersectionObserver` marks blocks read while scrolling, and whether full-screen focus
mode is granted or refused.

**This is the largest gap in the phase and the first thing the next session should close.**

### 7.2 What *was* driven, and how

The fake's study paths were exercised directly in Node — not a substitute for a browser,
but it is how the one real bug in this phase was found. Confirmed by driving:

- **Practice** — the queue for a named deck, the interleave, all four grades producing the
  standard ladder (Again 1m / Hard 6m / Good 10m / Easy 10d), a rating committed, the
  optimistic-concurrency rejection, and undo.
- **Quiz resume** — `startAttempt` returned the fixture's `in-progress` attempt with its
  existing answer, accumulated to two through `saveAttemptProgress`, rejoined at the same
  attempt, and opened a *new* one only after submission.
- **Exam** — a new sitting per start, `expired` scored over answered only, and a sitting
  with nothing answered scoring `null` rather than 0%.
- **Notes** — `readBlockCount` 2 → 6, monotonic when fewer indexes are sent, and the
  dangling quote source resolving to neither the snapshot nor `listSources`.

**That found the `stale_card` bug** (drift log): the fake was returning live store objects,
so the concurrency check compared a value with itself and the error was unreachable.

### 7.3 Still unverified, beyond the browser

1. **FSRS intervals.** The ladder above looks right and is not proof. Worse, this phase
   knowingly schedules every card as `learning_steps: 0` (§6.1 of the drift log), which is a
   real behavioural deviation nothing checks.
2. **The timer** against wall clock over a long sitting, backgrounded, or across a sleep.
   `useExamTimer` counts to an absolute deadline, which is the design that survives it —
   but no one has watched it do so.
3. **Resume across a real refresh.** Proven at the API level, not through the browser, so
   the runner's seeding of its answer map from `attempt.answers` is unobserved.
4. **Every card kind × every runner.** The deck fixtures carry basic, cloze and mcq; only
   basic was driven to a rating.
5. **No model has generated a quiz or exam question.** Every question is fixture data. The
   exam brief says so on screen.

## 8. Handoff to FR6

### 8.1 What an `Attempt` records, per kind

One shape for both, differing only in `artifactKind` and which outcomes occur:

| | Quiz | Exam |
| --- | --- | --- |
| `outcome` seen | `in-progress`, `submitted` | `submitted`, `expired` |
| Sittings at once | **one, resumable** | a new one per start |
| `score` | correct / answered, `null` if nothing answered | the same |
| Answers stored | accumulate as you go | all at once, every question |

`AttemptAnswer` carries `questionText`, `topicId`/`topicName`, `selectedOption` (**null is
"never answered", not wrong**), `correct`, `flagged` and `elapsedMs`.

**`abandoned` never appears** — nothing writes it (§6.2). So FR6 will see quiz attempts
stuck at `in-progress` that will never complete; do not count them as sittings, and do not
infer abandonment from age until FR7 adds the sweep.

### 8.2 Which aggregates the runners emit

- **Practice → `Review` rows** via `reviewCard`. Undo **tombstones** (`undoneAt`) rather
  than deleting, so anything re-pointing `progress.ts` or `mastery.ts` must exclude
  `undoneAt !== null` — the fake's `countableReviews` is the reference.
- **Quiz and exam → `Attempt`**, as above. This is what `mastery.ts`'s exam signal reads.
- **Notes → `readBlockCount`** via `markBlocksRead`, and it is **monotonic**: the fake takes
  the maximum, so readiness never moves backwards and a lower number is not a correction.

### 8.3 The readiness contribution per kind (brief §1.3)

What each artifact contributes to the roll-up FR6 aggregates:

| Kind | Contributes |
| --- | --- |
| Deck | due cards (and new ones within today's allowance) |
| Quiz | questions not yet answered across its attempts |
| Exam | sittings — an exam never sat is the unstarted state |
| Note set | unread sections: `blockCount - readBlockCount` |

The server already computes `Artifact.readiness`; the fake's note-set string ("3 of 9
sections unread") is the worked example of the shape.

### 8.4 What FR5 invalidated in FR6's assumptions

- **`queries.ts` is down to `useProfile`.** FR6 re-points it, and then `queries.ts`,
  `api-client.ts` and `src/lib/exam.ts` can all go — only `shuffled`, `formatDuration` and
  `TIMER_WARNING_MS` still have a caller.
- **`BlueprintPage` and `DiagnosticPage` are still unrouted**, as FR2 left them. FR5 did not
  touch them; rebuilding both against the artifact list is still FR6's.
- **The blueprint editor is unbuilt and is yours.** FR4's generate modal promises the user
  they can adjust an exam's blueprint once it exists. FR5 renders it **read-only** on the
  exam brief, where it is information a candidate can act on; editing it belongs with the
  overview. `updateArtifact` takes a payload and `Blueprint.basis` has `'manual'` for
  exactly this.
- **`@tanstack/react-virtual` is still unused** (§6.5). If FR6's lists are short too, drop
  the dependency rather than carry it further.
- **A note block's `sourceId` can name a source the artifact's snapshot never recorded** —
  three states, not two. See the drift row and `NoteBlocks.tsx`.
- **`src/features/study/` is where a study surface goes.** `scheduling.ts` is the only
  sanctioned `Card` → FSRS conversion; `WrongKind` / `NotReady` are the guards every
  artifact-keyed route should use.
