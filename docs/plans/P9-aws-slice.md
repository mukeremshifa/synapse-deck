# P9 — Backend migration, vertical slice

Phase A of [AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md). The phase that moves the backend:
RDS Postgres, Cognito, API Gateway, Lambda — and **retires RLS**, replacing the entire
security boundary with application code.

It migrates a **vertical slice**, not everything (D12). The app runs on two backends for a
stretch, deliberately and with an expiry.

**Reference:** the brief's D1, D2, D3, D4, D12, §7 open questions 1, 4, 5, §8 constraints
1, 2, 5, 7, 8. [ADR 0006](../adr/0006-rds-dynamodb-split.md) and
[ADR 0007](../adr/0007-cognito-for-identity.md) settle the data-store and identity
reasoning; this plan does not reopen either.

**Done when:** a user signs in through Cognito, and their decks and cards are read and
written through API Gateway → Lambda → RDS, with `user_id` enforced in application code —
and `dev` still runs unchanged on Supabase.

---

## The decision this plan is written under

**RLS is retired for good.** The owner confirmed this on 2026-09-06, having been shown
what it costs. It is not revisited here.

What it costs, stated once and plainly so the tasks below can be judged against it:

> Today, `authenticated` is a Postgres role and every one of the 15 policies in
> `20260811090100_rls.sql` is evaluated by Postgres on every row. A query that forgets
> `where user_id = …` returns **nothing**, because the database refuses. After this phase,
> that same query returns **every user's rows**.

The boundary does not disappear — it *moves*, from the database into
[src/lib/queries.ts](../../src/lib/queries.ts)'s successor. The entire safety of the
product then rests on that layer being right, and [ADR 0005](../adr/0005-no-test-suite.md)
means nothing will prove that it is.

**So this plan compensates structurally rather than with tests.** Four mechanisms, all in
the tasks below, chosen because each one fails *closed* and none of them depends on a
human remembering something:

1. **`userId` is a required first parameter** on every data-access function — not
   optional, not inferred, not defaulted. A caller that forgets does not compile.
2. **No route handler may build a query.** Handlers call the data-access layer; the layer
   is the only place that writes SQL. This is what makes rule 1 auditable by reading one
   directory.
3. **The RPCs get `user_id` filters in SQL** (task 6). They are `security invoker` today
   *because RLS was the boundary* — retiring RLS silently converts them into unfiltered
   queries, and this is the sharpest edge in the phase.
4. **A `verify`-time grep** (task 11) that fails the build on a query in a handler, or a
   data-access export whose first parameter is not `userId`. Crude, mechanical, and it
   runs on every push — which is more than a convention achieves.

**This is weaker than RLS and the plan says so rather than implying otherwise.** RLS is a
guarantee; the above is a discipline with a linter behind it. The honest summary for the
case study is that the boundary became more legible to a reviewer and less absolute in
fact.

---

## Preconditions

```bash
git branch --show-current      # aws-native
git status                     # clean
npm run verify                 # green
npx cdk diff SynapseDeck-Foundation-dev   # empty
```

- **P8 complete and deployed.** Stack `SynapseDeck-Foundation-dev` is live in `us-east-1`,
  account `513774291123`. Budgets, alarms, tags and log retention are in place and were
  verified against AWS, and the error alarm has actually fired.
- **Two P8 items may still be open** and neither blocks this phase: cost-allocation tag
  activation and the first cost figure, both waiting on AWS's billing lag. Chase them; do
  not wait on them.
- **§8 constraint 7 is retired. There is no "before" to capture.**

  **Decided by the owner on 2026-09-06: this ships as a new product built on AWS, not as a
  migration with a before-and-after.** The brief's §9 asked for the current app deployed to
  Vercel so the case study had a first half; there is no such half now, so the requirement
  is dropped rather than deferred. **Nothing blocks task 4.**

  What survives from the pre-AWS product is **the commits** — seven phases, ADRs, a
  recorded reason for every choice. That is engineering provenance and it is already in
  git; it needs no deployment, no recording and no screenshots.

  `pre-aws-migration` (tag, at `45af283`) was created before this decision. **Keep it** —
  it costs nothing, and it marks where the Supabase-era code ends, which is genuinely
  useful when reading history. It is a bookmark, not a deliverable.
