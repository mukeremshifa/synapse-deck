# Session brief — priority 1, part 1

**Written 2026-09-13.** Branch `dev`. Read [ROADMAP.md](ROADMAP.md) first, then this.

Your job is items **1–3** of priority 1, and then to rewrite this file for the session that
takes items 4–5. If you get further than 3, take more. If you get stuck before finishing 3,
stop and hand over honestly — a half-built layout is worse than a clear note saying where
you stopped.

> **Everything below was verified against the code on 2026-09-13.** Where an earlier
> audit was wrong, this says so. Trust this file over any other description of the app,
> but trust the code over this file.

---

## 0. Before you touch anything

```sh
git branch --show-current      # expect: dev
git status --short             # expect: clean
npm run check                  # expect: pass, ~55s
```

`dev` is yours — commit and push without asking. `main` is frozen. There are no tests;
report work as "typechecks and builds", never "tested" or "works".

**There is one known-broken command.** `npm run infra:synth` fails on this machine with
`EPERM: operation not permitted, rename` during CDK asset bundling. It is a Windows file
lock, it predates this work, and it is **not yours to fix** — `infra/` is frozen. Do not
touch `infra/`; if you somehow must, know that synth cannot verify you.

---

## 1. What you are building, and why this order

Four features exist in the API and have no UI. They are the reason a user cannot fix an AI
hallucination or look at their own material.

| # | Item | Why it is in this position |
| --- | --- | --- |
| 1 | `createCard` in the contract | Nothing else can be built on top until it exists |
| 2 | DeckBrowser — list, edit, suspend, delete, create | Where `CardEditor` gets un-orphaned |
| 3 | SourceViewer — open a source | Independent of 1–2; also unblocks citation links later |
| 4 | Layout restructure — workspace pane, chat relocation | Largest; goes after the things it would churn |
| 5 | Study polish — flip, quiz navigator, drill-incorrect, markdown notes | Last |

Items 1–3 touch **no layout**. That is deliberate: item 4 rearranges the notebook shell,
and building 1–3 inside the old shell first means you are not rewriting them mid-move.

---

## 2. Ground truth — five things an earlier audit got wrong

An earlier brief described this work and was mostly right, but it was written without
reading the code. These five corrections change what you build:

**(a) `CardEditor` already supports create mode.** It is not edit-only. The props are:

```ts
// src/features/cards/CardEditor.tsx:56
export type CardEditorProps = {
  /** Editing an existing card, or null when adding a new one. */
  defaultValue?: CardPayload | null;
  /** Receives every card the draft produced — more than one for a split cloze. */
  onSubmit: (payloads: CardPayload[]) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
  className?: string;
};
```

Pass `defaultValue={null}` and it is a create form. **No work needed inside the component.**
It also already validates through `zodResolver(CardPayload)` — the one schema in
`src/lib/schemas.ts` — so user edits are checked the same way generated cards are.

Note `onSubmit` takes an **array**. A cloze card can split into several cards. Your create
flow must handle n≥1, and your *edit* flow must decide what a split means when editing one
existing card — see §3.2.

**(b) `POST /decks/{deckId}/cards` already works, end to end.** The handler is at
`services/api/src/handlers/cards.ts:135`, and `createCards` / `createArtifactCards` both
exist in `services/api/src/data/cards.ts`. The backend is **not** the missing piece. What
is missing is the contract method and a notebook-scoped route. See §3.1.

**(c) `CardEditor` was orphaned deliberately, not by accident.** The reason is written at
`src/features/study/PracticeSession.tsx:47`:

> Editing mid-review is also the one moment the user is least able to judge a card fairly.
> Removed rather than half-carried.

**Do not add an Edit button to the practice runner.** The editor belongs in the
DeckBrowser, where the user is browsing rather than being graded. This is settled; it is in
[ROADMAP.md](ROADMAP.md).

**(d) Cards are locked to their deck.** From `contract.ts:701`: membership is fixed at
generation, which is why there is no move operation and `artifactId` has no setter. A
created card must therefore name its deck and stay there. Do not add a move.

**(e) `Skeleton` already exists** at `src/components/ui/skeleton.tsx`. Do not create one.

