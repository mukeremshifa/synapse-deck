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

- ~~Cards cannot be edited; no card list; no manual creation~~ — **`DeckBody`** lists,
  edits, suspends, deletes and adds cards, full-screen at
  `/notebooks/:id/decks/:deckId/cards` and inline in the workspace. `createCards` was added
  to the contract, both clients and the API.
- ~~Sources cannot be opened~~ — **`SourceBody`**, in the workspace. It needed more than
  `getSource`: see the decision below.
- ~~The chat pane owns 52% of the viewport~~ — **the centre is a workspace**: a source, a
  deck's cards, or the notebook's summary, with the selection in the URL. Chat is a sheet
  opened from the header.
- ~~Every artifact click navigates away~~ — a deck's cards open **in** the notebook, with
  the Studio still beside them. The full-screen route is kept for deep links and width.
- ~~The Overview is reachable only through a "Diagnostics" tile~~ — it is a named link in
  the header and the workspace, and the tile is gone.
- ~~The polish gaps~~ — **card flip** (the answer turns, not the card), a **question
  navigator** in quizzes (the exam's, shared rather than copied), **drill-incorrect** after
  a quiz or exam, and **inline markdown and math** in notes via `components/InlineText`.

**None of this has been exercised in a browser.** No session that built it had one
available. There are no tests, so nothing above is known to render — only to compile.

### What is broken today

- Home shows four stats and offers no way to act on them. Five minutes between classes
  costs four clicks.
- Dark mode is flat pure black with no surface layering, and loading states are raw
  spinners.

That is **visual refinement**, and it is what is left of this priority.

### Decisions already taken

- **Notes are read-only.** No notes editor. The reader renders structured blocks as
  elements and that is the whole surface.
- **Card editing lands in the card list, not in the review runner.** Editing mid-review is
  the one moment a user is least able to judge a card fairly — that was the original
  reason the editor was disconnected, and it still holds. Browsing is the right context.
- **Chat does not own the centre.** Settled: the centre is a workspace showing whatever is
  selected — a source, a deck's cards, or the notebook's summary — and chat is a sheet
  opened from the notebook header. A pane, however narrow, spends screen on chat at rest;
  a sheet costs nothing until opened and is wider when it is, which an answer with cited
  passages needs.
- **What the workspace shows is in the URL**, not local state: `?view=source&item=<id>`.
  Same test as a modal — a place you can be, link to and return to — and it is what keeps
  the address able to name an open deck.

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
- **A body that owns no layout renders in any frame.** `SourceBody` was split from its
  sheet before the workspace existed and moved into it unchanged; `DeckBody` was split from
  `DeckBrowser`'s `FocusFrame` the same way and now renders in both. This is the pattern to
  reach for when a surface needs to exist in two frames — not a fork.
- **The drill after a quiz records nothing.** Re-asking the missed questions as a new
  attempt would land a 100% score on a quiz actually scored 60% in the user's history, and
  every aggregate reading attempts would see improvement that never happened. It drills what
  was answered wrongly, never what was left unanswered.
- **No markdown library.** Inline formatting is a regex split producing elements
  (`components/InlineText`), so it cannot emit HTML by construction rather than by
  configuration. A real engine would also parse block structure the contract does not
  have.

### Order

~~Contract and card workflows~~ ~~the source viewer~~ ~~the layout restructure~~ ~~study
polish~~ — all done. What is left is **visual refinement**, and before it, the one thing
worth more than any of it: **open the app and use it.** Four sessions have now built
priority 1 without a browser, so every claim above is "it compiles", not "it works".

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
