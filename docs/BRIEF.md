# Session brief — priority 1, part 2

**Written 2026-09-13.** Branch `dev`. Read [ROADMAP.md](ROADMAP.md) first, then this.

Your job is items **4 and 5** of priority 1 — the layout restructure, then study polish.
Items 1–3 are done and are described below only where you need them. When you finish,
rewrite this file for the session after you.

> **Everything below was verified against the code on 2026-09-13**, and every claim about
> items 1–3 was either driven by hand or is flagged as unverified. Trust this file over any
> other description of the app, and the code over this file.

---

## 0. Before you touch anything

```sh
git branch --show-current      # expect: dev
git status --short             # expect: clean
npm run check                  # expect: pass, ~15s
```

`dev` is yours — commit and push without asking. `main` is frozen. There are no tests;
report work as "typechecks and builds", never "tested" or "works".

**`npm run infra:synth` is still broken on this machine** — `EPERM: operation not
permitted, rename` during CDK asset bundling. It is a Windows file lock, it predates all of
this, and `infra/` is frozen. Do not touch it. (Note that item 3 *did* have to add one
route to `infra/lib/api-stack.ts`, because `check:routes` enforces parity between that file
and `scripts/dev-api.mjs`. Editing the route table is unavoidable and safe; deploying is
not yours.)

---

## 1. What the last session built

| # | Item | State |
| --- | --- | --- |
| 1 | `createCards` in the contract | **Done**, driven against real Postgres |
| 2 | DeckBrowser — list, edit, suspend, delete, create | **Done**, UI unverified |
| 3 | SourceViewer — open a source | **Done**, UI unverified |
| 4 | Layout restructure — workspace pane, chat relocation | **Yours** |
| 5 | Study polish — flip, quiz navigator, drill-incorrect, markdown notes | **Yours** |

New files: `src/features/cards/queries.ts`, `src/features/cards/DeckBrowser.tsx`,
`src/features/notebook/SourceViewer.tsx`. New route:
`/notebooks/:notebookId/decks/:deckId/cards`. Two new contract methods: `createCards` and
`getSourceContent` (46 methods now, not the 43 `SPEC.md` used to claim — that count was
already stale by one before this work).

### The two DeckBrowser decisions, and why

**An edit that splits into several cards updates the first and creates the rest.**
`CardEditor.onSubmit` hands back `CardPayload[]` and `updateCard` takes exactly one. The
edited card takes the first payload, so it keeps its id and its **entire FSRS schedule**;
further deletions become new cards at the zero state. Dropping the extras would be silent
data loss, and refusing the split would block adding a second deletion to an existing
cloze, which is an ordinary thing to want. The toast says how many cards resulted.

**Delete confirms; suspend does not.** Delete destroys the card's review history — months
of the user's actual work — and the dialog names suspend as the reversible alternative
rather than only warning. Per `modals.tsx`, the confirmation is local state, not in the URL.

### Where the SourceViewer is, and what you are moving

**It is a right-hand `Sheet`, mounted once by `SourcesPane` and opened from a source's
title.** This is item 4's problem, so it was built to be moved:

- `SourceViewer` is the sheet wrapper. **`SourceBody` is exported separately** and knows
  nothing about the sheet — it takes `notebookId` and a `Source`, reads its own data, and
  owns no layout. Moving the viewer into the workspace pane should be rendering
  `<SourceBody>` there and deleting the wrapper.
- `SourcesPane` holds `viewing: Source | null` in local state and passes an `onOpen` to
  each row. When the workspace pane exists, that state probably belongs to `NotebookPage`
  instead, because the workspace shows *whatever is selected* — a source, a deck, or the
  overview — and a source is only one of three things it can be.

---

## 2. Four things the last brief got wrong

**(a) `getSource` was not enough for a source viewer, and this is the big one.** The brief
said `getSource` exists and nothing calls it, so item 3 was "wire it up". But `Source` has
**no content field**, and `services/api/src/data/sources.ts:21` excludes `content` from its
column list deliberately — "selecting it on every list would ship a book to render a
filename". A viewer on `getSource` alone shows a title, a size and a date, which is
metadata the rail already displays: a dead end, which is the thing priority 1 exists to
remove.

So `getSourceContent(notebookId, sourceId, { offset, limit })` was added — contract,
data layer (`getSourceSlice`, a `substr` + `length` in one statement), handler, route in
both tables, and both client implementations. **Sliced by character offset**, because an
extraction is routinely megabytes and the viewer is a reading surface, not a download.

**(b) The backend for `createCards` existed, but not where the brief said to use it.** The
brief pointed at `services/api/src/handlers/cards.ts:135` and `createCards` in the data
layer. That path is the **pre-notebook** one: it takes a `deckId` and joins
`public.decks`. The notebook-model path is `createArtifactCards`, whose CTE matches
`kind = 'deck'` on `public.artifacts`. The new route is a POST on the existing
`GET /notebooks/{id}/artifacts/{id}/cards` in `handlers/artifacts.ts`, not a new path.

**(c) `freshScheduling` is now duplicated three times** in `handlers/` — `cards.ts`,
`generation.ts` and now `artifacts.ts`. Each carries the same comment explaining why
(importing ts-fsrs to compute `due = now` would put the whole scheduling library in a
Lambda bundle). If a fresh card ever gains a non-trivial schedule all three go wrong
together. It was left as a third copy rather than extracted, to match what the two existing
ones already decided; extracting it is a reasonable small cleanup if you are in there.

**(d) `SPEC.md` said "43 contract methods".** It was 44 before this session and is 46 now.
The count is corrected; be aware the doc can drift from the interface, because nothing
checks it.

