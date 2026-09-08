# FR2 — The shell and routing

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §3.1, §3.2, §3.5.
**Depends on:** [FR1](FR1-design-system.md) complete.
**Hands off to:** [FR3](FR3-the-notebook.md).

> Contract altitude. Names no component files — FR1's handoff supplies those.

---

## 1. Preconditions

```bash
npm run check                # passes
npm run dev                  # fake mode, no .env.local
```

FR1's §8 handoff must name the layout components, the four state components, and the
modal/sheet API. **If it does not, read the code and write that handoff yourself before
starting** — the rest of this plan assumes it.

## 1b. Reconcile — first, before any code

Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) rows naming FR2, and FR1 §6 and §8.

This plan assumes the current route table at `src/app/routes.tsx` still has: `/home`
(DashboardPage), `/notebooks`, `/notebooks/:notebookId` (+ `/cards`, `/blueprint`,
`/diagnostic`, `/practice`, `/exam`), the `/create/*` family, `/settings`, `/login`,
`/signup`, `/auth/callback`, and legacy redirects from `/dashboard` and `/decks/*`.

**Where it differs, fix this plan first.**

### What FR1 delivered — appended 2026-09-08 by FR1

FR1 is complete and its §8 handoff is written, so §1's fallback ("read the code and write
that handoff yourself") is **not** needed. Start from [FR1 §8](FR1-design-system.md) and
[docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). The five things most likely to trip this
phase up, all also in the drift log:

- **The shell's parts exist.** `PaneGroup` / `Pane` / `PaneHandle` for the resizable panes,
  `Rail` for the fixed-width column, `Toolbar` for a pane's top strip, `Page width="full"`
  for the frame. **`Rail` does not resize and `Pane` does** — that is the entire
  distinction, so a nav column is a `Rail`.
- **`resizable.tsx` targets `react-resizable-panels` v4**, whose API is `Group` / `Panel` /
  `Separator` with `orientation`. Published shadcn source uses the v2 names and will not
  compile. Do not paste it in.
- **The modal system is `dialog.tsx` + `sheet.tsx`**, and §3.2's "modals are the main verb"
  now has a rule behind it: a **dialog interrupts** (a decision, a short form), a **sheet
  accompanies** (a surface you work in while the page stays relevant). `CommandDialog` in
  `command.tsx` is the ⌘K palette, built on Dialog rather than `cmdk`; it filters nothing
  on its own, so matching is this phase's job.
- **There is no `tailwindcss-animate`.** `animate-in` / `fade-in-0` / `zoom-in-95` silently
  do nothing. Overlay motion is `ui-overlay` / `ui-panel` / `ui-pop` / `ui-sheet`.
- **The home strip's stat cards use the state set** (`LoadingState`, `EmptyState`,
  `ErrorState` from `@/components/states`), and the streak comes from
  `getGlobalSummary().streakDays` per FR0's row above — which returns 0 in `live` mode.

One thing FR1 did **not** build that this phase might have assumed: **no `AppShell`
component exists.** The vocabulary is the parts, not an assembled shell — assembling them
is FR2 task 1, deliberately, because the shell's arrangement is this phase's decision.

---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| The notebook's three panes, sources, Studio | **FR3** |
| The generate modal's *contents* and job progress | **FR4** — FR2 builds the modal *system*, not any particular modal |
| The four runners' internals | **FR5** |
| The overview page's contents | **FR6** — FR2 may route to a placeholder |
| Backend, migrations, infra | FR7 |

**The trap:** FR2 creates the routes FR3–FR6 fill. It is very tempting to fill one while
you are there. A route that renders a documented placeholder is a *complete* FR2
deliverable.

---

## 3. The rule this phase runs under

> **Every screen answers "which notebook?" from the route, never from a heuristic.**
> A surface that cannot name its notebook is not a valid surface. (Brief §1.)

And its corollary, which is what this phase physically deletes:

> **No `focus` guess, ever.** (Brief §3.5.)

`DashboardPage.tsx:60-70` picks *the notebook with the most cards due*, never names it on
screen, and lets it change as counts shift. Three surfaces depend on that guess. **Deleting
it is the point of FR2** — not refactoring it.

Second rule, brief §3.2:

> A **modal** configures or creates. A **route** is a place you can be, link to, and
> return to.

---

## 4. Tasks

### Task 1 — The new route table

Replace `src/app/routes.tsx` with brief §3.1:

```
/                                        Home
/notebooks/:id                           The notebook
/notebooks/:id/overview                  The notebook's centre
/notebooks/:id/decks/:deckId/practice    full-screen runner
/notebooks/:id/quizzes/:quizId           full-screen runner
/notebooks/:id/exams/:examId             full-screen runner
/notebooks/:id/notes/:noteSetId          reader
/settings, /login, /signup, /auth/callback
```

**Gone:** `/home` *and* `/dashboard` as separate destinations; `/notebooks` as a list page
distinct from `/` — there is one home; `/create/text`, `/create/document`,
`/create/review/:deckId`; the `/decks/*` legacy redirects.

**Every runner route names its artifact.** That is what makes "many decks, many quizzes,
many exams" expressible and is the direct fix for the exam that opens from nowhere.

Routes FR3–FR6 own may render placeholders. Say so on screen — an honest "FR3 builds this"
beats a blank div.

### Task 2 — Home

Brief §3.5: a grid of notebook cards carrying per-notebook readiness, plus a genuinely
global strip (total due, streak, reviewed today).

Every action either names its notebook or lives on a notebook card. **No global "Continue
studying" that guesses.**

Readiness comes from the contract's roll-up (brief §1.3), not a card count computed here.

### Task 3 — The modal system

