# 5. The test suite is deleted; `check` is the only gate

**Status:** Accepted · **Date:** 2026-09-05 · **Amends:** [ADR 0002](0002-two-tier-verification.md)

## Context

ADR 0002 split verification into a fast per-commit gate and a slower checkpoint gate, and
deferred *writing* new tests to checkpoints while keeping the existing 31 suites (359
tests) running in `verify` and in CI.

The owner's instruction on 2026-09-05 goes further: **delete the suite entirely.** The
priority through the AWS-native build is fast, token-cheap iteration, and a full suite is
to be written later, at a checkpoint, once the shape of the system has settled.

The context that makes this less reckless than it sounds: `AWS-NATIVE-BRIEF.md` plans to
replace the entire backend — Supabase Auth to Cognito, Postgres possibly to Aurora, Edge
Functions to Lambda. A large share of the deleted suite tested exactly the things that
migration will delete or rewrite. `rls.test.ts` asserts policies written against
`auth.uid()`; the PGlite harness boots a Supabase-shaped schema. Maintaining those through
the migration means paying to keep tests green for a backend being dismantled.

That argument is real, and it is also not the whole picture. It was raised at the time
along with the recommendation to keep `rls.test.ts`, and the owner chose to delete
everything. That is a legitimate call: it is their project, their risk, and the reasoning
above is genuinely on their side.

## Decision

Delete all 31 suites, the `src/test/` harness, `vitest.config.ts`, and the test
dependencies (`vitest`, `jsdom`, `@electric-sql/pglite`, `@testing-library/*`).

**`npm run check` is the gate.** Typecheck plus eslint on changed files, ~15s.

**`npm run verify` survives** as the checkpoint and CI gate — typecheck, repo-wide lint,
production build, and a Deno typecheck of the Edge Function. It runs no tests.

Do not add tests, and do not add a test runner, until the owner asks for a suite. The
prohibition is explicit because the failure mode is not a decision to re-add testing — it
is a session reaching for `vitest` out of habit to check one function, and the suite
growing back by accretion in whatever shape the first accident chose.

## Consequences

Iteration gets fast: 15s per commit, no 87-second suite, no test output consuming context.
For a phase whose job is exploring a migration's shape, most of what the suite asserted
was about to change anyway.

**What is now unverified, stated plainly, because nothing else in the repo will say it:**

- **RLS.** `CLAUDE.md` calls it the entire security boundary. `rls.test.ts` proved a user
  could not read another user's decks. That proof is gone; the policies still exist and
  are still forced, but nothing checks them. The Cognito migration is precisely the change
  most likely to break per-user isolation silently.
- **Migrations.** PGlite ran every migration before it reached the live database. `db:push`
  is now a sharp tool with no rehearsal — only a dry-run and careful reading.
- **FSRS scheduling.** The one part of the product that must be numerically right, and the
  part where a wrong answer looks plausible. `fsrs.test.ts` simulated a week and checked
  the intervals.
- **The env-schema refusal.** `src/lib/env-schema.ts` still refuses to boot on a
  `sb_secret_…` key; the test proving it does is gone.

Because of this, **honesty in reporting becomes load-bearing.** With a green suite, "it
works" was a claim backed by something. It no longer is. Sessions must say "typechecks and
builds" and must not say "tested" or "verified" — and where a change is risky and
unprovable, must say that instead of letting a green gate imply more than it covers.

**When the suite is rebuilt**, the order that recovers the most safety per test is: RLS
policies, FSRS scheduling, migration harness, then everything else. Recovering it is a
real cost — the PGlite harness in particular was non-trivial to build — and that cost is
the honest price of the speed being bought here. It is recoverable from git history rather
than from scratch, which is what makes the trade reversible:

```bash
# 0bdc858 is the last commit with the suite intact (31 suites, 359 tests).
git checkout 0bdc858 -- src/test vitest.config.ts
git show 0bdc858:package.json   # for the removed devDependencies
```
