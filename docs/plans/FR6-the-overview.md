# FR6 — The notebook overview

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
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



---

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

## 6. Decisions to record

1. **How readiness is computed and where** — client roll-up or contract-served. Determines
   what FR7 must build.
2. **What `/progress` is now.** FR0 either re-pointed or deleted its hooks; FR6 either
   supersedes it or leaves it. **Say which — this is the last phase where it is ambiguous.**
3. **Which aggregates must be server-side** for performance (task 4), with the row counts
   that justify each.
4. Anything `progress.ts` / `mastery.ts` / `study-plan.ts` could not express against the
   new shapes. Brief §1.4 said they keep their place; if one did not, that is a finding.

## 7. What will go unverified

No tests. Report **"typechecks and builds"** plus what you opened.

1. **Every aggregate is computed over fixture data.** Correctness against real review
   histories is unproven — and `mastery.ts` and `study-plan.ts` are exactly the kind of
   arithmetic that is wrong quietly.
2. **Performance.** The fake holds a few hundred rows. Nothing here has met 70,000.
3. **Readiness agreement** between home and overview is checked by looking at both.
4. **The "new kind extends without touching home" property** is reasoned, not demonstrated.

## 8. Handoff to FR7 — the build list

**Write this properly. It is the specification hand-off for an entire backend rebuild, and
the FR7 session will arrive cold.**

- **Every method in `ApiClient`**, and for each: whether `client.ts` implements it today or
  throws `not_implemented` (FR0 §6.3 started this list — finish it).
- **Every aggregate that must be server-side**, with its justification.
- **Every place the fake does something a real API would find expensive**, even where legal.
- **The complete noun list as it actually ended up** — FR1–FR6 will have changed things the
  brief's §1.1 did not anticipate, and the contract, not the brief, is the truth by then.
- **Everything in the brief's §6 open questions that got forced**, and how.
