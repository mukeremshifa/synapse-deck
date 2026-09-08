# FR3 — The notebook

**Status:** ✅ Done 2026-09-08.
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

### What FR2 delivered — appended 2026-09-08 by FR2

All four assumptions above hold, with one correction and one addition.

- **`/notebooks/:id` renders a placeholder naming FR3**, in `src/app/routes.tsx`. Replace
  `NotebookRoute` there with your shell.
- **P11's notebook shell is deleted, not left for you to unpick.** `NotebookPage`,
  `NotebookHeader`, `SourcesRail`, `StudioRail`, `WorkspacePane`, `useAsk`,
  `NotebookCardsPage`, `NotebookLayout` and `use-rails` are all gone — brief §1.4 lists
  them as not surviving, and leaving them routed would have made your first task unpicking
  FR2's wiring. Build the panes on FR1's `PaneGroup`/`Pane`/`Rail`. `useAsk` and
  `WorkspacePane` are in git history if the chat pane wants them.
- **The modal system is `src/app/modals.tsx`** — `?modal=<name>`, `ModalProvider` (already
  mounted in `AppRoutes`) and `useModal()`. Add `add-source`, `edit-card` and
  `notebook-settings` bodies; the names are already in the `ModalName` union.
  `NewNotebookModal` is a worked example of the whole pattern.
- **Your first task is re-pointing at the contract.** `src/lib/queries.ts` is the *old*
  deck-shaped stack and only home is on `@/lib/api` today. Follow
  `src/features/home/queries.ts`; do not extend `queries.ts`.
- **The card table has no route.** `/notebooks/:id/cards` is gone; it belongs inside your
  shell now. `CardEditor`, `CardFace`, `ClozeText` and `McqOptions` survive.


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

## 6. Decisions recorded

### 6.1 Sub-tablet layout — **tabs below `md`**

Three resizable panes do not fit at 375px; the sources rail alone wants ~240px. The three
options were a drawer, tabs, or a documented desktop-only stance.

**Tabs**, because a drawer hides two of the three surfaces behind a control the user has to
discover, and this screen's whole argument is that the three belong together. A drawer would
make the Studio — the answer to "where did this exam come from?" — the thing you go looking
for. Desktop-only is the honest stance for a *timed exam*, which is why the runners take the
viewport, but adding a source and reading a note are exactly what a student does on a phone
between lectures.

**The implementation is a JS branch, not a responsive class**, and that was not the first
attempt. Two traps, both found in a browser:

1. `PaneGroup` **ignores a `hidden` passed to it** — `ResizablePanelGroup` hardcodes `flex`
   in its own `cn(...)` and tailwind-merge drops the caller's conflicting class, so
   `hidden md:flex` rendered **both layouts at once**: tabs above a three-pane shell
   crushed into a phone.
2. Even with a wrapper div fixing that, CSS hiding still **mounts** both branches — every
   pane existed twice, every query had two subscribers, and the accessibility tree listed
   everything twice.

So `useMediaQuery` + `MEDIA_WIDE` were added to `src/components/layout.tsx`, built on
`useSyncExternalStore` so the first paint is already correct rather than flashing the mobile
layout on a desktop.

### 6.2 Save-response-as-note — **built here, not deferred**

`createArtifact({ kind: 'noteset', fromResponseId })` already exists in the contract and the
fixtures already ship a note set with `origin: 'chat'`, so the shape was designed for this
and deferring it would have left that fixture unexercised. It is also what makes an unsaved
chat transcript acceptable: anything worth keeping becomes a real artifact.

It returns a `Job` like any generation, which means **FR4 has two callers of its progress
surface**, not one. Recorded in the drift log and in FR4's plan.

### 6.3 Deleting a source — **artifacts stay, provenance is struck through**

Brief §1.2(7), and the pane says so before it happens: the confirmation states that anything
already generated is kept. Afterwards the artifact keeps its `sourcesSnapshot` and renders
the deleted source **struck through with a warning icon — never omitted**, because an
artifact that silently drops a source is lying about what it was built from.

