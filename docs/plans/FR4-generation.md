# FR4 — Generation

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
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

## 6. Decisions to record

1. **How in-flight jobs survive navigation** — query cache, a provider, or polling on return.
2. **What a failed job leaves behind**, and how the user retries.
3. **Whether a regeneration is a new artifact or replaces one** — brief §6.2 leaves this
   open and says new-artifact is simpler and matches §1.2(7). **This phase forces it.**
   Record it as a decision, and note it in the brief's §6.
4. Whether save-response-as-note landed here (if FR3 deferred it).

## 7. What will go unverified

No tests. Report **"typechecks and builds"** plus what you drove by hand.

1. **No real generation has run.** Every stage, timing and error is the fake's. The real
   pipeline's timings will differ and its failure modes may not match.
2. **The stage list is honest only against today's pipeline.** FR7 may report different
   fields; the discipline is a reading, not a check.
3. **Quota and rate-limit handling** is designed against injected errors, never a real 429.
4. **Structured note blocks** are proven only as far as the fake's shape.

## 8. Handoff to FR5

- **what a completed artifact looks like** per kind, and how a runner is entered;
- **where attempts are created** — FR5's quiz/exam runners record them;
- **the regeneration decision** (§6.3), which changes what a runner may assume is stable;
- anything in FR5's assumptions you invalidated.
