# DS2 — Grounded chat, and the pane P11 left empty

Phase 2 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md). [P12](P12-grounded-chat.md) is the
substance — its §3 no-stub-answers rule and its §6 tenancy trap are **inherited verbatim and
not reopened**. This plan re-aims it at the portable infrastructure DS1 built and at what
DS1 discovered on the way.

**Reference:** the brief's D6 (pgvector on Neon, embeddings need their own seam),
[ADR 0010](../adr/0010-runtime-seams.md) (the seam pattern to copy),
[ADR 0008](../adr/0008-application-level-tenancy.md) (every new table, all four rules),
[DS1-HANDOFF.md](DS1-HANDOFF.md) §6 (the three schema decisions this plan makes).

**Done when:** a user asks a question about a notebook whose sources they ingested, and gets
an answer written from *their own* chunks, with citations that resolve to the chunk they came
from — and a question the sources do not support gets told so rather than answered.

---

## 0. The finding that shapes this phase, checked before planning it

**Groq has no embedding model.** The account's catalogue was listed while writing this plan:

```
allam-2-7b · canopylabs/orpheus-* · groq/compound{,-mini} · meta-llama/llama-prompt-guard-2-*
openai/gpt-oss-{120b,20b} · openai/gpt-oss-safeguard-20b · qwen/qwen3.{6,8}-27b
whisper-large-v3{,-turbo}
```

Chat, audio and prompt-guard. **Nothing that embeds.** The brief's D6 hedged — *"if Groq has
no embedding model that fits, a dedicated embedding provider is a second seam"* — and the
hedge has resolved: it is not a contingency, it is task 2.

**pgvector is available and not yet installed.** `pg_available_extensions` reports `vector`
at `0.8.6` with `installed_version = null` on the Neon project. `create extension` is task 3's
first line and it needs no Neon console work.

Two consequences, and they are the reason this section is first:

1. **The chat completion stays on Groq** (`openai/gpt-oss-120b`, what DS1 settled on), and
   **the embedding call goes somewhere else entirely.** One phase, two vendors, and the
   token budget in §5 is therefore *not* shared between them — which is a relief, given
   Groq's 8,000 TPM.
