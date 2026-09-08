# The design system

Written at **FR1, 2026-09-08**. The tokens live in
[`src/styles/globals.css`](../src/styles/globals.css); this file is the reasoning behind
them and the rules that keep them coherent.

Read this before adding a component or picking a colour. The file it documents carries the
same rules in shorter form, so if the two ever disagree, `globals.css` is the code and this
is the argument — fix whichever is wrong.

> **Everything except the brand hue was open.** The owner released every token except the
> tone of the brand colour, so FR1 was a re-derivation rather than a tidy-up. Nothing here
> survived by being already there.

---

## 1. How contrast was decided

**Computed, not asserted.** [`scripts/check-contrast.mjs`](../scripts/check-contrast.mjs)
parses `globals.css`, converts OKLCH → linear sRGB → WCAG relative luminance, and reports
every pair the app actually renders.

```bash
node scripts/check-contrast.mjs          # the report below
node scripts/check-contrast.mjs --fail   # exit 1 on any failure
```

It reads the CSS rather than carrying its own copy of the palette, so it cannot quietly
drift out of agreement with the thing it checks. **Run it whenever you touch a colour.**

It is deliberately *not* in `check` or `verify`. Gamut clipping means a pair can be
"correct but 4.48", and a gate that blocks a commit on the third decimal of a colour is a
gate someone disables.

### What it found in the P5 palette

The checker earned its place immediately. Three real failures existed in the palette FR1
inherited, none of which had ever been measured:

| Pair | Was | Needed | Why it mattered |
| --- | --- | --- | --- |
| `muted-foreground` on `muted` | **4.34** | 4.5 | Secondary text inside a Card — drawn on nearly every screen. |
| `border` on `background` | **1.35** | 3.0 | Every field outline in the app. |
| `grade-easy` as a mark | **1.22** | 3.0 | The Easy dot on `SessionSummary` was effectively invisible. |

Two of those forced structural changes rather than a nudge, and they are §2.4 and §2.5.

### The numbers, as of this commit

Light theme:

| Pair | Ratio | Min |
| --- | --- | --- |
| `foreground` on `background` | 19.41 | 4.5 |
| `muted-foreground` on `background` | 5.51 | 4.5 |
| `muted-foreground` on `muted` | 4.98 | 4.5 |
| `primary-foreground` on `primary` | 16.09 | 4.5 |
| `destructive-foreground` on `destructive` | 5.17 | 4.5 |
| `border-strong` / `input` on `background` | 3.17 | 3.0 |
| `ring` on `background` | 19.41 | 3.0 |
| ink on the four grade **fields** | 5.62 / 8.26 / 11.71 / 16.09 | 4.5 |
| the four grade **marks** on `background` | 5.49 / 4.37 / 3.54 / 3.03 | 3.0 |

Dark theme passes the same set: body text 18.68, muted-on-muted 5.90, `border-strong` 3.30
on the page and 3.08 on a card, the field ramp 5.62–15.28 against ink, and the mark ramp
5.73–15.58 against the page.

**52 pairs, all passing, in both themes.** What that does *not* mean is in §8.

---

## 2. Colour

### 2.1 Neutrals are chroma 0

Every grey, in both themes, is achromatic. The palette is ink, paper and one wavelength of
green; a grey tinted toward the accent muddies the only colour allowed to mean anything.

Kept from P5 — it was right, and the re-derivation found no argument against it.

### 2.2 `--primary` is a field, never a foreground

`oklch(0.922 0.178 130)` is near-white: **1.21:1 against paper**. Accent *text* or an
accent hairline is invisible. It may be a background carrying `--primary-foreground`, a
chart fill, or a focus ring on dark. Nothing else.

There is deliberately no darkened `primary-700` to escape this. Darkening it far enough to
read on white produces olive, which is a different colour wearing the same name.

**The brand tone is the one thing that carried over.** Hue moved 122.5 → **130** — the same
yellow-green family, nudged toward green because the ramp now has four stops to fit between
red and the accent, and at 122.5 the Good and Easy stops were too close to separate at a
glance. Lightness and chroma are unchanged in spirit.

### 2.3 `--accent` is not the brand accent

