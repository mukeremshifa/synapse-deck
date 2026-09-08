# FR1 — The design system

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §3.6 — read it first.
**Depends on:** [FR0](FR0-contract-and-fake.md) complete.
**Hands off to:** [FR2](FR2-shell-and-routing.md).

> **Written before the code it runs against exists.** This plan is deliberately at
> contract altitude — scope, constraints, acceptance criteria, handoff — and names no
> component files, because FR1 is the phase that invents them. See
> [the drift log](FR-DRIFT-LOG.md) for why, and for what it owes you.

---

## 1. Preconditions

```bash
git branch --show-current    # aws-native or dev
npm run check                # passes
npm run dev                  # boots with no .env.local, in fake mode
```

The last one is FR0's headline acceptance criterion. If it fails, **FR0 is not done** —
finish it rather than working around it.

## 1b. Reconcile — do this first, before any code

**Mandatory.** Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) for rows naming FR1, and read
[FR0](FR0-contract-and-fake.md) §6 (what it decided) and its handoff.

This plan assumes:

- `src/lib/api/` exists and exports a typed client; `fake.ts` serves `fixtures.ts`.
- Eleven UI primitives exist in `src/components/ui/` (`badge`, `button`, `card`,
  `confirm-dialog`, `input`, `kbd`, `label`, `select`, `skeleton`, `sonner`, `textarea`).
- The grade ramp lives in `src/styles/globals.css` as `--grade-*` custom properties, with
  `bg-grade-*` Tailwind classes consumed by `Meter.tsx`, `RatingButtons.tsx` and
  `src/features/plan/DiagnosticPage.tsx`; only `SessionSummary.tsx` imports
  `src/lib/grade-tokens.ts`.

**Where any of that is now false, fix this plan and commit that before writing code.**

### Reconciled against FR0 as executed — 2026-09-08

**All three assumptions above were checked and hold.** `src/lib/api/` exists with
`contract.ts`, `client.ts`, `fake.ts`, `fixtures.ts` and `index.ts`; the eleven primitives
are exactly the eleven named; and `SessionSummary.tsx` is still the only importer of
`grade-tokens.ts`. FR0 touched no component, no primitive and no CSS.

Three things FR0 changed that this phase should know, none of which invalidate the plan:

- **`npm run dev` boots with no `.env.local`, in fake mode** — the precondition above is
  satisfied and was observed rather than assumed. `VITE_API_MODE` defaults to `fake`.
- **`DashboardPage` lost its streak card.** That is the one component FR0 modified, and it
  was forced: `streaks()` needed the Supabase history that this phase's predecessor
  removed. If FR1 upgrades `DashboardPage` as its "one real screen", it is upgrading a
  screen with three stat cards, not four. The streak returns at FR2 from
  `getGlobalSummary().streakDays`.
- **The fake's knobs are the way to see a state**, not to reason about one. In dev,
  `fakeApi.configure({ latencyMs: 2000 })` from the browser console is how the **loading**
  half of §5's four-state set gets designed against something real rather than imagined;
  `fakeApi.configure({ failAlways: 'internal' })` does the same for **error**. Both are
  live now. The **empty** state has `nb-stats`, a notebook with nothing in it at all.

---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| New routes, the three-pane shell, home | **FR2** |
| Wiring any primitive to real data | FR2+ |
| Deleting `DashboardPage`, `/create/*`, `SourcesRail` | FR2/FR3 — still running |
| Touching `services/api/`, `infra/`, migrations | FR7 |
| Tests | Never ([ADR 0005](../adr/0005-no-test-suite.md)) |

**The trap specific to this phase:** a design system built with no screen using it is
decoration. §5's "reviewed on a real screen" criterion exists to stop that, and it is
satisfied by upgrading *one existing* screen — not by building a new one.

---

## 3. The rule this phase runs under

> **Everything except the brand hue is open, and nothing survives by being already there.**

The owner has released every token except the tone of the brand colour (the hue family, not
the exact value). So this is a re-derivation, not a tidy-up. Two constraints bind it:

1. **Contrast must be *checked*, not asserted.** Run actual numbers against WCAG. Record
   them.
2. **The grade ramp must vary in lightness, not only hue.** A red-to-green sweep is the
   axis deuteranopia flattens. Today's ramp runs 0.60 → 0.92 in lightness and that
   *property* — not its values — is what carries forward.

And one thing that is not a style choice: **keep the `prefers-reduced-motion` block** in
`globals.css:162` (SPEC §8.4). It is an accessibility requirement.

---

## 4. Tasks

Ordered so the app builds after each. Files are named only where they already exist.

### Task 1 — Re-derive the palette

Neutrals, surfaces, borders, semantic colours, and the FSRS grade ramp, in both themes.
Only the brand *tone* carries over; its exact value may change.

