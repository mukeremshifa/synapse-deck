# AWS-native — the brief

**Status:** Decisions made 2026-09-05 · **No plan written · No code changed**

This is a **brief**, not a phase plan. It exists to be handed to a planning session:
everything below is settled, and the planning session's job is to turn it into phase
plans under the convention in [README.md](README.md) — not to re-litigate it.

It replaces the earlier `AWS-MIGRATION.md`, which was written before the goal was stated
clearly and reached materially different conclusions as a result. Where the two disagree,
this file is correct. §10 records what changed and why, because the reasoning that was
wrong is instructive.

**The app runs on Supabase and Vercel today and keeps working until a phase plan says
otherwise.**

---

## 1. The goal, stated plainly

The owner has been accepted as an **AWS SBGL** and intends to apply as an **AWS Community
Builder**. The purpose of this work is a portfolio project that consumes those privileges
and demonstrates cloud-native engineering.

The acceptance criterion, in the owner's words: **at least one major division of the
product must be genuinely AWS-native by the end, and boastable** — or the time is better
spent elsewhere.

That is a legitimate requirement and this brief is designed against it, not around it.

**The governing test** every step must pass is not "does this let the product do something
new" — that is a product test, and it wrongly excludes work like observability that is
pure operations. The test is instead the six capabilities a cloud engineer is hired for:

> **design · deploy · observe · secure · cost-govern · operate** an AI product on AWS.

A step earns its place by demonstrating one of those. A step that demonstrates none is
service collection, and belongs in §9.

### What "boastable" excludes

One trap is worth naming because the earlier document walked into it. **Compute in AWS
that writes its state to a database somewhere else is not an AWS-native division** — it is
a coprocessor attached to someone else's product, and a reviewer will say so. A division
is AWS-native when it owns its data, its identity, its deployment and its observability.

That is why the division here is **the entire backend**, not "the pipeline."

---

## 2. What is true today

| Concern    | Today                                        | Fate                                 |
| ---------- | -------------------------------------------- | ------------------------------------ |
| Data       | Supabase Postgres, 5 migrations, RLS-forced  | → RDS Postgres; RLS retired (§3)     |
| Auth       | Supabase Auth, publishable-key mode          | → Cognito                            |
| Generation | Deno Edge Function → Groq, NDJSON over SSE   | → Lambda + Step Functions → Bedrock  |
| Hosting    | Vercel, static SPA                           | → S3 + CloudFront                    |
| Tests      | 359 tests, PGlite in-process Postgres        | **Kept** — RDS is still Postgres     |
| Frontend   | React SPA, design system, FSRS scheduler     | **Kept, nearly unchanged**           |

**The product does not change.** Upload material → generate cards → review with FSRS →
track progress. What changes is where it runs. The FSRS scheduler, the card schemas, the
design system and its three enforced invariants, the landing page, and the test suite all
survive; the Supabase-coupled layer (`src/lib/queries.ts`, the auth wrapper, the Edge
Function) is what gets rewritten.

---

## 3. Decisions

Each is settled. The planning session implements them; it does not reopen them. Where a
decision has a real cost, the cost is stated rather than hidden.

### D1 · Migrate the existing repo. Do not start fresh.

Same repo, same product, on a long-lived branch off `dev` per
[ADR 0003](../adr/0003-branching-model.md) clause 2 (work spanning many sessions).

Two reasons. **The surviving code is the expensive code** — seven phases of scheduler
logic, schemas, design system and tests are ~80% of the value and none of it is coupled to
Supabase. And, decisively for §1: **a from-scratch AWS project is a tutorial; a migration
is a case study.** "I hit a wall the architecture could not clear, migrated, and here is
the before, the after, and what each decision cost" demonstrates judgement under
constraint. Reviewers see hundreds of the other kind.

The git history — seven phases, ADRs, a recorded reason for every choice — is evidence
that cannot be fabricated afterwards. Starting fresh discards it.

