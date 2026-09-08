# FR2 — The shell and routing

**Status:** ✅ **Complete 2026-09-08.** `npm run verify` passes (37.2s). See §6 for what
was decided, §8 for the handoff, §7 for what went unverified — and note that this phase
was **opened in a real browser** at both widths and both themes, which FR1 could not do.
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

## 5. Acceptance criteria — met

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Route table matches brief §3.1; no `/home`, `/dashboard`, `/create/*` | ✅ `/home` and `/notebooks` survive **only as redirects to `/`** — §6.3 says why those two and nothing else |
| 2 | `grep -rn "focus" src/features/` finds no guessing heuristic | ✅ `DashboardPage` deleted, not relocated. Every remaining hit is browser focus, exam focus-mode, or a comment explaining the deletion |
| 3 | Every runner route carries an artifact id | ✅ decks, quizzes, exams, notes — and `notebookPath` now *requires* one, which is what found the surviving guesses |
| 4 | Home renders notebook cards with readiness from the contract roll-up | ✅ `readiness.detail` rendered as received; verified in a browser against all four fixtures, including the empty and half-built ones |
| 5 | No global action navigates to a notebook the user did not name | ✅ no "Continue studying"; the global strip is four facts and no buttons; Settings lost its "Generate cards" link for the same reason |
| 6 | Modal system exists and is documented; URL question decided and recorded | ✅ `src/app/modals.tsx`, §6.1. Verified in a browser: open, reload, Escape, back, bogus param |
| 7 | `ReviewGatePage`'s dead `/practice/:deckId` navigation gone | ✅ now a real notebook-scoped runner path |
| 8 | Every route renders without crashing, signed in and out | ✅ all walked in a browser both ways. **Caveat:** the two real runners 500 against fixture ids — §7(1) |
| 9 | Opened in a browser at 1280px and 375px | ✅ both, **and both themes**. Zero horizontal overflow; four defects found and fixed |
| 10 | `npm run verify` passes | ✅ 37.2s |
| 11 | §6 recorded; drift log appended | ✅ §6.1–6.5; 9 drift rows; FR3–FR6 updated directly; `SPEC.md` §8.2 rewritten |

---

## 6. Decisions recorded — 2026-09-08

### 6.1 Do modals reflect in the URL? **Yes — with one exception.**

`?modal=<name>`, read and written by `src/app/modals.tsx`. Three reasons, in the order they
mattered:

1. **Brief §3.2 makes modals the primary verb.** Adding a source and generating an artifact
   are what this product is *for*. With local state, the two main actions in the app would
   be the only things in it that cannot be linked to.
2. **Reload is not data loss.** A generate modal with sources chosen and a count set,
   dismissed by a refresh, teaches users not to trust the form.
3. **Back closes it, for free** — on Android that is *the* dismiss gesture. Local state
   makes back leave the page instead, which is worse and harder to retrofit.

Opening pushes a history entry, closing replaces it — so back closes the modal but does not
reopen it. **One modal at a time**; `openModal` replaces rather than stacks, because two
overlays make focus containment ambiguous for no product gain here.

**The exception: a confirmation does not go in the URL.** `ConfirmDialog` stays local state.
The test is brief §3.2's own — a route is a place you can *be*. You can be in "generating a
quiz"; you cannot be in "about to confirm a delete", and a confirmation restored from a
pasted link prompts a user to destroy something they never asked about. That maps cleanly
onto FR1's rule: a dialog that interrupts is transient, a surface you work in is a place.

The cost, stated: modal params are user-editable text. `useModal` never trusts them — an
unknown `modal` value reads as **closed** rather than throwing. Verified in a browser.

### 6.2 What happened to `src/lib/notebooks.ts` — **kept, narrowed, re-pointed.**

Not deleted, and the reason is scope rather than affection. Thirteen files imported
`notebookPath`, most in screens FR3, FR5 and FR6 own; deleting it would have meant rewriting
all of them here, which is three phases done badly in one commit.

What changed instead:

- **`notebookPath` re-pointed at the new table.** Every path in it named a route this phase
  deleted or renamed, so leaving it alone would have left a dozen callers navigating to
  404s. Route construction living in one place is what made that a one-file fix, and is why
  the file earns its survival.
