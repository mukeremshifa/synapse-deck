# FR4 — Generation

**Status:** ✅ Complete 2026-09-08. Typechecks and builds; driven by hand in a browser.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §3.2, §1.1.
**Depends on:** [FR3](FR3-the-notebook.md) complete.
**Hands off to:** [FR5](FR5-study-surfaces.md).

> Contract altitude. Names no component files.

---

## 1. Preconditions

```bash
npm run check && npm run dev   # fake mode
```

FR3's §8 handoff must name the generate modal's entry points.

**One extra, and it is specific to this phase:** confirm FR0's fake can inject latency and
errors. Brief §2.2(2) — a fake with only a happy path is `json-server` with extra steps,
and **this is the phase that spends that capability.** If it is missing, build it now
(small) rather than designing the error surfaces blind.

## 1b. Reconcile — first, before any code

Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) rows naming FR4, and FR3 §6/§8.

Assumes: `createArtifact` and `addSource` return a `Job`; `getJob` advances through stages
over wall-clock time; the fake's error injection covers at least `quota_exceeded` and
`rate_limited`; FR1's `generating` state component exists.

### What FR2 delivered — appended 2026-09-08 by FR2

- **The modal system is `src/app/modals.tsx`**, and modals are **URL-reflected**:
  `?modal=generate&kind=quiz`. `generate` is already in the `ModalName` union;
  `ModalProvider` is mounted in `AppRoutes`. `useModal()` gives `openModal`, `closeModal`,
  `modalProps(name)` (spread onto a Radix `Dialog`/`Sheet`) and `modalParam(key)`.
  **`src/features/home/NewNotebookModal.tsx` is a worked example** — form, mutation,
  invalidate, close, navigate.
- **A generate modal is therefore linkable and survives a reload**, which is the property
  the decision was made for. Read your params through `modalParam` and validate them: they
  are user-editable text.
- **The `/create/*` page family is deleted.** `CreateFromTextPage` and
  `CreateFromDocumentPage` are gone. `ReviewGatePage`, `JobProgressPanel`,
  `PipelineStages`, `StagingList`, `useJobProgress` and `useUploadDocument` **survive on
  disk, unrouted** — yours to mine or replace. The review gate becomes a modal over the
  notebook (brief §3.2).
- **One modal at a time.** `openModal` replaces rather than stacks; a sub-decision uses
  `ConfirmDialog`, which stays local state on purpose.

### What FR3 delivered — appended 2026-09-08 by FR3

Every assumption in §1b above holds. Four things are now concrete rather than planned.

- **Your entry point exists and is wired.** Studio opens `?modal=generate&kind=<kind>` —
  from the single button on an empty entry, and from "+ New …" under a non-empty one.
  `src/features/notebook/GenerateModalPlaceholder.tsx` is the seam: **delete that file and
  put the real modal on the same param contract.** It already validates `kind` with
  `ArtifactKind.safeParse` rather than trusting it (a modal's params are user-editable
  text) and falls back rather than throwing on a hand-typed `?kind=nonsense`. Keep both.
- **The pending state you replace is a poll, not a surface.** `useSources` and
  `useArtifacts` in `src/features/notebook/queries.ts` set `refetchInterval: 1500` while
  any row is `processing` / `generating`, and a source row shows the word "Processing…".
  That is the honest minimum FR3 was allowed, not a design. **Remove both polls when the
  job surface lands** — two mechanisms watching the same thing is worse than either.
- **Save-as-note landed in FR3, so you have two callers, not one.**
  `useSaveResponseAsNote` calls `createArtifact({ kind: 'noteset', fromResponseId })`, so a
  chat answer becomes a real note-set artifact and **returns a `Job` like any generation**.
  Whatever progress surface you build is reached from the Studio *and* from the chat pane.
- **A `generating` artifact already renders.** `ArtifactRow` in `StudioPane.tsx` draws it
  greyed and **not a link** (the contract calls it "greyed, unopenable"), and a `failed`
  one keeps its row with a `Failed` badge so it can be seen and retried. You are adding
  progress *to* an existing row, not inventing the row.


---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| The runners the generated artifacts feed | **FR5** |
| The overview's artifact list | **FR6** |
| Real model calls, Bedrock, embeddings | **FR7** and beyond |
| Chat persistence | Undecided (brief §6.4) |
| Backend | FR7 |

---

## 3. The rule this phase runs under

> **`createArtifact` returns a `Job`, never the finished artifact.**

Generation takes seconds to minutes and involves a model. FR0's §3 forbids the fake from
returning the finished deck synchronously precisely so this phase has to design the
progress surface — the one the brief calls "the hardest surface to design and the one most
worth prototyping" (§2.1).