- **The parallel sessions are finished and their work is merged.** Resolved 2026-09-06:
  `feat/exam-runner-shell` is merged into `aws-native` and deleted, local and remote.
  `git status` is clean, `npm run verify` is green, and everything lives on one branch.

  **What that branch now carries beyond P8**, so it is not a surprise:

  | Work | Files | Phase it belongs to |
  | ---- | ----- | ------------------- |
  | Exam runner, setup, results, focus mode | `src/features/exam/`, `src/lib/exam.ts` | C |
  | Topic mastery + mastery map | `src/lib/mastery.ts`, `src/features/progress/MasteryMap.tsx` | D |

  **This does not expand P9's scope, and the reason is worth checking rather than
  trusting.** That code imports neither `supabase` nor `@/lib/queries` — it runs on
  `src/features/exam/fixtures.ts`. So P9 rewrites the data layer *underneath* it without
  touching it, and it neither blocks this phase nor gets migrated by it. It still needs
  wiring to real data when Phase C actually runs; P9 task 12 records that for P10.
  **Do not adopt it into this phase** to "finish" it.

- **Still always `git rev-parse aws-native`, never `HEAD`** (P8 decision 9). The parallel
  session is gone, but the rule earned its place and costs nothing.

---

## Out of scope — do not build these here

- **Anything Bedrock, Step Functions or S3 ingestion.** Phase B. This phase moves data and
  identity; it adds no AI.
- **`topics`, `questions`, `exams`, `answers`.** D11's schema is Phase B and C. The exam
  work already on `feat/exam-runner-shell` does not change that — **do not adopt it into
  this phase** to make it compile against the new backend.
- **Migrating every screen.** That is the point of D12. See the split table in task 2.
- **Deleting Supabase.** Phase F. Nothing is torn down here.
- **The `services/` and `web/` restructure.** Still deferred, per P8's decision 4.
- **pgvector.** Phase G.
- **Re-litigating RLS.** Settled above.
- **Deploying the `prod` stack, or anything to Vercel.** The owner deferred production
  deployment to a checkpoint (2026-09-06). P9 builds and deploys the **dev** stack only.
  The `prod` stack is defined in CDK — it must stay synthesisable and its config correct —
  but it is not deployed by this phase, and `infra:deploy:prod` remains owner-only per
  `CLAUDE.md`. A phase that ends with dev working is a complete phase.

---

## The two-backend split (D12), written down

§8 constraint 8 requires this to be explicit, and it is the artifact that stops the split
becoming permanent. **No screen is live on both backends at once.**

| Data / screen | Backend during P9 | Moves in |
| ------------- | ----------------- | -------- |
| Identity, session | **Cognito** | P9 |
| `profiles` | **RDS** | P9 |
| `decks` | **RDS** | P9 |
| `cards` (content + FSRS state) | **RDS** | P9 |
| `reviews` | **RDS** | P9 |
| Practice queue, review write path | **RDS** | P9 |
| `/progress` aggregates | **Supabase** — untouched | Phase F |
| `generations` + quota | **RDS** — moved at P10 task 8 | ✅ Phase B |
| `/create/text` generation | **Supabase Edge Function** — untouched | Phase B |

**Why `/progress` and generation stay.** Progress reads
`20260812210000_progress_stats.sql`, an aggregate that would have to be ported wholesale;
generation is being rewritten by Phase B anyway (SSE → job polling), so migrating it now
means writing it twice. Both would violate "no feature is built twice."

**The consequence, and it must be visible in the app, not hidden:** for the duration, a
user's decks live in RDS while their progress chart reads Supabase. **Task 10 makes
`/progress` state plainly that it is showing pre-migration data**, rather than silently
showing a chart that no longer matches the deck list.

**`generations` moved at P10 task 8, and it left one seam open until task 9.** The quota a
user sees, and the one `POST /jobs` enforces, is now `sum(units)` over the **RDS** table.
The Edge Function behind `/create/text` still counts **its own Supabase rows**, because it
still writes them — so for the window between task 8 and task 9 the two paths bill against
two separate ledgers, and neither sees the other's spending.

This is a real gap and it is named rather than hidden: a user could spend 300 units on
documents and still paste text, or the reverse. It is bounded and small — nothing here is
deployed, `/create/text` is the only route still on the Edge Function, and **task 9 closes
it by moving that route onto the same pipeline and deleting the Edge Function's quota
path entirely.** It is not a case of the same feature built twice: it is one feature
mid-move, with the old half still running until the new half replaces it.

**Phase F ends this and is not optional.**

---

## Progress

