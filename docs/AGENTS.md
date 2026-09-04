# Working in this repo as an agent

`CLAUDE.md` is the rulebook — hard constraints, non-negotiable. This file is the
_working manual_: how to be fast here without being sloppy. Read `CLAUDE.md` first;
nothing here overrides it.

---

## 1. Two gates, and why

There are exactly two commands you need, and knowing which to run is most of the skill.

| Command          | Cost  | When                                                             |
| ---------------- | ----- | ---------------------------------------------------------------- |
| `npm run check`  | ~15s  | **Before every commit.** Always. No exceptions.                  |
| `npm run verify` | ~130s | At a **checkpoint** — end of a phase, before you ask for a merge |

`check` is typecheck plus eslint on the files you actually changed. It is scoped on
purpose: repo-wide eslint costs ~39s while eslint on four files costs ~3s, and the
typecheck is what catches the errors that break a build anyway.

`verify` is everything: typecheck, repo-wide lint, all 359 tests, production build.

**Why the split.** The v1 phases were built with a test-first discipline and it paid —
31 suites, RLS verified against real Postgres. But running 87 seconds of tests after
every small edit buys nothing when the edit was a copy change, and the tokens spent
reading that output are tokens not spent on the work. So: the fast gate runs constantly,
the full suite runs at boundaries where it can actually catch regression.

**This is a trade, and it has a cost.** Between checkpoints, a regression in an untested
path can survive several commits. That is acceptable while iterating and is not
acceptable at a merge, which is exactly why `verify` gates the merge.

### Tests, during the fast phase

The standing instruction is: **do not write new tests until a checkpoint.** When you
reach one, write the suite for everything the phase added, in one pass.

Three exceptions, because they cost minutes and save hours:

1. **A migration.** `npm test` runs migrations against PGlite. An untested migration
   that reaches the live database is the one mistake here with no cheap undo.
2. **A security boundary.** New RLS policy, anything touching key handling. `CLAUDE.md`
   is explicit that RLS is the entire security boundary.
3. **A bug you just fixed.** Write the test that would have caught it, then and there —
   that is the one moment the failure is fully understood.

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
src/lib/          pure logic — fsrs, schemas, queue, quota. Tests are cheap here.
src/features/     one directory per product area; screens live with their logic
src/app/          shell — routing, providers, theme, error boundary
src/components/   shadcn primitives in ui/, shared bits above it
src/test/         PGlite-backed db tests (migrations, RLS, RPCs)
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
- **Postgres majors must match** between PGlite and production — `npm run db:pg-version`.
- **`sb_secret_…` must never reach client env.** `src/lib/env-schema.ts` refuses to boot
  if it finds one, and that refusal is tested. Do not weaken it.

---

## 8. What is the owner's alone

Merging, pushing, PRs, anything touching `main` or a remote. Do not offer. Do not ask
"shall I merge this?". Commit to `dev`, then say what remains.
