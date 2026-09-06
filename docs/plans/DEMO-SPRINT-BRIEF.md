# Demo sprint — building the product while AWS is unavailable

**Written 2026-09-06.** A brief, not a phase plan: it changes no code and records
decisions, in the same register as [AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md). Its first
output is a phase plan, not a commit.

---

## 1. What happened

Two things arrived on the same day and they compound.

1. **Bedrock model access is not granted**, and the account is new enough that the grant
   could take a week. P10 task 10 and all of P12 are blocked behind it — the pipeline has
   never once called a real model.
2. **RDS is not worth paying for yet.** ~$14/mo for an idle database whose only consumer
   is a pipeline that cannot generate anything. `scripts/dev-api.mjs` was written in P9
   for exactly this reason and its header already says so.

Against that: **a demoable product is due in 3–4 weeks** for a hackathon-style event, and
the owner's assessment is that the product is far from where it should be in UI/UX,
features and capability. AWS is not required for the event.

So the constraint inverts. The AWS-native brief optimised for _demonstrating AWS_; for the
next few weeks the product itself is the deliverable and AWS is an implementation detail
that is temporarily unavailable.

## 2. The decision

**Build the product against portable infrastructure. Do not remove the AWS work, and do
not build anything that AWS's return would invalidate.**

The owner's constraint, stated verbatim: _"whatever i do shouldnt be redesigned and
written when aws comes back later."_ Every decision below is tested against it.

This is deliberately **not** a migration off AWS. `infra/` stays, the deployed Cognito pool
stays, the CDK stacks stay synthesisable. What changes is which implementation of three
seams is running.

## 3. Why this is cheap, which is the finding that made it the plan

The repository was already built for this and nobody had noticed, because each piece was
justified on its own local grounds rather than as portability.

**The frontend has no AWS coupling at all.** `src/lib/api-client.ts` is `fetch` against
`VITE_API_URL` with a bearer token. `src/lib/cognito.ts` is one isolated module. None of
the eleven feature folders import either. The exam half — blueprint, diagnostic, exam
runner, study plan — runs on fixtures and five pure modules that import no data layer at
all, which is the property the fixture convention was built to prove and this is the first
time it has been cashed in.

**The provider seam already exists.** `services/api/src/lib/providers/` defines
`CardProvider` and resolves it from `CARD_PROVIDER`. Its own doc comment says the reason
is having two providers to compare, not portability — but portability is what it bought.
Adding Groq is implementing one interface and widening one union.

**The database is Postgres and nothing else.** Every module in `services/api/src/data/`
except three uses `pg` and plain SQL. Neon speaks the same wire protocol as RDS, so the
migrations, the data layer, the `PG*` variables and `services/api/migrations/run.mjs` are
all unchanged by the swap.

**The AWS-bound code is exactly three modules, and they are already behind the data-layer
door** — which is ADR 0008's rule doing work it was not written for:

| Module             | AWS service    | Why it is replaceable                                                       |
| ------------------ | -------------- | --------------------------------------------------------------------------- |
| `data/jobs.ts`     | DynamoDB       | 8 exported functions, `userId` first. Job state is a Postgres table anywhere else |
| `data/uploads.ts`  | S3             | 4 exported functions. A presigned PUT becomes a local/R2 write               |
| `data/pipeline.ts` | Step Functions | **1 exported function**, `startIngestion`                                    |

That is the whole surface. Handlers call these; nothing else does; `check-data-access.mjs`
enforces that mechanically. **Replacing them is implementing three interfaces that already
have exactly one caller each.**

## 4. Decisions

### D1 — Groq behind the existing provider seam, free tier first

`CARD_PROVIDER=groq`, implementing `providers/groq.ts` against the interface that is
already there. The key exists (a Supabase Edge Function secret since 2026-08-12); it moves
to `.env.local` and later to a secret store.