---

## 3. The work

### 3.1 `createCard` — the contract, both implementations, the route

**No hook, no component exists for any card method.** `grep` for `listCards`, `updateCard`,
`setCardStatus`, `deleteCards`, `getSource` across `src/` outside `src/lib/api/` returns
exactly one hit, and it is a comment. You are building the whole client path.

Add to `src/lib/api/contract.ts`, next to `UpdateCardInput` (line ~741):

```ts
/** Content only, and the deck it joins. Scheduling is server-set. */
export const CreateCardInput = z.object({
  artifactId: z.string().min(1),
  payloads: z.array(CardPayload).min(1),
  sourceExcerpt: z.string().nullable().optional(),
});
export type CreateCardInput = z.infer<typeof CreateCardInput>;
```

Then on the `ApiClient` interface, beside `updateCard` (line ~1400):

```ts
/** Returns every card the input produced — a cloze can split into several. */
createCards(notebookId: string, input: CreateCardInput): Promise<Card[]>;
```

**Name it `createCards`, plural.** The editor emits an array and the backend already
inserts arrays; a singular method would have to lie about one of them.

Then, in order:

1. **`src/lib/api/fake.ts`** — implement it. The fake must produce fresh FSRS state
   (`fsrsState: 'new'`, `due` now, `reps: 0`, `lapses: 0`, `stability: null`,
   `difficulty: null`, `lastReviewedAt: null`). Mirror whatever the fake already does for
   generated cards. **Return copies, not live store objects** — the fake handing out live
   objects was a real bug once, and it made a staleness check impossible to fire.
2. **`src/lib/api/client.ts`** — the HTTP call.
3. **The backend route.** The logic exists; what is missing is the notebook-scoped path.
   Follow the existing artifact-scoped routes. Register it in **both** the API Gateway
   stack and `scripts/dev-api.mjs` — `npm run check:routes` compares the two tables and
   will fail if you do one. Be aware it says in its own header that it does **not** check
   that a route reaches a handler; a whole phase once shipped with every ingestion route
   returning 500 because a handler was never imported. Drive it once by hand.

Both implementations must satisfy the interface **with no cast**. That is the rule that
makes `contract.ts` a specification rather than a suggestion.

### 3.2 DeckBrowser

New: `src/features/cards/DeckBrowser.tsx`, plus query hooks.

**Hooks first.** Follow `src/features/notebook/queries.ts` exactly — a `*Keys` object, a
`use*` query per read, `useMutation` + `invalidate*` per write. Put card hooks in
`src/features/cards/queries.ts`. `listCards(notebookId, artifactId, page?)` returns a
`Page<Card>`, so it is paginated; handle that rather than assuming one page.

**The list.** Per card: front text truncated, kind badge (`basic` / `cloze` / `mcq`), FSRS
state, next review date. `src/features/cards/card-summary.ts` and `CardFace.tsx` already
exist — use them rather than re-deriving a front-text preview.

**Actions:** Edit (mount `CardEditor` with `defaultValue={card.payload}`), Suspend /
Unsuspend (`setCardStatus`), Delete (`deleteCards`). Add Card (`CardEditor` with
`defaultValue={null}`).

Two decisions are yours, and both need writing down in your handover:

- **What an edit that splits into several cards means.** `onSubmit` hands you
  `CardPayload[]`. `updateCard` takes exactly one payload. The honest options are: update
  the first and create the rest; or refuse to split on edit and say so in the UI. Pick one,
  implement it, and say which in your handover. Do not silently drop the extras.
- **Whether delete confirms.** Deleting a card destroys its FSRS history, which is months
  of the user's work. Suspend is the reversible one and exists for this reason. Note that
  in this repo confirmations are deliberately *not* URL-reflected, unlike modals.

**Reachability.** `src/features/notebook/StudioPane.tsx` lists artifacts per kind. A deck
should be openable to browse as well as to practise. Do not rename or remove the existing
Practice action — add alongside it.

**Route.** Register in `src/app/routes.tsx`. Every runner route names its artifact:

```
/notebooks/:notebookId/decks/:deckId/cards
```

A route reading `:notebookId` and treating it as a deck id was a real bug — one notebook's
session served every notebook's cards. Name the artifact.

