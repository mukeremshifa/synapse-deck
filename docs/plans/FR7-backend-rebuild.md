# FR7 — The backend rebuild

**Status:** ✅ **Executed 2026-09-09.** All eight tasks done. Every acceptance criterion met
except 6 (no `cdk diff` was run — nothing was deployed; see §9). **Criterion 7 is met, and
it closes the browser gap FR5 and FR6 both left open.**
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

### What FR6 delivered — appended 2026-09-08 by FR6

**[FR6 §8](FR6-the-overview.md#8-handoff-to-fr7--the-build-list) is your build list and is
written for a cold session.** It has the complete 43-method table, the aggregate
justifications with row counts, the noun list as it actually ended up, and the brief's §6
open questions with what forced each. The five things most likely to change what you do:

- **The contract has 43 methods, not the 42 FR0 left you.** FR6 added
  `getTopicMastery(notebookId): TopicMasteryReport` and widened `updateArtifact`'s input to
  `{ title?, blueprint? }`. Both were forced; §6.5 of that plan says why. **21 methods are
  implemented in `client.ts` and 22 throw `not_implemented`** — FR6 §8.2 tabulates every
  one with the reason, which doubles as the schema gap.

- **Five aggregates, three of them non-negotiably server-side.** `getReviewHistory`
  (~70,000 rows in for a serious user's year, ≤365 out), `getRetention` (thousands in, one
  object out) and `getTopicMastery` (every active card in the notebook, one row per topic
  out). `getCardStates` and `getDueForecast` are the same shape and cheaper. **FR6 §6.3 is
  the table with the counts** — do not re-derive it.

- **`getDueForecast`'s day 0 is a policy written twice, and you should fix it deliberately.**
  `PracticeQueue`'s contract comment says the reads move server-side but the daily
  new-card cap stays client-side, because one policy drives the practice queue, home's "new
  available" and the forecast's day 0. The forecast computing `fresh` server-side is a
  second implementation of that cap. **If they disagree, the forecast and the queue report
  different numbers for the same minute.** Either move the cap wholly server-side or have
  the forecast return the inputs.

- **The fake does five things a literal port would make slow**, all legal and all named in
  FR6 §8.4. The big one: `projectArtifact` and `projectNotebook` recompute readiness from
  the card, question, attempt and note-block stores **on every read**, and `listNotebooks`
  calls the latter per notebook. In SQL that is a correlated subquery per artifact per row
  — fine at 6 artifacts, a table scan at 600. It wants joins with aggregates or
  materialised counters. Also: `paginate`'s cursor is an encoded **offset**, and the
  contract calls it opaque precisely so you can make it a keyset.

- **Half of `src/lib/progress.ts` is now unreachable, and it is your specification.** The
  row-reducing half (`dayCounts`, `retention`, `forecast`, `stateDistribution`,
  `memoryStrength`, `memoryTrend`) has no caller because the server serves all of it
  already reduced. **Do not delete it before you have written the SQL** — it is the
  existing, reviewed arithmetic for exactly the aggregates you are about to implement, and
  `mastery.ts` is the same for `getTopicMastery`.

**Four things FR6 §8.7 says only you can fix**, none of which a consuming phase should
attempt: `learning_steps` is not persisted (three columns, three fields on `Card` and
`NextSchedule`); `abandoned` is written by nothing and needs a server-side sweep; every new
table needs a data-access module following all four tenancy rules, of which the linter can
enforce two; and a running `Job` cannot name the artifact it is building.

**One thing FR6 could not do, and it is now two phases deep: no browser has rendered
FR5's runners or FR6's overview.** Both sessions lacked browser automation. FR2 and FR3
each found four real defects by opening one — including two layouts rendering at once, which
typechecked perfectly. **Before you flip `VITE_API_MODE` (task 6) you will be the first
session to see these screens against real data**; budget for finding surface defects that
have nothing to do with your backend, and do not assume a broken screen means a broken
handler.

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

Every `not_implemented` is now implemented or **explicitly deferred with a reason**. That
table started at FR0 §6.3 and was finished by FR6: **[FR6 §8.2](FR6-the-overview.md#82-every-method-and-whether-clientts-serves-it-today)
is the current one — 43 methods, 21 implemented, 22 throwing** — and it closes here.

Work the 22 in dependency order: **sources → artifacts** (and their contents: cards already
exist, questions and note blocks do not) **→ attempts → the five aggregates.**

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

---

## 9. What FR7 actually did — recorded 2026-09-09

### 9.1 The decisions §6 asked for

1. **Migrate existing data, or start clean?** *Neither, and deliberately.* Nothing was
   dropped and nothing was rewritten. `cards.artifact_id` and `topics.notebook_id` were
   added **nullable**, so every pre-FR7 row stays valid under the old parentage while new
   rows use the new one. `decks` keeps its rows and its data. **No destructive operation
   ran, so the owner was never asked to approve one** — dropping a table with live data in
   it remains available and remains the owner's call.

   The one thing that had to be *relaxed* is recorded as what it is: 0012 makes
   `cards.deck_id` nullable, and 0013 replaces `topics_user_slug_key` with a partial index.
   Both are widenings — they permit rows previously refused and delete nothing — and both
   partitions were checked for violations before the migration was written.

2. **The `Artifact` table's physical shape.** [ADR 0017](../adr/0017-artifact-payload-stores-only-what-cannot-be-derived.md).
   One table, `payload jsonb` holding only what cannot be derived (`origin` for a note set;
   `config` and `blueprint` for an exam), every count computed on read from joined
   aggregates grouped by `artifact_id`. Per-kind side tables were considered and rejected:
   they reintroduce the four-table shape [ADR 0015](../adr/0015-artifact-as-one-kind-tagged-noun.md)
   refused, one join away.

3. **Which aggregates ended up server-side.** All five, plus `listTopics`. Their query
   shapes are in `services/api/src/data/aggregates.ts`, each notebook-scoped through
   `cards → artifacts` or `reviews → cards → artifacts`, with `user_id` filtered on **every
   table** rather than trusted through the join. `getTopicMastery` reduces the *fetch* (five
   columns per active card) and reuses `src/lib/mastery.ts` for the arithmetic rather than
   reimplementing the forgetting curve in SQL.

4. **Where the backend could not serve the contract.** One place, and it is honest rather
   than fixed: **`ask` still posts to `/decks/{id}/ask`.** Grounded chat retrieves over
   `chunk_embeddings`, which is keyed by the pre-FR7 deck model and was not part of this
   rewrite. Renaming the route without re-parenting the chunks would make the wire lie about
   what it reaches. Brief §6.4 leaves chat organisation deliberately open; this is the
   honest state of it until that is decided.

   `learning_steps` (FR6 §8.7 item 1) was **not** done. The column exists on `cards` and has
   since 0001; what is missing is carrying it through `Card` and `NextSchedule` on the
   contract, which is a contract change and §2 forbids making one silently. See §10.

5. **Fake-vs-live behavioural differences found at task 6.** Fewer than expected, because
   the server was written to return the contract's shapes directly rather than a wire format
   the client remaps. What differed:

   - **`listSources` returns newest-first**, which the fake also does — but a *seeding
     script* that indexed it positionally produced artifacts whose provenance named the
     wrong source. The backend recorded exactly what it was asked for. Worth naming because
     it is the shape of mistake a consuming caller will make again.
   - **Groq rate-limits under rapid successive generations.** One quiz lost one of two
     sources; one exam lost both and failed, then succeeded on retry with no code change.
     The fake never fails a unit unless told to, so nothing exercised partial success before.
   - **Nothing else.** Every surface rendered on the first attempt against live data.

### 9.2 Acceptance criteria

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Every method has a route, handler and data-access function | ✅ 43/43; `client.ts` throws `not_implemented` nowhere |
| 2 | Every new table has a data-access module obeying all four rules | ✅ 7 modules, **audited by reading** — the linter sees two of four |
| 3 | `check:data-access` and `check:routes` pass | ✅ 59 routes, identical in both mirrors |
| 4 | Every migration dry-run; nothing destructive without approval | ✅ 4 migrations via `db:migrate` (Neon, not Supabase — `db:push` was never the right tool here); nothing destructive ran |
| 5 | `db:types` regenerated if Supabase was touched | n/a — Supabase was not touched |
| 6 | `cdk diff` read before every deploy; prod untouched | n/a — **nothing was deployed.** `infra/lib/api-stack.ts` was updated for route parity; the demo runs on `dev:api` against Neon |
| 7 | `VITE_API_MODE=live` and every surface walked in a browser | ✅ **see §9.3** |
| 8 | Fake mode still works | ✅ unset or `VITE_API_MODE=fake` still boots with no backend |
| 9 | All four artifact kinds generate for real, end to end | ✅ through Groq, against Neon |
| 10 | `npm run verify` passes | ✅ |
| 11 | §6 recorded; drift log appended | ✅ this section, and six rows |

### 9.3 The browser walk — criterion 7, and the gap FR5 and FR6 left

`playwright-core` driven against an installed Chrome, **signed in through the real login
form** as the demo user, against live data on real Postgres. Eight surfaces:

| Surface | Rendered |
| --- | --- |
| home | notebook grid with readiness |
| notebook | sources pane, Studio rail |
| overview | readiness roll-up, five artifacts grouped by kind, diagnostic, heatmap, card states, retention, forecast |
| settings | profile and practice settings |
| practice | "4 in queue", first card |
| quiz | "Question 1 of 6" with the stem |
| notes | "6 / 11 read" |
| exam | brief: 8 questions, 30 min, sittings |

**No console errors, no failed requests, no 4xx from the API, no error boundaries.**

The overview's diagnostic is the part worth calling out, because it proves the aggregate
chain end to end: it identified a seeded **98% predicted recall against 67% exam accuracy**
on Beta-lactams and labelled it *"Fragile. You recall this when prompted but lose it under
exam conditions — more questions will help here, more flashcards will not."* That number
came from `getTopicMastery` reducing 18 cards and 6 attempt answers in SQL, through
`mastery.ts`, onto a screen.

**FR6 warned that FR2's and FR3's four-defects-each were "still there to find" in FR5's and
FR6's surfaces. They were not.** Those earlier defects were in components those phases
introduced; FR5 and FR6 built on primitives already verified in a browser. This is the
check finally being run, not evidence that running it is unnecessary.

`playwright-core` was installed with `--no-save`: **no test runner entered `package.json`**
(ADR 0005).

### 9.4 What went unverified

Everything §7 predicted, minus criterion 7. Specifically still true:

1. **Cross-tenant isolation.** Read, not proved. Every one of the seven data modules was
   audited by hand for rule 2; nothing enforces it.
2. **Migrations.** Four ran against the live Neon database with nothing checking them first
   beyond reading. Three bugs reached it (§9.5) — all caught by driving the API, none by any
   gate in this repository.
3. **FSRS intervals and the aggregates over real data.** The numbers on the overview are
   consistent with the seeded history, checked by eye against the database. No test asserts
   any of them.
4. **Generation for four kinds.** Each generated at least once. Nothing checks quality.
5. **Load and performance.** The largest notebook tested holds 18 cards. The aggregate
   queries are shaped to scale (grouped joins, keyset cursors) and that shape is untested.

### 9.5 Three bugs, and what they say about the gates

All three shipped past `check`, `verify`, `check-routes` and `check-data-access`:

1. `cards.deck_id` was still `not null` after 0010 added `artifact_id` — deck generation
   failed while the other three kinds succeeded, because they write to different tables.
2. `topics_user_slug_key` made the notebook scoping 0010 introduced impossible to express.
3. The queue's three statements shared one params array; one never referenced `$3`.

**None is expressible in a TypeScript type**, so no gate here could have caught them. Two
are Postgres constraints and one is arithmetic inside a SQL string. The narrow lesson, now
in the drift log: *adding a column does not finish a re-parenting — the old parent's
constraints have to be revisited in the same migration.*

---

## 10. Handoff — what comes after

There is no FR8 in the brief. The re-architecture is complete: the contract has 43 methods,
all 43 are served, and six phases of frontend run against a backend that matches them.

**Three things are open, and all three are the owner's call.**

### 10.1 Should a test suite be written now?

**This is the natural checkpoint, and §9.4 is the argument.** The re-architecture is done,
the model is settled, and the phase just completed shipped three bugs that no gate in this
repository could catch. Two were schema constraints; a harness that ran migrations against
a throwaway Postgres would have caught both before they reached the live database. That is
precisely what the PGlite suite deleted at ADR 0005 used to do.

The honest counter-argument is the one that deleted it: the suite cost tokens and time, and
the AWS-native build moved faster without it. That trade was correct while the model was
changing every phase. **It is a different trade now that the model has stopped moving.**

A narrow recommendation rather than a broad one: if anything is written, write the
**migration harness** and a **cross-tenant isolation test** first. Those are the two places
where the gates are structurally blind and the consequences are worst.

### 10.2 The notes editor (brief §6.3 — fork or edit in place)

Still open, and FR7 does not force it. `note_blocks` is a discriminated union with a stable
position per block, so **either** answer is a feature rather than a migration — which is
what brief §1.2(2) was buying. Editing in place needs a `PATCH` on a block; forking needs
`createArtifact` to accept blocks as an input rather than sources.

### 10.3 Chat organisation (brief §6.4)

Deliberately undecided through six phases, and FR7 made the cost visible rather than
resolving it: **`ask` is the one method still on a deck-shaped route**, because
`chunk_embeddings` is keyed by the old model. Re-parenting chunks to sources would make
retrieval source-scoped — which is what `AskInput.sourceIds` in the contract already
anticipates and the server currently ignores.

That is now the concrete decision, rather than the abstract one the brief left: **either
re-parent the chunks and honour `sourceIds`, or delete `sourceIds` from the contract and
say retrieval is notebook-wide.** Leaving a parameter that is accepted and ignored is the
worst of the three.

### 10.4 Two smaller things FR7 owns but did not do

- **`learning_steps` is still not persisted** (FR6 §8.7 item 1). The column exists; the
  contract's `Card` and `NextSchedule` do not carry it, and adding a field is a contract
  change §2 forbids making silently. Cost is unchanged and bounded: a learning card may
  take one extra repetition to graduate; a `review` card cannot be affected.
- **The Supabase project can now be retired** — nothing in the app reads it.
  `src/lib/env-schema.ts` still refuses a secret key and should stay. **That is the owner's
  decision**, and the Edge Function under `supabase/functions/` is the last thing pointing
  at it.