And the constraint that keeps the progress honest, from `PipelineStages.tsx:25`:

> **Every stage is derived from a field the job actually reports.** Do not invent stages
> the pipeline could not report.

Stages that describe work the pipeline does not do are a progress bar that lies slowly.

---

## 4. Tasks

### Task 1 — The generate modal, one per artifact kind

Brief §3.2: kind, **source selection**, count, depth. Opened from Studio (FR3), never from
a page navigation.

Source selection is the piece with no precedent in the current app — today a job takes one
document and **creates a notebook**. Here the user picks from *this notebook's* sources
(brief §1.2(6): no cross-notebook sources) and the chosen ids become the artifact's
`sourceIds[]` plus its `sourcesSnapshot`.

Four kinds, and they differ (brief §1.2(2), (3)):

- **Deck** — count, kinds, depth.
- **Quiz** — question count; untimed, so no duration.
- **NoteSet** — **structured blocks, never one blob**; a blob makes the later editor a
  migration.
- **Exam** — timed; duration and the **blueprint, which belongs to the exam** (§1.2(9)).

### Task 2 — Job progress

Stages, not a bare percentage (`JobProgressPanel.tsx:53`: a percentage says how much is
left, stages say what is happening). Reuse `PipelineStages`' thinking; its stage-to-field
discipline is the part worth keeping.

Progress must survive navigation — a user who starts a generation and looks at another
notebook should not lose it. **Decide how, and record it.**

### Task 3 — The error surfaces

This is what the dialable fake exists for. Design, on screen, for at least:
`quota_exceeded`, `rate_limited`, a mid-job failure, and a job that fails **before any
stage reports** — the case a stage-based UI handles worst.

Brief §1.2(7): a failed generation must not corrupt the notebook. **A failed job leaves no
half-artifact.**

### Task 4 — The review gate, as a modal

Brief §3.2. Today it is `/create/review/:deckId`, a page that **navigates to a route that
does not exist** on completion (`ReviewGatePage.tsx:297`). FR2 removed the dead
navigation; FR4 removes the page.

As a modal over the notebook, its exit is "close" — there is nowhere to navigate to,
which is what removes the bug class entirely.

Note the two `draft` meanings (`notebooks.ts:44`): `deck_status: 'draft'` (generation
finished, gate not passed) is **not** the removed `card_status: 'draft'`. A grep-wide
rename treating both alike is the documented way this breaks silently.

### Task 5 — Delete `/create/*`

The whole page family, and the flow that creates a notebook when the user meant to add to
one. Check imports first.

### Task 6 — Document, and update what follows

`SPEC.md`; [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md); FR5–FR6 where invalidated.

---

## 5. Acceptance criteria

1. Every artifact kind has a generate modal with source selection scoped to the notebook.
2. **Generation never navigates away and never creates a notebook.**
3. `createArtifact` returns a `Job`; the UI shows stages derived from reported fields only.
4. Progress survives navigating away and back.
5. **All four error cases designed and seen on screen**, including failure before any stage.
6. A failed job leaves no half-artifact.
7. The review gate is a modal; `/create/*` is deleted.
8. NoteSet generation produces **structured blocks**, verifiable in the fake's data.
9. An exam carries its own blueprint.
10. Opened in a browser, 1280px and 375px.
11. `npm run verify` passes.
12. §6 recorded; drift log appended.

---

## 6. Decisions recorded

### 1. In-flight jobs survive navigation via the query cache, not a provider

**`useNotebookJobs(notebookId)` in `src/features/notebook/jobs.ts`** polls `listJobs` at
1.5s while anything is running and stops when nothing is. React Query's cache is the only
client-side state; there is no provider and no job-id bookkeeping.

The argument against the alternatives is one argument: **a provider holding in-flight ids
is a second source of truth, and it is the one that is wrong after a reload.** A user who
starts a two-minute generation and closes the tab has a job running on a server; a
provider that lost its `useState` says nothing is running. The contract anticipated this —
`listJobs` is documented as "in-flight and recently finished jobs, **so a reload can
rejoin one**". "Polling on return" is what this is, done where the cache keeps the last
answer so returning renders immediately and corrects a moment later.

**The limit, stated:** progress is visible on the notebook the job belongs to, not
globally. Jobs are notebook-scoped in the contract, and a cross-notebook feed would
violate FR0's rule that `getGlobalSummary` is the one cross-notebook method.

Verified in a browser: a deck generation left at `Queued`, navigated to home and back, was
rejoined at `Splitting into sections`.