2. **`CARD_PROVIDER` must not grow an embedding method.** It is a chat interface; widening it
   would mean `StubProvider` and the unwritten `BedrockProvider` both owe an
   implementation of something neither has any business knowing about. See task 2.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` is green | `npm run verify` |
| DS1's stack comes up | `npm run dev:api` then `npm run dev` — see the caveat below |
| Neon reachable, 0006 applied | `npm run db:migrate:status` — nothing pending |
| An embedding API key to hand | **Owner-supplied.** Task 2 decides which vendor; this is the one thing that blocks |

**The caveat from [DS1-HANDOFF.md](DS1-HANDOFF.md) §2, repeated because it cost a session
once:** if `npm run dev:api` reports `EADDRINUSE`, **kill the old process rather than
switching ports.** A stale server on 8787 serves the old code and looks exactly like the new
code failing.

**What you are inheriting, and it is more than P12 assumed.** P12 and SPEC §4.6 both say
chunks are not persisted retrievably, and that was the stated reason the tutor was refused
rather than deferred. **That is no longer true.** Migration `0006` gave
`public.job_chunks` a `source_text` column, scoped by `user_id`, holding every chunk of
every job. The retrieval corpus is already being written on every ingestion — what is
missing is a vector, an index, and a query.

**Both of those documents are now wrong and task 9 fixes them.** Leaving SPEC saying the
feature is impossible while the feature is shipping is exactly the code/spec drift CLAUDE.md
forbids.

---

## 2. Out of scope

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| Blueprint / diagnostic / exam off fixtures | **DS3** |
| Any UI or motion polish beyond making the pane usable | **DS4** |
| Vercel, the API host, the seeded demo account | **DS5** |
| Multi-source fan-out for *generation* | Still out. The sources rail's copy says each source generates on its own; making that false is a different phase **and it must update that copy** |
| Audio overview, mind maps, briefing docs | Still absent, still not stubs (P12 §4) |
| Streaming the answer token by token | DS4 if it earns itself. A 3-second wait with an honest spinner beats a streaming implementation that has to be rewritten when the retrieval shape moves |
| Re-ranking, HyDE, query rewriting | Later, and only if measured. `k` nearest neighbours over one user's chunks is the baseline; nothing here has a number to beat yet |
| `providers/bedrock.ts`, and Bedrock's Titan embeddings | When model access is granted. The seams are what this phase leaves ready |
| A test suite | ADR 0005 stands |

**The temptation with a name.** Retrieval is the phase where "just let it answer from the
model's own knowledge when retrieval finds nothing" becomes very inviting, because the
fallback is one line and the demo never hits the empty case. **That line is the feature's
failure**, and §3 exists to make it unwritable.

---

## 3. The rule this phase runs under — P12 §3, verbatim

**No stub answers. Not once, not behind a flag, not "just to see the layout".**

P10's stub is safe because a stub card announces itself in its own text and passes a review
gate before it becomes anything. A chat answer has neither property: it is fluent prose about
the user's own study material, delivered with no gate, and a plausible wrong answer is
indistinguishable from a right one.

Three corollaries, each of which is a specific line of code you might otherwise write:

1. **No answer without a retrieval hit.** If the search returns nothing above the floor, the
   endpoint returns *that*, and the pane says the sources do not cover it. It does not ask
   the model anyway.
2. **No answer from the model's own knowledge.** The prompt says to answer *only* from the
   provided passages and to say so when they do not suffice. A correct answer sourced from
   pretraining is still ungrounded, and the user cannot tell which they got.
3. **No `EMBEDDING_PROVIDER=stub`.** A stub embedder returns vectors whose neighbours are
   meaningless, so retrieval silently returns arbitrary chunks and the answer is grounded in
   noise while looking perfect. This is worse than the card stub, because there is no text on
   screen that says it is fake. **Do not write one**, not even to develop against.

---

## 4. Tasks

Ordered so the app builds and runs after every one.

### Task 1 — The three schema decisions, made before any SQL

[DS1-HANDOFF.md](DS1-HANDOFF.md) §6 names these and says to decide them early because they
shape everything after. Decide them **in this task**, write the reasoning into the migration
header, and record them in §6 of this plan.

**1. Where embeddings live.** A vector column on `job_chunks` is the cheap answer and couples
the retrieval corpus to a table whose rows carry `expires_at` and whose parent cascades on
delete. A separate table decouples them at the cost of a join.

> **The recommendation, and the reasoning it must survive:** a separate
> `public.chunk_embeddings` table, keyed `(job_id, chunk_index)` with `user_id` denormalised
> onto it exactly as `job_chunks` does. Not for purity — for two concrete reasons. A vector
> column would make every `select *` in `jobs-postgres.ts` drag 1–3 KB of float per chunk
> through the pipeline that has no use for it, and the embedding's lifecycle is genuinely
> different from the chunk's: a re-embedding (new model, changed dimension) rewrites one
> table and leaves the pipeline's state alone.
>
> If you overturn this, say why in the migration and in §6. It is a real decision.

**2. Chunk expiry becomes load-bearing, and this is the sharp one.** `expires_at` is a column
nothing sweeps — harmless while chunks were pipeline scratch, **actively dangerous the moment
they are the knowledge base.** A sweep added later by someone reading the column as intent
would silently empty every notebook's retrieval corpus, and the symptom would be "chat
suddenly says it can't find anything" with no error anywhere.

> **The recommendation:** keep the column, **do not sweep it**, and change its comment from
> "intent" to a statement that it is now retained deliberately because chunks are the
> retrieval corpus. A `retained_reason` is a comment, not a mechanism, so the migration must
> say it plainly enough that the next person does not undo it. Task 9 puts the same sentence
> in SPEC.

**3. `on delete cascade`, and what deleting a notebook now means.** `job_chunks` cascades from
`jobs`, which does *not* cascade from `decks`. Whatever holds embeddings inherits that chain.
Follow it before writing the FK and say in §6 what deleting a deck does to its chat corpus —
the answer today is *nothing*, and that may or may not be what you want.

Files: none yet. This task's output is the reasoning the next three tasks are written against.

### Task 2 — `lib/embeddings/`: the second seam

**A new seam on ADR 0010's pattern, not a widened `CardProvider`.** The reason is stated in
§0 and is worth the sentence: `CardProvider` is a chat interface with three named
implementations, one of which is a deliberate stub and one of which is unwritten. Adding
`embed()` to it makes both of them owe an implementation of a capability neither has, and
`StubProvider` would answer it with exactly the fake vectors §3 forbids.

So: a parallel structure, deliberately the same shape so it reads as the same idea.

```
services/api/src/lib/embeddings/
  types.ts     EmbeddingProvider { name; dimensions; embed(texts: string[]): Promise<number[][]> }
  index.ts     resolveEmbeddingProvider() — reads EMBEDDING_PROVIDER, no default
  <vendor>.ts  the one real implementation