It is shadcn's subtle-hover-surface token and stays achromatic. The brand accent is
`--primary`. This trips up everyone once.

### 2.4 The grade ramp is two ramps

**This is the structural finding of the phase.** A stop light enough for ink to sit on it
(≥4.5:1) is too light to *be* a mark on white paper (≥3:1). The two requirements barely
overlap, and the region where both hold is so narrow it would flatten the ramp to almost no
lightness climb — destroying the property the brief specifically asked to preserve.

So there are two:

| Tokens | Role | Use when |
| --- | --- | --- |
| `--grade-*` | **Field** | The stop is a *background*. A filled button, a bar, a badge. Ink goes on top. |
| `--grade-*-mark` | **Mark** | The stop is a *foreground*. A dot, a chart stroke, an icon, a rule. It sits on the page. |

Setting `backgroundColor` with text over it → field. Setting `fill`, `color`, or a small
`backgroundColor` with nothing on top → mark. Guessing wrong is not a typecheck error, which
is why `grade-tokens.ts` says so at length.

Both climb in lightness, because a red-to-green sweep is the exact axis deuteranopia
flattens — **value carries the information, hue is the reward**:

```
light  field  0.655 → 0.745 → 0.835 → 0.922   (+0.090, +0.090, +0.087)
light  mark   0.545 → 0.585 → 0.625 → 0.655   (+0.040, +0.040, +0.030)
dark   field  0.655 → 0.745 → 0.835 → 0.905   (+0.090, +0.090, +0.070)
dark   mark   = field
```

In dark theme the field ramp already clears 3:1 against the background, so `-mark` aliases
it. The tokens still exist there so every consumer is written the same way in both themes.

Easy *is* the brand colour, because rating Easy is what the product exists to produce.

### 2.5 Borders are two tokens

| Token | Ratio | For |
| --- | --- | --- |
| `--border` | 1.35 | **Decoration.** A card hairline, a separator. |
| `--border-strong` / `--input` | 3.17 | **Meaning.** A field outline, a selected state, a focused control. |

SC 1.4.11 governs boundaries that carry *information*, not every line on the page. A
hairline dark enough to pass 3:1 does not read as a hairline — it reads as a spreadsheet.
So the rule is: **if the boundary is the only thing telling the user something, it is
`--border-strong`.** Otherwise `--border`.

The checker tests `--border-strong` and not `--border`, deliberately: a permanent FAIL row
for a decorative token is a row people learn to ignore.

### 2.6 Semantic colours

`--destructive`, `--warning`, `--success`, each with a `-foreground`. `Alert` tints rather
than fills them, because a filled destructive block is louder than almost any real
condition warrants, and the body text keeps `--foreground`'s 19.41:1 instead of inheriting
whatever the tint gives it.

---

## 3. Typography — the rule

Three faces are loaded. Before FR1 there was no documented rule for when each was used,
which is how `font-serif` ended up on some headings and not others.

| Face | Job | The test |
| --- | --- | --- |
| **sans** — Plus Jakarta Sans | Everything. | The default, and the answer unless one of the two below applies. |
| **serif** — DM Serif Display | The name of the thing you are looking at, **once per screen**. | A page title. Never body text, never a label, never twice on one screen. |
| **mono** — JetBrains Mono | A value you might compare, count or type. | A number, an interval, an id, an email, a keyboard hint. Tabular numerals are the point; decoration is not. |

**Enforced, not just written down.** `PageHeader` owns the serif face — a screen gets it by
using the component, and `SectionHeader` (an `<h2>`) is deliberately sans, because a screen
has one subject and a second serif heading competes with it rather than subdividing it.

Every figure in the rebuilt Settings screen is `font-mono tabular-nums`. A column of numbers
that does not line up is the most common reason a data table looks amateur.

---

## 4. Tokens beyond colour

The P5 token file was colour-only, which is why every screen hand-rolled its own spacing.

### Spacing

Named by **role**, not size — "gutter" survives a redesign, "space-6" does not.