- **Every runner helper now requires an artifact id** — `practice(notebookId, deckId)`,
  `quiz`, `exam`, `notes`. **This is how the phase found the remaining guesses:** a caller
  with no id to pass stopped compiling. `StudioRail`, `DiagnosticPage` and `BlueprintPage`
  all failed exactly that way, and all three were navigating to "the" deck or "the" exam of
  a notebook.
- **`list()`, `gate()`, `cards()`, `blueprint()`, `diagnostic()` are gone**; `home()` and
  `overview()` are new.
- **`toNotebook` / `isResumable` are deprecated on arrival** — they map a `DeckWithCounts`
  that only the old stack produces, and they die with it.

### 6.3 What the old routes do now

**Two redirects, both to `/`: `/home` and `/notebooks`.** They were the app's two nav items
until this commit, so every bookmark points at one of them, and both mean exactly what `/`
now means — the redirect is lossless.

**Everything else 404s: `/dashboard`, `/account`, `/decks`, `/decks/:id`, `/create/text`,
`/create/document`, `/create/review/:deckId`, `/notebooks/:id/cards`, `.../blueprint`,
`.../diagnostic`.** The brief already said the `/decks/*` redirects go; the rest follow the
same rule. A redirect is honest only when the destination means what the old path meant.
`/create/document` has no equivalent — the flow is a modal inside a notebook now — so
forwarding it to `/` would tell a user their bookmarked page still works. `/dashboard` and
`/account` were already redirects to redirects.

`NotFoundPage` was re-pointed at `/` in the same pass; it had been offering "Go to
notebooks", which would itself have redirected.

### 6.4 Which routes ship as placeholders, and who fills each

| Route | Renders | Filled by |
| --- | --- | --- |
| `/notebooks/:id` | `Placeholder` naming FR3 | **FR3** |
| `/notebooks/:id/overview` | `Placeholder` naming FR6 | **FR6** |
| `/notebooks/:id/quizzes/:quizId` | `Placeholder` naming FR5 | **FR5** |
| `/notebooks/:id/notes/:noteSetId` | `Placeholder` naming FR5 | **FR5** |
| `/notebooks/:id/decks/:deckId/practice` | the **old** `PracticePage` | FR5 re-points it |
| `/notebooks/:id/exams/:examId` | the **old** `ExamPage`, which ignores `:examId` | FR5 |
| `/`, `/settings`, the auth pages | real screens | — |

`src/app/Placeholder.tsx` names its phase on screen and prints the route params it was
addressed with, so a pasted deep link can be checked by eye.

### 6.5 The decision the plan did not ask for: two data stacks, and one modal built

**Home is the first screen in the app on FR0's contract.** Nothing consumed `@/lib/api`
before this phase. Home had to, because criterion 4 wants readiness from the contract's
roll-up and the old stack has only card counts — the signal the brief exists to delete.
Every other screen stays on `queries.ts` until its phase re-points it. Recorded in §1c; the
route table is the seam.

**And one modal was built** — `NewNotebookModal` — against §2's "FR2 builds the modal
system, not any particular modal". Two reasons that do not generalise to FR3's and FR4's
modals: task 5 requires the app to work, and home's primary action is "new notebook" whose
old flow (`/create/text`) this phase deletes; and a modal *system* with no consumer is
doubly unverified, since nothing else can check its claims about escape, focus, back and
reload. FR3 should not be the phase that discovers the system does not work.

---

## 7. What went unverified

No tests ([ADR 0005](../adr/0005-no-test-suite.md)). This **typechecks and builds** —
`verify` passed in 37.2s. That is not a claim that anything works.

**What was actually opened in a browser**, which is more than FR1 managed: headless Chrome
driven over the DevTools Protocol from this session — no new dependency, because Node 24 has
a built-in `WebSocket`. Signed in with the demo account against the real Cognito pool.

- **Every route in the table, signed in and signed out.** All resolve; none crashes. Signed
  out, every protected route lands on `/login`; `/signup` and the 404 stay public.
- **Home at 1280px and 375px, light and dark.** `scrollWidth - clientWidth === 0` at both
  widths in both themes — the DS4b overflow defect class is clear.
- **The modal system, in full**: opening writes `?modal=new-notebook`; a pasted URL restores
  the dialog; Escape closes it *and* cleans the URL; the back gesture closes it without
  leaving the page; `?modal=nonsense` renders the page with no dialog. This was also the
  first time `dialog.tsx` had ever rendered — FR1 shipped it among twelve unused primitives.