**Repo layout is restructured** (`infra/`, `services/`, `web/`). That is a reorganisation,
not a rewrite, and it is what makes the repository read as a cloud project rather than a
React app with a folder of Lambdas.

### D2 · RLS is retired. Authorisation moves to the application layer.

The owner has another project that demonstrates RLS, so keeping it here buys a **duplicate
portfolio signal at the cost of constraining every other decision** — it is the single
assumption that was forcing Supabase to stay.

**This is the highest-risk decision in the brief and the cost must not be waved away.**
RLS is doing two jobs: a portfolio signal (duplicated — drop it) and an *enforcement
mechanism* (not duplicated — it must be replaced). Today Postgres makes cross-user access
impossible. After this, it becomes possible to write a query that leaks, and nothing but
tests will catch it.

The replacement is explicit and must be built, not assumed:

- a data-access layer where `userId` is a **required parameter**, never inferred
- `sub` from the verified JWT is the only source of `userId` — never a request body
- cross-tenant tests that assert user A cannot read user B, per table
- IAM scoped per function; S3 prefixes and DynamoDB partition keys keyed on `userId`

In §1 terms this is a **net gain in demonstrable security work**: JWT verification at the
edge, least-privilege IAM, and user-scoped access are more legible to a reviewer than
"Postgres enforces it." But it is only a gain if it is actually built.

`CLAUDE.md`'s "RLS is the entire security boundary" rule must be **rewritten in the same
phase that retires it**, not left contradicting the code.

### D3 · RDS Postgres for relational data. DynamoDB for pipeline state.

Two stores, each holding what it is good at. This split is deliberate and is itself the
strongest architectural artifact in the project.

| RDS Postgres (`db.t4g.micro`)            | DynamoDB                                  |
| ---------------------------------------- | ----------------------------------------- |
| Users, profiles, decks, cards            | Job status, per-chunk state               |
| Reviews and FSRS scheduling state        | Draft cards, pre-acceptance               |
| Progress aggregates                      | Token and cost accounting per job         |
| pgvector embeddings (§4 E)               |                                           |
| *Range scans, aggregation, joins*        | *Key-access by job id, free at idle*      |

**Why Postgres for the study loop:** the queries are relational — due cards by date across
decks, review-history aggregation over time windows. `20260812210000_progress_stats.sql`
exists because that aggregation was worth pushing into the database. Modelling it in
DynamoDB means either a second system for aggregates or a migration back.

**Why DynamoDB for pipeline state:** job and chunk state is key-access by job id with no
aggregation. That is the workload DynamoDB is genuinely good at, and it is free at idle.

**Why RDS and not Aurora Serverless v2:** RDS `db.t4g.micro` is on the **12-month free
tier**; Aurora v2 bills continuously against an ACU floor. Free tier covers the runway.

**Why not Supabase Postgres, which would also work:** it fails §1. The database would live
outside AWS, and per §1 that makes the backend a coprocessor rather than a division.

This split needs an **ADR** — it is the first thing a reviewer will ask to have justified,
and "we used both, here is the access-pattern analysis that put each dataset where it
went" is a better answer than either store alone.

### D4 · Cognito for identity.

Any OIDC provider integrates via an **API Gateway JWT authorizer**, and Auth0 or Clerk
would work — Clerk has materially better developer experience. Cognito wins on two
grounds: it removes a vendor from the diagram in a project whose entire point is being
AWS-native, and it is **free to 10k MAU**, which matters because auth is the one component
where switching later means re-migrating every identity.

The known cost is developer experience — the hosted UI is dated. Use it as a plain OIDC
provider behind the app's own screens, which the design system already provides.

`sub` becomes `userId` everywhere: the Postgres `user_id` column, DynamoDB partition keys,
S3 object prefixes. Identities migrate by id so existing rows still join.

### D5 · Step Functions for orchestration. Not SQS.

A document is fan-out over chunks with per-chunk retry and partial failure — Step
Functions' Map state, natively. SQS is the right answer for "one message, one job" and
arrives when there is a second producer. Standard workflow transitions are fractions of a
cent at ~40 per document, and **the execution graph is a genuinely good case-study
screenshot**.

