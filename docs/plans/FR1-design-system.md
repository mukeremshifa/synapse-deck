# FR1 — The design system

**Status:** ✅ **Complete 2026-09-08.** `npm run verify` passes. See §6 for what was
decided, §8 for the handoff, §9 for what went unverified — and
[docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) for the system itself.

**Planned:** 2026-09-07, before FR0 executed.
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

## 6. Decisions recorded — 2026-09-08

The full write-up is [docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). The four this plan asked
for, answered:

### 6.1 The palette, and why the brand tone resolved as it did

**Hue 122.5 → 130**, same yellow-green family, lightness and chroma unchanged in spirit
(`oklch(0.922 0.178 130)`). The nudge toward green was forced by the ramp rather than
chosen for its own sake: with four stops to fit between red and the accent, at 122.5 the
Good and Easy stops were too close to separate at a glance. It remains a **field, never a
foreground** — 1.21:1 against paper.

**Two structural findings, both from measuring rather than looking.** They are the real
output of this phase:

1. **The grade ramp had to become two ramps.** A stop light enough for ink to sit on it
   (≥4.5:1) is too light to *be* a mark on paper (≥3:1); the overlap is so narrow that
   forcing one ramp to serve both would have flattened the lightness climb the brief
   specifically said to preserve. So `--grade-*` (field, ink on top) and `--grade-*-mark`
   (a dot, a stroke, an icon). The old single ramp put an Easy dot at **1.22:1** on
   `SessionSummary` — invisible, and shipped that way since P5.
2. **Borders had to split the same way.** `--border` stays decorative at 1.35:1 because a
   hairline that passes 3:1 does not read as a hairline; `--border-strong` / `--input` is
   3.17:1 and carries anything SC 1.4.11 governs.

Both ramps climb in lightness in both themes: field `0.655 → 0.745 → 0.835 → 0.922`
(+0.090, +0.090, +0.087), mark `0.545 → 0.585 → 0.625 → 0.655`. **52 pairs computed, all
passing**, by [`scripts/check-contrast.mjs`](../../scripts/check-contrast.mjs) — which
parses `globals.css` rather than carrying its own copy, so it cannot drift.

That script also found two failures in the inherited palette that nobody had measured:
`muted-foreground` on `muted` at **4.34** (secondary text inside a Card — drawn constantly),
and every border at **1.35**.

### 6.2 The typography rule

- **sans** (Plus Jakarta Sans) — everything; the default, and the answer unless one of the
  two below applies.
- **serif** (DM Serif Display) — the name of the thing you are looking at, **once per
  screen**; never body text, never a label, never twice on one screen.
- **mono** (JetBrains Mono) — a value you might compare, count or type: a number, an
  interval, an id, an email, a keyboard hint.

**Enforced, not merely written:** `PageHeader` owns the serif face, so a screen gets it by
using the component; `SectionHeader` is deliberately sans, because a screen has one subject.

### 6.3 shadcn vs Mantine

Stayed with shadcn/ui — **[ADR 0016](../adr/0016-shadcn-over-mantine.md)**, which records
the counter-argument as live rather than dismissed. The palette argument really was void
once the owner released the tokens; what survived is that the distinctive surfaces ship with
no library, and that source-in-repo turned out to be load-bearing — splitting the grade ramp
into two variants with different contrast contracts is not something a library that owns its
theming layer lets you express.

### 6.4 The primitive list

**All fifteen were built; none turned out unnecessary.** Two diverge from stock shadcn on
purpose, and both are traps for a later session:

- **`resizable.tsx`** — the installed `react-resizable-panels` is **v4** (`Group` / `Panel` /
  `Separator`, `orientation`), not the v2 the published shadcn source targets. Pasting
  upstream's file in does not compile.
- **`command.tsx`** — built on our `Dialog`, not `cmdk`, to hold the two-dependency line the
  brief drew. Exported names are `cmdk`'s so swapping it in later is small.

A third thing the brief did not name but the phase needed: **there is no
`tailwindcss-animate`**, so overlay motion is four `ui-*` classes in `globals.css` keyed off
Radix's `data-state`. `animate-in` and friends silently do nothing in this repo.

## 7. Acceptance criteria — met

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Palette re-derived, contrast **computed and recorded** | ✅ 52 pairs, `scripts/check-contrast.mjs`, recorded in DESIGN-SYSTEM.md §1 |
| 2 | Ramp varies in **lightness**, L values stated | ✅ §6.1 above |
| 3 | All five ramp consumers re-pointed; `RatingButtons` comment updated | ✅ `globals.css`, `grade-tokens.ts`, `Meter.tsx`, `RatingButtons.tsx`, `DiagnosticPage.tsx` |
| 4 | Spacing, radius, elevation, motion tokens exist and are used | ✅ used by the primitives, the layout vocabulary and the rebuilt Settings |
| 5 | All fifteen primitives present, on the new palette | ✅ |
| 6 | `react-resizable-panels`, `@tanstack/react-virtual` installed | ✅ |
| 7 | Layout vocabulary; `EmptyState` folded in, not duplicated | ✅ moved to `states.tsx`, old path is a re-export |
| 8 | Four states documented, `generating` included | ✅ `src/components/states.tsx` |
| 9 | Typography rule written down | ✅ §6.2, DESIGN-SYSTEM.md §3 |
| 10 | One real screen rebuilt **and opened in a browser, both themes** | ⚠️ **partially — see §9.1** |
| 11 | `prefers-reduced-motion` intact | ✅ unchanged from P5 |
| 12 | `npm run verify` passes | ✅ 27.9s |
| 13 | §6 recorded; drift log appended; FR2 updated | ✅ 10 rows; FR2 §1b |