| Task | State | Notes |
| ---- | ----- | ----- |
| 1. Cognito | ✅ Written, **not deployed** | `infra/lib/auth-stack.ts` |
| 2. RDS + VPC | ✅ Written, **not deployed** | `infra/lib/data-stack.ts`. Cold start still unmeasured |
| 3. Schema | ✅ Written, **never executed** | `services/api/migrations/`. How it reaches RDS is now settled — see task 7 |
| 4. Accounts | ⚠️ **Partly dropped** | No migration (owner, 2026-09-06). `demo:seed` deferred to Phase B — see the task |
| 5. Data-access layer | ✅ Written, **never run** | `services/api/src/data/` — 4 modules, every export takes `userId` first |
| 6. The three RPCs | ✅ **Done early** | Ported with `p_user_id` in `0002_review_card.sql` |
| 7. API Gateway + Lambda | ✅ Written, **not deployed** | `infra/lib/api-stack.ts`, `services/api/src/handlers/`. 18 routes, all behind the JWT authorizer |
| 8. Frontend | ✅ Written, **not run** | `api-client.ts`, `cognito.ts`, `queries.ts` rewritten, auth on Cognito |
| 9. `CLAUDE.md` | ✅ | Rewritten; [ADR 0008](../adr/0008-application-level-tenancy.md) records the decision |
| 10. `/progress` notice | ✅ | One sentence on `/progress`; the dashboard streak's staleness noted in code |
| 11. Enforcement lint | ✅ | `scripts/check-data-access.mjs`, in `verify`. **Now has real code to check** |
| 12. Write P10 | ✅ | [P10-ingestion.md](P10-ingestion.md). Starts by deploying P9 and debugging it |

**Session 1 (2026-09-06) did 1, 2, 3, 6, 9 and 11.** Owner scoped it to
infrastructure-as-code with no deploy, so nothing bills yet and the acceptance criteria
that need a running system are all still open.

**Session 2 (2026-09-06) did 5, 7, 8, 10, 12, and resolved 4.** Owner scoped it the same way:
build everything, deploy nothing. `npm run verify` is green and all eight stacks
synthesise, dev and prod. **Nothing in this session has ever run** — not a query, not a
handler, not a sign-in. Every acceptance criterion that needs a running system is still
open, and the code is more likely to have first-run bugs than the plan's confident tone
suggests.

Two things the session decided rather than deferred, both recorded in their tasks:

1. **The migration runner reaches RDS through a Lambda** (`synapsedeck-dev-migrate`),
   which is the answer task 3 left to task 7. It runs `run.mjs` unmodified.
2. **`demo:seed` cannot be ported this phase** and acceptance criterion 2 is dropped. See
   task 4 — the script's whole value is that it drives the real generation pipeline, and
   generation stays on Supabase while decks and cards moved to RDS.

**Task 6 was pulled forward** against the plan's "its own session" advice, because its
content is SQL and it would have meant writing `0002_review_card.sql` twice — once
wrong, then once correctly. The analysis it deserved is in the file's header and in
ADR 0008; it did not get less attention for arriving early. **It has not been run.**

### What the next session inherits

1. **Nothing is deployed.** `npm run infra:diff` shows the two new dev stacks as pure
   additions. Deploying starts the ~$12-15/mo RDS meter, which will trip the $10 and $15
   budget alarms — correctly, not accidentally.
