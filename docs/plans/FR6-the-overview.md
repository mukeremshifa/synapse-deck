# FR6 — The notebook overview

**Status:** ✅ **Executed 2026-09-08.** All six tasks done; criterion 8 (a browser) unmet —
see [§7.1](#71-no-browser-rendered-any-of-it--the-largest-gap-again).
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §3.4, §1.3.
**Depends on:** [FR5](FR5-study-surfaces.md) complete.
**Hands off to:** [FR7](FR7-backend-rebuild.md) — **and this handoff is the biggest one in
the sequence.** FR7 rebuilds a backend against everything FR0–FR6 established.

> Contract altitude. Names no component files.

---

## 1. Preconditions

```bash
npm run check && npm run dev   # fake mode
```

FR5's §8 handoff must name what `Attempt` records and each kind's readiness contribution.

## 1b. Reconcile — first, before any code

Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) rows naming FR6, and FR5 §6/§8.

Assumes: `/notebooks/:id/overview` exists from FR2; every artifact kind is generatable
(FR4) and runnable (FR5); `progress.ts`, `mastery.ts`, `study-plan.ts` are still in place
and still model-independent.

### What FR2 delivered — appended 2026-09-08 by FR2

- **`/notebooks/:id/overview` exists** and renders a placeholder naming FR6. Replace
  `OverviewRoute` in `src/app/routes.tsx`.
- **`BlueprintPage` and `DiagnosticPage` are unrouted but intact**, and FR2 removed their
  artifact-less navigation: the diagnostic's "drill" and "mini-exam" plan actions used to
  navigate to *the* practice and *the* exam with nothing named, and the blueprint's "Sit
  the sample exam" button did the same. Both now say what they need. **What they need is
  the artifact list**, which is exactly what your phase has — restoring those actions with
  a real deck or exam id is FR6 work, and §1.2(9) makes a blueprint belong to an *exam*.
- **`TopicMasteryList` and `StudyPlanView` survive**, as do `progress.ts`, `mastery.ts` and
  `study-plan.ts`.
- **Re-point at the contract first.** The four aggregates are on `@/lib/api`
  (`getReviewHistory`, `getDueForecast`, `getCardStates`, `getRetention`), all
  notebook-scoped. Follow `src/features/home/queries.ts`.
- **Home already renders a readiness roll-up** from `notebook.readiness.detail`. The
  overview's per-artifact readiness must agree with it — same source, `Artifact.readiness`.

### What FR3 delivered — appended 2026-09-08 by FR3

- **The provenance pattern is built and verified — reuse it.** `Provenance` in
  `src/features/notebook/StudioPane.tsx` renders names from `sourcesSnapshot` (complete,
  never dangles) and uses `sourceIds` only to decide whether a name is still *live*. A
  deleted source renders **struck through with a warning icon, never omitted**. Verified in
  a browser by deleting a real source: eight artifacts survived with provenance intact.
  Your artifact list has the same job and should look the same doing it.
- **The Studio already answers "which deck drills this topic?" by kind.** What it cannot do
  is rank or explain, which is the overview's half. Diagnostics is deliberately **not** an
  artifact kind — it is the fifth Studio entry and it **links to
  `notebookPath.overview(notebookId)`**, so your page is already the destination of a
  control that exists. The notebook header carries an "Overview" link for the same reason.
- **`src/lib/notebooks.ts` lost `toNotebook` and `isResumable`** and is now route
  construction only. Import `Notebook` from `@/lib/api`.
- **`useProfile` will outlast FR5 and FR6.** `AccountMenu` and `SettingsPage` hold it, so
  `queries.ts` does not disappear when the overview is re-pointed — plan the last step.
- **`useMediaQuery` / `MEDIA_WIDE` are in `src/components/layout.tsx`**, and `PaneGroup`'s
  `autoSaveId` now actually persists (it was a no-op v2 prop before FR3). Both drift rows
  matter if the overview uses panes.

### What FR4 delivered — appended 2026-09-08 by FR4

