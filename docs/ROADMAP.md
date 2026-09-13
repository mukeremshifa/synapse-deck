# Roadmap

Three things, in this order. Later ones do not start until earlier ones are done.

> The old board tracked twenty-odd phases across four naming schemes. It is deleted. This
> file replaces it, and stays this short. If it grows past one screen, something has gone
> wrong.

---

## 1. Make it production-grade

**Goal:** every workflow the UI implies actually works, and the app feels finished.

Not deployed. Not tested. **Polished.** The bar is: a stranger can use it without hitting a
dead end, and nothing on screen is a lie.

### What is broken today

Four features exist in the API and have no UI at all:

| Gap | The API already has |
| --- | --- |
| Cards cannot be edited — AI hallucinations are permanent | `updateCard` |
| No card list; cards are met one at a time during review | `listCards` |
| No manual card creation | *nothing — `createCard` must be added* |
| Sources cannot be opened, viewed or searched | `getSource` |

And four structural problems:

- The chat pane owns 52% of the notebook viewport while being ephemeral, non-streaming and
  reset on navigation. The Studio — where the actual study material lives — gets 26%.
- Every artifact click unmounts the notebook shell and navigates away, so studying several
  small decks is constant ping-pong.
- The Overview (heatmaps, retention, forecast, mastery) is reachable only through a tile
  labelled "Diagnostics" buried in a grid.
- Home shows four stats and offers no way to act on them. Five minutes between classes
  costs four clicks.

Plus the polish gaps: no card flip, no drill-incorrect after a quiz, no question navigator
in quizzes (exams have one), notes render without inline markdown or math, dark mode is
flat pure black with no surface layering, and loading states are raw spinners.

### Decisions already taken

- **Notes are read-only.** No notes editor. The reader renders structured blocks as
  elements and that is the whole surface.
- **Card editing lands in the card list, not in the review runner.** Editing mid-review is
  the one moment a user is least able to judge a card fairly — that was the original
  reason the editor was disconnected, and it still holds. Browsing is the right context.
- **Chat gets reorganised for the best possible UX**, which almost certainly means it
  stops owning the centre of the screen. The centre becomes a workspace that shows
  whatever is selected — a source, the card list, the overview. Chat moves to a surface
  that suits something ephemeral.

### Order

Contract and card workflows first (they unblock everything and touch no layout), then the
source viewer, then the layout restructure, then study polish, then visual refinement.

The layout restructure is the largest and most invasive item. It waits until the things it
would otherwise churn are already built.

---

## 2. Pivot off AWS

**Goal:** infrastructure, AI, compute and deployment all run on non-AWS vendors.

This is deliberately cheap, because [the five runtime seams](HISTORY.md#6-runtime-seams-pick-infrastructure-and-none-has-a-default)
were built for exactly this. Each seam picks an implementation from an environment
variable and throws when unset. Swapping a vendor is a new implementation behind an
existing seam, not a rewrite.

The one seam that is not cheap is `EMBEDDING_PROVIDER`: changing it on a populated corpus
means re-embedding every chunk, because two models occupy different vector spaces.

**The target vendors are not chosen yet.** That is the first decision of this phase, and
it is the owner's. Nothing here should be pre-empted during priority 1.

---

## 3. Keep the AWS door open

**Goal:** adopting AWS later is a configuration change, not a rebuild.

This is not work. It is a constraint on priorities 1 and 2:

- `infra/` stays as it is — CDK, two stacks, `us-east-1`. It compiles. It costs nothing
  dormant. **Do not delete it.**
- The AWS seam implementations (`jobs-dynamo.ts`, `pipeline-sfn.ts`) stay.
- Priority 2 adds implementations alongside them. It does not replace them.

If a change during priority 2 would make AWS adoption a rewrite rather than a config flip,
that is a decision to bring to the owner, not a detail to absorb.

---

## Constraints that apply to all three

- **No test suite.** `npm run check` before every commit; `npm run verify` at a checkpoint.
  Report work as "typechecks and builds".
- **No deployment until the product is ready.** Priority 1 finishes first.
- **`dev` is the working branch.** `main` is frozen production and moves only when the
  owner moves it.