2. **The SQL has never been executed** (owner's call, 2026-09-06). Expect to debug it on
   first run; `npm run db:migrate:status` first.
3. **The database has no public route**, so migrations cannot run from a laptop without a
   tunnel. How they run in practice is an open decision that task 7 has to settle, since
   it is the session that puts compute inside the VPC.
4. **The lint currently checks nothing**, because `services/api/src/{handlers,data}` do
   not exist. It says so rather than passing silently. Task 5 is what gives it teeth.

---

## Tasks

Ordered so the app runs after every one.

### 1. Cognito user pool — `infra/lib/auth-stack.ts`

A new stack, not an addition to the foundation stack: identity has a different lifecycle
from observability, and a mistake here should not force a redeploy of the alarms.

- User pool, email sign-in, self-service signup — matching what Supabase Auth does today.
- App client **without** a secret (a browser SPA cannot hold one).
- No hosted UI (ADR 0007). The app's own screens in `src/features/auth/` stay.
- Export the pool id, client id and issuer URL as stack outputs and as CDK context for the
  API stack.
- **A pre-token-generation Lambda is not needed** and should not be added; `sub` is
  already the claim we want.

### 2. RDS Postgres — `infra/lib/data-stack.ts`

`db.t4g.micro`, 20 GB, single-AZ, in a VPC with **no NAT Gateway** (§8 constraint 3, and
the brief's §6 trap 1 — a NAT is ~$32/mo and the whole point of the endpoint design is to
avoid it).

- Private isolated subnets. Lambdas join the VPC; nothing needs egress to the internet
  that an endpoint cannot serve.
- **S3 gateway endpoint** (free). Add interface endpoints only when a task actually needs
  one — Secrets Manager is the likely first, and SSM Parameter Store is the cheaper
  alternative the brief's §6 already recommends.
- Credentials in **SSM Parameter Store**, not Secrets Manager ($0.40/secret adds up and
  buys nothing here).
- `deletionProtection: true` on prod, `false` on dev.
- **Measure Lambda-in-VPC cold start** and write the number into this plan. The brief's §6
  flags it as "a measurement for Phase A, not an assumption" — so measure it before the
  interactive paths depend on it, not after.

  **Still unmeasured as of session 1.** It cannot be measured before something is
  deployed, and nothing is. It belongs to the session that deploys — measure it then,
  before task 7's interactive paths are built on top of an assumption. Replace this
  paragraph with the number.

**Written and synthesising as of 2026-09-06; not deployed.** The template was checked
rather than trusted: `AWS::EC2::NatGateway` and `AWS::EC2::EIP` counts are both zero
(acceptance criterion 10, at template level), dev shows `DeletionProtection: false` with
`DeletionPolicy: Delete`, and prod shows `true` / `Retain`.

### 3. Schema — `infra/migrations/` or `services/api/migrations/`

The five tables, ported from `supabase/migrations/` — **without the RLS policies.**

- `profiles`, `decks`, `cards`, `reviews` port nearly as-is; `generations` stays on
  Supabase this phase (see the split table) but **port its DDL anyway** so the schema is
  whole and Phase B has somewhere to write.
- `user_id uuid not null` stays on every table. It is no longer enforced by policy, so it
  is now enforced by the data-access layer — **and it must still be `not null` and still
  be indexed**, because every query now filters on it explicitly.
- `cards_state_consistency` and every other CHECK constraint **is kept**. Those guarantee
  something real and are unrelated to RLS.
- **`auth.users` does not exist in RDS.** `user_id references auth.users` becomes a plain
  `uuid not null` column holding the Cognito `sub`. Drop the FK; nothing replaces it, and
  that is a real loss of referential integrity worth noting in the migration's comment.
- Decide and record how migrations run against RDS now that `supabase db push` is gone. A
  plain SQL runner in a Lambda invoked by CDK is the boring answer; **do not reach for a
  migration framework** for five files.

  **Decided 2026-09-06: `services/api/migrations/`, with `run.mjs` as the runner.** The
  schema lives beside the data-access layer that mirrors it rather than in `infra/`,
  because a column added in one needs a query changed in the other and two directories
  apart is where that gets forgotten. `infra/` stays pure CDK.

  The runner is ~200 lines and no dependency beyond `pg`, which the API needs anyway. One
  transaction per file, an advisory lock so two runners cannot interleave, and a
  `schema_migrations` ledger with a **checksum** — which makes "never edit an applied
  migration" enforced rather than merely stated. No down-migrations: reversing
  `0001_schema.sql` is `drop schema public cascade`, and reversing a data migration
  correctly is bespoke every time.

  **Still open: how the runner reaches the database.** The RDS instance is in an isolated
  subnet with no public route, so this does not run from a laptop without a tunnel.
  **Task 7 must settle it** — that is the session that first puts compute inside the VPC,
  and a Lambda invoked by CDK is the boring answer there too.

**Written 2026-09-06 and never executed.** The owner decided against standing up a
Postgres to run it through, so the first `db:migrate` will be the first execution. The
migrations README says so where the person running it will see it.

### 4. Accounts — start clean, migrate nothing

**Decided by the owner on 2026-09-06: no user or data migration.** This ships as a new
product, and the only accounts in Supabase are the owner's and a seeded demo one. Importing
them would be real work — `sub` preservation, a remap-table fallback, a partial-migration
failure mode — spent to carry two accounts across.

So this task is small, and the risk it used to carry is gone rather than managed:

- **Cognito starts empty.** The owner signs up through the app's own screens, which is also
  the first end-to-end test of task 1.
- **The demo account is re-seeded, not moved.** `npm run demo:seed` already builds a
  plausible account from nothing (`scripts/seed-demo.mjs`); point it at the new API and
  run it. It drives the real pipeline rather than inserting rows directly, which is why it
  survives the backend change at all.

  **This does not survive the split, and session 2 found out why rather than working
  around it.** The script's stated rule 2 is that it drives the *real* generation
  pipeline — the same POST to `generate-cards`, the same SSE decoder — and that is the
  entire reason its output is a demonstration rather than a mock-up. But the Edge
  Function writes its decks and cards **into Supabase**, and generation stays on Supabase
  this phase by design (the split table). Decks and cards moved to RDS.

  So the two halves of the script now land in different databases, and there is no
  version of "point it at the new API" that keeps rule 2:

  - Point it at the new API and it can no longer generate — it would have to insert card
    rows directly, which is exactly the mock-up the script exists not to be.
  - Leave it on Supabase and it seeds an account the app can no longer see.

  **Decision: `demo:seed` is deferred to Phase B, and acceptance criterion 2 is dropped
  from this phase.** Phase B rewrites generation onto Bedrock and Step Functions, writing
  into RDS; that is the first moment a seeded account can be both really generated and
  actually visible. Rewriting the script twice — once against a pipeline being replaced —
  is the "no feature is built twice" rule this plan applies everywhere else.

  The script is left untouched and still works against Supabase. It is not deleted,
  because Phase B needs its structure (the replayed review history in particular, which
  is backend-agnostic and the hard part).

  **What this costs:** the end-to-end write path is no longer proven by something larger
  than a hand-made deck. Criterion 3 still exercises it by hand, and that is genuinely
  weaker. Say so rather than quietly reinterpreting criterion 2 as met.
- **Existing Supabase rows are not ported.** They stay where they are until Phase F
  deletes the project. Nothing reads them after this phase.
- **`user_id` is a Cognito `sub` from the first row written.** No remapping, no legacy ids,
  no dual-format column to reason about later.

**One consequence to accept deliberately:** the owner's existing decks and FSRS review
history do not come along, so the new environment starts with no real scheduling data.
`demo:seed` produces a plausible substitute. If real review history turns out to matter
for demoing FSRS, exporting it is a self-contained job that can be done any time before
Phase F — the data is not going anywhere.

### 5. The data-access layer — `services/api/src/data/`

**This is the phase, and everything else is plumbing around it.**

One module per table. Every exported function takes `userId` as its **first, required
parameter**:

```ts
export async function listDecks(userId: string): Promise<DeckRow[]>;
export async function getDeck(userId: string, deckId: string): Promise<DeckRow | null>;
export async function updateCard(userId: string, cardId: string, patch: CardPatch): Promise<CardRow>;
```

Non-negotiable rules, each with a reason:

- **`userId` is never optional and never has a default.** A default is how a bug becomes
  silent.
- **Every statement includes `where user_id = $1`** — including single-row fetches by
  primary key. A card id is not a capability, and treating it as one is exactly the leak
  RLS used to make impossible.
- **`userId` comes only from the verified JWT** (task 7). Never a request body, never a
  query parameter, never a header the client controls.
- **No SQL outside this directory.** Task 11 enforces it.
- Parameterised queries throughout. RLS was never SQL-injection protection, but it did
  limit the blast radius of one, and that cushion is gone.

Port `src/lib/queries.ts`'s **read/write logic**, not its shape: it is 1,146 lines of
TanStack Query hooks, and the hooks stay client-side (task 8). What moves here is the ~30
queries inside them.

### 6. The three RPCs — the sharpest edge in this phase

`review_card`, `undo_last_review` and the `progress_stats` functions are **`security
invoker` today specifically because RLS was the boundary** — their comments say so
(`20260812093000_review_card.sql:9`). `review_card` **never filters by `user_id` itself**;
it reads a card by id and trusts the database to have refused if it belonged to someone
else.

**Retiring RLS therefore turns `review_card` into a function that will happily review
another user's card.** This is not hypothetical and it is not caught by anything.

So, when porting:

- Add `p_user_id uuid` as the first parameter of each function.
- Add `and user_id = p_user_id` to **every** statement inside it, not just the outer
  fetch.
- Keep the optimistic-concurrency check (`p_expected_updated_at`) exactly as it is; it is
  orthogonal and it works.
- Rewrite the header comments. Every one of them currently explains a security model that
  will no longer exist — leaving them is how the next session concludes the boundary is
  still there.

`progress_stats` stays on Supabase this phase, but port it under the same rule so Phase F
inherits a correct version rather than repeating this analysis.

### 7. API Gateway + Lambda — `infra/lib/api-stack.ts`, `services/api/src/`

- HTTP API (not REST — cheaper, and the JWT authorizer is native).
- **JWT authorizer** against the Cognito pool. This is where `sub` is verified, and it is
  the only place `userId` may enter the system.
- One Lambda per resource group (decks, cards, reviews, profile) — **not** one per route,
  and **not** one monolith. D10 wants capabilities with schema-described inputs; this is
  the same instinct at the API layer.
- The handler's only job: read `sub` from the authorizer context, validate the body with
  the **existing** Zod schemas from `src/lib/schemas.ts` (D10, and the one-definition rule
  in `CLAUDE.md`), call the data-access layer, map errors to status codes.
- **Handlers contain no SQL.** Task 11 enforces it.
- Structured JSON logs including `userId` and request id, into the log groups P8's
  retention config already covers.

### 8. The frontend — `src/lib/api-client.ts`, `src/lib/queries.ts`, `src/features/auth/`

The 22% the brief measured. The hooks' **signatures and query keys do not change** — that
is what keeps this from becoming a frontend rewrite.

- `src/lib/supabase.ts` → `src/lib/api-client.ts`: `fetch` with the Cognito access token
  attached, 401 handling, typed responses.
- `src/lib/queries.ts`: each hook's body swaps `supabase.from(…)` for an `apiClient` call.
  `queryKeys` is untouched, so no component changes.
- `currentUserId()` at `src/lib/queries.ts:121` **is deleted, not ported.** Its doc comment
  — *"RLS will not accept any other"* — describes a guarantee that no longer exists, and a
  client-side `userId` is now meaningless: the server reads it from the token and ignores
  anything the client says. Leaving a function that *looks* like it scopes queries is worse
  than having none.
- `src/features/auth/`: `AuthProvider`, `AuthPages`, `AuthCallbackPage`, `ProtectedRoute`
  move to a Cognito OIDC flow. **The screens' markup does not change** (ADR 0007).
- `src/types/database.ts` is regenerated from RDS, or hand-written if no generator fits.
  If hand-written, say so in the file — `db:types` currently guarantees it matches, and
  that guarantee is about to be gone.

### 9. `CLAUDE.md` — rewrite the RLS rule in this commit

§8 constraint 5, and it is not optional or deferrable. `CLAUDE.md` currently says:

> RLS is the entire security boundary. Every table gets an owner-only policy set plus
> `force row level security`. A new table without RLS is a bug, not a TODO.

That becomes false the moment task 5 ships. Replace it with the four mechanisms from the
top of this plan, and **state plainly that the replacement is weaker than what it
replaces** — a rulebook that oversells its own guarantees is how the next session takes a
shortcut it thinks is safe.

Same commit as the code. Not a follow-up.

### 10. `/progress` says what it is showing

Per the split table: progress reads Supabase while decks read RDS. A chart that silently
disagrees with the deck list reads as a bug and erodes trust in the whole migration.

One line of copy on `/progress` — that it reflects pre-migration data until Phase F. Not a
banner on every screen; one honest sentence where the discrepancy is visible.

### 11. The enforcement grep — `scripts/check-data-access.mjs`, wired into `verify`

The mechanical half of the four mechanisms. Not a test — a lint, in the spirit of the
`dangerouslySetInnerHTML` ESLint rule that already exists for the same reason.

Fail the build when:

- a file under `services/api/src/handlers/` contains `SELECT`, `INSERT`, `UPDATE`,
  `DELETE` or a query-builder call;
- an exported function in `services/api/src/data/` has a first parameter not named
  `userId`;
- a string `user_id` appears in a handler (it should only ever appear in the data layer).

Crude, and it will need an escape hatch eventually. It runs on every push, which a
convention does not. **Add it to `scripts/verify.mjs`, not `check`** — the per-commit gate
stays fast (ADR 0002).

### 12. Write P10 — `docs/plans/P10-ingestion.md`

Phase B. It must settle the brief's §7 open questions 1 (quota shape for multi-chunk
work), 2 (progress reporting once it is not an SSE stream), 4 (the draft-card seam) and 7
(topic stability across documents), and it inherits the RDS/Lambda/auth foundation this
phase builds.

