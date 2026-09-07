# FR7 — The backend rebuild

**Status:** 📋 Planned 2026-09-07, before FR0 executed. Not started.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) §2.3, §4.
**Depends on:** [FR6](FR6-the-overview.md) complete, **and its §8 build list written.**

> **This is the only FR phase that touches `services/api/`, `infra/` and the migrations.**
> Every earlier phase was forbidden from doing so. Read this whole file before starting;
> the constraints here are heavier than anywhere else in the sequence, and two of them are
> security boundaries.

---

## 1. Preconditions

```bash
npm run check && npm run verify        # both pass
npm run dev                            # fake mode, every surface works
```

**And the one that actually gates this phase:** [FR6](FR6-the-overview.md) §8 exists and is
complete. It is the build list. **If it is thin, stop and reconstruct it from
`contract.ts` before writing SQL** — discovering missing endpoints halfway through a schema
rewrite is how this phase goes wrong.

## 1b. Reconcile — first, before any code

Read **the whole** [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md), not just rows naming FR7. Six phases
of decisions land here, and the ones that will bite are the ones nobody flagged as
affecting you.

Then read, in order: `src/lib/api/contract.ts` (**the specification — it, not the brief, is
the truth by now**), FR6 §8, and FR0 §6.3's `not_implemented` table.

---

## 2. Out of scope

| Tempting | Where it goes |
| --- | --- |
| Redesigning any frontend surface | Done. FR7 makes the backend serve what exists |
| "Improving" the contract while implementing it | If it is wrong, **say so and stop** — changing it silently desynchronises six phases of work |
| Touching `main` | **Owner only. Always.** |
| Opening a PR | **Owner only** |
| Tests | Still none ([ADR 0005](../adr/0005-no-test-suite.md)) unless the owner asks |
| Deleting the Supabase project | Separate decision. FR0 removed the *client*; the project is the owner's to retire |

---

## 3. The rules this phase runs under

Four, and unlike earlier phases these are not stylistic.

### 3.1 Tenancy — weaker than what it replaced

**RLS is retired on RDS** ([ADR 0008](../adr/0008-application-level-tenancy.md)). There is
no `auth.uid()` and no `authenticated` role to write policies against.

> On Supabase, a query that forgets `where user_id = …` returns **nothing**.
> On RDS, that same query returns **every user's rows**.

Four rules hold the boundary up. All four are mandatory, and **every new table this phase
creates needs all four**:

1. **`userId` is the required first parameter** of every exported data-access function.
   Never optional, never defaulted.
2. **Every statement includes `where user_id = $1`** — including single-row fetches by
   primary key. A card id is not a capability.
3. **No SQL outside `services/api/src/data/`.**
4. **`userId` comes only from the verified JWT.** Never a body, query parameter or header.

`scripts/check-data-access.mjs` enforces 1 and 3 in `verify`. **It cannot enforce 2 or 4** —
it checks the shape of the code, not its meaning.

> **A new table on RDS without a data-access module following all four rules is a
> cross-tenant leak, not a TODO.** This phase creates many new tables.

### 3.2 Migrations are unguarded

The PGlite harness that ran every migration before it reached the live database was deleted
with the suite ([ADR 0005](../adr/0005-no-test-suite.md)). Nothing checks a migration now
except you reading it.

- **`npx supabase db push --linked --dry-run` first, every time.** If it names a migration
  you did not write, **stop and ask.**
- **Never edit a pushed migration.** Add a new one.
- **Destructive operations — dropping a table, deleting live rows, `db reset` — ask the
  owner first, every time.** This phase is a schema *rewrite*, so this will come up.

### 3.3 The contract is the specification

`contract.ts` is what the API must serve. Where the backend cannot serve it, the honest
move is to **say so and stop**, not to bend the contract — six phases of frontend are built
on it.

### 3.4 Infrastructure

`cdk diff` **first, every time, and read what it lists.** `infra:deploy` on **dev** is
allowed; `infra:deploy:prod`, `cdk destroy`, `cdk bootstrap` and IAM are **owner only**.
**No AWS credential enters the repo.** Nothing in `infra/` may declare a TypeScript `enum`.

---

## 4. Tasks

Ordered so nothing is destructive before its replacement exists.

### Task 1 — The schema

New migrations in `services/api/migrations/` for the contract's nouns: `notebooks`,
`sources`, `artifacts` (kind-tagged), `topics` (notebook-scoped), `attempts`, plus
`cards`/`reviews`/`answers` re-parented.

The four real entities today are `cards`, `reviews`, `topics`, `answers`. Everything else in
the contract is genuinely new. Note what the old schema recorded about itself —
`0008_answers.sql:89`: *"there is no `exams` table, because an exam is currently assembled
in the browser"* — that is the gap this closes.