- **Each generation is a NEW artifact** (FR4 §6.3, brief §6.2), so the artifact list the
  overview renders only ever grows. A notebook can hold several decks built from the same
  sources at different times, and **nothing dedupes them** — if the artifact list needs to
  group or collapse regenerations, that is your design decision, and `createdAt` plus
  `sourcesSnapshot` are what you have to do it with.
- **`failed` artifacts are listable rows the user has not cleared yet.** A failed
  generation keeps its row (the contract requires it) with no contents at all — 0 cards, 0
  questions, 0 blocks. **The overview's counts and diagnostics must skip
  `status !== 'ready'`**, or a notebook with two failed decks reports decks that cannot be
  opened. FR4 clears them only when the user explicitly dismisses one.
- **`useNotebookJobs(notebookId)` already invalidates the notebook's queries when a job
  finishes**, including home's grid. If the overview shows anything a generation changes,
  it will refresh itself — do not add another poll.
- **The exam blueprint editor is promised and unbuilt.** Every exam carries a server-derived
  blueprint (`basis: 'card-counts'`), and FR4's generate modal tells the user they can
  adjust it "once it exists". Brief §3.4 says per-exam blueprints live with their exam
  rather than on the overview, so this may be FR5's — but the promise is made, and one of
  you owns it.



---

### What FR5 delivered — appended 2026-09-08 by FR5

**All four runners are on the contract**, each entered by the artifact id in its route.
`src/features/study/` is where a study surface lives now. Six things changed under you:

- **`queries.ts` is down to `useProfile`.** The old practice page and session, and the old
  exam page/runner/results/setup/navigator/fixtures, are **deleted**. `@/lib/api` serves
  home, the notebook and every runner — so **the two-stack seam is one screen wide, and it
  is yours.** Re-point `useProfile` and `queries.ts`, `api-client.ts` and most of
  `src/lib/exam.ts` all die with it (only `shuffled`, `formatDuration` and
  `TIMER_WARNING_MS` still have a caller).
- **What the runners emit, for `progress.ts` / `mastery.ts` / `study-plan.ts`:** practice
  writes `Review` rows and **undo tombstones them** (`undoneAt`), so any aggregate must
  exclude those — the fake's `countableReviews` is the reference. Quiz and exam both write
  `Attempt`. The note reader writes `readBlockCount`, **monotonically**.
- **`abandoned` is written by nothing** (FR5 §6.2). You will see quiz attempts stuck at
  `in-progress` for ever; do not count them as sittings. The server-side sweep is FR7's.
- **The blueprint editor is yours, and it is a promise already made to the user.** FR4's
  generate modal says the blueprint can be adjusted once the exam exists. FR5 renders it
  **read-only** on the exam brief; `updateArtifact` takes a payload and `Blueprint.basis`
  has `'manual'` for exactly this.
- **A note block's `sourceId` can name a source the artifact's own `sourcesSnapshot` never
  recorded** — so the FR3 provenance pattern has **three** states here, not two. See the
  drift row.
- **`@tanstack/react-virtual` is still unused.** FR5 declined it: the contract caps
  generation at 50, and the runners render one card or one question at a time. **If your
  lists are short too, drop the dependency** rather than carry it further.

Reusable, and built to be: **`WrongKind` / `NotReady`** in `src/features/study/` are the
guards for any artifact-keyed route, and **`AttemptReview`** renders an `Attempt` for
either kind if the diagnostic wants to show a past sitting.

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| Any backend, schema or migration work | **FR7** — even though this phase surfaces the need loudly |
| A **global** dashboard across notebooks | Nowhere. Brief §3.4: scoping to one notebook is what makes it honest where a global dashboard was not |
| Per-exam blueprints | They live **with their exam** (brief §1.2(9)), not here |
| The notes editor | Later |

**The trap, and it is the phase's defining one:** this looks like the old dashboard, and
the old dashboard is exactly what it must not become. The old one guessed a notebook. This
one is *given* one by the route. If you find yourself wanting a notebook selector at the
top, **stop** — that is the guess coming back wearing a different hat.

---

## 3. The rule this phase runs under

> **Readiness is a bundle, not a card count.** (Brief §1.3.)

Today "18 due" is a raw card count and the only signal. Replace with per-artifact
readiness, rolled up:

