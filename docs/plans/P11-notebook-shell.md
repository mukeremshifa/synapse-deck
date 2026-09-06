# P11 — the notebook shell

**Status:** Planned 2026-09-06 · Branch `aws-native` · Supersedes the frontend, not the API

A **complete rewrite of the frontend**, from a six-tab deck app to a NotebookLM-shaped
notebook shell. Decided by the owner on 2026-09-06. This is not a feature addition and not
a reskin: the information architecture changes, the top-level object changes, and most of
`src/features/` is deleted rather than migrated.

**One line:** a notebook holds sources; flashcards, exams and practice are things you
generate *from* those sources and then actually get scheduled on.

---

## 1. Preconditions

```bash
git branch --show-current    # aws-native
git status                   # clean
npm run check                # passes before the first edit
```

`dev` is a strict ancestor of `aws-native` (44 commits behind, zero divergence), so this
work continues on `aws-native` and `dev` fast-forwards to it when the rewrite is coherent.
A topic branch was considered and rejected: it would add a merge commit to re-join two
lines that never diverged, and the owner asked for the pipeline work and the rewrite to
land on `dev` as one thing.

**Verify the fast-forward still holds before merging:**

```bash
git merge-base --is-ancestor dev aws-native && echo ff-able
```

---

## 2. The shape, and why it is not a literal clone

NotebookLM is **sources-first**: a notebook holds documents and everything else — chat,
summaries, study guides, audio — is a *derived view* with citations back to the source.
Nothing it generates has a life of its own.

SynapseDeck cannot be that, because [AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md) §2 commits
to "one loop, both halves equal": study → practice → **timed exam** → diagnostic. Cards
carry FSRS state across months. An exam attempt is a durable record. Those are not derived
views and making them disposable panels would discard the scheduling loop that is the
product.

**So: NotebookLM's shell, SynapseDeck's loop.** Three panes.

```
┌──────────┬─────────────────────┬──────────────┐
│ SOURCES  │   WORKSPACE         │   STUDIO     │
│ ──────── │  ─────────────────  │  ──────────  │
│ ▣ lec1.pdf│  (source reader,    │ ▸ Flashcards │
│ ▣ notes   │   or the chat pane  │   142 cards  │
│ ▣ pasted  │   once it exists)   │ ▸ Exam       │
│          │                     │ ▸ Practice   │
│ + Add     │                     │   18 due     │
└──────────┴─────────────────────┴──────────────┘
```

**The studio is a launcher, not a container.** Practice and exam open as their own
full-screen routes, because a timed exam inside a 380px column is a worse exam. This is the
one place the clone is deliberately broken, and it is broken in favour of the thing being
cloned *for*.

### The object rename

`deck` → `notebook` **in the UI only**. The API, the database and `schemas.ts` keep
`deck`/`deckId` throughout. A rename that crossed the wire would turn a frontend rewrite
into a two-sided edit and break task 10's isolation, which
[P10-SESSION-4.md](P10-SESSION-4.md) explicitly protects. The mapping lives in one place
(`src/lib/notebooks.ts`) and every hook underneath keeps its current name.

---

## 3. Out of scope

Named explicitly, because scope creep is the failure mode of a rewrite.

- **Grounded chat.** The centre pane ships with an explicit "arrives in a later phase"
  state. **No stub answers, no fake citations.** Retrieval, embeddings, a vector store and
  a citations model are real backend work that no phase plan covers. A chat box that
  answers plausibly from nothing is the single most dishonest thing this rewrite could
  ship.
- **Audio overview, mind maps, briefing docs.** NotebookLM artifacts with no counterpart
  here. Not stubs, not placeholders — absent.
- **Any backend change.** No handler, no migration, no CDK, no `services/api/` edit. If
  the rewrite appears to need one, stop and record it here instead.
- **Task 10 (Bedrock).** Still blocked on model access and still backend-only.
- **Multi-source notebooks in the pipeline.** The UI shows a sources list; the job pipeline
  still takes one document per job. The list is real, the fan-out is not.

---

## 4. What survives, and what does not

The owner's instruction: *"nothing here is a must-exist except the exam mode — we are
adding a full exam mode and flashcard practicing to a NotebookLM-like flow."*