Free, fast, and — the point — **`bedrock.ts` lands beside it rather than instead of it.**
Two providers answering the same question is what the seam was built for and what Phase E's
eval harness needs. The free tier is the cheapest way to find out whether the quality is
adequate; if grounded chat disappoints, a paid provider is a third file, not a rewrite.

**The stub's rule survives untouched.** A real provider does not make `CARD_PROVIDER=stub`
safer, and `resolveProvider()` still has no default.

### D2 — Neon for Postgres

Free serverless Postgres with `pgvector` available. The migrations run against it with
`npm run db:migrate` as written.

Chosen over staying local because a demo that only runs on the owner's laptop is not a
demo, and over Supabase Postgres because reintroducing that client path would undo the
dual-stack untangling P9 spent a phase on.

**RDS returns as a connection string.** No code changes, because there is no code that
knows which Postgres it is talking to.

### D3 — Cognito stays, and is not touched

It is deployed, it works, its free tier is 50k MAU, and it costs nothing idle. Auth is the
one piece of AWS that is already unblocked, so replacing it would be pure loss: work now,
work again later, and a demo with weaker identity in between.

This is worth stating because "take it off AWS" reads as _all_ of AWS, and the correct
scope is narrower.

### D4 — Job state moves to Postgres; the DynamoDB module stays

A `jobs` table and a `job_chunks` table behind the same eight function signatures
`data/jobs.ts` exports today. `data/jobs-dynamo.ts` is kept, not deleted, and a `JOB_STORE`
variable picks between them the way `CARD_PROVIDER` picks a provider.

**This is a real loss and it should be recorded rather than glossed.** DynamoDB's partition
key makes `userId` the _address_ of the data; Postgres makes it a filter, which is ADR
0008's admitted weakness applied to one more table. The Postgres implementation therefore
carries all four tenancy rules, and the similarity-search trap in
[P12 §6](P12-grounded-chat.md) applies here too.

### D5 — Fan-out becomes a bounded in-process loop; Step Functions stays

`startIngestion` is one function. The portable implementation processes chunks with a small
concurrency limit and writes the same job records, so `/progress` polling — which the
frontend already does — is unchanged.

**What is genuinely lost: per-chunk retry, and durability across a crash.** Step Functions
gave both declaratively. The loop must implement bounded retry itself, honouring the
retryable/non-retryable distinction `pipeline-generate.ts` already documents, and a job
interrupted mid-run is a job that stays `running` forever unless something reaps it. Say
this out loud rather than discovering it during a demo.

`MAX_CHUNKS_PER_JOB = 40` stays. It was a cost control against Bedrock and it is now also
what keeps the in-process loop bounded.

### D6 — pgvector on Neon for P12's retrieval

Same extension, same SQL, same `<->` operator as pgvector on RDS. P12's task 2 asked for
this decision to be justified in an ADR rather than made silently; the justification is
unchanged by the pivot and gets written when the phase runs.

Embeddings need a provider too. If Groq has no embedding model that fits, a dedicated
embedding provider is a second seam — and it must be a seam, for the same reason the card
provider is one.

### D7 — Vercel for the frontend, and one host for the API

`vercel.json` was written at P4 and its SPA rewrite is reasoned about in three documents.
The API becomes one long-running Node process rather than per-route Lambdas — the handlers
are already `(input) => Promise<output>` functions with the routing table declared in
`dev-api.mjs`, so this is a production-grade version of a server that already exists.

**`dev-api.mjs` itself is still never deployed.** It fakes route matching by hand and its
header says so; the deployable server shares the handlers, not the file.

## 5. What this explicitly does not do

- **Does not delete `infra/`.** The stacks stay, stay synthesisable, and stay in `verify`.
- **Does not touch `main`.** Frozen at `0bdc858`, owner's alone.
- **Does not merge into `dev`.** Still a checkpoint decision for the owner.
- **Does not remove Cognito, the AWS SDK dependencies, or the DynamoDB and Step Functions
  implementations.** Each becomes one side of a seam.
- **Does not relax the tenancy rules.** Every new table gets a data-access module obeying
  all four, and a new table without one is a cross-tenant leak, not a TODO.
