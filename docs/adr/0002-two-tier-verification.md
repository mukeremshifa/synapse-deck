# 2. Two-tier verification: a fast gate per commit, a full gate per checkpoint

**Status:** Accepted, amended by [ADR 0005](0005-no-test-suite.md) · **Date:** 2026-09-05

> **Amended the same day.** The two-gate shape below still holds — `check` per commit,
> `verify` at a checkpoint — but **the test suite it was built around no longer exists.**
> It was deleted on 2026-09-05; `verify` now runs typecheck, repo-wide lint, a production
> build and a Deno check of the Edge Function, and no tests. Everything below about test
> timings, the PGlite/jsdom split, and deferring tests to checkpoints is kept as the record
> of why the split was shaped this way, not as a description of what runs today.

## Context

`CLAUDE.md` has required, since P0, that four commands pass before work is called done:

```
npm run typecheck && npm run lint && npm test && npm run build
```

Measured on this machine, that is:

| Step      | Cost     |
| --------- | -------- |
| typecheck | 22s      |
| lint      | 39s      |
| test      | 87s      |
| build     | 22s      |
| **total** | **~170s** |

Three minutes per commit is affordable at one commit an hour. It is not affordable at the
cadence this project is moving to, where most sessions are agent-driven and a commit may
be a copy change or a single extracted function. The cost is not only wall-clock: every
run pours output into a context window that has better uses, and the marginal information
from re-running 359 tests after a Tailwind class change is approximately zero.

The naive fix — drop the tests — throws away the thing that makes this repo trustworthy.
RLS is the entire security boundary here, and it is verified against real Postgres in
WASM. Losing that to save two minutes would be a bad trade at any speed.

## Decision

Two gates, with different jobs.

**`npm run check` (~15s) — before every commit.**
Typecheck across the project, plus eslint scoped to changed files.

**`npm run verify` (~130s) — at checkpoints and in CI.**
Typecheck, repo-wide lint, the full suite, production build.

Three measurements drove the shape:

1. **Repo-wide lint costs more than the typecheck** (39s vs 22s) and almost all of it is
   re-linting files the commit never touched. Scoping to changed files takes it to ~3s
   and loses nothing, because `verify` lints everything before a merge.

2. **The typecheck cannot be scoped.** The error you care about is the one your change
   caused three modules away. It stays whole-project in both gates.

3. **The test suite is 30 seconds slower than the sum of its parts.** All 31 suites
   together take 87s; `src/test/**` alone takes 26s and everything else 31s. The gap is
   contention — ten PGlite instances compiling and booting Postgres-in-WASM at the same
   moment Vitest is constructing jsdom environments in sibling workers. `verify` runs the
   two groups in sequence and gets ~57s of testing for ~87s of work.

Alongside this, new tests are deferred to checkpoints rather than written per-commit,
with three exceptions that keep the cheap-to-lose things safe: **migrations**, **security
boundaries**, and **a regression test for a bug just fixed**. The full rationale is in
`docs/AGENTS.md §1`.

## Consequences

The per-commit gate drops from ~170s to ~15s, and still catches every type error and
every lint violation in the code actually being written — including the
`dangerouslySetInnerHTML` ban, which is a real security rule and now fails in about three
seconds instead of forty.

**The honest cost:** between checkpoints, a regression in a path with no type-level
expression can survive several commits. Nothing here catches a broken FSRS interval or an
RLS policy that got too permissive — only the suite does, and it now runs at boundaries
rather than continuously. This is a deliberate trade of _latency to detection_ for
_iteration speed_, and it is only sound because `verify` gates the merge and CI runs it
on every push. If a regression ever does reach `main`, the answer is to move the gate,
not to blame the trade.

A second cost worth naming: `check` passing is now weaker than the old four-command
ritual, and someone reading a green `check` should not conclude the app works. The names
were chosen with that in mind — "check" is not "verify".