### 2. A failed job leaves a `failed` artifact with no contents, and the user clears it

The fake pushed the artifact row at `generating` *before* running the job, and nothing
flipped it back — a failed generation left a row spinning for ever. `startJob` gained an
**`abandon` hook, the mirror of `commit`**: on failure the artifact becomes
`status: 'failed'` and **no cards, questions or blocks are ever written**, because `commit`
is the only thing that writes them and a failed job never reaches it. A failed `add-source`
marks its source `failed` with the reason, for the same reason.

The row is **kept, not deleted** — the contract is explicit that a failed artifact keeps
its row "so the user can see what did not work, and retry". Clearing it is
`deleteArtifact`, behind a confirmation.

**Retry reopens the generate modal rather than resubmitting.** The original request's
options are not recoverable — the contract stores what was *produced*, not what was asked
for — so re-running a guess at them is how a user gets a deck they did not order.

Verified in a browser: a failed deck generation left an artifact with **0 cards**.

### 3. A regeneration is a NEW artifact. It never replaces one.

Brief §6.2 left this open and said new-artifact is simpler and matches §1.2(7). **This
phase forces it, and chooses that.** Nothing in FR4 mutates or reuses an existing
artifact's id.

What it buys, and why it matters most to FR5: **a runner may treat an artifact's id,
contents and `sourcesSnapshot` as stable for its lifetime.** An attempt recorded against
an artifact id can never be invalidated by a regeneration, because a regeneration produces
a different id. Replacement-in-place would mean an attempt could outlive the questions it
answered.

The cost, recorded: regenerating leaves the old artifact in the list, and deleting it is
the user's explicit act. **Noted in the brief's §6.**

### 4. Save-response-as-note landed in FR3, not here

FR3 built `useSaveResponseAsNote`. FR4's only obligation was to make sure it reaches the
same progress surface, and it does: `GenerationPanel` renders whatever `listJobs` reports,
so a note saved from chat gets the same stages and the same failure handling with no
special case.

### 5. The review gate is a completion surface, because the contract has no drafts

**Not in the original plan, and it is the biggest deviation from it.** Task 4 asked for the
review gate as a modal. The FR0 contract has **no draft concept at all**: `Card.status` is
`active | suspended`, there is no `deck_status`, and nothing in `ApiClient` accepts or
rejects a generated card. FR0 dropped it deliberately when it rewrote the nouns, so there
was nothing to build a card-by-card gate against.

What shipped is the part the contract *can* express, and it is the part `Job.truncated`
was put there for — its own doc comment says "the review gate's whole reason for existing:
the user should see what did *not* make it in". A **partial** success gets a panel naming
exactly what did not land; a clean success gets nothing, because the artifact simply
appearing ready is the whole outcome.

**Its exit is "Open it" and nothing else**, which is what removes the bug class task 4
named: the old page navigated to a route that did not exist.

**Card-by-card triage needs a contract change and is not in this phase.** Recorded in the
drift log so a later phase decides it deliberately rather than discovering it.

### 6. Two contract limits found, both recorded rather than worked around

- **A running or failed job cannot name its artifact.** `Job.result` is populated only on
  success, so a progress bar *inside* an artifact row is not expressible — hence a panel
  above the list. A failure is rendered **from the job** (it carries `error.code`) and the
  leftover row from the artifact; doing it the other way round loses the reason, which is
  a real defect this phase shipped and then found in a browser.
- **`closeModal` leaked its params.** `openModal('generate', { kind })` set `kind` and
  closing removed only `modal`, leaving `?kind=quiz` on the notebook for ever. Fixed in
  `modals.tsx` by recording the owned keys in the URL. A bug in FR2's system that FR4 was
  simply the first to expose.

## 7. What went unverified

No tests. **Typechecks and builds**, plus what was driven by hand in a browser over CDP
(Chrome, 1280px and 375px, signed in as the demo account, fake mode):

- the generate modal for all four kinds, opened from the Studio and from a pasted URL;
- a full quiz generation: stages advancing `Queued → … → Saving`, the unit counter
  climbing `0 of 9 → 6 of 9`, the panel clearing and the row appearing ready;
- **all four error cases** — `quota_exceeded` failing before any stage reported (pinned to
  `Queued`, no retry offered), `rate_limited` and `provider_error` mid-job (both with a
  working retry), and a truncated success reporting `8 of 9 sections`;
- a failed generation leaving an artifact with **0 cards** (`listCards` read directly);
- a note set generating `heading` / `paragraph` / `list` blocks, not a blob;
- an exam carrying its own `blueprint` (`basis: 'card-counts'`) alongside its config;
- progress rejoined after navigating to home and back;
- 375px: no horizontal overflow, dialog fits with even margins.

