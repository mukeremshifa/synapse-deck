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
- **§8 constraint 7 — the "before" state.** The brief asks for the current app deployed to
  Vercel before Phase A, "not to keep it — to have a 'before' that exists."

  **The owner has deferred production deployment to a real checkpoint (2026-09-06), and
  that is respected here.** What actually expires is narrow, so this precondition is
  narrow too:

  > **Before task 4, capture the pre-migration app.** Task 4 migrates identities and is
  > the first irreversible step; after it, the pre-migration app cannot be run again
  > against real data.

  A deploy is *one* way to satisfy that and is no longer required. Cheaper options that
  close the same window, in ascending order of effort:

  1. **A local capture** — run `npm run dev` against the current Supabase project and
     record a short screen capture of the working loop (sign in → deck → practise →
     progress), plus screenshots. Costs ten minutes and no infrastructure.
  2. ✅ **A tagged commit** — **done 2026-09-06.** `pre-aws-migration` points at `45af283`,
     the last purely Supabase + Vercel commit: RLS forced on five tables, Supabase Auth,
     the Deno Edge Function, no `infra/`. Pushed. Run it with
     `git switch --detach pre-aws-migration && npm ci && npm run dev`.
  3. **A Vercel deploy**, if and when the owner wants a live before/after at a checkpoint.
     Still available *after* the migration — the tag is what keeps it possible.

  **Option 1 is the one still outstanding, and it is minutes of work.** Do it before task
  4. It is the difference between a case study that shows the migration and one that
  describes it. It is not a production deployment and commits to nothing.
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
| `generations` + quota | **Supabase** — untouched | Phase B |
| `/create/text` generation | **Supabase Edge Function** — untouched | Phase B |

**Why `/progress` and generation stay.** Progress reads
`20260812210000_progress_stats.sql`, an aggregate that would have to be ported wholesale;
generation is being rewritten by Phase B anyway (SSE → job polling), so migrating it now
means writing it twice. Both would violate "no feature is built twice."

**The consequence, and it must be visible in the app, not hidden:** for the duration, a
user's decks live in RDS while their progress chart reads Supabase. **Task 10 makes
`/progress` state plainly that it is showing pre-migration data**, rather than silently
showing a chart that no longer matches the deck list.

**Phase F ends this and is not optional.**

---

## Tasks

Ordered so the app runs after every one, and so nothing irreversible happens before the
"before" state exists.

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

### 4. Cognito ↔ existing identities — the cutover

**Capture the "before" first** (see preconditions) — a local recording and a
`pre-aws-migration` tag, or a deploy if the owner has chosen one by then. This is the
first irreversible step in the phase, and the last moment the pre-migration app can be run
against real data.

- Export existing Supabase users. Import into Cognito **preserving `sub`**, so every
  `user_id` in the ported data still joins.
- If `sub` cannot be preserved for some users, the fallback is a `user_id` remap table
  applied during the data copy — **decide which before writing the import**, because
  discovering it halfway means a partial migration.
- Passwords do not migrate. Users reset. **Say this in the app**, do not let it be
  discovered at a failed sign-in.

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
2. An existing user signs in with the same `sub`, and their pre-migration decks are
   visible — proving the identity migration preserved the join.
3. Creating a deck, adding cards, practising, and reviewing all work end to end through
   API Gateway → Lambda → RDS.
4. `npm run verify` is green, including the new data-access lint.
5. **The manual cross-tenant check**, run once by hand and recorded here with its output —
   see "What went unverified". Two accounts; account B calls `GET /decks/{a-deck-id}` with
   A's deck id and a valid B token; the response is 404 (not 403, which confirms the id
   exists). Repeat for one card and one review.
6. `dev` is untouched, still on Supabase, still working.
7. `/progress` states that it is showing pre-migration data.
8. `CLAUDE.md` no longer claims RLS is the boundary.
9. Lambda-in-VPC cold start is measured and the number is written into task 2.
10. **No NAT Gateway exists in the account.** `aws ec2 describe-nat-gateways` returns
    empty.

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
- **The identity migration.** If `sub` is not preserved for some subset of users, the
  symptom is an empty deck list for exactly those users, and there is nothing that would
  catch it before they report it.
- **Migrations.** Already unguarded since ADR 0005; now also running against a database
  with no policy layer to refuse a mistake.
- **Cold-start latency on interactive paths**, until task 2's measurement exists.

---

## Sessions

5–8, per the brief's §5. Tasks 1–3 are one or two sessions of infrastructure; 4–6 are the
migration proper and the riskiest; 7–8 are the API and frontend rewrite; 9–12 close it.

**Task 6 deserves its own session with nothing else in it.**