- **Does not reintroduce a test suite.** ADR 0005 stands. Report "typechecks and builds".

## 6. The trap this brief exists to name

**A seam built to be temporary becomes permanent, and a seam built once serves twice.**

The failure mode is not "we picked the wrong provider". It is writing
`if (process.env.USE_AWS)` through the handlers, so that AWS's return means finding every
branch. That is what ADR 0008's rule 3 already forbids for SQL, and the same rule covers
this: **the seam is the data-access module boundary, and there is no branching above it.**

The second trap is subtler and this is the phase most exposed to it. Three of the most
convincing screens render fixtures and say so on screen. Under demo pressure the temptation
is to make them look real by making the disclosure quieter. **The disclosure is the
feature** — the same argument `stub.ts` makes at length about fake cards, applied to fake
data. A screen that says its numbers are samples is honest; the same screen with the label
removed is a lie told to a judge.

## 7. Phases

Written as the AWS-native brief's are: scoped here, planned one at a time against the
codebase each will run in.

| #       | Phase                | Delivers                                                                                                                                          |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS1** | Portable spine       | Neon + `db:migrate`, `providers/groq.ts`, jobs in Postgres, the in-process fan-out. **Upload a document, get real cards.** Unblocks four inert affordances |
| **DS2** | Grounded chat        | pgvector, embeddings on ingestion, retrieval endpoint, citations, the chat pane. P12 re-aimed at portable infrastructure; its §3 no-stub-answers rule inherited verbatim |
| **DS3** | Fixtures become real | Blueprint, diagnostic and exam runner off fixtures. Three impressive-but-fake screens become the loop                                              |
| **DS4** | Surface              | UI/UX, motion, mobile, and the differentiating features. Judged on how it demos                                                                   |
| **DS5** | Deploy + rehearse    | Vercel, the API host, seeded demo account, a rehearsed path through the product                                                                   |

**Ordered by what unblocks what.** DS1 first because nothing downstream is real without it
and it alone unblocks four affordances. DS4 is deliberately not first despite being the
owner's stated pain: polish on fixtures is polish that gets redone when the data arrives.

DS5 is last and must not be later than it sounds. A demo path that has never been walked
end to end on the deployed thing is the most common way an otherwise finished product
fails in the room.

## 8. When AWS returns

Not a migration. Environment variables and two new files — **with one exception, added at
DS2, that is a real migration and is marked as such:**

| Seam      | Demo                 | AWS                                             |
| --------- | -------------------- | ----------------------------------------------- |
| Model     | `CARD_PROVIDER=groq` | `CARD_PROVIDER=bedrock` + `providers/bedrock.ts` |
| Postgres  | `PG*` → Neon         | `PG*` → RDS. No code change                     |
| Jobs      | `JOB_STORE=postgres` | `JOB_STORE=dynamo`. Module already written      |
| Fan-out   | in-process           | Step Functions. Module already written          |
| **Embedder** (DS2) | `EMBEDDING_PROVIDER=openai` | `EMBEDDING_PROVIDER=bedrock` + `embeddings/bedrock.ts` — **plus a re-embedding of the whole corpus. Not a config change.** |
| Identity  | Cognito              | Cognito. Unchanged                              |
| Frontend  | Vercel               | Unchanged, or CloudFront                        |

**The embedder row is the one that costs money and time.** Two models embed into different
vector spaces, so a corpus written by OpenAI and queried by Titan returns real rows in a
plausible order that means nothing — no error, no symptom except wrong answers.
`scripts/backfill-embeddings.mjs` is the tool; `chunk_embeddings.model` is how you check.
See [ADR 0012](../adr/0012-embedding-provider-seam.md).

**If any row of that table stops being true, the seam has been violated** — that is the
check to run at each phase boundary, and it is cheaper than discovering it in a month. The
grep is now five variables:

```
grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER\|EMBEDDING_PROVIDER' \
  src/ services/api/src/handlers/
```