## 8. Handoff to FR2

### The layout components — `src/components/layout.tsx`

| Component | Props | Notes |
| --- | --- | --- |
| `Page` | `width?: 'prose' \| 'wide' \| 'full'` | `prose` one readable column, `wide` a grid, `full` edge-to-edge with **no padding** — that is the shell's frame. |
| `PageHeader` | `title`, `description?`, `actions?` | **Owns the serif face.** |
| `SectionHeader` | `title`, `description?`, `actions?` | Sans, `<h2>`. |
| `Section` | `title?`, `description?`, `actions?` | `SectionHeader` + content. |
| `Toolbar` | — | Fixed `h-11`, so panes line up across the shell. |
| `ToolbarSpacer` | — | Pushes the rest to the far end. |
| `Rail` | `side?: 'left' \| 'right'` | `w-60`, **does not resize**. |
| `PaneGroup` | `orientation?`, plus `Group`'s props (`defaultLayout`, `onLayoutChanged`, …) | |
| `Pane` | `defaultSize?`, `minSize?`, `maxSize?`, `collapsible?` | Percentages of the group. |
| `PaneHandle` | `withHandle?: boolean` | Hairline with a 9px grab area; keyboard-resizable. |

**`Rail` vs `Pane` is the distinction to get right:** a rail is fixed, a pane resizes. A nav
column a user can drag is a decision they did not want.

### The four state components — `src/components/states.tsx`

`LoadingState({ lines?, label? })`, `LoadingCard({ className? })`,
`EmptyState({ icon?, title, description?, action? })`,
`ErrorState({ title?, detail?, onRetry?, retryLabel? })`,
`GeneratingState({ stage, value?, detail?, onCancel? })`.

- **Import from `@/components/states`.** `src/components/EmptyState.tsx` is now a re-export
  kept only for the nine existing callers.
- **`GeneratingState` is not `LoadingState`.** A skeleton promises the answer exists and is
  in transit; generation is being *made*, takes tens of seconds, and can fail partway.
  Pass `value={null}` when the total is unknown — FR0's `failNextJob: { at: 'immediately' }`
  is exactly that case, and 0 would falsely claim the size is known.

### The modal / sheet API

`dialog.tsx`: `Dialog`, `DialogTrigger`, `DialogContent` (`showClose?`), `DialogHeader`,
`DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`.
`sheet.tsx`: the same shape, plus `side?: 'top' | 'right' | 'bottom' | 'left'` on
`SheetContent`.
`command.tsx`: `CommandDialog` (`open`, `onOpenChange`, `title?`, `description?`),
`CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`
(`value`, `onSelect`), `CommandShortcut`, `CommandSeparator`.

**The rule for §3.2's "modals are the main verb":** a **dialog interrupts** — a decision or
a short form, the thing behind it stops mattering. A **sheet accompanies** — a surface you
work in while the page is still the subject. `ConfirmDialog` stays on AlertDialog and is
unchanged.

### What FR1 did **not** build

- **No `AppShell`.** The vocabulary is the parts; assembling them is FR2's decision and its
  task 1. This is deliberate, not an omission.
- **No command-palette matching.** `CommandItem` renders and selects; **filtering is the
  caller's**. The component scores nothing.
- **No virtualisation.** `@tanstack/react-virtual` is installed and unused. `ScrollArea` is
  a styled scrollbar, *not* virtualisation — wrapping ten thousand rows in it renders ten
  thousand rows. FR3/FR5 own that.
- **No toast changes.** `sonner` is untouched.
- **No `Skeleton` layout presets** beyond `LoadingState`/`LoadingCard`.

## 9. What went unverified

No tests ([ADR 0005](../adr/0005-no-test-suite.md)). This **typechecks and builds** —
`verify` passed in 27.9s. It does not mean anything works or looks right.

1. **Criterion 10 is only half met, and that is the one honest gap.** Settings was rebuilt
   on the system and the dev server serves it; the CSS was verified to compile with every
   new token and utility emitted. **But no browser rendered it in this session** — no
   browser tooling was available — so neither theme was actually looked at. The contrast
   numbers are computed and trustworthy; the *composition* is not reviewed. **Open
   `/settings` in both themes before building on this.**
2. **Motion and the reduced-motion path.** Nothing verifies either. The `ui-*` classes are
   emitted and the `prefers-reduced-motion` block is intact and matches `*`; that the
   animations look right, and that opting out degrades correctly, is unchecked.
3. **Twelve of the fifteen primitives have no consumer.** Only `separator`, `alert` and
   `progress` (via `GeneratingState`) are used. `command`, `resizable`, `table`, `avatar`,
   `scroll-area`, `toggle-group`, `sheet`, `tabs`, `tooltip`, `dropdown-menu`, `popover`
   and `dialog` have never rendered. **Expect small things wrong the first time each is
   used** — cheaper to say so than to pretend otherwise.
4. **Contrast in pairs nothing draws yet.** 52 pairs are checked because 52 pairs are drawn.
   **Add yours to `PAIRS` in `scripts/check-contrast.mjs` when you introduce it** — a pair
   nobody listed is a pair nobody checked.
5. **The other screens.** FR1 deliberately rebuilt one. Every other screen now renders on a
   changed palette without having been looked at; FR2–FR6 replace most of them, but
   `DiagnosticPage`, `BlueprintPage` and the exam surfaces will look slightly different and
   nobody has checked how.
