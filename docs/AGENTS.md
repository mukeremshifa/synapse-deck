# Working in this repo as an agent

`CLAUDE.md` is the rulebook — hard constraints, non-negotiable. This file is the
_working manual_: how to be fast here without being sloppy. Read `CLAUDE.md` first;
nothing here overrides it.

---

## 1. The gate

There are exactly two commands you need, and one of them is the everyday one.

| Command          | Cost | When                                                          |
| ---------------- | ---- | -------------------------------------------------------------- |
| `npm run check`  | ~15s | **Before every commit.** Always. No exceptions.               |
| `npm run verify` | ~45s | At a **checkpoint**, and in CI on every push.                  |

`check` is typecheck plus eslint on the files you actually changed. It is scoped on
purpose: repo-wide eslint costs ~39s while eslint on four files costs ~3s, and the
typecheck is what catches the errors that break a build anyway.

`verify` adds repo-wide lint, a production build, and a Deno typecheck of the Edge
Function — the one part of the codebase tsc and eslint both skip.

### There are no tests

The suite (31 suites, 359 tests) was **deleted on 2026-09-05** at the owner's instruction,
to keep development fast and token-cheap through the AWS-native build. See
[ADR 0005](adr/0005-no-test-suite.md).

**Do not write tests, and do not add a runner.** `vitest`, `jsdom`, `@testing-library/*`
and `@electric-sql/pglite` were removed from `package.json` on purpose; reaching for one
out of habit reintroduces what was deliberately taken out. A suite gets written in one
pass at a checkpoint, when the owner asks for it.

**Be honest about what this means.** Both gates prove the code compiles, lints and builds.
Neither proves it works. Say "typechecks and builds" — not "tested", "verified" or
"works". If a change is risky and you cannot prove it is right, say that plainly instead
of implying a gate covered it.

Three things are now completely unguarded and deserve extra care:

1. **Migrations** — PGlite used to run every one before it reached the live database.
   Nothing does now. Dry-run, and re-read your own SQL.
2. **RLS** — still the entire security boundary, with nothing proving it holds.
3. **Key handling** — `src/lib/env-schema.ts` still refuses to boot on a secret key; the
   test proving that refusal is gone. Do not weaken it.

---

## 2. Before you start

```bash
git branch --show-current    # must be dev, or a topic branch off dev
git status                   # must be clean
```

If it is not `dev` or a topic branch off it, stop and ask. `CLAUDE.md` is unambiguous
about this and it is the constraint most likely to be broken by accident.

---

## 3. The loop

```
read the plan  →  change code  →  npm run check  →  commit  →  repeat
                                       ↑                          │
                                       └──── fails? fix, rerun ────┘

                        ... at a checkpoint: npm run verify
```

**Commit small and often.** A commit per coherent change, not per session. On this
branching model, `dev` is the working branch and its history is allowed to be granular —
`main` is where the curated story lives.

**Never commit with a failing `check`.** If it fails and you cannot fix it, say so and
leave the work uncommitted rather than committing something broken.

---

## 4. Token discipline

The point of the fast gate is to spend tokens on work rather than on output. The same
logic applies to everything else you do:

- **Read narrowly.** `grep` for the symbol; read the function, not the file. Whole-file
  reads of 500-line modules are the single biggest avoidable cost in this repo.
- **Do not re-read what you just wrote.** The tools error on failure; a silent success
  is a success.
- **Do not paste command output back.** Summarise it. Nobody needs 40 lines of vite
  build output in the transcript — `verify` already prints pass or fail.
- **Batch independent commands** into one call rather than one per turn.
- **Trust the docs.** `SPEC.md` says what the product is and why. Re-deriving a decision
  that is already written down is pure waste — and if you disagree with one, say so
  rather than quietly doing something else.

---

## 5. Where things are

```
src/lib/          pure logic — fsrs, schemas, queue, quota
src/features/     one directory per product area; screens live with their logic
src/app/          shell — routing, providers, theme, error boundary
src/components/   shadcn primitives in ui/, shared bits above it
supabase/         migrations (plain SQL, filename order) + Deno edge functions
docs/SPEC.md      what and why. The source of truth for scope.
docs/plans/       one plan per phase; README.md is the board
docs/adr/         one file per architectural decision (see §6)
```

**One Zod definition per concept**, in `src/lib/schemas.ts`, shared by client and Edge
Function. Do not redefine a card shape anywhere else — this is in `CLAUDE.md` and it is
the rule most often broken by a session that did not look first.

---

## 6. Recording decisions

Phase plans in `docs/plans/` are execution: ordered tasks, acceptance criteria.

ADRs in `docs/adr/` are architecture: one file per decision that is expensive to
reverse. Write one when choosing between two viable designs, when the reason for a
choice will not be obvious in six months, or when reversing it would mean a migration.
Do not write one for a decision that documents itself in code.

Format is `NNNN-short-title.md`; see `docs/adr/0001-record-architecture-decisions.md`.
The AWS work ahead is exactly the kind of thing this exists for.

---

## 7. Things that will bite you

- **`npm run db:push` is allowed and expected** when a plan needs it — it is not a
  `git push`. Dry-run first, then `npm run db:types`, then commit the regenerated file.
  See `CLAUDE.md` for the full procedure.
- **Destructive database operations are not covered by that.** `db reset`, dropping a
  table, deleting live rows: ask first, every time.
- **Never edit a pushed migration.** Add a new one.
- **`dangerouslySetInnerHTML` is blocked by eslint** because card content is untrusted
  LLM output. Do not disable the rule. `check` catches this.
- **Postgres major** is recorded in `supabase/pg-version.json`; `npm run db:pg-version`
  compares it against the live project. The test that enforced this is gone — run it by
  hand when the environment changes.
- **`sb_secret_…` must never reach client env.** `src/lib/env-schema.ts` refuses to boot
  if it finds one. The test that proved the refusal is gone, so the file itself is now the
  only thing standing there — do not weaken it.

---

## 8. `dev` is yours; `main` is not

**On `dev`: act.** Commit, push, merge your topic branches, delete them when merged. Do
not ask and do not offer — just do it and say what you did. CI runs `verify` on every
push, and that is what makes it safe.

**On `main`: nothing.** It is frozen at the v1 + AWS-brief state and it is production. No
merge, no push, no offer, no question. If work seems to need `main` to move, say so and
stop — that is the owner's decision, not a task.

PRs are the owner's too. An agent opening and merging its own PR is a review trail with no
review in it; merge into `dev` directly instead.

Rewriting history on `dev` (force-push, rebase) is owner-only — it can destroy another
session's work and is not recoverable from the remote. A topic branch you created
yourself is exempt.

See [ADR 0004](adr/0004-dev-autonomy-main-frozen.md) for why this changed.
