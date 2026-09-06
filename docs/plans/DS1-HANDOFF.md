# Handoff after DS1 — read this before starting DS2

**Written 2026-09-07**, at the end of the session that executed
[DS1-portable-spine.md](DS1-portable-spine.md). Everything here is either something the next
session needs to bring the stack up, or something it would otherwise rediscover the hard way.

---

## 1. Where things stand

**On `aws-native`, at `46a80ec`, pushed.** `verify` is green. `dev` is untouched and still
runs on Supabase, as [ADR 0003](../adr/0003-branching-model.md) intends.

**The pipeline generates real cards.** That is new as of this session and it is the thing
that had never been true before: paste text or upload a `.txt`/`.md` file and a language
model writes cards from it, ending at the review gate with the cards in the study queue.

| Piece | What runs today |
| ----- | --------------- |
| Model | **Groq**, `openai/gpt-oss-120b`, behind the provider seam |
| Postgres | **Neon**, `neondb`, all six migrations applied |
| Job state | **Postgres** (`jobs`, `job_chunks`) — migration `0006` |
| Fan-out | **In-process**, bounded, concurrency 2 |
| Uploads | **Local directory**, `../synapsedeck-uploads` |
| Identity | **Cognito**, the live dev pool, untouched |
| API | `scripts/dev-api.mjs`, which now serves every route it declares |

`jobs-dynamo.ts` and `pipeline-sfn.ts` are byte-identical to what P10 wrote. The brief's §8
table holds in full.

## 2. Bringing it up — two commands and one caveat

```
npm run dev:api      # loads .env.local, serves on 8787
npm run dev          # Vite on 5173
```

**`.env.local` already has everything**, added this session: the four seam variables, the
`PG*` block derived from your Neon `DATABASE_URL`, `GROQ_MODEL`, and `UPLOAD_DIR`. Nothing
further is needed.

**The caveat that cost time here:** a stale `dev-api.mjs` was already listening on 8787 from
an earlier session, running pre-DS1 code. If `npm run dev:api` reports `EADDRINUSE`, kill the
old process rather than switching ports — an old server on the expected port will serve the
old broken routes and look like the new code failing.

`npm run db:migrate` and `db:migrate:status` now load `.env.local` themselves, so they target
Neon without any exported variables.

## 3. Things that will bite you

### `GROQ_MODEL` is not stable, and the catalogue is per-account

DS1 was written against `llama-3.3-70b-versatile`; Groq answered `404 model_not_found`,
because the Llama chat models are not in this account's catalogue at all. Before assuming an
id is current:

```
curl -s https://api.groq.com/openai/v1/models -H "authorization: Bearer $GROQ_API_KEY"
```

### The free tier limits **tokens** per minute, not requests

**8,000 TPM** on this account. One chunk costs roughly 1,000 in and 800 out, so about four
chunks a minute is the real ceiling. This is the single most likely thing to make DS2 look
broken, because embeddings add another call per chunk to the same budget.

Concurrency is `PIPELINE_CONCURRENCY` (default 2). The provider honours Groq's `retry-after`
header, capped at 30 s. If DS2 sees widespread 429s, the answer is the budget, not the code.

### Cognito accounts need admin confirmation

Sign-up sends an emailed code. To make an account usable from a script:

```
aws cognito-idp admin-confirm-sign-up --user-pool-id "$POOL" --username "$EMAIL"
aws cognito-idp admin-initiate-auth --user-pool-id "$POOL" --client-id "$CID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME="$EMAIL",PASSWORD="$PW" \
  --query 'AuthenticationResult.AccessToken' --output text
```

The AWS CLI is configured on this machine as `synapsedeck-cli`. **Two test accounts were
created and deleted** during DS1; the pool is back to whatever it held before.

### `POST /jobs` refuses while another job runs

402 `rate_limited`, by design — one generation at a time per user. It is correct behaviour
and it will look like a bug when you run two test scripts in parallel.

### The API request bodies are not always what you would guess

`POST /decks/{id}/cards` takes `{ payloads: CardPayload[], sourceExcerpt }`, and
`POST /cards/accept` takes `{ cardIds }` — not `cards`, not `ids`. Both cost a wrong guess
during DS1's verification.

## 4. Not mine, left for you to decide

`git status` is clean except for **Neon CLI scaffolding that I did not create and
deliberately did not commit**:

- `hello.ts`, `neon.ts` — a Neon Functions starter
- `@neon/config` and `@neon/env` added to `package.json` **dependencies**, plus ~460 lines of
  `package-lock.json`, including `@napi-rs/keyring` binaries for every platform
- `.neon` added to `.gitignore`

**DS1 uses none of it.** The code reaches Neon through plain `pg` and the standard `PG*`
variables, which is exactly D2's claim — nothing in the codebase knows which Postgres it is
talking to, so RDS's return is a connection string. Adding a Neon-specific runtime dependency
would be the first thing to make that false.

Delete them, or keep them deliberately. Either is fine; leaving them undecided is how a
vendor SDK quietly becomes load-bearing.

## 5. One security note

Your **Neon password appeared in this session's terminal output** — a script error printed
the connection string in an exception. It is not in git and `.env.local` is ignored, but it is
in the scrollback. Rotating it in the Neon console costs a minute; if you do, re-derive the
`PG*` block in `.env.local`.

## 6. What DS2 inherits, and what it must not assume

**DS2 is grounded chat**: pgvector, embeddings at ingestion, a retrieval endpoint, citations,
and the chat pane `WorkspacePane` currently leaves empty. [P12](P12-grounded-chat.md) is the
substance; DS2 re-aims it at portable infrastructure. Its §3 no-stub-answers rule is inherited
verbatim.

**What is now true that P12 assumed was not.** P12 and SPEC §4.6 both said chunks are not
persisted retrievably, and that was the stated reason the AI tutor was refused rather than
deferred. **That is no longer the case**: `job_chunks.source_text` holds every chunk's text,
scoped by `user_id`, from migration 0006. The retrieval store DS2 needs is half-built already
— what is missing is an embedding column, an index, and the query.

**Three things to decide early, because they shape the schema:**

1. **Where embeddings live.** A column on `job_chunks` is the cheap answer and couples
   retrieval to a table whose rows expire after seven days (`expires_at`, which nothing
   currently enforces — see below). A separate `chunk_embeddings` table decouples them. This
   is a real decision, not a formality.
2. **Chunk expiry becomes load-bearing.** `expires_at` is currently a column nothing sweeps,
   which was harmless while chunks were pipeline scratch. The moment chunks are the retrieval
   corpus, a sweep would silently empty a notebook's knowledge base. Decide this deliberately.
3. **Embeddings need a provider, and it must be a seam.** Groq may have no embedding model
   that fits; the brief's D6 says so and says a dedicated embedding provider is a second seam
   for the same reason the card provider is one. [ADR 0010](../adr/0010-runtime-seams.md) is
   the pattern to copy — resolver in `data/` or `lib/providers/`, no default, structurally
   typed implementations, and nothing above the data layer reading the variable.

**Two rules that are not negotiable and are easy to break under demo pressure:**

- **Every new table gets a data-access module obeying all four tenancy rules.** A `pgvector`
  similarity search that forgets `where user_id = $1` returns *other users' documents as
  answers*, which is the worst available version of this bug. P12 §6 names this trap; it
  applies to Neon exactly as to RDS.
- **No stub answers.** A chat that answers from nothing is worse than no chat. If retrieval
  returns nothing, say so.

**Run the seam audit at the DS2 boundary**, and do not skip it because it seems obvious:

```
grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER' src/ services/api/src/handlers/
```

Comments only. Anything else means a seam has leaked upward and the brief's §8 table has
stopped being true.

## 7. Honest limits of what DS1 proved

Worth restating because the phase's report reads confidently and the confidence has edges:

- **Nothing proves the two sides of a seam agree.** `JOB_STORE=dynamo` typechecks and has
  never run; DynamoDB and Step Functions were not reachable. Structural typing prevents
  signature drift and says nothing about semantics.
- **Card quality is one person reading roughly two dozen cards.** They were on-topic, atomic
  and correctly shaped. That is an impression. The eval harness is Phase E.
- **The cross-tenant probes are a handful of paths, not a proof.** They passed — 404 on
  another user's job, `null` on their deck lookup, 404 on their object key, 400 on traversal
  — but `check-data-access.mjs` checks shape rather than meaning, and a data-access function
  that ignored its `userId` would still pass every gate here.
- **PDF was never tried, because no PDF can work.** The failure message is written and
  unobserved.
- **There are no tests** (ADR 0005). `verify` proves the code compiles, lints and builds. The
  claims above rest on this session running the thing by hand and writing down what happened.
