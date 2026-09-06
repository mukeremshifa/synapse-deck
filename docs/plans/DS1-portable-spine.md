# DS1 — The portable spine

Phase 1 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md). The phase that makes the pipeline
**actually generate cards** for the first time in the project's history — against Neon and
Groq, behind seams that AWS slots back into without a rewrite.

**Reference:** the brief's D1 (Groq behind the provider seam), D2 (Neon), D4 (jobs in
Postgres, DynamoDB kept), D5 (in-process fan-out, Step Functions kept), §6 (the seam trap),
§8 (the table that must stay true). [ADR 0008](../adr/0008-application-level-tenancy.md)
governs every new table; it is not reopened here.

**Done when:** a user pastes text or uploads a document, watches honest progress, and lands
at the review gate holding cards a real language model wrote — with `CARD_PROVIDER=bedrock`,
`JOB_STORE=dynamo` and Step Functions still one environment variable away each.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` is green | `npm run verify` |
| A Neon project exists with its connection details to hand | Owner-supplied; goes in `.env.local` |
| A Groq API key to hand | Owner-supplied; it is a Supabase Edge Function secret today |
| Cognito dev pool still live | `npm run dev:api` starts and prints the pool id |

**What you are inheriting, and it is more than it looks.** The whole pipeline is written and
none of it has ever run:

- `POST /jobs`, `GET /jobs/{jobId}`, `GET /jobs?deckId=`, `GET /quota`, `POST /uploads` all
  exist as handlers, are declared in **both** `infra/lib/api-stack.ts` and
  `scripts/dev-api.mjs`, and pass `check:routes`.
- **`scripts/dev-api.mjs` does not import the `jobs` or `uploads` handler.** Its `handlers`
  object holds only `profile`, `decks`, `cards`, `reviews`, so every route above resolves to
  `undefined` and throws `handlers[route.fn] is not a function` → a 500 with no useful body.
  `check:routes` cannot see this: it compares route *tables*, and its own header says it
  deliberately does not check that a route reaches a handler. **This is the single most
  valuable bug in the phase and it is found by running the thing, not by reading it.**
- The frontend is complete. `useUploadDocument`, `useJobProgress`, `JobProgressPanel`,
  `PipelineStages`, `StagingList`, `ReviewGatePage` are all written against these endpoints.
  **DS1 changes no frontend file.** If it does, something has been designed twice.

## 2. Out of scope

Explicitly later, and each named so it does not creep in:

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| pgvector, embeddings, retrieval, the chat pane | **DS2** |
| Blueprint / diagnostic / exam off fixtures | **DS3** |
| Any UI or motion work | **DS4** |
| Vercel, the API host, the seeded demo account | **DS5** |
| A PDF text-layer parser | Still deferred. See task 4 — the gap is *narrowed*, not closed |
| `providers/bedrock.ts` | When model access is granted. The seam is what this phase leaves ready |
| Deleting `data/jobs-dynamo.ts` or `data/pipeline-sfn.ts` | Never. They are one side of a seam (brief §5) |
| A test suite | ADR 0005 stands |

**The temptation with a name.** Once cards generate, the review gate becomes demoable and
DS4's polish becomes very inviting. It is DS4 for the reason the brief gives: polish applied
to a screen whose data shape is still moving is polish applied twice.

## 3. Tasks

Ordered so the app builds and runs after every one.

### Task 1 — `.env.local`, `.env.example`, and the two new variables

Add `JOB_STORE`, `PIPELINE_RUNNER`, `GROQ_API_KEY` and the Neon `PG*` block to
`.env.example` with the reasoning inline, as that file already does for every other value.
Record that `CARD_PROVIDER` has no default and that this is deliberate.

`PGPASSWORD` keeps its `LOCAL_PGPASSWORD` bridge in `dev-api.mjs`; add `NEON_*` nothing —
**Neon is reached through the same `PG*` variables as RDS**, which is D2's whole claim and
the thing that must stay true.

Files: `.env.example`.

### Task 2 — Migration `0006_jobs.sql`: job state in Postgres

Two tables, `jobs` and `job_chunks`, behind the eight signatures `data/jobs.ts` exports.

Non-negotiable, and each for a stated reason:

- `user_id uuid not null` on **both** tables, and every index leads with it. On DynamoDB
  `userId` is the partition key — the *address* of the data. Here it is a filter, which is
  ADR 0008's admitted weakness applied to one more table, and the comment in the migration
  says so.
- `job_chunks` carries the chunk **text** as well as the result, because
  `putChunkText`/`getChunkText` exist and the in-process runner still reads its input back
  rather than holding a document in memory across the fan-out.
- `expires_at timestamptz`, mirroring DynamoDB's 7-day TTL. **Postgres has no TTL**, so this
  is a column nothing enforces until something reaps it — say that in the migration rather
  than implying a guarantee. Task 9 is the reaper.
- `chunks_completed` is incremented with `update … set chunks_completed = chunks_completed +
  1`, which is atomic in Postgres exactly as DynamoDB's `ADD` is. A read-modify-write here
  would drop increments under the fan-out, which is the bug the DynamoDB module's comment
  already warns about.

`npx supabase db push` is **not** how this is applied — that is the Supabase project.
`npm run db:migrate` is the runner for `services/api/migrations/`.

Files: `services/api/migrations/0006_jobs.sql`.

### Task 3 — `data/jobs-dynamo.ts`, `data/jobs-postgres.ts`, and the seam

Rename today's `data/jobs.ts` to `data/jobs-dynamo.ts` **unchanged** — it is one side of a
seam, not legacy. Write `data/jobs-postgres.ts` against the same eight signatures. Make
`data/jobs.ts` the resolver: read `JOB_STORE`, re-export one implementation's functions.

**The seam is here and nowhere above it** (brief §6). No handler learns which store is in
use; `handlers/jobs.ts`, `pipeline-split.ts`, `pipeline-generate.ts` and `pipeline-finalise.ts`
keep importing `../data/jobs.ts` and change not at all.

`JOB_STORE` gets **no default**, for `resolveProvider()`'s reason: a job store chosen by
accident is a job silently written where nothing will look for it.

All four tenancy rules apply to the Postgres implementation. Every statement carries
`where user_id = $1`, including the single-row reads — a job id is not a capability.

Files: `services/api/src/data/jobs-dynamo.ts` (moved), `jobs-postgres.ts` (new),
`jobs.ts` (rewritten as the resolver).

### Task 4 — `providers/groq.ts`

Implement `CardProvider` against Groq's OpenAI-compatible chat completions endpoint. Widen
nothing: `ProviderName` already includes `'groq'` and `PROVIDER_NAMES` already lists it —
the union was written for this.

What it must get right:

- **The chunk text is document content, never instructions.** It goes in a user message
  clearly delimited, and the system prompt says the delimited text is material to be
  studied, not commands to follow. This is the same untrusted-content rule CLAUDE.md states
  for rendering; it applies at the prompt boundary too.
- **JSON mode, then Zod.** `response_format: { type: 'json_object' }` narrows the failure
  surface; `CardPayload.safeParse` per card in `pipeline-generate.ts` is what actually
  decides. The provider returns what it got; it does not pre-validate and it does not repair.
- **The retryable/non-retryable distinction is the one that costs money.** 429 and 5xx and a
  network timeout throw `ProviderRetryableError`. A 400, a 401, and **a malformed body do
  not** — asking the same model the same question again yields the same malformed answer, and
  `pipeline-generate.ts`'s header already says so.
- **Topics come from the same call** (D11): one response carries cards and topic names.
  A provider that cannot extract them returns `[]` rather than guessing.
- **Real token counts.** `usage.prompt_tokens` / `completion_tokens`, or `null`. Never a
  fabricated number — `stub.ts` explains at length why, and the reason is unchanged.

The key is read from `GROQ_API_KEY` at call time, not module load, so a missing key is an
error naming itself rather than a crash at import.

Files: `services/api/src/lib/providers/groq.ts`, `index.ts` (the `case 'groq'` throw becomes
a construction; the `bedrock` throw stays, with its message updated to point here).

### Task 5 — `data/pipeline-local.ts`: the bounded in-process fan-out

`data/pipeline.ts` becomes the resolver on `PIPELINE_RUNNER`, exactly as `jobs.ts` does;
today's Step Functions implementation moves to `data/pipeline-sfn.ts` unchanged.

The local runner calls the **same three handlers** the state machine calls —
`pipeline-split`, `pipeline-generate`, `pipeline-finalise` — in that order. It does not
reimplement them. That is what keeps the two runners honest about being the same pipeline.

Four properties, each of which is a way this goes wrong:

1. **Bounded concurrency.** A small limit (start at 3), because 40 unbounded model calls is
   a rate limit and a bill at the same time. `MAX_CHUNKS_PER_JOB = 40` stays as the other
   bound.
2. **Bounded retry, honouring the distinction.** `ProviderRetryableError` thrown out of
   `pipeline-generate` is retried with backoff, a small fixed number of times. Anything else
   is recorded as a failed chunk and the job continues — partial failure is a normal outcome
   here, not an exception.
3. **It does not block the response.** `POST /jobs` returns 202 with a `jobId` and the run
   proceeds after; the frontend already polls. Errors must therefore be *written to the job
   record*, never only thrown — an unhandled rejection in a detached run is a job that stays
   `running` with nothing said.
4. **Durability is lost and must be stated.** Step Functions survived a crash; a Node process
   does not. A job interrupted mid-run stays `running` forever unless task 9 reaps it. This
   goes in the module header, in SPEC, and in this plan's §6 — not discovered in a demo.

Files: `services/api/src/data/pipeline-sfn.ts` (moved), `pipeline-local.ts` (new),
`pipeline.ts` (rewritten as the resolver).

### Task 6 — `data/uploads-local.ts`: uploads without S3

`data/uploads.ts` becomes the resolver on the same pattern; `uploads-s3.ts` keeps the
presigned-PUT implementation unchanged.

The local implementation writes to a directory outside the repo, and the four exported
signatures are unchanged — including `assertOwnedKey`, whose prefix check is the tenancy
boundary and is **more** important here, because a filesystem path that escapes its prefix
is a real traversal rather than an odd-looking S3 key.

`createUploadTicket` cannot presign anything locally, so it returns a URL pointing at a new
local route that accepts the PUT. **That route is a real addition to the API surface**, so it
goes in `dev-api.mjs` *and* in `api-stack.ts`'s comments as a local-only route, or
`check:routes` fails — and if that check fails, read it rather than silencing it.

**A cheaper alternative, and take it if it holds:** the S3 path already works today against a
real dev bucket if `UPLOAD_BUCKET_NAME` is set, because the presigned URL is signed with the
caller's own AWS credentials and the browser uploads directly. S3 costs cents. If that is
acceptable, this task is *setting one variable* and the local implementation is not written
at all — decide it explicitly, record which, and do not build both.

Files: as above, or none.

### Task 7 — Wire `dev-api.mjs`

Import the `jobs` and `uploads` handlers into the `handlers` object. This is the bug named in
§1. Two lines.

While there: the header's claim that the local server runs the real handlers is now true of
every route rather than most of them, so it needs no change — but the comment block about
`JOB_TABLE_NAME` and `UPLOAD_BUCKET_NAME` being deliberately unset is now wrong for the
Postgres/local path and must be rewritten to say which variables the demo path needs.

Files: `scripts/dev-api.mjs`.

### Task 8 — Run it. This is the task the phase exists for.

Nothing above is finished until this passes. Against Neon, with `CARD_PROVIDER=groq`:

1. `npm run db:migrate:status` — 0006 pending.
2. `npm run db:migrate` — applies clean.
3. `npm run dev:api` and `npm run dev`; sign in with a real Cognito account.
4. Paste text at `/create/text`. Watch `/jobs/{id}` go `pending → running → succeeded`,
   chunk counts climb, cards appear.
5. **Read the cards.** They must be about the pasted text. A card that says
   `[STUB CARD — not real content]` means `CARD_PROVIDER` is wrong, and that is exactly the
   failure `resolveProvider()`'s no-default rule exists to make loud.
6. Accept at the review gate; the deck holds real cards; `GET /quota` moved by the right
   number of units.
7. Force a failure — a bad `GROQ_API_KEY` on one run — and confirm the job records it and the
   UI says so, rather than spinning.

**Record what actually happened, including what broke.** P9's most useful artifact was the
list of three real bugs its execution found. Write the equivalent here.

### Task 9 — The reaper, and honest expiry

A job left `running` by a crashed process is the failure D5 names. Add a bounded sweep:
`GET /jobs/{jobId}` (and the `?deckId=` lookup) marks a job `failed` if it is `running` and
its `updated_at` is older than a threshold, with an error that says the run was interrupted.

**Do it on read rather than as a cron.** There is no scheduler in the demo stack, a job
nobody is looking at harms nobody, and `staleRunningBefore` in `lib/quota.ts` already
establishes this exact pattern for stuck generations — reuse its threshold rather than
inventing a second one that can disagree with it.

Files: `services/api/src/data/jobs-postgres.ts`, `services/api/src/handlers/jobs.ts` (if the
sweep needs a call site there, it goes through the data layer — rule 3).

### Task 10 — Documentation, and the seam audit

1. **SPEC.md** — the pipeline is real. Update §4.6's table: "Blueprint-aligned generation" is
   still blocked, but the *pipeline* row it was blocked on is now delivered against portable
   infrastructure. Say what generates cards today and on what.
2. **The board** — DS1 complete, DS2 next.
3. **An ADR for the seams.** Three modules became three resolvers on the same pattern in one
   phase; that is a repeated architectural decision and it earns
   `docs/adr/0009-runtime-seams.md`. It should state the rule the brief's §6 gives —
   **the seam is the data-access module boundary, and there is no branching above it** — and
   the audit that enforces it.
4. **Run the brief's §8 table as a checklist.** Six rows. Every one must still be true, and
   the way to prove rows 3 and 4 is that no file outside `data/` mentions `JOB_STORE` or
   `PIPELINE_RUNNER`. `grep -rn 'JOB_STORE\|PIPELINE_RUNNER' src/ services/api/src/handlers/`
   returning nothing is the check.
5. **Write DS2's plan**, per the convention — the last task of every plan.

## 4. Acceptance criteria

Observable, in order of what they prove:

1. A pasted-text job produces cards whose content is about the pasted text, generated by
   Groq, visible at the review gate and accepted into a deck.
2. An uploaded `.txt` document does the same thing end to end.
3. `GET /jobs/{jobId}` reports honest per-chunk progress, and a job with some failed chunks
   reports the failure count rather than hiding it.
4. `CARD_PROVIDER=stub` still produces cards that say they are fake, and an unset
   `CARD_PROVIDER` still refuses to start.
5. `JOB_STORE=dynamo` and `PIPELINE_RUNNER=sfn` still typecheck, and their modules are
   byte-identical to what P10 wrote apart from their filenames.
6. `grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|CARD_PROVIDER' src/ services/api/src/handlers/`
   returns nothing. The seam did not leak upward.
