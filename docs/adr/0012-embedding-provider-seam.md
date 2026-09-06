# 12. The embedding provider is a fifth seam, and the only one that may not have a stub

**Status:** Accepted · **Date:** 2026-09-07 · **Implements:** [DS2](../plans/DS2-grounded-chat.md) task 2 · **Extends:** [ADR 0010](0010-runtime-seams.md)

## Context

[ADR 0010](0010-runtime-seams.md) recorded four runtime seams and the pattern behind them:
a module that resolves one of several implementations from an environment variable, with no
default, no branching above the data layer, and implementations structurally required to
match.

DS2 needed a fifth. Grounded chat embeds every chunk at ingestion and embeds the question at
query time, and **Groq has no embedding model at all** — the account's catalogue is chat,
audio and prompt-guard only. The brief's D6 had hedged on this ("if Groq has no embedding
model that fits, a dedicated embedding provider is a second seam"); listing the catalogue
resolved the hedge into a certainty. So the completion and the embedding go to two different
vendors with two separate rate limits, and something has to choose the second one.

This is the first seam added *after* the pattern was written down, which makes it worth
recording whether the pattern was reused deliberately or merely copied.

## Decision

**A fifth seam, `EMBEDDING_PROVIDER`, on ADR 0010's pattern — with one deliberate
asymmetry: it has no stub implementation and must never get one.**

### It is not a method on `CardProvider`

The cheap version was `embed()` added to the existing model-provider interface. It was
rejected for a reason that is a safety property rather than a taste in interfaces:
`CardProvider` has three implementations, one of which is a deliberate stub. Widening the
interface obliges `StubProvider` to implement `embed()` — and the only thing it could return
is fake vectors, which is precisely what the rest of this ADR exists to forbid.

The same reasoning produced a second, narrower interface for *answering*
(`AnsweringProvider`), which `GroqProvider` implements and `StubProvider` does not. The chat
endpoint asks for an answering provider and gets `null` under `CARD_PROVIDER=stub`, so it
reports that chat is unavailable rather than answering. That is the type system enforcing
the rule, not a convention.

### There is no `EMBEDDING_PROVIDER=stub`, and the resolver refuses it by name

Every other seam has a local or offline implementation you can develop against. This one
does not, and the asymmetry is the point:

> A stub embedder returns vectors whose neighbours are meaningless. Retrieval then returns
> arbitrary chunks, ranked confidently, and the model writes a fluent answer grounded in
> noise. **Unlike a stub card, there is nothing on screen that says it is fake.** A stub card
> announces itself in its own text and passes a review gate before it becomes anything; a
> chat answer has neither property, and a plausible wrong answer about the reader's own study
> material is indistinguishable from a right one — they are asking precisely because they do
> not know.

So `resolveEmbeddingProvider()` refuses `stub` by name, with that reasoning in the error
message, rather than merely reporting it as an unrecognised value. Someone reaching for it
is trying to develop offline and deserves to be told why they cannot.

### `dimensions` is on the interface, and asserted once at resolution

The column is `vector(1536)` and `n` is a property of the model, not a choice. A provider
whose dimension disagrees fails at **startup**, naming both numbers. Without that assertion
the failure is a Postgres type error — `expected 1536 dimensions, not 3072` — arriving
mid-ingestion, naming neither the variable that caused it nor the model that was swapped,
and reading like the database is broken.

### `embed()` is batched and order-preserving

It takes an array and returns one vector per input **in the same order**, or throws. Vendors
charge and rate-limit per request, so batching is the difference between a handful of calls
and hundreds. But the ordering guarantee is the part that matters: a caller forced to zip
results back to inputs by hand will eventually zip them wrong, and a mis-zipped embedding is
invisible — every row still has a plausible vector, it just belongs to a different passage.
The symptom reads as "retrieval quality is poor" rather than as a bug. The OpenAI
implementation places each result by the `index` the API returns rather than by arrival
order, and refuses a batch it cannot account for completely.

### It reuses `ProviderRetryableError` rather than declaring a second one

One concept — "this failure is worth another attempt and this one is not" — one definition,
as CLAUDE.md requires for schemas and for the same reason: two definitions drift, and an
`instanceof` check against the wrong one silently stops retrying. The import direction
(embeddings depending on the card provider's module) is admittedly odd; lifting the class to
`lib/errors.ts` was considered and deferred, because it would touch three correct files to
move something already correct, in the same commit range as a new feature. A third consumer
is the moment to lift it.

## Consequences

**ADR 0010's table now has five rows.** The fifth is added there and in
[DEMO-SPRINT-BRIEF §8](../plans/DEMO-SPRINT-BRIEF.md).

**This seam is *not* a configuration change, and that breaks the pattern's own promise.**
The other four can be flipped between deploys because the data means the same thing on both
sides: a job row is a job row in DynamoDB and in Postgres. Embeddings are not like that.

> Two models embed into two different vector spaces. A corpus written by one and queried by
> another returns real rows, in a plausible order, with no error anywhere — and the ordering
> is meaningless, so the answers are confident nonsense.

**Switching `EMBEDDING_PROVIDER` on a populated corpus requires re-embedding every chunk**,
which is a paid pass over the whole corpus. When Bedrock's Titan embeddings arrive, *that* is
the work — not an edit to `.env.local`. `scripts/backfill-embeddings.mjs` is the tool, and
`chunk_embeddings.model` is how you find out a table already holds two models' vectors. This
is stated in the seam's header, in the migration, and in `.env.example`, because it is the
one place a reader who has internalised ADR 0010 would reasonably guess wrong.

**Nothing proves the two sides of this seam agree, because there is only one side.** That
is the same honest limit ADR 0010 records for `JOB_STORE=dynamo`, and it is sharper here:
structural typing prevents signature drift and says nothing about whether two models'
vectors mean the same thing. They do not.