**Migration, not just creation.** Existing data has notebooks-as-decks. Decide and record:
migrate it, or start clean. Starting clean is defensible for a pre-launch product; **it is
still a decision, and if it means dropping live tables, it is the owner's.**

### Task 2 — The data-access layer

One module per table in `services/api/src/data/`, all four §3.1 rules, no exceptions.
`check-data-access.mjs` catches two of them; **you are the only thing catching the others.**

### Task 3 — The handlers

`services/api/src/handlers/`. Handlers read `sub` from the authorizer, call the data layer,
map errors. **They never build a query** (§3.1 rule 3).

Every method in `contract.ts` gets a route, including the ones `client.ts` has been
throwing `not_implemented` for since FR0.

### Task 4 — Jobs and generation

`createArtifact` and `addSource` return a `Job` and the pipeline fulfils it. The stages the
job reports must be **the stages FR4's UI displays** — that mapping was FR4's discipline
and this is the other half of it.

Four artifact kinds now generate, where the current pipeline makes only cards. Quiz, note
set and exam generation are new pipeline work.

### Task 5 — Routes, and the parity check

`infra/lib/api-stack.ts` and `scripts/dev-api.mjs` are a hand-maintained mirror;
`check-routes.mjs` in `verify` is what stops them drifting. This phase rewrites the route
table, so expect that check to fail loudly until both sides agree. **That is it working.**

### Task 6 — Flip `VITE_API_MODE`

To `live`, and walk every surface FR1–FR6 built.

**Expect this to hurt.** Six phases were developed against a fake. Brief §2 accepted that
trade knowingly: nothing has ever compared fake and live behaviour. Budget real time here,
and **fix the backend to match the contract rather than the frontend to match the
backend** — otherwise the contract stops being true and the next re-architecture starts.

Keep fake mode working. It is how FR8+ gets developed.

### Task 7 — `client.ts` completeness

Every `not_implemented` from FR0 §6.3 is now implemented or **explicitly deferred with a
reason**. That table started at FR0 and closes here.

### Task 8 — Document

`SPEC.md`, ADRs for the schema decisions (the `Artifact` table especially — it is the move
a future session will try to "simplify" back into four tables), the drift log, and the
board.

If the Supabase project can now be retired, **say so — and leave the decision to the owner.**

---

## 5. Acceptance criteria

1. Every `contract.ts` method has a route, a handler and a data-access function.
2. **Every new table has a data-access module obeying all four §3.1 rules.** Audit this by
   reading, not by trusting `check-data-access.mjs` — it sees two of four.
3. `npm run check:data-access` and `npm run check:routes` pass.
4. Every migration was `--dry-run`'d before pushing, and nothing destructive ran without the
   owner's say-so.
5. `npm run db:types` regenerated and committed if the Supabase schema was touched.
6. `cdk diff` read before every deploy; prod untouched.
7. **`VITE_API_MODE=live` and every FR1–FR6 surface walked in a browser.** List what you
   walked and what broke.
8. Fake mode still works.
9. All four artifact kinds generate for real, end to end.
10. `npm run verify` passes.
11. §6 recorded; drift log appended.

---

## 6. Decisions to record

1. **Migrate existing data or start clean**, and if data was dropped, **that the owner
   approved it.**
2. **The `Artifact` table's physical shape** — one table with a payload column, or a base
   table with per-kind side tables. An ADR.
3. **Which aggregates ended up server-side** (FR6 §8's list), and their query shapes.
4. **Every place the backend could not serve the contract**, and what was done.
5. **Every fake-vs-live behavioural difference found at task 6.** This is the record of what
   the fake cost, and it is the honest accounting the brief promised.

## 7. What will go unverified

No tests ([ADR 0005](../adr/0005-no-test-suite.md)). `check` and `verify` prove this
compiles, lints and builds. Report **"typechecks and builds"** plus exactly what you ran.

**This phase has more unguarded surface than any other in the sequence:**

1. **Cross-tenant isolation.** Nothing proves it. The test that did was deleted, and
   §3.1's linter checks shape, not meaning. **A data-access function that takes `userId`
   and ignores it passes every gate in this repository.** Read every one.
2. **Migrations.** Nothing runs them before the live database does.
3. **Every FSRS interval, every aggregate**, now over real data.
4. **Generation for four kinds.** Only what you actually generate is checked.
5. **The fake/live gap.** Task 6 finds what it finds; there is no systematic comparison.
6. **Load and performance.** Nothing here has met a real user's data volume.

## 8. Handoff — what comes after

There is no FR8 in the brief. At completion, record:

- **what the notes editor needs** (brief §6.3 — fork or edit in place, still open);
- **what chat organisation now demands** (brief §6.4 — deliberately undecided; six phases
  of use should have produced an opinion);
- **whether a test suite should now be written.** The owner's call, and this is the natural
  checkpoint to raise it: the re-architecture is done, the model is settled, and §7's list
  is the argument.