---

## 3. Item 4 — the layout restructure

The largest and most invasive item. Today: sources 22%, chat 52%, studio 26%
(`NotebookPage.tsx:193`). The most transient pane owns the most screen — chat is
`useState<AskResponse[]>([])`, resets on navigation, and **has never answered a question**,
because no embedding key was ever supplied.

The plan: a **workspace pane** in the centre showing whatever is selected — a source, the
DeckBrowser, the overview — with chat moved to a surface that suits something ephemeral.

**Four traps, three of them inherited and one new:**

1. **`PaneGroup` hardcodes `flex` in its own `cn(...)`**, so a `hidden` class passed to it
   loses and both layouts render at once below `md`. **Branch, do not hide.** This is in
   `SPEC.md §4` as well.
2. **The Overview is reachable only via a tile labelled "Diagnostics"** buried in the
   Studio grid (`StudioPane.tsx`, the `GENERATORS` entry with `kind: null`). It should
   become a real tab.
3. **Every runner route names its artifact**, and that is load-bearing — a route that read
   `:notebookId` and treated it as a deck id was a real bug that served one notebook's
   session every notebook's cards. If the workspace pane makes the DeckBrowser reachable
   *without* navigating, the URL must still say which deck is open.
4. **New:** `StudioPane`'s deck rows now have **two** links — the row itself (Practice) and
   a "Browse cards" link under it. The row is deliberately one link and one tab stop,
   because a `<button>` inside an `<a>` is invalid HTML; the browse action is a sibling for
   that reason. If you restructure those rows, keep the two actions as siblings.

---

## 4. Item 5 — study polish

- **Card flip.** Respect `prefers-reduced-motion`.
- **A quiz question navigator.** Exams have `ExamNavigator`; port the pattern.
- **Drill-incorrect** on quiz and exam results.
- **Inline markdown and math in `NoteBlocks.tsx`.** This is the only item here that adds
  dependencies, and it needs a React markdown renderer that emits **elements, never raw
  HTML** — `dangerouslySetInnerHTML` is blocked by an ESLint rule and that rule does not
  get disabled. Notes stay **read-only**; there is no notes editor and none is planned.

---

## 5. Rules that will bite you

- **`userId` never comes from the client.** If you touch `services/api/`, read the four
  tenancy rules in [HISTORY.md §2](HISTORY.md#2-tenancy-is-application-level-and-weaker-than-what-it-replaced).
  Rules 2 and 4 are **not enforced by any linter**.
- **No SQL outside `services/api/src/data/`.**
- **One Zod definition per concept.** `CardPayload` lives in `src/lib/schemas.ts`, **not**
  in `contract.ts` — importing it from `@/lib/api` does not typecheck, which is the
  guardrail working.
- **`npm run check:routes` proves the two route tables match. It does not prove a route
  reaches a handler.** Its own header says so, and a whole phase once shipped with every
  ingestion route returning 500. Drive any new route by hand — see §6 for how.
- **`npm run check` before every commit.** Never commit with it failing.
- **Do not create new documents.** `docs/` is six files and stays that way. `BRIEF.md` is
  the only one ever *replaced*.

---

## 6. What nothing verifies — read this before you trust anything above

There are no tests. `check` and `verify` prove the code compiles, lints and builds, and
nothing else. Here is the honest state of items 1–3, split by what was actually exercised.

### Driven by hand, against real local Postgres

Both new routes were invoked directly with synthetic API Gateway events, because
`check:routes` cannot tell you a route reaches a working handler. Probes were deleted after
running; recreate them the same way if you need to.

- `POST /notebooks/{id}/artifacts/{id}/cards` — 201 with both cards, `fsrs_state: new`,
  correct notebook and artifact ids; a quiz artifact refused with 400; **another user's id
  404s and inserts nothing**; an invalid payload 400s through the shared schema.
- `GET /notebooks/{id}/sources/{id}/content` — slices contiguous and exact, reassembly
  equals the `content` column byte for byte, `hasMore` false at the end, the metadata route
  still carries no content field, and both a stranger's id and a cross-notebook source id
  404.

### Exercised against the fake, headlessly

- Create returns **copies**, not live store objects (a caller mutating the result does not
  reach the store), with the zero FSRS state.
- A splitting edit keeps the original's **id, `fsrsState`, `due` and `reps`**.
- Suspend round-trips; delete returns the deck to its starting count.
- 27 small content slices reassemble byte-identically to one whole fetch.
- `processing` and `failed` sources both return an empty slice and a zero total rather than
  an error.

### Not verified by anything — a human clicking is the only check

**No browser was available in that session.** Every one of these is typechecked and built
and has never been rendered:

- The whole of `DeckBrowser.tsx`: layout, the dropdown menu, the inline editor mounting in
  a list row, the confirm dialog, "Load more", every empty and error state.
- The whole of `SourceViewer.tsx` and `SourceBody`: the sheet, scrolling a long document,
  "Read more", and the processing/failed states.
- **The `SourcesPane` click split** — the row now has three tab stops (open, select,
  delete) where it had two. The claim that the checkbox and delete button keep their own
  hit areas is a claim about markup, not an observation. **Check this with the keyboard as
  well as the mouse**; it is the specific thing the previous brief warned about.
- The "Browse cards" link in `StudioPane`, and whether two stacked links per deck row read
  as one control or two.
- Toast copy and whether the split-edit message actually makes sense to someone who did not
  write it.

If you start with anything, start by opening `npm run dev` and clicking through those.