```
Artifact.readiness  →  { state: 'ready' | 'partial' | 'none', detail: string }
Notebook.readiness  →  roll-up, e.g. "2 decks · 1 quiz ready"
```

Practice means "work this bundle", not "drill N cards". The property that matters: **a new
artifact kind extends readiness without touching the home screen.** If adding a kind would
mean editing home, the roll-up is in the wrong place.

Second rule, from FR0 §3, and this is where it is most likely to be broken:

> **No pre-joined graphs no endpoint could produce.** An overview wants everything at once.
> If the fake serves it as one magic call, FR7 inherits an endpoint nobody can build.

---

## 4. Tasks

### Task 1 — The artifact list

Everything the notebook has produced, by kind, **with source provenance** — the thing
nothing in the app can show today.

Includes artifacts whose sources are gone (brief §1.2(7)). **Dangling ids are valid**;
show what it was built from via `sourcesSnapshot`.

### Task 2 — Readiness

Per-artifact, rolled up to the notebook. Must agree with what home shows (FR2) — **one
source of truth, not two computations that drift.**

### Task 3 — Diagnostics

Topic mastery, `mastery.ts` re-pointed. Topics are **notebook-scoped** (brief §1.2(5)),
which is the live bug DS4 fixed at the SQL level and the contract now fixes structurally:
[ADR 0009](../adr/0009-topic-reconciliation-by-name.md) keeps by-name reconciliation; what
changed is the scope.

### Task 4 — The review heatmap, notebook-scoped

`progress.ts` re-pointed. **This is where FR0's task-5 decision comes due.** The four
Supabase-backed aggregate hooks (`useReviewHistory`, `useDueForecast`, `useCardStates`,
`useRetention`) were either re-pointed at the contract or deleted; read FR0 §6 to find out
which, then build accordingly.

Note what the old implementation bought: `review_day_counts` aggregated **in Postgres**
because a serious user's year is ~70,000 review rows and the aggregate returns at most 365.
The fake will happily do it in memory over fixture data. **Whatever shape you give this,
FR7 must be able to serve it without shipping 70,000 rows to the browser** — say so in the
handoff.

### Task 5 — The study plan

`study-plan.ts` re-pointed, notebook-scoped, exam-date aware.

### Task 6 — Document, and hand off to FR7

`SPEC.md`; [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md); and **§8, which is this phase's most
valuable output.**

---

## 5. Acceptance criteria

1. `/notebooks/:id/overview` shows the artifact list with provenance, **for one notebook
   named by the route**. No selector, no guess.
2. Artifacts with **dangling `sourceId`s render correctly.**
3. Readiness is a bundle and **agrees exactly with home's roll-up**.
4. Adding a hypothetical new artifact kind would not require editing home. Reason it
   through and say so — this is §3's stated property.
5. Diagnostics show **notebook-scoped** topic mastery.
6. Heatmap and study plan are notebook-scoped and re-pointed.
7. **No endpoint the fake serves is one a real API could not.** Re-read FR0 §3 against your
   own calls — this phase is where that rule breaks.
8. Opened in a browser: an empty notebook, a full one, one with a deleted source.
9. `npm run verify` passes.
10. §6 recorded; drift log appended; **§8 written**.

---

## 6. Decisions recorded — executed 2026-09-08

### 6.1 Readiness is contract-served, and nothing on the client recomputes it

**Server-computed, rendered as received.** `projectArtifact` in `fake.ts` computes
`Artifact.readiness` per kind; `projectNotebook` rolls those up into
`Notebook.readiness`. Home, the Studio and the overview all render the resulting
`state` and `detail` and none of them derives a readiness of its own.

That is what makes criterion 3 structural rather than a coincidence someone maintains
by hand: there is one computation, so there is nothing to disagree about. The only
thing that could still have drifted was the *rendering*, and it was already drifting —
home and the Studio had each grown an identical `ReadinessBadge` and the overview would
have made a third. Extracted to `src/components/artifact-bits.tsx` with `Provenance`,
which had the same problem coming.