Also record for P10: **the exam work on `feat/exam-runner-shell` exists and is Phase C.**
It should be reconciled deliberately — either merged into the phase sequence or parked —
not discovered by the session that starts Phase C.

---

## Acceptance criteria

1. A new user signs up through the app's own screens, receives a Cognito account, and
   signs in.

   **✅ Done 2026-09-06.** Pool `us-east-1_8byyB8D2H`, deployed and free (50k MAU). Signup
   through the app's own `signUp`, email confirmed, then SRP sign-in returning a real
   access token: `token_use=access`, 60-minute expiry, `custom:displayName` carried.

   **The email sends a six-digit code, not a link**, and the signup screen said "open the
   link" — carried over unexamined from Supabase. A user following it would have been stuck
   with a valid account they could not confirm. Fixed in the same session: the screen now
   takes the code, with a resend. This is the class of bug that only a real signup finds.
2. `npm run demo:seed` builds the demo account against the new API, and its decks are
   visible when signed in as that account — proving the write path end to end through
   something larger than one hand-made deck.
3. Creating a deck, adding cards, practising, and reviewing all work end to end through
   API Gateway → Lambda → RDS.

   **🟡 Proven except for API Gateway and RDS themselves**, which are the two pieces the
   deferred deploy removes. Run 2026-09-06 with a real Cognito token against
   `scripts/dev-api.mjs` — the real handlers, over HTTP, against local Postgres:

   ```
   GET    /profile        200   profile.id === token sub  ✓   tz seeded Asia/Dubai
   PATCH  /profile        200
   POST   /decks          201
   POST   /decks/{id}/cards 201  (basic + cloze)
   GET    /decks          200    GET /queue 200  (due 0, fresh 2, limit 15)
   POST   /reviews        200    new -> learning, reps 1
   POST   /reviews        409    (replayed token: stale-card detection)
   POST   /reviews/undo   200    learning -> new, reps 0
   GET    /summary        200    DELETE /decks/{id} 200
   ```

   The token is verified against the pool's live JWKS for signature, issuer, audience,
   expiry and `token_use` — the same checks the JWT authorizer performs. Three attacks
   were refused with 401: **a forged `sub` re-signed into a valid token**, an id token
   used in place of an access token, and a token with its signature stripped. The forged
   `sub` is the one that matters, since `sub` becomes `where user_id = $1`.

   What remains unproven is API Gateway's own route matching and authorizer, and RDS in
   place of local Postgres. Both move with the deferred Data stack.
