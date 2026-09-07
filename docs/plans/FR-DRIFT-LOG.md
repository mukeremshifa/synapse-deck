# FR drift log

**One line per thing a phase learned that changes a later phase.**

FR1–FR7 were planned on 2026-09-07, before FR0 executed. That was a deliberate choice
against [the one-at-a-time convention](README.md), taken because the plans are written at
**contract-and-handoff altitude** — scope, preconditions, acceptance criteria and explicit
handoffs, with no file-by-file task lists, which is the part that rots.

The convention's objection still stands and this file is the answer to it:

> A plan written today against code that does not exist is fiction, and every drift between
> plan and reality is a session confidently doing the wrong thing.

**So every drift gets written down, by the session that discovers it, at the moment it is
discovered.** Not at the end, and not "if it seems significant" — the whole point is that
the session which knows is the one that records it.

---

## The duty

Every FR plan carries two mandatory steps that exist only to feed this file:

- **§1b Reconcile** — the *first* thing a session does, before writing any code. Read the
  entries below that name your phase. Read the previous phase's handoff section. Where
  reality differs from your plan, **fix your plan and commit that first.**
- **§N Update what follows** — the *last* thing. Anything you built that invalidates an
  assumption in a later plan goes here, **and** into that plan directly.

Updating a later plan is not scope creep and is not optional. It is the mechanism that
makes planning seven phases ahead defensible rather than reckless.

## How to write an entry

Name the phase that found it, the phase(s) affected, and what a session should now *do*
differently. "The contract changed" helps nobody; "FR4's generate modal must handle a
`Job` that fails before any stage reports — `fake.ts` can produce this" is an instruction.

Append; never rewrite history. A superseded entry gets a follow-up entry, not an edit.

---

## Entries

| Date | Found by | Affects | What changed, and what to do about it |
| --- | --- | --- | --- |
| 2026-09-07 | Planning | FR0 | The seam `fake.ts` was to sit behind **does not exist**. `api.get<T>(path)` is verb-shaped, so no fake can implement it in a way tsc checks. Inventing the `ApiClient` interface is FR0 task 1, not task 3. |
| 2026-09-07 | Planning | FR0 | `env.ts` throws at startup on missing AWS vars, so a fresh clone dies on boot in fake mode. FR0 makes them conditional on `VITE_API_MODE`. |
| 2026-09-07 | Planning | FR1 | The brief names `grade-tokens.ts`, `Meter`, `RatingButtons`, `DiagnosticPage` as ramp consumers. **Only `SessionSummary.tsx` imports the module**; the others reach the ramp through Tailwind classes (`bg-grade-again`) defined in `globals.css`. Re-deriving the palette must cover the CSS custom properties, not just the TS. `DiagnosticPage.tsx` is at `src/features/plan/`, not `src/features/mastery/`. |

_(Append below. Do not delete rows.)_
