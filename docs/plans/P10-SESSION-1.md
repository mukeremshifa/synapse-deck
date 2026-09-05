# P10, session 1 — take off from here

A fresh session should be able to read this file and start working. It is the handover
from the sessions that finished P9 on 2026-09-06, and it is deliberately short: the detail
is in [P10-ingestion.md](P10-ingestion.md), and this is what that plan assumes you already
know.

---

## The one-paragraph version

P9 is done — the backend moved to Cognito + an HTTP API + Postgres, RLS is retired, and
nine of its ten acceptance criteria are met with recorded evidence. **The database and the
API run locally on purpose**, because RDS is the only line in this project that bills and
the AWS credits are reserved for Phase B's Bedrock work. Your job is Phase B: document
ingestion through S3, Step Functions and Bedrock. Start local, deploy RDS only when the
pipeline genuinely needs a database.

---

## Get the backend up — two commands

```bash
pg_isready                    # PG 18 must be listening on 5432
npm run db:migrate:status     # expect: 2 applied, 0 pending
npm run dev:api               # the API on :8787
npm run dev                   # the SPA on :5173, pointed at :8787
```

`dev:api` needs `PGPASSWORD` for the `synapsedeck_app` role. `.env.local` holds the
Cognito ids and `VITE_API_URL`; it is gitignored, so if it is missing rebuild it from
[.env.example](../../.env.example) plus the `SynapseDeck-Auth-dev` stack outputs.

If the local database is gone entirely:

```sql
CREATE ROLE synapsedeck_app LOGIN PASSWORD '<pick one>';
CREATE DATABASE synapsedeck OWNER synapsedeck_app;
```

then `npm run db:migrate`. The ledger makes it idempotent.

---

## What is deployed, and what deliberately is not

| | Where | Cost |
| --- | --- | --- |
| Cognito user pool | **AWS**, `us-east-1_8byyB8D2H` | $0 — free to 50k MAU |
| Budgets, alarms, version fn | **AWS** (P8) | $0 |
| Postgres | **Local**, PG 18 | $0 |
| The API | **Local**, `scripts/dev-api.mjs` | $0 |
| RDS + VPC, API Gateway + Lambdas | **Written and synthesising. Not deployed.** | — |

**Total added monthly cost so far: $0.** Credits: $140, expiring 2027-03-03, $0 spent.

### The trap, stated once

**`cdk deploy SynapseDeck-Api-dev` creates RDS as a side effect.** The API Lambdas join
the VPC and take the database by reference, so CloudFormation pulls the whole Data stack
in. There is no "just deploy the free API stack". `cdk diff` shows this plainly — read it.

Also: **any `cdk` command that deploys needs `ALERT_EMAIL` set.** Without it the foundation
stack's four budgets and the alert subscription are *destroyed*, which is the cost
governance vanishing exactly when spending starts. It shows up in `cdk diff` as `[-]`
lines.

---

## What is proven, so you do not re-verify it

All of this was executed, not just typechecked. Evidence is recorded in
[P9-aws-slice.md](P9-aws-slice.md) under criteria 1, 3 and 5.

- Both migrations apply clean. Five tables, three RPCs, **zero RLS policies**.
- `review_card` / `undo_last_review` refuse another user's card with `PT404`; stale
  `updated_at` gives `PT409`; the append-only trigger gives `PT403`.
- Every data-access function runs; every cross-tenant probe returns `[]` or `null`.
- 32 handler checks pass. **Every cross-tenant call answers 404, never 403.**
- The four SQLSTATEs `http.ts` maps are the four the database actually raises.
- Real Cognito signup and SRP sign-in; `profile.id === token.sub`.
- Token verification refuses a forged `sub`, an id token, and a stripped signature.

## What is not proven — the short list

1. **The browser against the API.** `queries.ts` was rewritten to call `api-client.ts` and
   no browser has made one of those calls. Row types agree with the server's by
   transcription. **This is task 1 and the most likely place to find a bug.**
2. **API Gateway's routing and authorizer.** Never ran; `dev-api.mjs` stood in.
3. **PG 17.** Local is 18; RDS is pinned to 17.
4. **Cold start for a Lambda in a VPC.** P9 criterion 9, still open.

2–4 all close together at task 12, the RDS checkpoint.

---

## Three things that will bite you

**`dev-api.mjs` mirrors `api-stack.ts` by hand.** A route added to one and forgotten in
the other is a bug that surfaces weeks later at the RDS checkpoint. Add routes to both, in
the same commit. See task 1b.

**No TypeScript parameter properties in `services/api/`.** Node's `--experimental-strip-types`
rejects `constructor(readonly x: number)` outright. esbuild transpiles it fine, so it
passes `verify` and breaks only when the code is run locally — which is now how everything
is run. Same family as the `enum` ban in `infra/`.

**The brief's §6 cost table is wrong about RDS.** It claims "$0, free tier, 12 months".
This account is on AWS's newer credit-based free plan — verified: `get-free-tier-usage`
returns only `Always Free` entries, no 12-month RDS line. RDS bills ~$14/mo against
credits. Fix the table when you touch cost (acceptance criterion 12).

---

## Your first move

Read [P10-ingestion.md](P10-ingestion.md) — the whole plan, it is not long — then do task 1:
bring the local backend up and drive the app in a browser. Fix what breaks.

After that, task 2 (DynamoDB job state) is where Phase B actually begins.

**Before writing any Bedrock code**, confirm model access is granted in `us-east-1`. It is
per-account, per-model, requested in the console, and CDK cannot grant it. An unavailable
model surfaces as an `AccessDeniedException` deep inside a Step Functions execution, which
is an expensive and confusing place to discover it.
