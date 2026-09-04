# AWS-native — the direction, not yet a phase

**Status:** Direction agreed 2026-09-05 · **No execution plan written yet** · **No code changed**

This file is not a phase plan. `docs/plans/README.md` explains why only the next phase gets
one: a plan written against a codebase that does not exist yet is fiction. This is the
level above that — the shape of the migration, what each step buys, and what has to be
true before any of it starts.

**Nothing here has been executed.** The app runs on Supabase and Vercel today and keeps
working exactly as it does now until a phase plan is written and run.

---

## 1. Why do this at all

The stated goal is a project that demonstrates AI and full-stack engineering together, on
AWS. That is a career goal, and it is a legitimate reason to build something — but it is a
_bad_ reason to make a specific technical choice, because "it looks good on a CV" argues
equally well for every service on the list.

So this document holds itself to a stricter test. Every step below has to answer: **what
does this let the product do that it cannot do today?** A step with no answer is
résumé-driven development, and it belongs in the "deliberately not doing" section at the
bottom rather than in the plan.

There is one honest exception, stated plainly: some of this is worth building because
operating it teaches something that reading about it does not. Where that is the real
reason, it says so.

---

## 2. What is actually true today

| Concern    | Today                                       | Notes                                             |
| ---------- | ------------------------------------------- | ------------------------------------------------- |
| Data       | Supabase Postgres, 5 migrations, RLS-forced | RLS is the entire security boundary                |
| Auth       | Supabase Auth, publishable-key mode         | ~200 lines of the app touch it                     |
| Generation | Deno Edge Function → Groq, NDJSON over SSE  | Single request holds a stream; wall-clock limited  |
| Hosting    | Vercel, static SPA                          | `vercel.json` handles rewrites and caching         |
| Tests      | 31 suites, PGlite in-process Postgres       | Migrations and RLS verified with no cloud round-trip |

**This stack is good.** It is not a prototype to be escaped — it is a working, deployed,
tested product with a real security boundary. Any replacement has to clear the bar it
already sets, and two things in that table are genuinely hard to beat:

- **RLS.** Postgres enforces per-user isolation in the database. Move to a stack where
  authorisation lives in application code and every future endpoint becomes a place to get
  it wrong.
- **PGlite tests.** Migrations and policies are verified in-process, no Docker, no cloud.
  Most AWS data stores have no equivalent, and losing it would slow every future change.

Neither is a reason not to migrate. Both are reasons to know what is being traded.

---

## 3. The one real product constraint

From `POST-V1.md`, item 2 — documents. The finding there is the most important input to
this whole document:

> A 60-page PDF is _n_ generations, not one. Edge Functions have a wall-clock limit and
> the SSE stream is already the longest-lived thing in the app; a document is the first
> feature that cannot be modelled as one request holding one stream.

**That is a genuine architectural wall, and it is the only one currently in sight.** It is
not "Supabase is bad" — it is "this feature needs a job queue and a worker that can run
for minutes, and the current design has neither."

Which is why the sequencing below leads with the async pipeline. It is the step with a
real product justification, it is additive, and it is the one where AWS is genuinely the
right tool rather than merely a different one.

---

## 4. Sequencing

Ordered by **value per unit of risk**, not by architectural tidiness.

### A · Async document pipeline — *additive, high value*

The document feature, built as a real job pipeline instead of a longer request.

```
upload → S3 → EventBridge → Step Functions
                              ├─ extract text (Lambda)
                              ├─ chunk           (Lambda)
                              ├─ fan-out generate per chunk (Map state)
                              └─ write cards back to Postgres
```

**Why AWS genuinely wins:** Step Functions gives durable orchestration, per-chunk retries,
and a job that survives minutes of work — all things a single HTTP request cannot do at
any provider. The Map state handles fan-out over chunks natively.

**Why it is first:** it is purely additive. Nothing that works today stops working. It
ships a feature the product actually wants, and it is where the interesting engineering
is — chunking, partial failure, progress reporting on a job that outlives its request.

**Open questions to settle in the plan:** how progress reaches the browser once it is no
longer one SSE stream (job status polling is the boring, probably correct answer);
per-chunk quota accounting against the existing 30/month; how a half-failed job presents
to the user.

### B · Bedrock alongside Groq — *additive, moderate value*

Put the provider behind an interface and add Bedrock as a second implementation.