### Survives intact

| Surface | Files | Why |
| ------- | ----- | --- |
| **Exam mode** | `src/features/exam/*` (9 files, 1,518 lines incl. `lib/exam.ts`) | Owner-named. Brief §2 makes it a co-equal half. Re-homed under the studio, internals untouched |
| **The contract layer** | `api-client.ts`, `queries.ts`, `schemas.ts` | P10-SESSION-4: the pipeline coupling. Rewriting these is what would make task 10 a two-sided edit |
| **The domain libs** | `fsrs.ts`, `progress.ts`, `exam.ts`, `mastery.ts`, `grade-tokens.ts`, `day.ts`, `format.ts`, `quota.ts` | Pure logic, no UI. Brief §4's "surviving value" |
| **Auth** | `src/features/auth/*`, `cognito.ts` | P9 work, orthogonal to layout |
| **The stub defences** | see §5 | Non-negotiable regardless of the owner's "nothing must exist" |

### Rewritten

`AppLayout`, `routes.tsx`, every page under `features/decks/`, `features/generate/`,
`features/practice/`. The practice *runner* keeps its FSRS wiring and rating semantics; its
chrome is rebuilt.

### Dropped unless re-earned

- **Progress dashboard** (7 files, Recharts). The owner did not keep it. Recharts stays in
  `package.json` because the exam results screen may use it; if nothing does by task 9,
  remove the dependency in that task rather than leaving it as dead weight.
- **Landing page + marketing showcase** (4 files). `/` becomes the notebook list for a
  signed-in user and the sign-in door otherwise.
- **Dashboard.** Its job is the notebook list now.

**`src/lib/progress.ts` stays even though the progress *pages* go.** It is the aggregation
layer the diagnostic will need, it is pure and tested-by-shape, and deleting it to re-derive
it in a later phase is the drift the plans exist to prevent.

---

## 5. The three things that must not be dropped silently

From [P10-SESSION-4.md](P10-SESSION-4.md), and they bind even though the owner said nothing
is a must-keep — because the owner was answering about *product surfaces*, and these are
*safety* surfaces. If any of them is genuinely unwanted, that is a decision to make out
loud, not one a rewrite makes by omission.

1. **The stub warning**, wherever a job's providers include `stub` — on the upload surface
   and at the review gate. A redesign that drops it ships fake cards silently.
   `[STUB CARD — not real content]` stays in the card text; do not filter it for looking
   untidy in a new layout.
2. **Partial-failure reporting at the review gate** — what did not make it into the deck.
   Task 6 built it and no real job has ever populated it.
3. **`deck_status = 'draft'`** is the only marker of a resumable notebook, and is *not* the
   removed `card_status` `'draft'`. A grep-and-replace across a rewrite this size is exactly
   how that breaks. The notebook list reads it to mark a notebook resumable.

---

## 6. Tasks

Ordered so the app builds and runs after every task. Nothing here is a checkpoint; run
`npm run check` before each commit and `npm run verify` at task 10.

### 1. The shell — `src/app/`

`NotebookLayout.tsx` (three-pane, resizable, collapsible rails), `AppShell.tsx` (the outer
frame for non-notebook routes). Delete `AppLayout.tsx`'s six-tab header.

Panes collapse to a single column under `md`. The studio rail becomes a bottom sheet on
mobile; the sources rail becomes a drawer. Responsive-web only — SPEC §1 non-goal.

### 2. Design tokens — `src/styles/globals.css`

NotebookLM's visual language: flatter surfaces, a quieter palette, tighter density, more
generous line-height in reading contexts. Keep the existing token *names* so the surviving
components (exam, cards) restyle without edits.

### 3. Notebook list — `src/features/notebooks/NotebookListPage.tsx`

Replaces `DashboardPage` + `DecksPage` with one grid of notebook tiles. Each tile: title,
source count, card count, due count, resumable badge (`deck_status === 'draft'`, see §5.3).
Reads `useDecks`, `useDueSummary`. New notebook → creation flow.

### 4. Sources rail — `src/features/notebooks/sources/`