### D6 · Bedrock is primary. Groq is the fallback, behind the interface.

The inverse of the earlier document. An AWS-native pipeline's model provider is Bedrock;
Groq remains as the second implementation of one interface, sharing the Zod schema at the
boundary that `src/lib/schemas.ts` already is.

**The eval harness is the valuable artifact** — "we A/B'd two providers on card quality and
have the numbers" is a stronger story than either provider alone, and it is AI engineering
rather than API plumbing.

Cost discipline: a small model (Haiku-class) for routine generation, larger models only
for an explicit "improve this deck" action.

### D7 · CDK in TypeScript, from the first resource.

`infra/`, TypeScript, separate **dev and prod stacks**. Not a later step — retrofitting IaC
over click-ops is worse than starting with it, and CDK typechecks inside the existing
`npm run check`.

### D8 · GitHub Actions with OIDC federation, deploying CDK.

This *is* the industry standard; CodePipeline is the weaker product and most AWS shops use
GitHub Actions for source anyway. **No long-lived AWS access keys** — a short-lived
assumed role via OIDC, which is a real security talking point.

**CDK Pipelines** (a self-mutating pipeline defined in TypeScript) is the interesting
AWS-native addition if one is wanted later. CodePipeline as a raw service is not.

The owner-only constraint on `git push`, merges, PRs and `main` is unchanged by any of
this.

### D9 · Observability and cost governance ship with the first resource.

Operational evidence cannot be retrofitted, and "I added observability after it broke" is
a worse story than "the first deploy had a dashboard." In the **first** AWS phase:

- CloudWatch dashboard, alarms, and **7–14 day log retention set in CDK** (the default is
  never-expire, and it creeps silently)
- X-Ray tracing across the pipeline
- a DLQ, with a deliberate story for what lands in it
- AWS Budgets at **$2 / $5 / $10 / $15** with email alerts
- cost allocation tags on every resource: `project`, `env`, `owner`
- **per-job token and cost accounting** written to DynamoDB

That last item is what produces *cost per document* and *cost per study session* — the
case-study artifact almost nobody else has.

### D10 · Design for agents now; build nothing.

Agentic capability is a stated possible future. One decision today makes it configuration
later and a different one makes it a rewrite:

> **Every pipeline capability is a Lambda with a schema-described input and output,
> invoked by the state machine. The state machine is one consumer; an agent runtime is a
> later second consumer.**

Extract, chunk, embed, generate, evaluate — each a clean operation, none with logic inlined
into an orchestration handler. This is the same instinct as `src/lib/schemas.ts` being the
one definition per concept.

Keeping those capabilities **MCP-shaped** costs nothing now and is the difference between
wiring up and rewriting, since Bedrock AgentCore Gateway speaks MCP. If it is ever built,
the AWS-native options are **Bedrock AgentCore** (managed runtime, memory, gateway,
identity, observability), **Bedrock Agents**, or **Strands Agents** as an SDK. **Nothing is
built now.**

---

## 4. Sequencing

Ordered by value per unit of risk. The planning session writes one plan at a time, per
[README.md](README.md); the last task of each plan writes the next.

**Phase 0 · Foundation.** CDK skeleton, dev/prod stacks, GitHub Actions with OIDC,
budgets, alarms, tagging, log retention. Deploys something trivial end to end. This exists
so every later phase inherits governance rather than promising it.

**Phase A · Backend migration.** RDS + Cognito + API Gateway + Lambda. Migrations move,
`src/lib/queries.ts` is rewritten against the new API, RLS is replaced per D2 with
cross-tenant tests. The riskiest phase, and the one that makes the division AWS-native.

**Phase B · Document pipeline.** S3 presigned upload → Step Functions → extract, chunk,
fan-out generate, write drafts. **Ends at `/create/document` working in the app** — see §7.

**Phase C · Bedrock and the eval harness.** Provider interface, both implementations, the
numbers.

**Phase D · Frontend to S3 + CloudFront.** Cheap, low-risk, completes the picture.