| Token | Value | Role |
| --- | --- | --- |
| `hairline` | 4px | Icon to its label |
| `tight` | 8px | Within a control |
| `snug` | 12px | Between related controls |
| `base` | 16px | The default gap |
| `gutter` | 24px | Card padding, column gutters |
| `section` | 40px | Between sections of a page |
| `page` | 64px | Page padding, empty-state breathing room |

Available as utilities: `gap-gutter`, `p-snug`, `mt-tight`.

### Radius

`--radius` is 0.5rem, with `sm`/`md`/`lg`/`xl`/`2xl` derived from it.

### Elevation

Four steps, and a rule: **elevation means distance from the page, not importance.** A card
is not elevated because it matters; it is elevated because it floats.
`shadow-raised` / `shadow-overlay` / `shadow-modal`. Achromatic, per §2.1, and deepened in
dark theme where shadows barely read.

### Motion

Brief §3.6: ad-hoc animation is the most common reason a competent app still reads as
amateur.

| Duration | Value | For |
| --- | --- | --- |
| `--duration-instant` | 120ms | A state the user just caused — hover, press. Perceived as responsiveness, not motion. |
| `--duration-quick` | 180ms | Something appearing or leaving in place — a tooltip, a toast. |
| `--duration-moving` | 260ms | Something that travels — a sheet, a dialog, a pane resize. |

| Easing | For |
| --- | --- |
| `--ease-standard` | Things arriving and staying. |
| `--ease-exit` | Things leaving. **Exits are faster than entrances** — a UI that lingers on exit feels slow. |
| `--ease-spring` | The one case where something should feel physical. |

Anything slower than `--duration-moving` is a decision, not a default, and belongs in the
component with a comment saying why.

**Overlay motion is CSS, not a plugin.** `ui-overlay`, `ui-panel`, `ui-pop` and `ui-sheet`
in `globals.css` key off Radix's `data-state`, so six primitives share one definition and
the timings are the tokens above. This is deliberately not `tailwindcss-animate`: the brief
named exactly two new dependencies, and a third for what eight keyframes do would be scope
the phase was not given.

**`prefers-reduced-motion` is intact** (SPEC §8.4) and matches `*`, so everything above
degrades to its end state instantly. That is correct — these are decoration on top of a
state change that still happens.

---

## 5. The four states

In [`src/components/states.tsx`](../src/components/states.tsx). Every screen shows them the
same way; before FR1, each screen decided for itself.

| Component | Means | Notes |
| --- | --- | --- |
| `LoadingState` / `LoadingCard` | We asked, and we are waiting. | **Skeleton, never a spinner.** A skeleton says what is coming and reserves its space, so nothing jumps when the data lands. `lines` is a shape hint. |
| `EmptyState` | We asked, and the answer is "none". | In an SRS this is usually *success* — "nothing due" is the healthy case. Says what to do next, not just what is absent. |
| `ErrorState` | We could not get an answer. | Takes `onRetry`; an error with no action is a screen you can only leave by reloading. `detail` carries the API message, rendered as text. |
| `GeneratingState` | A model is working. | **The one the pre-FR1 app lacked**, and FR4 depends on it entirely. |

### Loading is not generating

A skeleton implies the answer already exists and is in transit. Generation implies it is
being *made*, takes tens of seconds, and might fail partway. Rendering them identically is
a false promise, so the animations differ on purpose: the skeleton **sweeps** (arriving),
the generating state **breathes** (working).

`GeneratingState` takes `value={null}` for "total not yet known" — which FR0's drift log
singles out as the case to design for first: a job can fail before any stage reports with
`unitsTotal` still 0. Passing 0 there draws an empty bar and claims we know the size; null
draws a breathing bar and claims only that we are working.

### Seeing them

The fake's knobs, from the browser console in dev:

```js
fakeApi.configure({ latencyMs: 2000 })            // loading
fakeApi.configure({ failAlways: 'internal' })     // error
fakeApi.reset()
```

The `nb-stats` notebook is empty, for the empty state.

---

## 6. Layout vocabulary

In [`src/components/layout.tsx`](../src/components/layout.tsx), so no screen hand-rolls
padding again. Before FR1 every screen opened with its own wrapper — `max-w-xl space-y-6`
on Settings, something else everywhere else. None was wrong; no two agreed.