**What it buys:** Groq's free tier is a real constraint (`GENERATION_LIMITS`, 3/60s burst).
A second provider is genuine resilience, not just a logo. Bedrock also opens Claude models
with a different quality/cost curve than Groq's hosted open models.

**The engineering that matters** is the abstraction, not the API call: one interface, two
implementations, a shared Zod schema at the boundary (`src/lib/schemas.ts` already is that
boundary), and an evaluation harness that says which provider is actually producing better
cards. **The eval harness is the valuable artifact here** — "we A/B'd two model providers
on card quality and have the numbers" is a stronger story than either provider alone.

### C · Semantic layer — *additive, product-led*

Embeddings over cards and source text, enabling: duplicate detection at the review gate,
"cards related to this one", and semantic search across decks.

**Start with `pgvector` in the existing Postgres.** It is one migration, it keeps the data
next to everything else, and it is testable under PGlite. Move to OpenSearch or Bedrock
Knowledge Bases only when a measured limit says to — vector search over one user's decks
is small data, and reaching for a managed vector service first would be the exact
résumé-driven mistake §1 warns about.

### D · Infrastructure as code — *from the first AWS resource*

AWS CDK in TypeScript, in `infra/`. Not a later step: the first Lambda gets defined in CDK,
because retrofitting IaC over click-ops resources is worse than starting with it.

CDK over Terraform specifically because the repo is already TypeScript and the constructs
are typed — one language, and the infra typechecks in the same `npm run check`.

### E · Auth and hosting migration — *deferred, and possibly never*

Cognito instead of Supabase Auth; S3 + CloudFront instead of Vercel.

**Deliberately last, and genuinely optional.** Neither buys the product anything. Supabase
Auth works, and Vercel serves a static SPA about as well as anything can. The one real
argument is consolidation — one bill, one IAM model, one place to look — and that argument
gets stronger the more of A–D exists, which is exactly why it comes after them and not
before.

If it happens: Cognito user pool, migrate identities by ID so `profiles.user_id` still
joins, and expect the RLS story to be the hard part (Postgres RLS keyed on Cognito `sub`
via a JWT claim, rather than `auth.uid()`).

---

## 5. The database question

The one genuinely hard decision, deliberately unresolved here — it deserves its own ADR
written when it is actually being made, not a paragraph now.

| Option                       | For                                                              | Against                                                     |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| **Stay on Supabase Postgres** | RLS keeps working; PGlite tests keep working; zero migration cost | Data lives outside AWS; two bills                           |
| **Aurora Serverless v2**      | Real Postgres, so RLS and migrations port nearly unchanged        | Costs real money at idle; needs VPC plumbing for Lambda     |
| **DynamoDB**                 | Cheap, scales, the "AWS-native" answer                           | **Loses RLS entirely**; FSRS queries are relational          |

The current lean is **stay on Postgres** — Supabase's or Aurora's — because the FSRS
scheduler's queries (due cards by date across decks, review-history aggregation for
progress) are relational, and because RLS is not a convenience to be reimplemented in
application code.

DynamoDB is listed for completeness and is probably wrong for this workload. Choosing it
to have used DynamoDB would be the clearest possible example of the mistake §1 warns
about.

---

## 6. What this deliberately does not do

Named explicitly, because the failure mode of an "AWS-native" rewrite is collecting
services:

- **Kubernetes / EKS.** A React SPA and a handful of Lambdas do not need an orchestrator.
- **Microservices.** One product, one team of one.
- **SageMaker training.** No labelled dataset and no model to train. Bedrock is inference,
  which is what this product actually needs.
- **Multi-region.** No users outside one region.
- **A message bus for its own sake.** Step Functions covers the one async workflow. SQS
  arrives when there is a second producer.

Each of these looks good in a list of technologies and would make the product worse.

---

## 7. Before any of this starts

1. **A phase plan exists** for the specific step, in `docs/plans/`, following the
   convention in `README.md`.
2. **An ADR is written** for the choice being made — §5 above at minimum (ADR 0001).
3. **Cost is bounded.** A billing alarm and a budget exist *before* the first resource. A
   Step Functions bug that retries forever is a real bill, unlike anything in the current
   free-tier stack.
4. **`npm run verify` is green** and `main` is deployable, so there is a known-good state
   to return to.

---

## 8. Next action

None automatically. The direction is agreed; the first executable step is **A — the async
document pipeline**, and it starts by writing `docs/plans/P8-documents.md`.

Until that plan exists and the owner says go, this file is a decision record, not a
backlog. The app runs on Supabase and it works.