**Criterion 4, checked rather than argued.** `grep` for `kind === '…'`, `case '…'` and
`ARTIFACT_KINDS` across `src/`: home appears **nowhere** in the results. It renders
`readiness.detail` and `counts`, neither of which a new kind changes. A fifth kind
lands in `projectArtifact`, in the roll-up's label table, and in the four places that
genuinely are kind-aware — the generate modal, the generation panel, the Studio's
grouping, the overview's grouping and `WrongKind`. Home is not one of them.

The card count this replaced could not have that property: "18 due" is a *deck's* unit,
so a kind not measured in cards had nowhere to appear.

### 6.2 What `/progress` is now — **superseded, and the route stays deleted**

FR0 found `/progress` had already been removed and **deleted all four Supabase stats
hooks** rather than re-pointing them (drift log, 2026-09-08). This phase settles the
question the plan says is ambiguous until now:

> **`/progress` is superseded by the notebook overview and is not coming back.**

The four aggregates it served are now `getReviewHistory`, `getDueForecast`,
`getCardStates` and `getRetention`, all notebook-scoped, all rendered on
`/notebooks/:id/overview`. A global progress route would have to answer "progress at
what?" without a subject, which is the `focus` guess in a different hat — and brief §3.4
is explicit that scoping to one notebook is what makes these figures honest.

`progress.ts` survives, but **smaller than it was**: what re-pointing kept is the
*layout* half (`heatmapGrid`, `intensityThresholds`, `intensityLevel`, `streaks`), which
is presentation. The *reduction* half — `dayCounts`, `countable`, `retention`,
`forecast`, `stateDistribution`, `memoryStrength`, `memoryTrend` — has no caller on this
screen, because the client no longer sees a review row to reduce. See §6.4.

### 6.3 Which aggregates must be server-side, and the row counts that justify each

| Aggregate | Rows the client would need | Rows on the wire | Verdict |
| --- | --- | --- | --- |
| `getReviewHistory` | every `reviews` row in the window — **~70,000** for a serious user's year | ≤365 | **Must be server-side.** This is what `review_day_counts` aggregated in Postgres, and the reason it did. |
| `getRetention` | every review inside 90 days — **thousands** | 1 object, ~8 numbers | **Must be server-side.** The Supabase version fetched them all and reduced in the browser. |
| `getTopicMastery` | every active `card` in the notebook, **and cards are only listable per deck** — an N+1 over deck artifacts, each paginated | 1 row per topic, ~5–40 | **Must be server-side.** FR6's one contract addition; see §6.5. |
| `getCardStates` | every card in the notebook — hundreds to thousands | 1 object, 7 numbers | **Should be server-side.** Same N+1 as mastery; the reduction is trivial in SQL. |
| `getDueForecast` | every active card's `due` — same set as above | ≤14 buckets | **Should be server-side.** Also the *only* one whose day 0 must agree with what practice serves, which is a policy the client owns — see the caveat below. |
| `Notebook.readiness` / `counts` | every artifact, plus every card and attempt behind them | a few fields per notebook | **Must be server-side.** A home grid that fetched each notebook's contents to render a card is N+1 by construction — the contract says so on `Notebook`. |