**Phase E · Semantic layer.** pgvector in RDS — an extension, free, next to the data,
testable under PGlite. **Not OpenSearch** (§9).

Phases D and E are genuinely optional against §1; A and B are not.

---

## 5. Cost

All figures on-demand `us-east-1`, rounded up. Runway is **$100 in credits expiring within
six months**, possibly more from SBGL and Community Builder.

**Portfolio mode — what will actually run.** Owner, a demo account, and whoever clicks the
link.

| Service                   | Monthly    | Note                                                  |
| ------------------------- | ---------- | ----------------------------------------------------- |
| RDS `db.t4g.micro`, 20 GB | **$0**     | Free tier, 12 months, 750 hrs                         |
| Lambda                    | **$0**     | 1M req + 400k GB-s, *always* free                     |
| API Gateway (HTTP)        | **$0–1**   | 1M req free for 12 months, then ~$1/M                 |
| S3                        | **$0–1**   | 5 GB free tier                                        |
| DynamoDB                  | **$0**     | 25 GB + 25 RCU/WCU always free                        |
| Step Functions            | **$0**     | 4,000 transitions/mo free; a document is ~40          |
| CloudFront                | **$0**     | 1 TB out + 10M req always free                        |
| Cognito                   | **$0**     | Free to 10k MAU                                       |
| CloudWatch                | **$0–3**   | 5 GB free — **only** with retention set (D9)          |
| X-Ray                     | **$0**     | 100k traces/mo free                                   |
| VPC interface endpoints   | **$0–14**  | ~$7/mo each if needed; S3 gateway endpoint is free    |
| SSM Parameter Store       | **$0**     | Use instead of Secrets Manager ($0.40/secret)         |
| Bedrock                   | **$2–10**  | The only real variable                                |

**Total: $5–20/month.** Six months costs roughly $30–100 of the $100. The free tier carries
the infrastructure; **the credits are effectively a Bedrock experimentation fund**, which is
the right place for them.

Bedrock sizing: a Haiku-class card generation is ~5k in / 2k out ≈ **$0.015**. A 60-page
document over ~15 chunks ≈ **$0.25**. A hundred documents a month stays under $30.

**After the free tier (month 13+).** RDS on-demand ~$12 + ~$2 storage dominates;
everything else stays near-free at low volume. **~$20–35/month**, and a 1-year reserved
instance cuts the RDS portion ~40%. Comfortably inside the owner's stated $100/month
ceiling, which is a fallback and not a design constraint.

**The traps, in order of likelihood.** Each is a design constraint, not a caution:

1. **NAT Gateway — ~$32/mo plus data.** The classic surprise bill, and entirely avoidable:
   private subnets with **VPC endpoints** for Bedrock and S3, never a NAT Gateway. If a
   plan finds itself adding one, stop and ask.
2. **Aurora Serverless v2** instead of RDS — the ACU floor bills continuously (D3).
3. **CloudWatch retention left at never-expire** — the default (D9).
4. **A Step Functions retry loop calling Bedrock.** Cap retries, set a DLQ, keep the
   existing per-user quota logic in `src/lib/quota.ts` as an app-level ceiling.
5. **OpenSearch — $50+/mo minimum.** Use pgvector (§9).

**Verify before committing:** Lambda-in-VPC cold-start latency on interactive paths. It has
improved substantially but it is a measurement for Phase A, not an assumption.

---

## 6. Open questions the planning session must settle

Decisions above are closed. These are genuinely open and each belongs in a specific plan:

1. **Multi-chunk quota shape.** "One document = 12 of your 30 monthly generations" is a
   *product* decision, not an implementation detail. Blocks Phase B.
2. **Progress reporting once it is no longer one SSE stream.** Job-status polling is the
   boring and probably correct answer. Blocks Phase B.
3. **How a half-failed job presents to the user.** Partial failure is the normal case in a
   fan-out, not the exception.
4. **The draft-card seam.** Drafts live in DynamoDB; acceptance writes to Postgres. One
   audited write path, not fifteen scattered ones.
