# FR3 — The notebook

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §3.3.
**Depends on:** [FR2](FR2-shell-and-routing.md) complete.
**Hands off to:** [FR4](FR4-generation.md).

> Contract altitude. Names no component files.

---

## 1. Preconditions

```bash
npm run check && npm run dev   # fake mode
```

FR2's §8 handoff must name the modal API and the notebook route's shape.

## 1b. Reconcile — first, before any code

Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) rows naming FR3, and FR2 §6/§8.

This plan assumes: `/notebooks/:id` exists and renders something FR3 replaces; the modal
system exists; `react-resizable-panels` is installed (FR1); the contract exposes
`listSources`, `addSource`, `listArtifacts` with `notebookId` as a required first argument.

**Where that is false, fix this plan first.**

---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| The generate modal's contents, job progress, the review gate | **FR4** |
| The runners themselves | **FR5** |
| The overview page | **FR6** |
| Chat *organisation* — history, persistence, threading | **Deliberately undecided** (brief §1.2(4), §6.4). FR3 builds the pane; it does not settle the model |
| Backend | FR7 |

**The trap:** Studio lists artifacts, and an artifact list makes you want to build the
generate modal. Empty Studio entries open a modal that FR4 fills — a documented "FR4
builds this" is complete for FR3.

---

## 3. The rule this phase runs under

Two, both from the audit's findings.

> **Sources are persisted entities, not `useState([])`.**

`SourcesRail`'s sources are session-local and gone on refresh. That is the bug this phase
exists to fix, and it is why `Source` is a noun in the contract.

> **"+ Add source" is the primary CTA on the notebook**, not a row in the Studio rail.

Brief §3.3: adding a source is the notebook's defining act. Today's only enabled CTA is
"Generate cards", which navigates *away* and **creates a new notebook**. That is the single
worst behaviour the audit found.

And the standing one, brief §1.2(7):

> **A dangling `sourceId` is a valid state, not an error.** An artifact whose source was
> deleted still displays what it was built from, via `sourcesSnapshot`.

FR0's fixtures contain one. **Render it correctly or the phase is not done.**

---

## 4. Tasks

### Task 1 — The three-pane shell

Sources (left) · Workspace (centre) · Studio (right), resizable, on FR1's `PaneGroup`.

Decide and record: what happens below tablet width. Three panes do not fit at 375px, and
DS4b's mobile pass found real defects. Tabs, a drawer, or a documented desktop-only stance
— **pick one and say so in §6.**

### Task 2 — Sources as persisted entities

The left pane lists the notebook's sources from the contract. Adding one opens a modal
(FR2's system) and calls `addSource`, which **returns a `Job`** — FR4 designs the progress
surface, so FR3 may show a minimal pending state and say FR4 replaces it.

**"+ Add source" is the pane's primary CTA.** Deleting a source must not delete artifacts
made from it (brief §1.2(7)).

### Task 3 — Workspace (centre)

Grounded chat over selected sources. The retrieval and citation work exists from DS2
(`POST /decks/:deckId/ask`) but has **never answered a question** — no embedding key was
ever supplied. Under the fake it answers fine; **do not report it as working end to end.**

**Untrusted content, and this is where it bites.** Chat responses and card content are LLM
output. `dangerouslySetInnerHTML` is ESLint-blocked; do not disable it. Rendering markdown
will be tempting — **use a renderer that produces elements, never HTML.**

One requirement only from brief §1.2(4): **saving a single response as a note must be
possible.** Whether it lands in FR3 or FR4 is yours; if you defer it, say so.

### Task 4 — Studio (right)

Five entries: **Quiz · Cards · Notes · Exam simulator · Diagnostics.**

Each **lists that notebook's artifacts of that kind** when it has any, and opens a generate
modal when empty. This is where "many exams per notebook" becomes visible and navigable —
the direct answer to "the exam button opens an exam and nobody knows where it came from".

Each artifact row shows its readiness (brief §1.3) and its source provenance, **including
when a source is gone.**

### Task 5 — Delete what this replaces

`SourcesRail`'s `useState([])`, `NotebookPage`'s deck→notebook hand-mapping, and whatever
FR2 left as placeholder. Check imports before deleting.

### Task 6 — Document, and update what follows

`SPEC.md`; [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md); FR4–FR6 where invalidated.

---

## 5. Acceptance criteria

1. Three resizable panes; the sub-tablet behaviour is decided, implemented and recorded.
2. **Sources survive a page refresh.** Observed, not assumed.
3. "+ Add source" is the notebook's primary CTA and adds to *this* notebook — **it creates
   no new notebook.**
4. Deleting a source leaves its artifacts intact and still displaying their provenance.
5. **The dangling-`sourceId` fixture renders without error or blank space.**
6. Studio lists artifacts per kind, with readiness and provenance; empty kinds open a modal.
7. A notebook with several decks shows several decks. Many exams, likewise.
8. Chat renders as elements; no `dangerouslySetInnerHTML`, no disabled rule.
9. Opened in a browser at 1280px and 375px, empty notebook and full one.
10. `npm run verify` passes.
11. §6 recorded; drift log appended.

---

## 6. Decisions to record

1. **Sub-tablet layout.**
2. **Save-response-as-note** — built here or deferred to FR4.
3. **What deleting a source does to the UI** of artifacts built from it.
4. **Whether Studio's five entries are fixed or data-driven.** Brief §1.1 says a new
   feature is a new `kind`; if the rail is hardcoded, say so — that is a real constraint on
   "more coming features".

## 7. What will go unverified

No tests. Report **"typechecks and builds"** plus what you opened.

1. **Chat has never answered a real question** (DS2 §7). The fake proves the surface, not
   retrieval.
2. **Persistence is the fake's.** Sources survive a refresh in memory; nothing proves the
   real API will store them — that is FR7.
3. **Resize behaviour** across window sizes; only what you drag is checked.
4. **The dangling-source path** in every consumer. You will check the ones you look at.

## 8. Handoff to FR4

- **the generate modal's entry points** — how Studio opens one, what it passes;
- **the pending state** `addSource` currently shows, which FR4 replaces;
- **whether save-as-note landed here**;
- anything in FR4's assumptions you invalidated.