### 3.3 SourceViewer

`getSource(notebookId, sourceId)` exists at `contract.ts:1344` and nothing calls it.

New: `src/features/notebook/SourceViewer.tsx`. Click a source in
`src/features/notebook/SourcesPane.tsx` to open it.

**The one trap:** each source row already has a `Checkbox` (selection scopes generation and
chat to chosen sources) and a delete control. A click-to-open must not steal clicks from
either. The checkbox keeps its own hit area; the row's label opens the source. Check this
with the keyboard too, not just the mouse.

**Where it renders is constrained by the fact that item 4 has not happened yet.** The
workspace pane does not exist. Do not build it here — that is item 4, and doing it early is
how this brief turns into a rewrite. Put the viewer somewhere self-contained (a sheet, a
dialog, or the chat pane's area) and say in your handover where you put it and why, so item
4 knows what to move.

**Render source content as text.** It is untrusted. `dangerouslySetInnerHTML` is blocked by
an ESLint rule; do not disable it.

---

## 4. Rules that will bite you

- **`userId` never comes from the client.** If you touch `services/api/`, read the four
  tenancy rules in [HISTORY.md §2](HISTORY.md#2-tenancy-is-application-level-and-weaker-than-what-it-replaced).
  Rules 2 and 4 are **not enforced by any linter** — a function that takes `userId` and
  ignores it passes every gate here.
- **No SQL outside `services/api/src/data/`.**
- **One Zod definition per concept.** `CardPayload` lives in `src/lib/schemas.ts`. Do not
  redefine a card shape. This is the rule most often broken by a session that did not look.
- **`npm run check` before every commit.** Never commit with it failing; if you cannot fix
  it, leave the work uncommitted and say so.
- **Do not create new documents.** `docs/` is six files and stays that way — and `BRIEF.md`
  is the only one that is ever *replaced*, never added to. There is no `plans/` and no
  `adr/`. Record decisions in the files that exist.

---

## 5. When you finish — the handover

**Rewrite this file in place** for the next session. Same shape, retargeted at items 4–5.
Delete what is done; a brief describing finished work is the archaeology this project just
deleted 18,000 lines of.

It must contain:

1. **What you actually built**, and what you did not. Name the gap plainly.
2. **The two DeckBrowser decisions** from §3.2 — what a splitting edit does, and whether
   delete confirms — and why.
3. **Where you put the SourceViewer**, so item 4 knows what it is moving.
4. **Anything you found that this brief got wrong.** It will have got something wrong.
5. **What nothing verifies.** There are no tests. Name the paths you changed that only a
   human clicking can check.

Then update [ROADMAP.md](ROADMAP.md): tick off what is done, and record any decision you
took that now binds. If something you built changed what the product *is*, edit
[SPEC.md](SPEC.md) in place — `§10 What is not true yet` is the section your work should be
shrinking.

### Item 4 and 5, for the session after you

Context you should carry forward, not act on:

**Item 4 — the layout restructure.** Today: sources 22%, chat 52%, studio 26%
(`NotebookPage.tsx:193`). The most transient pane owns the most screen. Chat is ephemeral —
`useState<AskResponse[]>([])`, no persistence, resets on navigation — and it has **never
answered a question**, because no embedding key was ever supplied. The plan is a workspace
pane in the centre showing whatever is selected (a source, the DeckBrowser, the overview),
with chat moved somewhere suited to something ephemeral. **Two traps:** `PaneGroup`
hardcodes `flex` in its own `cn(...)`, so a `hidden` class passed to it loses and both
layouts render at once — branch, do not hide. And the Overview is currently reachable only
via a tile labelled "Diagnostics" buried in the Studio grid; it should become a real tab.

**Item 5 — study polish.** Card flip (respect `prefers-reduced-motion`), a quiz question
navigator (exams have `ExamNavigator`; port the pattern), drill-incorrect on quiz and exam
results, and inline markdown + math in `NoteBlocks.tsx`. That last one needs a React
markdown renderer emitting elements — never raw HTML — and is the only item here that adds
dependencies. Notes stay **read-only**; there is no notes editor and none is planned.