- **Four defects found this way and fixed**: `NotFoundPage` offering "Go to notebooks";
  `ProtectedRoute` sending signed-in users to `/notebooks`; three more `to="/notebooks"`
  links in the runners; and ragged notebook-card heights at 1280px.

Still unverified, and these are the honest gaps:

1. **The two real runners.** `PracticePage` and `ExamPage` render, but both 500 against
   fake-fixture ids because they call the old backend while home calls the fake. Expected
   (§1c) — but it means **neither runner was seen working in this phase**, and `ExamPage`
   demonstrably ignores its `:examId`.
2. **Creating a notebook end to end.** The modal opens, validates and closes correctly; the
   `createNotebook` mutation itself was **not** driven to completion in the browser.
3. **Deep-linking beyond the routes listed.** A dozen were pasted by hand; nothing checks
   that every id shape resolves.
4. **The placeholders and the four state components at 1280px.** Home was checked at both
   widths; only one placeholder was, and only at 375px.
5. **The dialog overlay in dark mode** looked lighter than expected in the screenshot.
   FR1's token rather than this phase's, and not investigated.

---

## 8. Handoff to FR3

### The modal system — `src/app/modals.tsx`

`ModalProvider` is already mounted, inside `AppRoutes` and above every route.

| Export | What it gives you |
| --- | --- |
| `useModal()` | `{ open, openModal, closeModal, modalProps, modalParam }` |
| `openModal(name, params?)` | `?modal=name&…`; pushes history so back closes it |
| `closeModal()` | drops the param; replaces, so back does not reopen it |
| `modalProps(name)` | `{ open, onOpenChange }` — spread onto a Radix `Dialog`/`Sheet` |
| `modalParam(key)` | one of the modal's own params. **Untrusted — validate it.** |
| `ModalName` | the closed union. **Add your modal's name here.** |

`add-source`, `edit-card` and `notebook-settings` are already in the union, unimplemented.
**`src/features/home/NewNotebookModal.tsx` is the worked example**: form → mutation →
invalidate → close → navigate.

Escape, focus trapping, focus restore and scroll lock are Radix's and were not
reimplemented. Overlay motion is FR1's `ui-*` classes; there is no `tailwindcss-animate`.

### The notebook route's shape — what FR3 replaces

`/notebooks/:notebookId` renders `NotebookRoute` in `src/app/routes.tsx`, a `Placeholder`.
Replace that component. It sits **outside `AppShell`**, full-viewport with no outer chrome,
because the three panes need the vertical space a second header would cost.

**P11's shell is gone** — `NotebookPage`, `NotebookHeader`, `SourcesRail`, `StudioRail`,
`WorkspacePane`, `useAsk`, `NotebookCardsPage`, `NotebookLayout`, `use-rails`. Build on
FR1's `PaneGroup`/`Pane`/`PaneHandle` and `Rail`; a nav column is a `Rail`, because a rail
is fixed and a pane resizes. `useAsk` and `WorkspacePane` are recoverable from git history
if the chat pane wants them.

**The card table has no route any more.** It belongs inside your shell.

### The readiness roll-up home uses

`api.listNotebooks()` → `Page<Notebook>`; each `Notebook` carries
`readiness: { state: 'ready' | 'partial' | 'none', detail: string }` and
`counts: { sources, artifacts, dueCards }`. Home renders `readiness.detail` **as received**
— "2 decks · 1 quiz ready" — and never recomputes it from `counts`, which would be the card
count the brief deletes. `state === 'none'` deliberately draws no badge, because an empty
notebook is a normal state and a grid of grey "none" chips reads as a grid of problems.

**Your Studio must agree with that sentence.** Same source: per-artifact
`Artifact.readiness`, rolled up server-side. If Studio derives readiness differently, one of
the two screens is lying to the user.

### What FR2 invalidated in FR3's assumptions

- "`/notebooks/:id` exists and renders something FR3 replaces" — **true**, but that
  something is a placeholder, not the old shell, which is deleted.
- **Re-pointing at `@/lib/api` is FR3 task 0.** The plan assumed the contract was in use. It
  was not, anywhere, until this phase put home on it.
- **Auth is real in fake mode.** FR0's drift row said nothing in FR1–FR6 should need to sign
  in; in practice every route but the auth pages and the 404 is behind `ProtectedRoute`. Use
  `DEMO_EMAIL`/`DEMO_PASSWORD` from `.env.local`, and run Vite on **port 5173** or the
  dev-API's CORS allowlist rejects every old-stack call.
