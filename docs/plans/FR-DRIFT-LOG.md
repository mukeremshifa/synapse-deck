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
| 2026-09-08 | FR0 | FR6, FR2 | **`/progress` does not exist.** It was removed before FR0, so three of the four Supabase stats hooks had no consumer and the fourth (`useReviewHistory`) served one number on `DashboardPage`. FR0's task-5 options both assumed the route. All four hooks were **deleted**, not re-pointed; the aggregates now live on `ApiClient` as `getReviewHistory` / `getDueForecast` / `getCardStates` / `getRetention`, **notebook-scoped**. FR6 builds the overview from those four and must not look for `queries.ts` hooks. |
| 2026-09-08 | FR0 | FR2 | The dashboard's **streak card was removed**, not left loading: `streaks()` needs day-bucketed history that only the Supabase RPC had, and `value={null}` renders a permanent skeleton. FR2's home screen gets the streak from `getGlobalSummary().streakDays`, which exists in the contract and works in fake mode. In `live` mode it returns 0 — the AWS `/summary` route has no streak, and adding one is FR7's. |
| 2026-09-08 | FR0 | FR2–FR6 | **The contract is paginated.** `listNotebooks`, `listSources`, `listArtifacts`, `listCards` and `listAttempts` return `Page<T>` (`{ items, nextCursor }`), not arrays. The brief did not settle this; FR0 decided it, because a list that would page at FR7 must page now or every screen is designed having never seen a second page. Every consuming hook reads `.items`. |
| 2026-09-08 | FR0 | FR2, FR5 | **`getGlobalSummary` is the one cross-notebook method**, for the home strip (§3.5). Its rule, in the contract's doc comment: **nothing on it may become a CTA** — a button there would have to pick a notebook, which is the `focus` guess the re-architecture deletes. Every action lives on a notebook card. |
| 2026-09-08 | FR0 | FR4 | **`fake.configure({ failNextJob: { at: 'immediately', code } })` is the case to design for first.** A job can fail before any stage reports, with `unitsTotal` still 0 — a quota refusal does exactly this. That is *not* the same as "no progress yet", and a progress surface that renders them identically is wrong. Also available: `latencyMs`, `failNext`, `failAlways`, `jobDurationMs`, `truncateNextJob`. |
| 2026-09-08 | FR0 | FR3, FR5, FR6 | **A dangling `sourceId` is live in the fixtures.** `art-deck-abx` names `src-pharm-deleted`, which `listSources` does not return, and a note block in `art-notes-resistance` cites it too. **Render provenance from `sourcesSnapshot`** (complete, never dangles); use `sourceIds` only to *link*. Code that resolves ids against `listSources` and assumes a hit will throw. |
| 2026-09-08 | FR0 | FR7 | **`client.ts` throws `not_implemented` for everything the live backend lacks** — sources, artifacts, questions, attempts, note sets, and all four aggregates. FR0 §6.3 tabulates them and that table is FR7's build list. FR7 also deletes the synthetic-artifact translation in `client.ts`, where a notebook's own id doubles as its implicit deck's id. |
| 2026-09-08 | FR0 | all | **Auth is lazy now.** `cognito.ts` builds its user pool on first use, not at module load, because the Cognito variables are absent in fake mode. A missing variable therefore fails at first sign-in rather than at boot. Nothing in FR1–FR6 should need to sign in; if a phase does, it needs `VITE_API_MODE=live` and a real `.env.local`. |

_(Append below. Do not delete rows.)_