| Component | Props | For |
| --- | --- | --- |
| `Page` | `width: 'prose' \| 'wide' \| 'full'` | A screen's frame. `prose` = one readable column; `wide` = a grid; `full` = edge to edge, no padding (the shell, a runner). |
| `PageHeader` | `title`, `description?`, `actions?` | The screen's heading. **Owns the serif face.** |
| `SectionHeader` | `title`, `description?`, `actions?` | A heading within a screen. Sans, `<h2>`. |
| `Section` | `title?`, `description?`, `actions?` | `SectionHeader` plus its content. |
| `Toolbar` / `ToolbarSpacer` | — | Fixed-height strip at the top of a pane, so panes line up across a shell. |
| `Rail` | `side: 'left' \| 'right'` | A **fixed-width** column. Does not resize — if it should, it is a `Pane`. |
| `PaneGroup` / `Pane` / `PaneHandle` | `orientation`, `defaultSize`, `minSize` | Resizable panes — FR2's three-pane shell. |

---

## 7. Primitives

Twenty-six files in `src/components/ui/`. The eleven from P5, restyled, plus the fifteen
the brief named: `dialog`, `sheet`, `dropdown-menu`, `tabs`, `tooltip`, `progress`,
`separator`, `avatar`, `scroll-area`, `command`, `popover`, `alert`, `resizable`,
`toggle-group`, `table`.

shadcn/ui is **source-in-repo, not a dependency** — these are files we own.

Distinctions worth knowing before you pick one, each documented at length in its own file:

- **Dialog vs Sheet.** A dialog *interrupts* (a decision, a short form). A sheet
  *accompanies* (a surface you work in while the page stays relevant).
- **Tooltip vs Popover vs Dropdown.** Describes / holds controls / holds commands. A
  tooltip is never the only place information lives — it does not appear on touch.
- **Progress vs Meter.** `Progress` is a task advancing toward completion. `Meter` is a
  proportion that is true right now. A mastery bar rendered as Progress tells the user
  their mastery is on its way to 100%.
- **Tabs are not navigation.** If switching changes *what* you are looking at rather than
  *how*, it is a route.
- **Alert vs toast.** An alert is a condition still true; a toast is something that happened
  and is over.

Two files diverge from stock shadcn on purpose:

- **`resizable.tsx`** — the installed `react-resizable-panels` is **v4** (`Group` / `Panel` /
  `Separator`, `orientation`), not the v2 the published shadcn source targets. Copying that
  source would not compile. The exported names stay the shadcn ones.
- **`command.tsx`** — built on `Dialog` rather than `cmdk`, for the dependency reason in §4.
  The exported names are `cmdk`'s, so swapping it in later is a small change.

Two dependencies added, exactly the two the brief named as genuine gaps:
`react-resizable-panels` (FR2's shell) and `@tanstack/react-virtual` (FR3/FR5's long lists).

---

## 8. What is not verified

There are no tests ([ADR 0005](adr/0005-no-test-suite.md)). `check` and `verify` prove this
**typechecks and builds** — not that it works, and not that it looks good.

Specifically:

1. **That the system looks good.** Judgement. The rebuilt Settings screen is the only real
   check, and it is one screen.
2. **Contrast in combinations nothing uses yet.** The checker covers 52 pairs the app
   actually draws. A token pair FR2–FR6 introduce is unchecked until they do — **add the
   pair to `PAIRS` when you introduce it.**
3. **Motion, and the reduced-motion path.** Nothing verifies either except opening the app
   with the OS setting on.
4. **Twelve of the fifteen new primitives have no consumer.** They typecheck and they are
   styled from the tokens; nothing has rendered `command`, `resizable`, `table`, `avatar`,
   `scroll-area`, `toggle-group`, `sheet`, `tabs`, `tooltip`, `popover`, `dropdown-menu` or
   `progress` in a browser. **Expect to find small things wrong the first time each is
   used** — that is normal, and cheaper than the phase pretending otherwise.
5. **The dark theme of the rebuilt screen**, beyond the computed ratios. The tokens are
   correct by measurement; the *composition* in dark theme is unreviewed.