4. `npm run verify` is green, including the new data-access lint.
5. **The manual cross-tenant check**, run once by hand and recorded here with its output —
   see "What went unverified". Two accounts; account B calls `GET /decks/{a-deck-id}` with
   A's deck id and a valid B token; the response is 404 (not 403, which confirms the id
   exists). Repeat for one card and one review.

   **✅ Done 2026-09-06, against local Postgres 18 rather than RDS.** Run at three layers,
   because a check at only one of them proves less than it looks:

   *SQL (the RPCs, which never filtered by user before P9 task 6):*

   ```
   review_card(B, A's card)      -> SQLSTATE PT404  "card ... not found"
   undo_last_review(B, A's card) -> SQLSTATE PT404  "card ... not found"
   review_card(A, stale token)   -> SQLSTATE PT409
   update reviews set rating=4   -> "reviews are append-only; only undone_at may be set"
   ```

   *Data layer:* `listDecks(B)` → `[]`; `getDeck(B, A's deck)` → `null`;
   `createCards(B, A's deck, …)` → `[]` (the `owned_deck` CTE matches nothing);
   `finishReviewGate(B, A's deck)` → `null`.

   *Handlers (32 checks, all passing):* every cross-tenant call returns **404, never 403** —
   `GET /decks/{id}`, `PATCH /cards/{id}`, `POST /reviews`, `POST /reviews/undo`,
   `POST /decks/{id}/finish-gate`, `DELETE /decks/{id}`. `POST /cards/delete` returns
   **200 with an empty id list**, which is the deliberate choice: reporting "that one was
   not yours" is the oracle this API refuses to be.

   Afterwards A still had 2 decks and 2 cards; B had written **zero rows** anywhere.

   **What this does and does not prove.** It exercises the real SQL, the real data layer
   and the real handlers — the entire boundary that replaced RLS — against a real Postgres.
   What it does not exercise is API Gateway's JWT authorizer, because `sub` was injected
   directly into the event. So *"the boundary holds given a correct `sub`"* is proven;
   *"only a valid Cognito token can supply that `sub`"* is not, and moves with criterion 1.