5. **PGlite harness after the move.** RDS is still Postgres so it should survive, and
   `supabase/pg-version.json` must be re-pointed at the RDS major.
6. **Scanned PDFs have no text layer.** Detecting that in the browser before a 20 MB upload
   is worth more than any server-side cleverness after.

---

## 7. Hard constraints on any plan written from this brief

1. **Phase B ends with `/create/document` working in the app.** A pipeline with no front
   door is not a boastable division. A green execution in the Step Functions console is
   not the acceptance criterion.
2. **`dev` keeps working throughout.** The migration lives on a long-lived branch. If it
   stalls, the loss is a branch, not the product.
3. **No NAT Gateway** (§5).
4. **Budgets and tagging exist before the first billable resource** — Phase 0, not later.
5. **D2's replacement authorisation is built with the phase that retires RLS**, including
   its cross-tenant tests and the `CLAUDE.md` rewrite. Not deferred.
6. **Two ADRs before the code they justify:** the D3 data-store split, and D4 auth.
7. **`npm run verify` is green and there is a known-good deployed state** before Phase A
   begins — see §8.

---

## 8. The one blocker that is the owner's

Local `dev` is **16 commits ahead of both `origin/dev` and `origin/main`**, and Vercel has
never been connected, so nothing is deployed. There is no known-good deployed state to
return to.

**Push, and deploy the current app to Vercel, before Phase A.** Not to keep it — to have a
"before" that exists. It is also the first half of the case study.

Per `CLAUDE.md` this is the owner's alone: no session pushes, merges, or opens a PR.

---

## 9. Deliberately not doing

Named explicitly, because the failure mode of an "AWS-native" rewrite is collecting
services. Each of these looks good in a technology list and would make the product worse.

- **OpenSearch.** $50+/mo minimum for vector search over one user's decks. pgvector in the
  RDS instance already there is free, testable under PGlite, and next to the data. Choosing
  OpenSearch here would be the clearest possible case of the mistake §1 warns about.
- **Kubernetes / EKS.** An SPA and a handful of Lambdas do not need an orchestrator.
- **Microservices.** One product, one team of one.
- **SageMaker training.** No labelled dataset, no model to train. Bedrock is inference,
  which is what this product needs.
- **Multi-region.** No users outside one region.
- **CodePipeline as a raw service** (D8).
- **DynamoDB for the study loop** (D3).
- **A message bus for its own sake.** SQS arrives with a second producer (D5).
- **Agentic capability, for now** (D10) — designed for, not built.

---

## 10. What changed from `AWS-MIGRATION.md`, and why

The earlier document was written before the goal in §1 was stated. It optimised for lowest
idle cost and least migration risk and concluded "stay on Supabase Postgres, defer Cognito,
possibly never migrate hosting" — sound advice for a product with users, and **wrong for
this project**, because it ends with an app that runs on Supabase and Vercel with some
Lambdas attached and no division that can honestly be called AWS-native.

Four corrections, each traceable to a specific input:

| Then                               | Now                          | Because                                               |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------- |
| Keep RLS; it is the boundary       | Retire it (D2)               | Another project already demonstrates it               |
| Stay on Supabase Postgres          | RDS (D3)                     | RLS was the only thing pinning it there               |
| Aurora rejected on idle cost       | RDS free tier, NAT avoidable | Cost objection was overstated; VPC endpoints, not NAT |
| Cognito deferred, "possibly never" | Cognito (D4)                 | Auth outside AWS breaks the §1 division               |

The general lesson, worth keeping: **the earlier document applied a product test to a
portfolio goal.** Both are legitimate; using the wrong one produces confident, coherent,
wrong advice.

---

## 11. Next action

Hand this file to a planning session. Its first output is **Phase 0's plan** —
`docs/plans/P8-aws-foundation.md` — written against the codebase it will run in, following
the convention in [README.md](README.md).

Until that plan exists and the owner says go, this file is a decision record. The app runs
on Supabase and it works.