**One caveat FR7 must not lose.** `PracticeQueue`'s doc comment says the *reads* move
server-side but the *policy* — `buildQueue` and the daily new-card cap — stays on the
client, because the same policy drives the queue, home's "new available" figure and the
forecast's day 0. `getDueForecast` computing `fresh` server-side is therefore a second
implementation of that cap, and the fake already does it (`store.profile.dailyNewLimit`
minus today's introductions). **If those two ever disagree, the forecast's day 0 and the
practice queue will report different numbers for the same minute.** Either the cap moves
wholly server-side or the forecast returns the inputs and lets the client apply it; FR7
should decide deliberately rather than inherit the split.

### 6.4 What the pure modules could not express — one real finding

Brief §1.4 said `progress.ts`, `mastery.ts` and `study-plan.ts` keep their place. **Two
of the three kept it completely. One did not, and the reason is a finding.**

- **`study-plan.ts` — unchanged, no adaptation.** `buildStudyPlan`, `planFit`,
  `examSchedule`, `diagnosisFor` and `actionsForTopic` all consume `TopicMastery`, and
  `TopicMasteryEntry` matches it field for field, so the report feeds them directly.

- **`mastery.ts` — kept, but it had to *move*.** `topicMastery(cards, answers)` needs
  per-card `stability`, `difficulty` and `lastReviewedAt` grouped by topic. The contract
  lists cards only as `listCards(notebookId, artifactId)` — **per deck** — so computing
  this in the browser is one paginated call per deck artifact, growing with the notebook.
  That is the pre-joined graph FR0 §3(1) forbids and precisely what criterion 7 tests.
  The module is unchanged and still the only implementation of the arithmetic; what
  changed is that the *fake* calls it and the client reads the result. See §6.5.

- **`progress.ts` — half of it is now unreachable, and that is correct.** The module was
  written to reduce raw rows: `dayCounts(countable(rows), tz)`, `retention(rows, window)`,
  `forecast(cards, …)`, `stateDistribution(cards)`. The contract serves all four of those
  already reduced, so **those functions have no caller on this screen** and the types they
  take (`ReviewLogEntry`, `ProgressCard`, `ForecastCard`, `CountedReviews`) describe rows
  the client never sees. What survives and is used is the layout half — `heatmapGrid`,
  `intensityThresholds`, `intensityLevel`, `streaks`.

  **This is not a loss and should not be "fixed" by re-adding row endpoints.** The
  reduction moving server-side is the whole point of §6.3. But FR7 should know that a
  meaningful part of `progress.ts` is now dead weight, and deleting it is a deliberate
  act someone should take rather than a tidy-up done in passing — the retention and
  forecast arithmetic in there is the *specification* for the SQL FR7 has to write.

### 6.5 The contract changed twice, and both were forced

**FR6 was not supposed to touch the contract.** Both changes are recorded here because
they alter what FR7 builds.

1. **`getTopicMastery(notebookId): TopicMasteryReport` — added.** The argument is §6.4
   and the schema's own doc comment. It joins the four aggregates that had already won
   this argument. `client.ts` throws `not_implemented`.

2. **`updateArtifact`'s input widened from `{ title }` to `{ title?, blueprint? }`.**
   FR4's generate modal tells the user the blueprint "belongs to the exam, and you can
   adjust it once it exists", and FR5's handoff passed the editor to FR6 saying
   `updateArtifact` "takes a payload". **It did not** — it took a title, so the
   capability was absent from the contract and no surface could have kept the promise.
   Sending a blueprint sets `basis` to `'manual'`, and the server checks the weights sum
   to the exam's `questionCount` and refuses a blueprint on a non-exam.

   **The editor is on the exam brief, not the overview.** The blueprint belongs to its
   exam (brief §1.2(9)) and this plan's own §2 puts per-exam blueprints out of the
   overview's scope; the brief is where the weighting is information a candidate can act
   on. So FR6 built the capability and the surface, and the surface lives in FR5's area.

### 6.6 Two corrections to FR5's handoff

Both were acted on and both were wrong, so they are recorded rather than left to mislead:

- **`src/lib/api-client.ts` does not die with `queries.ts`.** FR5 listed it among the
  things FR6 deletes. It is the HTTP transport `src/lib/api/client.ts` is built on — the
  live implementation of the contract — not part of the old query stack. Deleting it
  breaks `client.ts`. It stays. `src/lib/queries.ts` **is** deleted, as are
  `DiagnosticPage`, `BlueprintPage`, `Citation.tsx` and `src/app/Placeholder.tsx` (whose
  last caller went when `/overview` was filled).

- **`updateArtifact` does not take a payload.** See §6.5(2).

### 6.7 `@tanstack/react-virtual` is gone

FR1 added it for FR5's task 5; FR5 declined it and told FR6 to drop it if the overview
had no long list either. It does not — the longest thing on the page is 365 heatmap
cells, which are plain divs in a scroll container, and virtualising them adds bugs and no
speed. Removed from `package.json`; the two comments naming it as available are corrected.

---

## 7. What went unverified

**`npm run verify` passes: the code typechecks, lints and builds.** Nothing here is
tested, and there is no suite (ADR 0005). What follows is what that leaves open.

### 7.1 No browser rendered any of it — the largest gap, again

**This session had no browser automation available**, so criterion 8 is **unmet**: an
empty notebook, a full one and one with a deleted source were never opened on screen.
This is the same gap FR5 recorded, and it is now two phases deep.

What was done instead, and it is not a substitute: **the fake was driven directly through
its real module graph** (bundled with the repo's own esbuild, run in Node, then deleted)
across all four fixture notebooks. That exercises every data path the page reads and
proves the arithmetic and the error branches, and it proves **nothing about layout,
responsive behaviour, focus order or contrast.** FR3 and FR2 each found four defects by
opening a browser that no amount of reading found; those defects are still findable here.

What the probe did establish:

- All four notebooks project correct readiness, including the two empty states —
  `nb-stats` (no sources) reads "Empty" and `nb-biochem` (sources, nothing generated)
  reads "Nothing generated yet", which are different sentences for different situations.
- **The dangling source renders.** `art-deck-abx`'s snapshot names "Cephalosporin
  generations (deleted)", which `listSources` does not return — the struck-through path
  is reached on the first notebook.
- **The failed artifact is listed and excluded from counts.** `nb-neuro` has a `failed`
  deck; it keeps its row and the kind's summary counts only the ready one.
- **The in-progress quiz attempt is excluded from mastery.** `nb-pharm` has one, with an
  answered question, and mastery counts 5 answers rather than 6 — FR5's `abandoned`-is-
  never-written row, handled.
- **The blueprint editor's four branches:** an unbalanced blueprint is refused with the
  arithmetic in the message, a balanced one saves and flips `basis` to `manual`, a
  blueprint on a deck is refused, and a title-only update still works.

### 7.2 Every aggregate is computed over fixture data

Correctness against real review histories is unproven, and `mastery.ts` and
`study-plan.ts` are exactly the kind of arithmetic that is wrong quietly. The numbers the
probe printed are self-consistent and plausible — `nb-pharm` retention 0.92 over 121
reviews, Beta-lactams at 0.98 with three exam answers behind it — but "plausible" is the
whole trap: a confidently wrong mastery score is the failure mode this screen has.

### 7.3 Performance has met nothing

The fake holds a few hundred rows. **Nothing here has met 70,000.** §6.3 says which
aggregates must be server-side and why, but that is an argument, not a measurement.

### 7.4 Readiness agreement is proven by construction, not by observation

§6.1 argues it structurally — one computation, one badge — and the probe confirmed the
roll-up matches the per-artifact states it is built from. **Home and the overview were
never seen side by side**, which is what criterion 3 literally asks for.

### 7.5 The exam brief and its new editor were not opened

The blueprint editor's logic was driven through the fake, but the dialog itself has never
rendered. Its `aria-live` total, its disabled-Save state and its behaviour on reopen
after a cancel are all unobserved.

---

## 8. Handoff to FR7 — the build list

**Read this before touching `services/api/`.** FR7 rebuilds a backend against everything
FR0–FR6 established, and the contract — not the brief — is the truth by now.

### 8.1 The one-line summary

> **`src/lib/api/contract.ts` is the specification.** 43 methods on `ApiClient`.
> `client.ts` implements **21** against the P9 backend and throws `not_implemented` for
> **22**. Those 22, plus the 21 that must be re-shaped onto the new schema, are the job.

### 8.2 Every method, and whether `client.ts` serves it today

**Implemented (21)** — these hit real routes on the existing AWS API. They still need
re-shaping where the schema changes underneath them, but the route exists:

`getProfile`, `updateProfile`, `getQuota`, `getGlobalSummary`, `listNotebooks`,
`getNotebook`, `createNotebook`, `updateNotebook`, `deleteNotebook`, `requestUpload`,
`listTopics`, `listCards`, `updateCard`, `setCardStatus`, `deleteCards`,
`getPracticeQueue`, `reviewCard`, `undoReview`, `ask`, `getJob`, `listJobs`.

**Throwing `not_implemented` (22)** — the build list proper, with the reason `client.ts`
gives, which is also the schema gap:

| Method | Why it cannot be served today |
| --- | --- |
| `listSources` | Sources are not persisted |
| `getSource` | Sources are not persisted |
| `addSource` | A source cannot be added to an existing notebook |
| `deleteSource` | Sources are not persisted |
| `listArtifacts` | Artifacts are not a table |
| `getArtifact` | Artifacts are not a table |
| `createArtifact` | Generation creates a new notebook rather than an artifact within one |
| `updateArtifact` | Artifacts are not a table |
| `deleteArtifact` | Artifacts are not a table |
| `listQuestions` | Questions are not stored |
| `startAttempt` | There is no attempts table |
| `saveAttemptProgress` | Quiz attempts are not resumable |
| `submitAttempt` | Answers are recorded loose via `POST /exams/answers`, not against an attempt |
| `getAttempt` | There is no attempts table |
| `listAttempts` | There is no attempts table |
| `listNoteBlocks` | Note sets do not exist |
| `markBlocksRead` | Note sets do not exist |
| `getReviewHistory` | There is no review-history aggregate |
| `getDueForecast` | There is no forecast aggregate |
| `getCardStates` | There is no card-state aggregate |
| `getRetention` | There is no retention aggregate |
| `getTopicMastery` | There is no topic-mastery aggregate |

**Four clusters, in dependency order:** sources → artifacts (and their contents: cards
already exist, questions and note blocks do not) → attempts → the five aggregates.

### 8.3 Aggregates that must be server-side

**§6.3 is the table, with row counts.** The short version: `getReviewHistory` (~70,000
rows in, ≤365 out), `getRetention` (thousands in, one object out) and `getTopicMastery`
(every active card in the notebook, one row per topic out) are **not optional** — a client
cannot produce them without fetching data no API should ship. `getCardStates` and
`getDueForecast` are the same shape and cheaper, but the reduction still belongs in SQL.

**And read §6.3's caveat about `getDueForecast`'s day 0.** The daily new-card cap is
client-side policy by design, and the forecast computing `fresh` server-side is a second
implementation of it. Decide that deliberately.

### 8.4 Where the fake does something a real API would find expensive

Legal but worth naming, because a literal port would be slow:

- **`projectArtifact` and `projectNotebook` run on every read.** Listing a notebook's
  artifacts recomputes each one's readiness from `store.cards`, `store.questions`,
  `store.attempts` and `store.noteBlocks`. In SQL that is a correlated subquery per
  artifact per row — the shape that looks fine at 6 artifacts and is a table scan at 600.
  It wants a join with aggregates, or materialised counters, not a per-row lookup.
- **`projectNotebook` does the same one level up**, and `listNotebooks` calls it per
  notebook. The home grid is therefore N notebooks × their artifacts × their cards. The
  contract's own comment on `Notebook.counts` says this must be "a few aggregate columns,
  not a nested graph" — the fake does not honour its own advice, because in memory it
  costs nothing.
- **`paginate` slices an already-filtered, already-sorted, already-copied array.** A real
  implementation must push the sort and the limit into the query; the cursor is an
  encoded offset here, and an offset cursor over a large table is the classic deep-paging
  problem. The contract says the cursor is opaque precisely so FR7 can make it a keyset.
- **`getTopicMastery` reads every active card in the notebook** to compute retention. That
  is correct and unavoidable *server-side*, but it is a full scan of the notebook's cards
  on every load of the overview. It wants an index on `(notebook_id, status, topic_id)`
  and probably a cache — the numbers change only when a review is written.
- **`countableReviews` filters `store.reviews` from scratch** for the history, the
  forecast's "introduced today", retention and the streak — four scans per overview load.

### 8.5 The noun list, as it actually ended up

Eleven entity shapes and five aggregate shapes. **The brief's §1.1 anticipated the first
five; the rest emerged.**

| Noun | Notes for the schema |
| --- | --- |
| `Notebook` | The only first-class citizen. Carries a computed `readiness` and `counts`. |
| `Source` | Persisted (it was `useState([])` before). Has a `status` because adding one is a job. |
| `Topic` / `TopicSummary` | Reconciled by name (ADR 0009), **notebook-scoped**. `TopicSummary` carries `unfiledCards` separately — not a topic, not an error. |
| `Artifact` | **The central noun.** One kind-tagged row (`deck`/`quiz`/`noteset`/`exam`), with `ArtifactPayload` as a discriminated union. `sourceIds` **may dangle**; `sourcesSnapshot` is frozen and never does. |
| `SourceSnapshot` | Denormalised provenance. The reason artifacts survive source deletion. |
| `Card` | Locked to its deck — no move operation exists anywhere in the interface. `updatedAt` is the optimistic-concurrency token, compared **byte for byte**. |
| `Review` | Tombstoned on undo (`undoneAt`), never deleted. **Every aggregate must exclude tombstones.** |
| `Question` | Deliberately *not* a card — a question answered once under time is not on a schedule. |
| `Attempt` / `AttemptAnswer` | One sitting of a quiz or exam, same record for both. `questionText` is **copied, not joined** (ADR 0013). `selectedOption` indexes the *presented* order. |
| `NoteBlock` | A discriminated union, never one text blob (brief §1.2(2)) — so the later editor is not a migration. |
| `Job` | `addSource` and `createArtifact` return one. `result` is populated **only on `succeeded`**. |
| `Blueprint` / `BlueprintWeight` | Belongs to its **exam**, not the notebook. `basis` is `card-counts` \| `mastery` \| `manual`. |
| `ReviewHistory`, `DueForecast`, `CardStates`, `RetentionSummary`, `TopicMasteryReport` | The five aggregates. The last is FR6's addition. |
| `GlobalSummary` | **The one deliberately cross-notebook shape**, and nothing on it may become a CTA. |
| `Profile`, `QuotaUsage` | Survive from today, camelCase on the contract. |

### 8.6 Open questions from the brief's §6 that got forced

- **q1 — does deleting a notebook delete its artifacts?** *Forced, answered yes* in the
  contract's `deleteNotebook` comment. Deliberately not a contradiction of §1.2(7): an
  artifact surviving *its source's* deletion is a different question from surviving the
  deletion of the notebook containing it.
- **Regeneration: replace or add?** *Forced by FR4 §6.3 — a regeneration is a **new**
  artifact, never a replacement.* So an artifact's id, contents and `sourcesSnapshot` are
  stable for its lifetime and an attempt recorded against one can never be invalidated.
  The cost, recorded: nothing dedupes, so a notebook accumulates decks built from the same
  sources and the overview's list only ever grows.
- **Pagination.** *Forced by FR0* — `Page<T>` everywhere, because a list that would page
  at FR7 must page from the start or every screen is designed having never seen page two.
- **Chat history.** *Still open, and deliberately.* Chat is not a noun; the single
  committed requirement is that a response can be saved as a note, which is why
  `AskResponse` carries an id.
- **The review gate.** *Forced by FR4 — it does not exist.* `Card.status` is
  `active | suspended`; there is no draft. Card-by-card triage needs a contract change and
  should not be added to a runner without deciding that first.

### 8.7 Four things FR7 owns that nothing else can fix

1. **`learning_steps` is not persisted** (FR5's drift row). Every card schedules as though
   on step 0, so a `learning`/`relearning` card that should graduate on `Good` may take
   one extra repetition. It cannot affect a `review` card. **Three columns, three fields
   on `Card` and `NextSchedule`** — and it should not be done from a consuming phase.
2. **`abandoned` is written by nothing** (FR5 §6.2). A runner cannot distinguish "walked
   away" from "lost the network". It needs a **server-side sweep** of attempts still
   `in-progress` well past their exam's duration. Until then the overview sees quiz
   attempts stuck `in-progress` for ever and correctly declines to count them.
3. **Tenancy is a discipline, not a guarantee** (CLAUDE.md, ADR 0008). Every new table
   needs a data-access module following all four rules. `scripts/check-data-access.mjs`
   enforces two of them and cannot enforce the other two. **A new table without one is a
   cross-tenant leak, not a TODO.**
4. **A running job cannot name the artifact it is building** (FR4's drift row).
   `Job.result` is populated only on `succeeded`, so a per-row progress bar is not
   expressible and a failed job matches its `failed` artifact only heuristically. FR7
   could add a running `result.artifactId` if a per-row bar is wanted.