Verified in a browser: deleting `Beta-lactams — lecture handout.pdf` left all eight
artifacts standing, each showing it struck through, alongside the fixture's pre-existing
`Cephalosporin generations (deleted)`.

### 6.4 Studio's entries — **four data-driven, one hardcoded, and the split is the point**

The four artifact kinds come from the contract's `ArtifactKind`, so brief §1.1's promise
holds for them: a new feature is a new kind, and a new kind is a new Studio entry.

**Diagnostics is the fifth and it is not a kind.** It is a *view* over attempts and card
states, so it is a hardcoded entry with `kind: null` that links to FR6's overview rather
than offering to generate anything. The `null` is load-bearing: it is what stops a later
session wiring a "generate a diagnostic" modal to a kind the contract does not have.

The real constraint, stated plainly: **a fifth artifact kind is one line here; a fifth
non-artifact *view* is a code change.** That is the right way round, but it is a constraint.

## 7. What went unverified

**There are no tests.** This phase **typechecks, lints and builds** (`npm run verify`
passes). It was also **opened in a browser** — Chrome over CDP, signed in with the demo
account against the fake — at 1280px and 375px, on the pharmacology notebook and the empty
one. What that exercised: the three panes and the tabs, add-source (text) end to end, the
processing state and its poll, source deletion with artifacts surviving, chat with citations,
save-as-note, modal restore from a pasted URL, and an invalid `?kind=`. **No console errors,
no horizontal scroll at either width.** Four defects were found this way and fixed — both
layouts rendering at once, the doubled mount, a Studio overflow, and inert citation markers.

What that still does not prove:

1. **Chat has never answered a real question.** DS2 built retrieval and citations; no
   embedding key was ever supplied. The fake answers, so the *surface* is exercised — the
   retrieval is not, and this is not reported as working end to end.
2. **Persistence is the fake's, and the fake is in memory.** Sources survive a client-side
   navigation away and back, which is what was observed. They do **not** survive a hard
   reload, because `fake.ts` holds `let store = seed()` in a module and a page load re-seeds
   it. That is the fake's lifetime, not a defect in this phase — but criterion 2 as written
   ("survive a page refresh") is only met in the sense the fake can meet it. **Nothing here
   proves the real API will store a source; that is FR7.**
3. **Resize behaviour** was checked at two widths and by dragging; the persisted layout was
   not checked across a browser restart.
4. **The dangling-source path** was verified in the Studio, which is where it renders. Other
   consumers (FR5's note reader cites a source id too) are unchecked.
5. **The document tab's upload leg has never moved a file.** `requestUpload` → PUT →
   `addSource` is written against the contract, and the fake returns a `fake.invalid` URL
   that the PUT fails against. The failure is caught and reported rather than left to hang,
   but only the text and link tabs were exercised end to end.

## 8. Handoff to FR4

- **The generate modal's entry point is `?modal=generate&kind=<ArtifactKind>`.** Studio
  opens it from an empty entry's single button and from "+ New …" under a non-empty list.
  `src/features/notebook/GenerateModalPlaceholder.tsx` is the seam — **delete that file and
  put the real modal on the same param contract.** It validates `kind` with
  `ArtifactKind.safeParse` and falls back rather than throwing; keep that, because modal
  params are user-editable text.
- **The pending state to replace is a poll.** `useSources` and `useArtifacts` set
  `refetchInterval: 1500` while a row is `processing` / `generating`, and a source row shows
  "Processing…". **Remove both polls when the job surface lands.**
- **Save-as-note landed here** (§6.2), so FR4's progress surface has two callers: the
  generate modal and the chat pane.
- **A `generating` artifact already renders** — greyed and not a link, per the contract;
  a `failed` one keeps its row with a badge. FR4 adds progress *to* an existing row.
- **Nothing in FR4's §1b assumptions was invalidated.** `Checkbox` is new
  (`src/components/ui/checkbox.tsx`, from `radix-ui`, no new dependency) if the modal's
  source picker wants one.
