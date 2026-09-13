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

### Done

- ~~Cards cannot be edited; no card list; no manual creation~~ — **`DeckBrowser` at
  `/notebooks/:id/decks/:deckId/cards`** lists, edits, suspends, deletes and adds cards.
  `createCards` was added to the contract, both clients and the API.
- ~~Sources cannot be opened~~ — **`SourceViewer`**, opened from the source's title in the
  rail. It needed more than `getSource`: see the decision below.

Neither has been exercised in a browser. There are no tests.

### What is broken today

Four structural problems:

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

Taken while building the card and source workflows, and now binding:

- **A source's text is a separate read from its metadata.** `Source` carries no content
  field and `listSources` must never fetch one — the extraction is the whole document and
  the rail renders a filename. `getSourceContent` slices it by character offset instead.
- **An edit that splits one card into several updates the first and creates the rest.**
  The edited card keeps its id and its whole FSRS schedule; the extra cloze deletions
  arrive as new cards. Dropping them would be silent data loss; refusing the split would
  block adding a deletion to a cloze that already exists.
- **Deleting a card confirms; suspending does not.** Delete destroys FSRS history, which
  is the user's actual work. Suspend is the reversible one and the dialog names it.
- **The `SourceViewer` is a sheet until the workspace pane exists.** Its readable half is
  a separate `SourceBody` component that knows nothing about the sheet, so the layout
  restructure moves it by rendering it elsewhere and dropping the wrapper.

### Order

~~Contract and card workflows first~~ ~~then the source viewer~~ — both done. Next is the
**layout restructure**, then study polish, then visual refinement.

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