6. `dev` is untouched, still on Supabase, still working.
7. `/progress` states that it is showing pre-migration data.
8. `CLAUDE.md` no longer claims RLS is the boundary.
9. Lambda-in-VPC cold start is measured and the number is written into task 2.
10. **No NAT Gateway exists in the account.** `aws ec2 describe-nat-gateways` returns
    empty.

**State after session 3 (2026-09-06):** criteria **1, 4, 5, 6, 7, 8 and 10 are met**;
criterion 3 is met except for API Gateway and RDS themselves. Only criterion 9 (cold start)
is fully open, and criterion 2 is dropped.

**The hybrid this session ran under, and why.** RDS is the only billable line in P9 (~$14/mo)
and the owner's AWS credits are reserved for Phase B's Bedrock work. `SynapseDeck-Api-dev`
cannot be deployed on its own — its Lambdas join the VPC and take the database by
reference, so `cdk deploy` on it creates `AWS::RDS::DBInstance` too, which the diff shows
plainly. So:

- **Deployed:** the Auth stack. Cognito is free at this scale, permanently.
- **Local:** Postgres 18 for the database, and `scripts/dev-api.mjs` for the API — the
  real handlers behind real token verification, never deployed.

This finished the phase's *verification* without spending the AI budget on an idle
database. The Data and Api stacks stay written, synthesising, and undeployed until Phase B
needs a database, at which point criterion 9 and the rest of criterion 3 close together.