Re-point every consumer. Per the drift log, that is **five files**, not the four the brief
names, and most reach the ramp through CSS rather than TS: `src/styles/globals.css` (the
definition), `src/lib/grade-tokens.ts`, `src/components/Meter.tsx`,
`src/features/practice/RatingButtons.tsx`, `src/features/plan/DiagnosticPage.tsx`.

`RatingButtons.tsx:13` says the `--grade-*` tokens "must keep doing so" — that comment is
now superseded by the owner's token release. **Update the comment**; a stale rationale is
worse than none.

### Task 2 — Tokens beyond colour

The current token file is colour-only. Add spacing, radius, elevation, and **motion**
(durations, easings). Brief §3.6: ad-hoc animation is the most common reason a competent
app still reads as amateur.

### Task 3 — Complete the primitive set

Add the fifteen the brief names: `dialog`, `sheet`, `dropdown-menu`, `tabs`, `tooltip`,
`progress`, `separator`, `avatar`, `scroll-area`, `command`, `popover`, `alert`,
`resizable`, `toggle-group`, `table`.

shadcn/ui is source-in-repo, not a dependency — these are files you own and restyle to the
new palette, not vendor code to leave alone.

Add the two genuine gaps as dependencies: `react-resizable-panels` (FR2's shell) and
`@tanstack/react-virtual` (FR3/FR5's long lists).

### Task 4 — Layout vocabulary

`Page`, `PaneGroup`, `Rail`, `Toolbar`, `EmptyState`, `SectionHeader` as real components,
so no screen hand-rolls padding again. `src/components/EmptyState.tsx` already exists —
fold it in rather than creating a second one.

### Task 5 — One documented state set

Loading (**skeleton, not spinner**), empty, error, and **generating**, applied identically
everywhere. `generating` is the one the current app lacks and FR4 depends on entirely.

### Task 6 — The typography rule

Three faces are loaded (`plus-jakarta-sans`, `dm-serif-display`, `jetbrains-mono`) with no
documented rule for when each is used. **Decide, write it down, enforce it.** Faces may
change.

### Task 7 — Prove it on a real screen

Take one existing screen and rebuild it on the new system. Settings or the practice runner
are good candidates: small, self-contained, already working. **This is the acceptance
gate for the whole phase** — a system nothing uses has not been reviewed.

Do not upgrade every screen. FR2–FR6 replace most of them.

### Task 8 — Document, and update what follows

- Write the system down where a session will find it (`docs/` or a README beside the
  tokens). Include the contrast numbers and the typography rule.
- **An ADR is likely warranted** for staying with shadcn/ui over Mantine given the owner
  released the tokens — brief §3.6 records a real counter-argument, and an ADR is where a
  decision-with-a-live-alternative belongs ([AGENTS.md §6](../AGENTS.md)).
- **Append to [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md)** and update FR2–FR6 directly for
  anything you invalidated.

---

## 5. Acceptance criteria

1. Palette re-derived in both themes; **contrast ratios computed and recorded**, not asserted.
2. The grade ramp varies in **lightness**, demonstrably — state the L values.
3. All five ramp consumers re-pointed; `RatingButtons.tsx`'s stale comment updated.
4. Spacing, radius, elevation and motion tokens exist and are used by at least one component.
5. All fifteen primitives present and on the new palette.
6. `react-resizable-panels` and `@tanstack/react-virtual` installed.
7. Layout vocabulary exists; `EmptyState.tsx` folded in, not duplicated.
8. Four states documented, `generating` included.
9. Typography rule written down.
10. **One real screen rebuilt on the system and opened in a browser**, both themes.
11. `prefers-reduced-motion` block intact.
12. `npm run verify` passes.
13. §6 recorded; drift log appended; FR2 updated if invalidated.

---

## 6. Decisions to record

1. The palette, and **why the brand tone resolved to the value it did**.
2. The typography rule, in one sentence per face.
3. shadcn vs Mantine — as an ADR if you take the brief's recommendation, and **especially**
   if you do not.
4. Anything in the brief's §3.6 primitive list that turned out unnecessary, and why.

## 7. What will go unverified

No tests ([ADR 0005](../adr/0005-no-test-suite.md)). Report **"typechecks and builds"**.

1. **That the system looks good.** Judgement; task 7 is the only real check.
2. **Contrast in every combination.** You will check the ones you compute. A token pair
   nothing uses yet is unchecked until FR2–FR6 use it.
3. **Motion.** Nothing verifies the reduced-motion path except opening it with the OS
   setting on. Do that once.
4. **The unused primitives.** Twelve of fifteen will have no consumer until FR2+.

## 8. Handoff to FR2

State explicitly, in this file, at completion:

- **the layout components' names and props** — FR2's shell is built from them;
- **the four state components' names** — FR2+ apply them identically;
- **the modal/sheet primitives' API** — brief §3.2 makes modals the main verb;
- **anything you did not build** that FR2 assumed it would have.
