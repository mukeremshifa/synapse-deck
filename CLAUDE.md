# Project rules

Read this before doing anything in this repo.

Then read [docs/AGENTS.md](docs/AGENTS.md) — this file is the hard constraints, that one
is how to work here efficiently. Architectural decisions and their reasoning are in
[docs/adr/](docs/adr/).

## Git — hard constraints

**`dev` is yours. `main` is not. That is the whole rule.**

Revised 2026-09-05. The previous version required the owner for every push and merge,
which made sense when one person typed every commit and became pure friction once agents
did the work. The constraint that actually matters was never "ask before pushing" — it is
**production must not move without a human deciding it should**. So the freedom is now
wide on `dev` and absolute on `main`.

| Action                                              | Who               |
| --------------------------------------------------- | ----------------- |
| Commit / push / merge on `dev`                      | ✅ Claude         |
| Create, push, merge, delete topic branches off `dev` | ✅ Claude         |
| Force-push a **topic branch you created**           | ✅ Claude         |
| **Anything at all touching `main`**                 | ❌ **Owner only** |
| Opening PRs                                         | ❌ **Owner only** |
| Force-push or rewrite history on `dev`              | ❌ **Owner only** |
| Deleting or rewriting anything on the remote        | ❌ **Owner only** |

**On `dev`, act.** Commit, push, merge your topic branches, delete them when merged. Do
not ask permission and do not offer to push — just do it and say what you did. CI runs
`verify` on every push, which is the safety net that makes this safe.

**On `main`, stop.** It is frozen at `0bdc858`, the v1 + AWS-brief state, and it is
production. It moves only when the owner moves it, only at a checkpoint. Do not merge into
it, do not push to it, do not offer to, do not ask. If work seems to need `main` to move,
**say so and stop** — that is a decision, not a task.

`main` is also protected server-side: required status checks, one approving review, and
admin enforcement. A push from a session will be rejected by GitHub, which is intended
rather than an obstacle to route around.

**PRs stay with the owner.** They are a human review surface; an agent opening and merging
its own PR is ceremony that reviews nothing. Merge into `dev` directly.

Topic branches off `dev` are yours whenever the work warrants one — speculative work
(`spike/`), work spanning several sessions, or when another agent is on `dev`. Anything
smaller goes straight to `dev`. See [ADR 0003](docs/adr/0003-branching-model.md), and
[ADR 0004](docs/adr/0004-dev-autonomy-main-frozen.md) for why this changed.

**`supabase db push` is not a git push and is not covered by any of the above.** See below.

## Documentation

- `docs/SPEC.md` — what the product is, and why each decision was made. The source of
  truth for scope. Update it when a decision changes; do not let code and spec drift.
- `docs/plans/` — one execution plan per phase. `docs/plans/README.md` holds the board and
  the convention. Only the next phase gets a detailed plan; the last task of every plan is
  to write the next one.

Respect the phase boundaries. If something belongs to a later phase, it goes in that
phase's plan, not into the current commit — even when it would take five minutes now.

## Database

- Migrations are plain SQL in `supabase/migrations`, applied in filename order. Never edit
  a migration that has been pushed; add a new one.
- **`npm run db:push` is allowed, and expected, when a plan's work needs it.** A phase that
  writes a migration is not finished while the schema only exists on disk: the types cannot
  be regenerated, so `src/types/database.ts` has to be hand-written, and every later session
  inherits that drift. Applying it is part of the work, not a deployment.

  Push it, then immediately `npm run db:types` and commit the regenerated file. Check the
  result: Postgres cannot express argument nullability, so a function parameter that accepts
  null is generated as non-null — cast at the call site and say why, rather than inventing a
  value. Run `npm run db:pg-version` afterwards if anything about the environment changed.

  Still the owner's alone: PRs and anything touching `main`. Those are about the shared
  repository; the database is this project's own schema.

  **The safety net that used to precede this is gone.** PGlite ran every migration before
  it reached the live database; the suite was deleted on 2026-09-05 (ADR 0005), so nothing
  now checks a migration except you reading it. Treat `db:push` as the sharp tool it has
  become:

  1. `npx supabase db push --linked --dry-run` first, every time. Read what it lists — if
     it names a migration you did not write, stop and ask.
  2. Read your own SQL again before pushing. There is no second opinion.
  3. If the migration is destructive or you are unsure, **ask the owner** rather than
     pushing and finding out.

- Destructive database operations are **not** covered by that. `supabase db reset`, dropping
  a table, deleting rows in the live project: ask first, every time.
- Migrations are **no longer verified anywhere before they reach the live database.** The
  PGlite harness that did that was deleted with the suite (ADR 0005). `supabase/pg-version.json`
  still records the expected Postgres major and `npm run db:pg-version` still compares it
  against the live project, but the test that enforced it is gone — run it by hand when
  anything about the environment changes.
- **RLS is the security boundary on Supabase, and Supabase only.** Every table there keeps
  its owner-only policy set plus `force row level security`. That project is still live
  and still serves `/progress` and generation until Phase F, so this rule still binds
  anything you add there.

### Tenancy on RDS — weaker than what it replaced, and say so

**RLS is retired on the AWS side** (P9, [ADR 0008](docs/adr/0008-application-level-tenancy.md)).
`services/api/migrations/` has no policies, because RDS has no `auth.uid()` and no
`authenticated` role to write them against.

Understand what changed before you write a query:

> On Supabase, a query that forgets `where user_id = …` returns **nothing** — the database
> refuses. On RDS, that same query returns **every user's rows**.

The boundary moved into `services/api/src/data/`. Four rules hold it up. All four are
mandatory, and none is a style preference:

1. **`userId` is the required first parameter** of every exported data-access function.
   Never optional, never defaulted — a default is how a bug becomes silent.
2. **Every statement includes `where user_id = $1`**, including single-row fetches by
   primary key. A card id is not a capability.
3. **No SQL outside `services/api/src/data/`.** Handlers read `sub` from the authorizer,
   call the data layer, and map errors. They never build a query.
4. **`userId` comes only from the verified JWT.** Never a request body, never a query
   parameter, never a client-set header.

`scripts/check-data-access.mjs` enforces 1 and 3 in `verify`. It **cannot** enforce 2 or
4: it checks the shape of the code, not its meaning, so a function that takes `userId` and
ignores it passes every gate in this repository.

**This is weaker than RLS and you should not treat it as equivalent.** RLS was a guarantee;
this is a discipline with a linter behind it. Nothing proves cross-tenant isolation holds —
the test that did was deleted with the suite. **A new table on RDS without a data-access
module that follows all four rules is a cross-tenant leak, not a TODO.**

## AWS — `infra/`

Added at P8, the first phase of the AWS-native build
([the brief](docs/plans/AWS-NATIVE-BRIEF.md)). `infra/` is CDK in TypeScript, two stacks,
region `us-east-1`.

| Action                                          | Who               |
| ----------------------------------------------- | ----------------- |
| `npm run infra:synth` / `infra:diff`            | ✅ Claude         |
| `npm run infra:deploy` (the **dev** stack)      | ✅ Claude         |
| `npm run infra:deploy:prod`                     | ❌ **Owner only** |
| `cdk destroy`, anything deleting infrastructure | ❌ **Owner only** |
| `cdk bootstrap`, IAM roles, the OIDC provider   | ❌ **Owner only** |

`infra:deploy` on dev is allowed the way `db:push` is allowed: a phase that writes a stack
is not finished while it exists only on disk. **`cdk diff` first, every time, and read what
it lists** — there is no test suite behind CDK either, so `check` proving the code compiles
says nothing about whether the template is right. If the diff is destructive or you are
unsure, ask.

**No AWS credential ever enters the repository.** CI assumes a role via GitHub OIDC; there
are no long-lived access keys to leak. The account id and the deployed function URL stay in
the owner's notes, not in git.

Nothing in `infra/` may declare a TypeScript `enum` — CDK runs under
`--experimental-strip-types`, which rejects it. Consuming CDK's own enums is fine. See
`infra/README.md`.

## Keys

- Modern Supabase key mode only: `sb_publishable_…` client-side, never `sb_secret_…`.
  The legacy `anon` / `service_role` JWTs are not used.
- The secret key maps to `service_role` (`BYPASSRLS`) and must never appear in client env,
  the repo, or a build. `src/lib/env-schema.ts` refuses to boot if it finds one; that
  refusal was tested until the suite was deleted (ADR 0005), so that file is now the only
  thing enforcing it. Do not weaken it.
- Provider API keys (e.g. Groq) live only as Edge Function secrets.

## Code

- TypeScript, strict, with `noUncheckedIndexedAccess`.
- Card content is untrusted LLM output: render it as text. `dangerouslySetInnerHTML` is
  blocked by an ESLint rule — do not disable it.
- One Zod definition per concept, in `src/lib/schemas.ts`, shared by client and Edge
  Function. Do not redefine a card shape anywhere else.

## Verification — `check` is the gate

| Command          | Cost | When                                                          |
| ---------------- | ---- | -------------------------------------------------------------- |
| `npm run check`  | ~15s | **Before every commit.** Typecheck + eslint on changed files.  |
| `npm run verify` | ~45s | At a checkpoint and in CI. Whole-repo lint, typecheck, build.  |

**Never commit with a failing `check`.** If it fails and you cannot fix it, leave the work
uncommitted and say so.

### There are no tests

**The suite — 31 suites, 359 tests — was deleted on 2026-09-05** at the owner's
instruction, to prioritise fast, token-cheap development through the AWS-native build.
See [ADR 0005](docs/adr/0005-no-test-suite.md).

Do not write tests. Do not add a test runner, and do not reintroduce one incidentally by
reaching for `vitest` out of habit — `vitest`, `jsdom`, `@testing-library/*` and
`@electric-sql/pglite` were all removed from `package.json` deliberately. A new suite gets
written in one deliberate pass at a checkpoint, when the owner says so.

**Know what this costs, and say so honestly.** Nothing verifies behaviour now. `check` and
`verify` prove the code compiles, lints and builds; they cannot tell you an FSRS interval
is right, an RLS policy still isolates users, or a migration does what it claims. When
reporting work, say "typechecks and builds" — never "tested", "verified" or "works".

This raises the stakes on three things in particular, all of which are now unguarded:

1. **Migrations** — `npm test` used to run them against PGlite before they reached the
   live database. That check is gone. Read the SQL yourself, and use
   `npx supabase db push --linked --dry-run` before every push.
2. **RLS** — still the entire security boundary, now with nothing proving it holds.
3. **Key handling** — `src/lib/env-schema.ts` still refuses to boot on a secret key, but
   the test that proved the refusal is gone. Do not weaken that file.
