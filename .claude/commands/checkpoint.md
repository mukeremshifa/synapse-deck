---
description: Full verification and doc updates at a phase boundary
---

A checkpoint is the boundary where the whole repo gets checked, not just what you touched.

### 1. Run the full gate

```bash
npm run verify
```

Typecheck, repo-wide lint, production build, and the Deno check of the Edge Function.
Everything must be green.

**It runs no tests** — there are none (ADR 0005). A green `verify` means the code
compiles, lints and builds. It does not mean the app works, so do not report it as though
it does.

### 2. Sanity-check the app by hand

Since nothing verifies behaviour automatically, the checkpoint is where a human-visible
check earns its keep. If the phase touched a user-facing path, run `npm run dev` and
actually exercise it — or, if you cannot, say plainly which paths went unverified so the
owner knows what to look at.

### 3. Update the docs

- `docs/SPEC.md` — if a product decision changed. Code and spec must not drift.
- `docs/plans/README.md` — the board.
- `docs/adr/` — an ADR for any architectural decision made since the last checkpoint that
  is expensive to reverse.

### 4. Commit and push

Commit the work and doc updates, then push to `dev`. No permission needed (ADR 0004).

### 5. Stop at `main`

Promoting a checkpoint to production is the owner's decision, and `main` is frozen until
they make it. Do not merge into `main`, do not push to it, do not offer. If this
checkpoint looks ready, say so plainly and leave it.

Then report: what was verified, what was **not** verified, what changed in the docs, and
what remains.

### If the owner asks for tests

The suite was deleted deliberately and comes back in one deliberate pass, not by
accretion. If asked to rebuild it, start with what is riskiest and least visible: RLS
policies, FSRS scheduling, and the migration harness — in that order.
