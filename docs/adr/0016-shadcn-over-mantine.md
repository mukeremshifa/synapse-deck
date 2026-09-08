# 16. Staying with shadcn/ui after the tokens were released

**Status:** Accepted · **Date:** 2026-09-08 · **Implements:** [FE-REARCHITECTURE-BRIEF.md](../plans/FE-REARCHITECTURE-BRIEF.md) §3.6 · **Decided during:** [FR1](../plans/FR1-design-system.md)

## Context

The frontend re-architecture put the UI library back on the table. The owner is fine with a
rewrite and **released every brand token except the tone of the brand colour**, which
removed the argument that had been keeping shadcn/ui in place.

That argument mattered. Through P0–P6 the case for composing Radix by hand was largely that
the palette was fixed and idiosyncratic — a near-white accent that can only ever be a field,
neutrals pinned to chroma 0, a four-stop grade ramp — and a library with its own theming
layer would have been fought at every screen. Once the owner released those tokens, that
case evaporated: any library could have been themed to whatever palette FR1 derived.

So the question was reopened honestly rather than defended. This ADR records the answer
because the alternative is live: **Mantine would still be a defensible choice today**, and
a future session that finds this codebase slow to build screens in deserves to know the
trade was made deliberately and on what grounds.

The brief assessed four candidates. MUI carries Material, a strong opinion that reads as
"Google admin console", and emotion sits awkwardly beside Tailwind v4. Park/Ark and Base UI
are credible but younger, and not worth the risk on the critical path. The real contest was
**Mantine vs Radix-composed-by-hand (= shadcn/ui)**.

## Decision

**Stay with shadcn/ui.**

Two reasons survive the loss of the palette argument.

**1. The distinctive surfaces ship with no library.** What this app is made of is the exam
runner, the quiz reveal, the three-pane notebook shell, the review gate, and three
keyboard-driven full-screen runners. A library's value is the components you *don't* write;
here the components that carry the product must be written regardless. What a library would
have supplied — dialogs, tabs, menus, tooltips — is the part that was cheap either way.
FR1 wrote fifteen primitives in a phase, which is the empirical version of that claim.

**2. shadcn is source-in-repo, not a dependency.** For an app whose identity is the point,
owning the source is the correct trade. This turned out to be load-bearing during FR1 in a
way that was not anticipated: the palette re-derivation found that **one grade ramp cannot
serve both roles** — a stop light enough for ink to sit on it is too light to be a mark on
the page — and the fix was to split the ramp in two and re-point every consumer. That is a
change to what a design token *means*, and making it required editing the components that
consume it. In a library that owns its theming layer, "our colour scale has two variants
with different contrast contracts" is not a thing you can simply express.

## Consequences

**What this costs, stated plainly.** Mantine would reach a professional surface faster, and
its rich components — spotlight, notifications, the hooks library — are real. FR1 spent most
of a phase writing primitives that Mantine would have supplied on day one. If speed mattered
more than identity, Mantine wins, and that is not a close call.

The judgement is that the app's problem was never missing components. It was **eleven good
components arranged around an incoherent model**, which no library fixes — and which FR2–FR6
are the actual answer to.

**What is now owed.** Every primitive is ours to maintain, including its accessibility. Radix
supplies the behaviour (focus traps, roving focus, `aria-activedescendant`), which is the
hard half; the styling and the composition are ours, and **nothing tests either** ([ADR
0005](0005-no-test-suite.md)). Twelve of the fifteen primitives FR1 added have no consumer
yet and have never rendered in a browser.

Two deviations from stock shadcn already exist and will need to be maintained as such:

- `resizable.tsx` is written against `react-resizable-panels` **v4** (`Group`/`Panel`/
  `Separator`), not the v2 API the published shadcn source uses. Copying upstream's file
  would not compile.
- `command.tsx` is built on our `Dialog` rather than on `cmdk`, to hold the line at the two
  dependencies the brief sanctioned. Its exported names are `cmdk`'s, so adopting the package
  later is a small change.

**When to revisit.** If FR2–FR6 find themselves repeatedly blocked writing primitives rather
than screens — a date picker, a rich combobox, a virtualised tree — that is evidence against
this decision, not a reason to write those by hand too. Reopening it then is legitimate.