The infrastructure, not the individual modals: how a modal opens, how it stacks, how it
handles escape/focus/scroll-lock, whether it reflects in the URL (**decide, and record it
in §6** — it affects whether a generate modal is linkable).

FR3 and FR4 build modals on top of this. Give them one way to do it.

### Task 4 — Delete the guess

Remove `DashboardPage` and the `focus` heuristic. Also fix the broken navigation the audit
found: `ReviewGatePage.tsx:297` navigates to `/practice/:deckId`, **a route that does not
exist** — a 404 on the happy path. Under the new table it becomes a notebook-scoped runner
path.

`src/lib/notebooks.ts` is the deck→notebook adapter whose own doc comment says "the rename
stops here". Under the FR0 contract the wire says notebook too. **Decide its fate and
record it** — most likely deleted, but check what still imports it.

### Task 5 — Keep the app working

Every route in the new table must render without crashing, in fake mode, signed in and
signed out. Auth routes are unchanged in behaviour — **do not redesign sign-in here.**

### Task 6 — Document, and update what follows

Update `SPEC.md`'s route list. Append to [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md). Update FR3–FR6
where you invalidated them.

---

## 5. Acceptance criteria

1. The route table matches brief §3.1 exactly. No `/home`, no `/dashboard`, no `/create/*`.
2. **`grep -rn "focus" src/features/` finds no notebook-guessing heuristic.** The
   `DashboardPage` selection logic is gone, not relocated.
3. Every runner route carries an artifact id in its path.
4. Home renders notebook cards with readiness from the contract roll-up.
5. **No global action navigates to a notebook the user did not name.**
6. The modal system exists and is documented; the URL question is decided and recorded.
7. `ReviewGatePage`'s dead `/practice/:deckId` navigation is gone.
8. Every route renders in fake mode without crashing, signed in and out.
9. **Opened in a browser at 1280px and 375px.** DS4b found five defects nothing else could
   see; the same applies here.
10. `npm run verify` passes.
11. §6 recorded; drift log appended.

---

## 6. Decisions to record

1. **Do modals reflect in the URL?** Affects FR3/FR4 linkability.
2. **What happened to `src/lib/notebooks.ts`.**
3. **What the old routes do now** — 404, or redirect? Brief §3.1 says the legacy `/decks/*`
   redirects go. Whether `/home` gets a redirect is yours; say which and why.
4. Which routes ship as placeholders, and who fills each.

## 7. What will go unverified

No tests. Report **"typechecks and builds"**, plus what you actually opened in a browser.

1. **That no guess survives.** Grep finds the one you know about.
2. **Deep-linking.** Nothing checks that a pasted runner URL resolves — try a few by hand.
3. **Auth interaction.** Route changes touch `ProtectedRoute`; only signing in and out
   proves it. Do that, both ways.
4. **Placeholder routes.** They render; they do nothing.

## 8. Handoff to FR3

- **the modal system's API**, and whether modals are URL-reflected;
- **the notebook route's shape** — what `/notebooks/:id` renders and what FR3 replaces;
- **the readiness roll-up call** home uses, so FR3's Studio agrees with it;
- anything in FR3's assumptions you invalidated.

---

## 1c. Reconciled against the code — 2026-09-08, by FR2

**Read [FR1 §8](FR1-design-system.md) and the five drift rows above first — all five hold.**
Three further things were true of the code and not of this plan. None changes the phase's
scope; all three change how a task is carried out.

### The route table is as §1b describes, with one addition

`src/app/routes.tsx` has everything §1b lists. It also has **`/account` → `/settings`** and
**`/decks` → `/notebooks`**, two redirects §1b did not name. They go with the rest (§6.3).

### `AppShell` exists — but it is not the shell FR1 meant

FR1 §8 says "no `AppShell` component exists". `src/app/AppShell.tsx` **does** exist: it is
P11's *page* frame — a sticky header, a two-item nav (`/home`, `/notebooks`), a
`max-w-6xl` main. FR1's statement is about the **pane** shell (`PaneGroup`/`Rail`), which
genuinely does not exist and is FR3's notebook, not FR2's.

So task 1 is not "assemble a three-pane shell". It is: **rewrite `AppShell`'s nav for a
route table with one home**, and leave the pane shell to FR3. A two-item nav whose two
items collapse into one is the change.

### The one that matters: **nothing consumes the FR0 contract yet**

`grep -rln "from '@/lib/api'" src` returns **nothing**. Every screen — including
`DashboardPage` and `NotebookListPage` — still reads `src/lib/queries.ts`, the old
deck-shaped stack over `api-client.ts`. FR0 built the contract and the fake beside the app
without re-pointing a single consumer, which was correct for FR0 and is the fact FR2 runs
into first.

**Consequence, and it is the phase's main decision:** Home is built on
`api.listNotebooks()` + `api.getGlobalSummary()` — the contract, per criteria 4 and 5 — and
becomes the **first** consumer of it. Every other route keeps `queries.ts` until the phase
that owns it replaces it (FR3 the notebook, FR5 the runners, FR6 the overview).

That means the app runs on **two data stacks at once** through FR2–FR6, and this is
deliberate rather than drift:

- Re-pointing `NotebookPage`, the runners and the overview at the contract *is* FR3, FR5
  and FR6. Doing it here would be those phases, done worse and in one commit.
- The alternative — building Home on `queries.ts` — fails criterion 4 outright: the old
  stack has no readiness roll-up, and inventing one client-side is the card count the brief
  deletes.

**The seam is the route table.** A route either renders a contract-backed screen (`/`) or
an old-stack screen (everything FR3–FR6 will replace). Nothing renders both.

**For FR3/FR5/FR6:** your phase's first task is re-pointing your screens at `@/lib/api`.
`queries.ts` dies with the last of them, not before, and `api-client.ts` with it.