7. `npm run verify` is green, including `check:data-access` and `check:routes`.
8. No file under `src/` changed. The frontend had no AWS coupling and it still has none.

## 5. Decisions to record

- Which uploads path was taken (task 6's either/or), and why.
- The Groq model chosen, and on what grounds.
- The concurrency limit and the retry budget, with the reasoning that picked the numbers.
- That job expiry is a column nothing enforces, swept on read.

## 6. What went unverified

Replaces "tests to write" while ADR 0005 stands. Name these honestly in the closing report:

- **Nothing proves cross-tenant isolation on `jobs` or `job_chunks`.** They are two new
  tables under ADR 0008's weaker regime. The lint checks that `userId` is the first parameter;
  it cannot check that the `where` clause uses it.
- **Nothing proves the two job stores behave identically.** `JOB_STORE=dynamo` typechecking
  is not `JOB_STORE=dynamo` working, and DynamoDB is not reachable to try.
- **Nothing proves the two pipeline runners behave identically**, for the same reason.
- **Card quality is unmeasured.** "Groq produced cards about the text" is one person reading
  a handful. The eval harness is Phase E and it does not exist.
- **The retry path is exercised only by the one forced failure in task 8**, if that.

---

## 7. What the first real run found

**Written 2026-09-07, after execution.** The pipeline had been written across all of P10
and had **never once run** — no model was reachable and the local server could not serve
its routes. Running it is what this phase was for, and it found five things. Four were
bugs; none was visible to `verify`, which had been green throughout.

### 1. `dev-api.mjs` never imported the `jobs` or `uploads` handler

Its `handlers` object held four entries and `ROUTES` named six. Every ingestion route —
`POST /jobs`, `GET /jobs/{jobId}`, `GET /jobs?deckId=`, `GET /quota`, `POST /uploads` —
resolved to `undefined` and threw `handlers[route.fn] is not a function`, returning a 500
with nothing useful in it.

**`check:routes` could not see this**, and its own header says why: it compares route
*tables* and deliberately does not check that a route reaches a handler. So the entire
ingestion pipeline was unreachable locally for a whole phase, behind a green gate.

Fixed by importing them, and by an assertion at startup that every handler named in
`ROUTES` exists — the failure now happens at boot with a sentence, rather than on one
route with a 500.

### 2. The `generations` row was never closed out

`handlers/jobs.ts` writes a `generations` row with `status = 'running'` **before** the work
starts, which is what makes the concurrency limit real. Nothing ever set it to
`succeeded`. `finishGeneration` existed in the data layer and had no caller.

This was invisible while the pipeline never ran, and it is worse than an untidy table:

1. **The next job is refused.** `decideGeneration` counts running rows, so one finished
   generation blocked every subsequent one for `staleRunningMinutes`. The second job of the
   session was told to "wait for it to finish" about a job that had already finished.
2. **The cost trail was empty.** `cards_returned` stayed 0 and `model` stayed `'pending'`,
   so the audit trail recorded that something was charged for and nothing about what it
   produced.

Fixed in `pipeline-finalise.ts`, which now looks the row up by the job's deck and closes
it. The lookup is by deck rather than a new `generation_id` column because the job's store
is behind a seam — the column would have had to be added to the DynamoDB item shape too,
for a link the deck already provides.

### 3. `GROQ_MODEL=llama-3.3-70b-versatile` does not exist

Groq answered `404 model_not_found`: the Llama chat models are not in this account's
catalogue. **The "no default model" rule paid for itself on its first run** — because the
id is configuration rather than a hardcoded constant, the fix was one line in `.env.local`.
The model is now `openai/gpt-oss-120b`.

Check what a key can actually reach before assuming an id is current:

```
curl -s https://api.groq.com/openai/v1/models -H "authorization: Bearer $GROQ_API_KEY"
```

### 4. Groq's free tier limits **tokens** per minute, and the backoff assumed requests

The first multi-chunk run lost **two chunks of four** to 429s. The classification was
right — 429 was recognised as retryable — but the retry budget was wrong: this account is
allowed **8,000 tokens per minute**, and one chunk costs roughly 1,000 in and 800 out. Three
chunks in flight plus retries exhausts that in seconds, and the window clears in *tens of
seconds*, so all three attempts landed inside one still-exhausted window.

Two fixes, both of which made the same document succeed 4/4:

- `ProviderRetryableError` now carries `retryAfterMs`, and the provider reads Groq's
  `retry-after` header. **The server knows when it will next accept work; guessing is only
  correct when there is nothing to ask.** Capped at 30 s, past which an honest partial
  failure beats a stalled job.
- Concurrency dropped from 3 to **2**, and made configurable via `PIPELINE_CONCURRENCY`.
  The right value is a property of the account's tier, not of this code.

### 5. Uploads accepted only the one format that could not work

`UPLOAD_LIMITS` was PDF-only and `readDocumentText` has never parsed a PDF. So "upload a
document, get cards" was unreachable for every file the UI accepted. `.txt` and `.md` were
added — not a widening so much as making the accepted set match what the pipeline can read.
PDF stays, and stays honestly broken, because a parser is a deferred decision rather than a
declined one.

**This is the one place DS1 touched `src/`**, against this plan's criterion 8. Three files:
`schemas.ts`, `useUploadDocument.ts`, `CreateFromDocumentPage.tsx`, all of it copy and the
accepted-type list. No seam work reached the frontend, which is the property that criterion
was actually protecting.

## 8. What was verified, by running it

Against **Neon** (`neondb`, all six migrations applied clean) with `CARD_PROVIDER=groq`,
`JOB_STORE=postgres`, `PIPELINE_RUNNER=local`, `UPLOAD_STORE=local`, and **real Cognito
tokens** from the live dev pool:

| Checked | Result |
| ------- | ------ |
| Pasted text → cards | ✅ 1 chunk, 4 cards about the pasted text, `providers: ["groq"]` |
| Multi-chunk fan-out | ✅ 8,600 chars → 4 chunks, `units: 4`, **4/4 succeeded, 12 cards**, 16 s |
| Upload → job → cards | ✅ ticket → `PUT` 204 → job → 3 cards about the uploaded document |
| Review gate | ✅ cards created (201), deck → `active`, cards appear in `GET /queue` as `fresh` |
| Honest partial failure | ✅ the pre-fix run reported 2 ok / 2 failed rather than hiding it |
| Quota accounting | ✅ `sum(units)` moved by 4 and by 1; `cards_returned` recorded |
| Concurrency limit | ✅ a second job while one runs → **402 `rate_limited`** |
| Stale-job reaper | ✅ a job stranded `running` 20 min → swept to `failed` with an explanation |
| All four seams refuse to default | ✅ unset and bogus values each throw a named error |
| The stub still announces itself | ✅ `[STUB CARD — not real content]`, `provider: 'stub'` |
| Bedrock still refuses | ✅ throws, naming the missing model grant |
| **Cross-tenant: another user's job** | ✅ **404**, never 403 |
| **Cross-tenant: another user's deck lookup** | ✅ **200 `null`** — reveals nothing |
| **Cross-tenant: another user's object key** | ✅ **404 "No such document."** |
| **Path traversal on the upload PUT** | ✅ **400**; nothing written outside the upload root |
| Seam-leak audit | ✅ no handler or `src/` file reads a seam variable (one comment aside) |
| `jobs-dynamo.ts`, `pipeline-sfn.ts` | ✅ byte-identical to what P10 wrote |
| `npm run verify` | ✅ green |

`uploads-s3.ts` is **not** byte-identical: `uploadKeyFor` gained a defaulted `extension`
parameter and the key now carries the real extension, both required by finding 5. Both are
backward-compatible.

## 9. What is still unverified

- **Nothing proves the two sides of any seam agree.** DynamoDB and Step Functions were not
  reachable; `JOB_STORE=dynamo` typechecks and has not run. Structural typing prevents
  signature drift and says nothing about semantics.
- **Card quality is one person reading two dozen cards.** They were on-topic, atomic and
  correctly shaped. That is an impression, not a measurement; the eval harness is Phase E.
- **The 30 s `retry-after` cap and the timeout path never fired.** Only the sub-30 s
  rate-limit wait was exercised.
- **No PDF was tried**, because none can work. The failure message on a PDF is written and
  unobserved.
- **`GET /jobs?deckId=` sweeps stale jobs with two extra queries per call.** Correct,
  measured on nothing.
- **The cross-tenant probes are a handful of paths, not a proof.** The lint checks shape,
  not meaning; a data-access function that ignored its `userId` would still pass.
