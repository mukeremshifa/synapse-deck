# ADR 0015 — An artifact is one kind-tagged noun, not four tables

**Status:** Accepted
**Date:** 2026-09-08
**Phase:** FR0 ([the brief](../plans/FE-REARCHITECTURE-BRIEF.md) §1.1–1.2)
**Related:** [ADR 0014](0014-typed-fake-as-the-frontend-backend.md) — the contract this shape lives in.

---

## Context

The audit behind the frontend re-architecture found that **the UI is built around eight
nouns and the data model has four.** Only `cards`, `reviews`, `topics` and `answers` are
real entities. Notebook, source, exam, deck-as-a-set, quiz and note are views over decks
and cards with no backing identity.

The owner's complaint was specific: *"no central way for what is generated inside a
notebook."* You cannot file an exam under a notebook because that relationship does not
exist. `decks` has no parent column — a deck *is* the notebook, one flat level, with
nothing between notebook and card.

The obvious fix is four new tables: `decks`, `quizzes`, `notesets`, `exams`, each belonging
to a notebook. It is the shape most people would reach for, and it is the shape a future
session is most likely to try to "simplify" this back into.

## Decision

**One table, tagged by kind.**

```ts
Artifact = {
  id, notebookId, kind: 'deck' | 'quiz' | 'noteset' | 'exam',
  title, sourceIds[], sourcesSnapshot, status, readiness, createdAt,
  payload: <discriminated union on kind>
}
```

The kind-specific half is a discriminated union *within* the artifact, so a note set's
blocks and an exam's blueprint each get a home without four parallel subsystems.

This one shape delivers four things at once, and each is something four tables would have
had to solve separately:

1. **The central place.** One list — "what this notebook has produced" — filterable by
   kind. Four tables need four queries and a client-side merge to render one rail.
2. **Provenance.** `sourceIds[]` answers "generated from what?", which nothing in the
   current app can.
3. **Readiness bundling.** `Notebook.readiness` rolls up over one list. With four tables
   the roll-up has to know about all four, so **a new artifact kind would touch the home
   screen** — exactly the coupling the card-count model had.
4. **Extensibility.** "More coming features" is a new `kind` and a new payload variant, not
   a new table, a new endpoint family, and a new branch in every consumer.

`Deck` becomes `Artifact(kind='deck')`, and that demotion is the point. A deck stops
competing with the notebook for top billing and becomes one of several things a notebook
contains — which is the middle layer the current schema lacks and the direct fix for the
deck/notebook confusion that `PracticePage.tsx:16` documents as a rename that "stopped at
the wire".

### Two shapes that ride along, and are not negotiable

**`sourcesSnapshot` sits beside `sourceIds[]`.** Deleting a source does not delete or
invalidate artifacts made from it. The ids may dangle; the snapshot still says what the
artifact was built from. Same principle as [ADR 0013](0013-answers-snapshot-the-question.md)
— a pointer is not the meaning.

> **A dangling `sourceId` is a valid state, not an error**, and every consumer must handle
> it. `fixtures.ts` ships one deliberately, so anything built against the fake meets it.

**A note set's content is structured blocks, never one string.** A blob would make the
later editor a migration: block-level editing, reordering and citation anchoring cannot be
added to a string without re-parsing content that was never structured.

### What is *not* merged

**Quiz and exam stay separate kinds**, not one kind with a `timed` flag. They differ in
delivery (one-per-page and repeatable versus timed and simulated), in state (a quiz attempt
is resumable), and in what they record. A flag would push all three differences into
runtime branches in one runner.

**A question is not a card.** A card fuses content with FSRS scheduling state; a question
answered once under time is not on a schedule at all. Merging them means nullable
scheduling columns and a weakened `cards_state_consistency` constraint — compromising the
flashcard model to accommodate a different one.

## Consequences

**Good.**

- The Studio rail, the overview's artifact list, and readiness are each one query.
- A new artifact kind is additive: a `kind` value, a payload variant, a runner. Nothing on
  the home screen changes.
- Provenance and source-deletion survival come from the same two fields, everywhere.

**Bad.**

- **The payload union is where the complexity went, not where it disappeared.** Every
  consumer that needs kind-specific data switches on `payload.kind`. TypeScript makes that
  exhaustive, which is the trade being made: a compile error per unhandled kind, in
  exchange for no compile error ever telling you a fifth table exists.
- **A single table means single-table constraints.** Postgres cannot express "an exam row
  must have a blueprint and a deck row must not" as cleanly as two tables could; that
  invariant lives in the payload's Zod schema and in FR7's write path.
- **Counts, not contents.** Cards, questions and blocks are fetched by their own methods —
  inlining them would be a pre-joined graph no list endpoint could produce cheaply. So
  rendering a deck's cards is always a second call.

**Unguarded.** There are no tests ([ADR 0005](0005-no-test-suite.md)). Nothing proves the
payload union is complete, that a consumer handles every kind at runtime, or that a
dangling `sourceId` is actually handled where it matters — only that the code compiles.

## Notes

This is settled ([the brief](../plans/FE-REARCHITECTURE-BRIEF.md) §1.2, the owner's
decisions, recorded 2026-09-07) and is not to be relitigated. **If you are reading this
because you were about to split `Artifact` into four tables, the four properties in the
Decision section are what you would have to reproduce.**