What that still does not prove:

1. **No real generation has run.** Every stage, timing and error is the fake's. The real
   pipeline's timings will differ and its failure modes may not match.
2. **The stage list is honest only against today's pipeline.** FR7 may report different
   fields; the discipline is a reading, not a check.
3. **Quota and rate-limit handling** is designed against injected errors, never a real 429.
4. **Structured note blocks** are proven only as far as the fake's shape.
5. **A full page reload mid-job was not verifiable in fake mode** — reloading resets the
   in-memory fake, so the job genuinely ceases to exist. The rejoin path was verified
   across client-side navigation only; `listJobs` is what would serve a reload against a
   real backend, and that is untested until FR7.
6. **The failed-job-to-artifact pairing is heuristic**, because `Job.result` is null on
   failure. With several failures in flight at once, a failure could be labelled with the
   wrong artifact's title. The failure text itself always comes from the right job.

---

## 8. Handoff to FR5

**Read the FR4 rows in [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) first.** The four that change
what you may assume:

- **A regeneration is a new artifact** (§6.3). So **an artifact's id, contents and
  `sourcesSnapshot` are stable for its lifetime** — an attempt you record against an
  artifact id can never be invalidated by a regeneration. This is the decision your
  runners most depend on.
- **There is no review gate and no draft card.** Nothing hands you a queue of cards to
  accept. A deck that is `ready` is ready; `listCards` returns its cards and they are
  `active`. Do not build a runner expecting a triage step before first use.
- **`useNotebookJobs` is the only thing that watches jobs**, and it already invalidates
  `artifacts` / `sources` / `detail` / home on completion. If a runner needs to react to a
  generation finishing, subscribe to that rather than adding a poll.
- **Generation failure copy is `failureFor(code)`** in `generation-errors.ts`, a closed
  `Record<ApiErrorCode, …>`. Reuse it for any error a runner surfaces rather than rendering
  `error.message`.

### What a completed artifact looks like, per kind, and how a runner is entered

Every runner is entered from `ArtifactRow` in `StudioPane.tsx`, which links via
`notebookPath.practice/quiz/exam/notes(notebookId, artifactId)` — **and only when
`status === 'ready'`**. A `generating` or `failed` artifact is a real, listable row that is
deliberately not a link.

| Kind | Ready payload | Contents fetched by | Entered at |
| --- | --- | --- | --- |
| `deck` | `cardCount`, `dueCount`, `newCount` | `listCards(nb, artifactId)` — paginated | `notebookPath.practice` |
| `quiz` | `questionCount`, `answeredCount` | `listQuestions(nb, artifactId)` | `notebookPath.quiz` |
| `noteset` | `origin: 'generated' \| 'chat'`, `blockCount`, `readBlockCount` | `listNoteBlocks(nb, artifactId)` — a `NoteBlock[]` discriminated union, **not** a blob | `notebookPath.notes` |
| `exam` | `config: ExamConfig`, `blueprint: Blueprint`, `questionCount`, `attemptCount` | `listQuestions(nb, artifactId)` | `notebookPath.exam` |

**The exam's blueprint is on the artifact when the runner opens it.** FR4 does not let the
user author one at creation — the contract's `blueprint` is optional on create and omitting
it means "weight it for me" — so every exam arrives with a server-derived blueprint
(`basis: 'card-counts'`). **Editing a blueprint is unbuilt and belongs to you or FR6**;
the generate modal says so in as many words, so the promise is already made to the user.

### Where attempts are created

Nowhere yet — **FR4 creates none.** `startAttempt` / `submitAttempt` are untouched by this
phase, and `listAttempts` is what FR6's diagnostics read. The quiz and exam runners are the
first and only writers.

Note the contract's separation, which FR4 did not disturb: **a question is not a card**. An
exam's questions carry no FSRS state, and an attempt is the record — do not route exam
answers through `reviewCard`.

### Anything in FR5's assumptions invalidated

- `ExamPage` and `PracticePage` are still on the **old stack** and still ignore their
  `:artifactId` — FR2's drift row stands, and re-pointing them is your first task.
- `src/features/generate/` is **deleted** (`JobProgressPanel`, `PipelineStages`,
  `StagingList`, `useJobProgress`, `useUploadDocument`, `ReviewGatePage`). If you wanted to
  mine any of it, it is in git history at `9c9280b`.
- `useDraftCards`, `useAcceptDrafts` and `useFinishReviewGate` are **gone** from
  `queries.ts`. `useDeleteCards` survives, unused, for a card editor.