```

Everything ADR 0010 requires of a seam applies:

- **No default.** Unset or unrecognised throws, naming the variable. Same argument as
  `resolveProvider()`, sharper: a wrong embedder does not fail, it returns *plausible
  neighbours from a different vector space*, and the chat looks like it is working.
- **`dimensions` is on the interface**, because the column's type is `vector(n)` and `n` is a
  property of the model. A provider whose dimension disagrees with the migration must fail at
  startup with a sentence, not at query time with a Postgres type error. Assert it once where
  the provider is resolved.
- **Retryable/non-retryable is the same distinction**, and it is the same cost decision.
  Reuse `ProviderRetryableError` from `lib/providers/types.ts` rather than declaring a second
  error class — one concept, one definition, as CLAUDE.md says for schemas. If that import
  direction feels wrong, lift the class to `lib/errors.ts` and re-export; do not duplicate it.
- **Batch, because the API charges and rate-limits per request.** `embed()` takes an array
  and returns an array *in the same order*. A caller that has to zip results back to inputs by
  index is a caller that will eventually zip them wrong.

**Which vendor.** Owner-supplied key decides it; the interface does not care and that is the
point. Two that fit the constraint (cheap, OpenAI-compatible, no SDK — one `fetch`, as
`groq.ts` deliberately does):

| Option | Dimensions | Note |
| ------ | ---------- | ---- |
| OpenAI `text-embedding-3-small` | 1536 (or 512 via `dimensions`) | The default guess. Cheap enough that a demo corpus costs cents |
| Voyage / Cohere / Jina free tiers | varies | Fine. Whichever key exists |

**Record which, and its dimension, in §6 and in `.env.example`** with the reasoning inline as
that file already does for everything else. `EMBEDDING_MODEL` gets no default either, for the
reason DS1 proved when `llama-3.3-70b-versatile` turned out not to exist: a model id is
configuration, and the fix was one line because of it.

Files: `services/api/src/lib/embeddings/{types,index,<vendor>}.ts`, `.env.example`.

### Task 3 — Migration `0007_chunk_embeddings.sql`

```sql
create extension if not exists vector;
```

Then the table task 1 decided. Non-negotiable, each for a stated reason:

- **`user_id uuid not null`, and the index leads with it.** This is P12 §6's trap and it is
  the worst one in the codebase: `order by embedding <-> $1 limit k` without
  `where user_id = $2` does not error, does not look wrong, and **returns the most relevant
  passages from every user in the system as the answer to this user's question.** The
  migration header says this in as many words.
- **The vector column is `vector(n)` with `n` from task 2's model**, and the migration names
  the model it was written for in a comment. A dimension mismatch is a startup error by task
  2's assertion; the comment is what tells the next reader *why* the number is that number.
- **An ANN index, and honesty about it.** `hnsw` with `vector_cosine_ops` (or `ivfflat` if you
  prefer, with the reasoning). **But note what it cannot do:** the index accelerates the
  distance ordering; the `user_id` filter is applied around it, so on a small corpus Postgres
  may well ignore the index entirely and that is fine. **Do not conclude from a working query
  that the index is being used** — and do not spend the phase tuning it, because the demo
  corpus is a few hundred chunks and a sequential scan over that is sub-millisecond.
- **A unique constraint on `(job_id, chunk_index)`**, so re-embedding is an upsert rather
  than a duplicate. Re-running a job's embedding step must be idempotent — task 4's retry
  path depends on it.

Apply it with `npm run db:migrate`. **`npx supabase db push` is not how this is applied** —
that is the Supabase project, which this migration has nothing to do with.

Files: `services/api/migrations/0007_chunk_embeddings.sql`.

### Task 4 — Embedding on ingestion, as a second consumer of the same chunks

P12 task 1 is explicit and it is the right instinct: **embedding is a second consumer of the
chunks the pipeline already produces, not a second chunker.** `chunking.ts` runs once.

Where the call goes is a real decision with a recommendation:

> **In `pipeline-generate.ts`, alongside the card call, per chunk.** The chunk's text is
> already in hand there, the retry and partial-failure machinery already exists there, and
> the per-chunk progress the UI already polls stays meaningful. The alternative — a fourth
> pipeline step after `finalise` — means a second pass reading every chunk back out of
> Postgres to embed it, for no benefit.

Four properties, each a way this goes wrong:

1. **A failed embedding must not fail the chunk's cards.** They are separate capabilities
   from separate vendors. A chunk whose cards generated and whose embedding failed is a
   *usable chunk that is not yet searchable* — record it and move on. The inverse, dropping
   good cards because an embedding vendor was down, is strictly worse.
2. **It must be visible that it failed**, or task 8's "the sources don't cover that" becomes
   a lie told about a corpus with holes in it. Record per-chunk embedding failure where the
   job can report it.
3. **Budget: this is a second vendor, so it is a second budget.** Groq's 8,000 TPM
   ([DS1-HANDOFF](DS1-HANDOFF.md) §3) is untouched by this. The embedding vendor has its own
   limit, and `PIPELINE_CONCURRENCY` (default 2) now governs calls to both.
4. **Backfill is a decision, not an afterthought.** Every chunk ingested before this phase has
   no embedding, so every notebook created during DS1 is invisible to chat. Either write a
   one-shot backfill script (`scripts/`, not a migration — it makes paid API calls) or state
   in §6 that pre-DS2 notebooks are not searchable and demo on a fresh one. **Say which.**

Files: `services/api/src/handlers/pipeline-generate.ts`, `services/api/src/data/chunks.ts`
(new — see task 5), possibly `scripts/backfill-embeddings.mjs`.

### Task 5 — `data/chunks.ts`: the retrieval query, and the four rules

**A new table means a data-access module obeying all four tenancy rules. This is the module
where forgetting one is worst.**

```ts
// The shape. Read the where clause, then read it again.
export async function searchChunks(
  userId: string,          // rule 1: first parameter, never optional, never defaulted
  deckId: string,
  queryEmbedding: number[],
  k: number,
): Promise<RetrievedChunk[]>
```

- **Rule 2 is the whole phase.** `where c.user_id = $1` on the embedding table **and** on
  every table joined to it. Not "the join makes it safe" — the join is exactly where it gets
  forgotten, which is why `job_chunks` denormalises `user_id` in the first place.
- **Rule 3:** no SQL outside this directory. The handler calls this and maps errors.
- **Rule 4:** `userId` is the `sub` from the verified JWT. Never a body field, never a query
  parameter, never a header.
- **`scripts/check-data-access.mjs` cannot save you here.** It checks that `userId` is the
  first parameter and that SQL lives in `data/`. It cannot check that the `where` clause uses
  it. **Read the query. Then have the diff read.**

Also here: fetching the chunks a set of citations refers to, by `(jobId, chunkIndex)`, scoped
by `userId` — task 7's pane needs the text to show the cited span, and a chunk id is not a
capability any more than a card id is.

**A distance floor, and it is a product decision.** Cosine distance has no natural cutoff, and
without one every question retrieves *something* — the k nearest chunks exist even when the
question is about the weather. That is precisely how §3's rule gets violated by accident:
retrieval "succeeds", the model is asked, and it answers from irrelevant passages. Pick a
floor, **record the number and how you picked it in §6**, and treat "nothing above the floor"
as the ordinary no-answer path rather than an error.

Files: `services/api/src/data/chunks.ts`.

### Task 6 — `POST /decks/{deckId}/ask`, and the citation model

**The route is `/decks/{deckId}/ask`, not `/notebooks/…`.** P12 wrote `notebooks` before
`src/lib/notebooks.ts` existed; that file is explicit that **the rename stops at the frontend
adapter** and the wire says `deck`. Introducing a `/notebooks` route would make that file's
rule false on its own terms and would be the second vocabulary crossing the wire.

**Declare it in `scripts/dev-api.mjs` *and* `infra/lib/api-stack.ts`, or `check:routes`
fails.** If it fails, read it rather than silencing it — DS1 §7 finding 1 is what happens
when a route table and a handler map disagree.

**The citation model, decided before the prompt is written** (P12 task 4: *"a citation must
resolve to a source and an offset, or it is decoration"*).

> **The recommendation:** a citation is `{ jobId, chunkIndex }` plus the quoted span, and the
> response carries the retrieved chunks alongside the answer so the pane can render the span
> without a second round trip.
>
> **Be honest about the offset.** `chunkIndex` resolves to a *chunk*, not to a character
> offset in the original document — SPEC §4.6 already notes that `chunking.ts` produces flat
> text with no page dimension, and the original upload is not retained as text. A chunk is a
> few paragraphs, which is a real and useful citation. **It is not a highlighted sentence in
> a PDF, and the UI must not imply that it is.** Claiming precision the data does not have is
> the same failure as a stub answer, one layer down.

The handler:

1. Reads `sub` from the authorizer. Embeds the question via the task 2 seam.
2. Calls `searchChunks(userId, deckId, embedding, k)`.
3. **If nothing clears the floor, returns the no-answer response and does not call the chat
   model.** §3, corollary 1. This branch is not an error — 200 with `answer: null` and a
   reason, or an equivalent shape the pane can render honestly.
4. Otherwise calls the chat model with the passages, delimited, and the same
   untrusted-content framing `providers/prompt.ts` already uses: **the passages are material
   to be answered from, never instructions to follow.** They are the user's own documents,
   but that user pasted them from somewhere.
5. The prompt says: answer only from the passages; cite the passages used; if they do not
   contain the answer, say so.

**Quota.** Generation is priced in units and `GET /quota` reports it. Chat is a model call the
user can make repeatedly with no review gate in front of it. **Decide whether asking costs a
unit and record it in §6** — the defensible answer is that it does not, on the grounds that
units price *generation* and a shared meter would make asking a question eat a document's
budget. But an unmetered model endpoint is a real exposure and the decision should be
deliberate, not skipped.

Files: `services/api/src/handlers/chat.ts` (new), `scripts/dev-api.mjs`,
`infra/lib/api-stack.ts`.

### Task 7 — The chat pane

Replace `WorkspacePane`'s empty state. It is the largest area of the app and it currently
says the feature is not built — which was honest and is now false.

**Read that file's header before deleting it.** It states the refusal this phase is lifting,
and the lift is conditional on retrieval actually existing. The replacement inherits the
reasoning, so the new header should say what grounds the answers and what a citation means.

What it needs, and nothing beyond it (polish is DS4):

- Transcript, input, pending state. A question takes seconds; the pending state must be
  honest rather than a fake token stream.
- **Citations rendered as what they are:** a reference to a passage, expandable to show the
  passage. Not a page number, not a highlight — see task 6.
- **The no-answer case rendered as a first-class outcome**, not an error toast. "Your sources
  don't cover this" is the feature working correctly and should look like it.
- **Card content and chunk text are untrusted LLM/document output. Render as text.**
  `dangerouslySetInnerHTML` is blocked by an ESLint rule and this is exactly the surface that
  rule exists for. Do not disable it.
- The frontend talks to the API through `src/lib/api-client.ts` with a bearer token, as
  everything else does. **No new coupling**, and nothing under `src/` learns a seam variable.

Files: `src/features/notebooks/workspace/WorkspacePane.tsx`, a hook in the feature's
`queries.ts` neighbourhood, following whatever convention `useJobProgress` already sets.

### Task 8 — Run it. This is the task the phase exists for.

DS1's most valuable output was §7 — the list of real bugs that only running it found, none of
which `verify` could see. Do the same here.

1. `npm run db:migrate:status` → 0007 pending; `npm run db:migrate` → applies clean.
2. Ingest a document with real, specific content. Confirm embeddings were written — count the
   rows, do not assume.
3. **Ask a question the document answers.** The answer must be about the document, and the
   citation must resolve to a chunk that genuinely contains the answer. **Read the cited
   chunk.** A citation that points at the wrong chunk is worse than no citation, and it is
   invisible unless you look.
4. **Ask a question the document does not answer, deliberately.** P12 criterion 3, and the
   property most likely to regress silently. It must say it cannot answer. **If it answers
   anyway, the phase is not done** — that is the failure §3 exists to prevent, not a rough
   edge to note.
5. **Ask a question in a notebook with no sources.** Must not 500.
6. **Cross-tenant probe, and it is the most important one in the project so far.** Two
   accounts, each with a document on a *different* subject. Ask account A a question that
   account B's document answers well and A's does not. **The answer must be "not covered".**
   If B's content appears, retrieval is leaking across tenants — stop everything and fix it.
7. Force an embedding failure (a bad key on one run) and confirm the chunk's cards still land
   and the failure is recorded rather than swallowed.

**Write down what actually happened, including what broke.** Especially the exact question and
the exact answer for steps 3, 4 and 6 — under ADR 0005 that transcript *is* the verification.

### Task 9 — Documentation, and the two audits

1. **SPEC.md, and it is a correction rather than an addition.** §4.6 says the AI tutor is
   refused because *"chunks are not persisted retrievably"*. That has been false since
   migration 0006 and is now doubly false. Rewrite that paragraph to say what grounds the
   answers, what a citation resolves to, **and what it does not** (no page offsets). Add the
   flow to §4, the route to §8.2, and the tables to §5.
2. **An ADR for the vector store**, which P12 task 2 asked for explicitly: pgvector on Neon
   over a dedicated vector database, in a paragraph, with the same "RDS is already there,
   already tenanted" argument that now reads "Neon is already there" — plus the fact that the
   `<->` operator and the SQL are identical when RDS returns, which is D6's whole claim.
3. **An ADR or an amendment for the embedding seam.** ADR 0010 lists four seams; there are now
   five, and the fifth is the first added *after* the pattern was written down. Either amend
   0010's table or write 0011 recording that the pattern was reused deliberately and that
   §3's rule forbids a stub implementation of this one — a genuine asymmetry with the other
   four, and worth the paragraph.
4. **The seam audit, and it now has five variables:**

   ```
   grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER\|EMBEDDING_PROVIDER' \
     src/ services/api/src/handlers/
   ```

   Comments only. Anything else means a seam leaked upward and the brief's §8 table stopped
   being true. **Add the new row to that table** while you are there.
5. **The board** — DS2 complete, DS3 next.
6. **Write DS3's plan**, per the convention. It is the last task of every plan.

---

## 5. Acceptance criteria

Observable, in order of what they prove:

1. A question about an ingested document returns an answer grounded in that document, with at
   least one citation that resolves to a chunk containing the answer.
2. **A question the sources do not support returns "not covered" rather than a fluent
   fabrication.** The single most important criterion in this plan.
3. **A question answerable only by another user's documents returns "not covered".** Verified
   with two real accounts, not by reading the SQL.
4. The retrieval query filters on `user_id` on every table it touches. Verified by reading it.
5. **No path produces a chat answer without both a retrieval hit and a model call.** There is
   no stub embedder and no stub answerer anywhere in the tree.
6. A chunk whose embedding failed still contributes its cards, and the failure is recorded.
7. `EMBEDDING_PROVIDER` unset or bogus throws a named error at startup. So do the other four.
8. The five-variable seam grep returns nothing but comments.
9. `npm run verify` is green, including `check:data-access` and `check:routes`.
10. `JOB_STORE=dynamo` and `PIPELINE_RUNNER=sfn` still typecheck; `jobs-dynamo.ts` and
    `pipeline-sfn.ts` are still byte-identical to what P10 wrote.

---

## 6. Decisions to record

Write these back into SPEC or this file, so the next session inherits them rather than
re-deriving them:

- **Where embeddings live** — separate table or a column on `job_chunks`, and why (task 1.1).
- **What happens to `expires_at`** now that chunks are the corpus, and the explicit decision
  not to sweep it (task 1.2).
- **What deleting a deck does to its chat corpus** (task 1.3).
- **The embedding vendor and model**, its dimension, and why that vendor.
- **The distance floor**, the number, and how it was picked.
- **`k`** — how many passages the prompt gets, and what that costs per question.
- **Whether asking costs a quota unit**, with the reasoning either way.
- **Whether pre-DS2 chunks were backfilled**, or notebooks from DS1 are not searchable.
- **What a citation resolves to**, and — stated plainly — that it is a chunk and not a page
  or a character offset.

---

## 7. What will go unverified

There are no tests (ADR 0005), so name these honestly in the closing report rather than
letting a confident summary imply more:

- **Retrieval quality is unmeasured.** "It cited the right chunk" for a handful of questions
  is an impression, not a number. There is no recall@k, no golden set, and no eval harness —
  that is Phase E and it does not exist.
- **The cross-tenant probe is a handful of questions, not a proof.** It is the strongest
  evidence available here and it is still one path through one query.
  `check-data-access.mjs` checks shape, not meaning: a `searchChunks` that took `userId` and
  ignored it would pass every gate in this repository.
- **The distance floor is one person's judgement on one corpus.** Too high refuses answerable
  questions; too low is §3's failure with extra steps. Nothing measures which.
- **Nothing proves the embedding seam's two sides agree**, because there is only one side.
  When Bedrock's Titan embeddings arrive, the vectors are in a *different space* — a corpus
  embedded by one model and queried by another returns confident nonsense. **Say this in the
  seam's header**: switching `EMBEDDING_PROVIDER` on a populated corpus requires a
  re-embedding, and that is not a configuration change like the other four seams are.
- **The `hnsw` index is unproven as used.** Postgres may ignore it at this corpus size, and
  nothing here measures whether it does.
- **The no-answer path is verified by asking a few questions**, which is the same method that
  makes criterion 2 the most likely thing in this plan to regress unnoticed.