The left pane. Source list, per-source selection state, add-source entry point. Upload goes
through `useUploadDocument` unchanged; paste goes through the `/create/text` job path
unchanged. **No direct `fetch`** — P10-SESSION-4 is explicit.

Multi-source is a UI affordance over a one-document-per-job pipeline (§3). The rail must
not imply cross-source synthesis that does not happen.

### 5. Workspace pane — `src/features/notebooks/workspace/`

Source reader plus the chat placeholder from §3. The placeholder states plainly that
grounded chat arrives in a later phase and that the retrieval endpoint is not built. It
renders no input box that does nothing.

### 6. Studio rail — `src/features/notebooks/studio/`

The launcher. Flashcards (count, → card list), Exam (→ setup), Practice (due count → runner).
Generation entry points live here, carrying the stub warning of §5.1.

### 7. Review gate — `src/features/generate/ReviewGatePage.tsx`

Rebuilt for the new shell, keeping §5.1 and §5.2 intact and keeping `useJobProgress`'s
polling contract untouched.

### 8. Practice — `src/features/practice/`

Full-screen route. FSRS wiring, rating semantics and `useReviewCard` unchanged; chrome
rebuilt. Undo stays.

### 9. Exam re-homing — `src/features/exam/`

Launch from the studio, run full-screen. `useFocusMode` and `useExamTimer` untouched. This
task is routing and entry-point work, not a rewrite of the exam. Also: decide Recharts'
fate here (§4).

### 10. Routes, cleanup, verify — `src/app/routes.tsx`

New route table. Delete the dropped features. `npm run verify`. `node scripts/check-routes.mjs`
must pass — it exists and will catch a route the rewrite orphaned.

### 11. Documentation

**SPEC §1, §4 and §8.2 are now wrong** and this is the task that fixes them. §8.2's route
table is rewritten; §4's flows are rewritten around the notebook; §1's one-line changes.
Update this file's board row, and write the next plan.

---

## 7. Acceptance criteria

Observable, not vibes.

1. `npm run verify` passes.
2. `node scripts/check-routes.mjs` passes; no orphaned route.
3. A signed-in user lands on the notebook list, opens a notebook, and sees three panes.
4. Uploading a document from the sources rail reaches the review gate through
   `useUploadDocument` → `useJobProgress` with **no new `fetch` call anywhere in `src/`**:
   `grep -rn "fetch(" src/ --include=*.tsx --include=*.ts` returns only `api-client.ts`.
5. A job whose providers include `stub` shows the warning on both surfaces (§5.1).
6. The review gate still reports what did not make it into the deck (§5.2).
7. A notebook with `deck_status = 'draft'` is marked resumable and reopens the gate (§5.3).
8. An exam runs full-screen, timed, with focus mode, from the studio rail.
9. Practice rates a card and the undo works.
10. The chat pane states it is unbuilt and offers no input that does nothing.
11. `src/lib/schemas.ts`, `api-client.ts` and `services/api/` are **unchanged** by this
    phase — `git diff dev..HEAD --stat` on those paths is empty except where task 7 needs
    a query key.

---

## 8. Decisions to record

- `deck` → `notebook` is a **UI-only** rename; the wire keeps `deck`. Record in SPEC §8.2.
- Progress pages dropped, `progress.ts` kept. Record in SPEC §4.4 and POST-V1.
- Landing page dropped; `/` is the notebook list or the sign-in door. Record in SPEC §8.2,
  and note it reverses P7's "the front door is public".
- Grounded chat is named as a future phase, not a stub. Record in POST-V1.

---

## 9. What went unverified

There are no tests (ADR 0005). This section is where the honesty lives.

- **Everything in §6.** `check` and `verify` prove the rewrite compiles, lints and builds.
  Nothing proves a pane renders, a rail collapses, or a rating is written.
- **The stub defences (§5) are enforced by nothing but this document and review.** No test
  asserts the warning appears. Re-read §5 before merging to `dev`.
- **The resumable-draft path (§5.3)** is the most likely silent breakage in the phase, and
  the least likely to be noticed by hand — it needs a notebook left mid-gate to exercise.
- **Responsive behaviour** is unverified at every breakpoint.
- The pipeline **has still never run in AWS** (P10-SESSION-4). This phase does not change
  that and must not be read as having tested it.
