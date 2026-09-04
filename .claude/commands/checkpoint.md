---
description: Full verification, write the deferred tests, and update the docs
---

A checkpoint is where the deferred work comes due. Between checkpoints the fast gate
trades test latency for speed (ADR 0002); this is where that debt is paid.

Work through these in order.

### 1. Write the tests that were deferred

Look at what has landed since the last checkpoint:

```bash
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~15")..HEAD
```

For each meaningful behaviour added, write the test that would catch its regression.
Prioritise, in this order:

- anything touching a **migration, RLS policy, or key handling** — non-negotiable
- **pure logic** in `src/lib/` — cheapest tests in the repo, highest value
- **component behaviour** that encodes a product rule, not markup shape

Do not chase coverage. A test that asserts a `div` has a class is a liability; a test
that asserts an FSRS interval is correct is why this suite exists.

### 2. Run the full gate

```bash
npm run verify
```

Everything must be green: typecheck, repo-wide lint, all suites, production build.

### 3. Update the docs

- `docs/SPEC.md` — if a product decision changed. Code and spec must not drift.
- `docs/plans/README.md` — the board.
- `docs/adr/` — an ADR for any architectural decision made since the last checkpoint
  that is expensive to reverse.

### 4. Commit, and stop

Commit the tests and doc updates. Then report: what was verified, what tests were added,
what changed in the docs, and what remains.

**Do not merge. Do not push. Do not offer to.** That is the owner's, always. If the work
is ready for `main`, say so and leave it.