**State after session 2:** criteria 4, 6, 7 and 8 are met. Criterion 10 holds at the
template level — zero `AWS::EC2::NatGateway` and zero `AWS::EC2::EIP` across every
synthesised stack, checked again after the API stack was added, since a VPC Lambda is
exactly the thing that tempts CDK into creating one — but cannot be confirmed against the
account until something is deployed.

**Criterion 2 is dropped** (task 4). Criteria 1, 3, 5 and 9 all need a deploy and are
open.

A criterion the phase should have had and did not: **nothing checks that the API's
responses match what the client expects.** The client's row types come from
`src/types/database.ts` (generated from Supabase) and the server's from
`services/api/src/lib/rows.ts` (hand-written from the RDS migrations). They agree by
transcription. The first deploy is what will find out whether that is true.

---

## What went unverified

Larger than usual, and this section is the honest core of the phase.

- **Cross-tenant isolation.** This was previously guaranteed by Postgres and tested by
  `rls.test.ts`. It is now guaranteed by convention and checked, once, by hand
  (criterion 5). **Every table added after this phase inherits the risk and not the
  check.** This is the single most important consequence of retiring RLS and it should be
  the first thing revisited whenever a test suite returns.
- **The data-access layer's `where user_id` clauses.** The lint in task 11 checks the
  *shape* of the code — that a `userId` parameter exists and that handlers hold no SQL. It
  cannot check that the parameter is actually used in the query. A function that takes
  `userId` and ignores it passes every gate in this repository.
- **The ported RPCs.** `review_card`'s new `user_id` filters are the difference between a
  correct review and reviewing a stranger's card, and nothing exercises them.
- ~~**The identity migration.**~~ **Removed** — task 4 migrates nothing, so this whole
  failure mode no longer exists. Worth recording as a deletion rather than silently
  dropping it: it was the second-largest unverified risk in the phase, and the owner's
  decision to start clean is what removed it.
- **Migrations.** Already unguarded since ADR 0005; now also running against a database
  with no policy layer to refuse a mistake.

  **Worse than that as of session 1: the SQL has never been executed at all.** Not against
  RDS, not against a local Postgres, not against PGlite. It was ported by reading the
  Supabase originals and reviewed by reading it back. The owner chose this deliberately on
  2026-09-06 rather than standing up a database to run it through, so the first
  `npm run db:migrate` is a first execution and should be treated as one.

- **The lint itself was tested; the code it guards does not exist yet.** Every rule was
  exercised against fixtures — SQL in a handler, a wrong first parameter, an optional and
  a defaulted `userId`, `user_id` outside the data layer — and the clean fixtures pass
  without false positives. That is more than the rest of this repository can say. But it
  currently runs over two directories that do not exist, so it proves nothing about
  production code until task 5 lands.
- **Cold-start latency on interactive paths**, until task 2's measurement exists.

---

## Sessions

5–8, per the brief's §5. Tasks 1–3 are one or two sessions of infrastructure; 4–6 are the
migration proper and the riskiest; 7–8 are the API and frontend rewrite; 9–12 close it.

**Task 6 deserves its own session with nothing else in it.**
