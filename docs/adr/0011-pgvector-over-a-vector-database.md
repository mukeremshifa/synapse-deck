# 11. pgvector in the application database, over a dedicated vector store

**Status:** Accepted · **Date:** 2026-09-07 · **Implements:** [DEMO-SPRINT-BRIEF.md](../plans/DEMO-SPRINT-BRIEF.md) D6, [DS2](../plans/DS2-grounded-chat.md) task 3 · **Follows from:** [ADR 0008](0008-application-level-tenancy.md)

## Context

DS2 added grounded chat, which needs a nearest-neighbour search over one user's document
chunks. The chunks were already there — migration `0006` gave `job_chunks` a `source_text`
column — so the question was only where the vectors go and what searches them.

The alternatives were a managed vector database (Pinecone, Weaviate, Qdrant) or the
`pgvector` extension in the Postgres this application already runs on. The demo corpus is a
few hundred chunks; the production ceiling this product realistically reaches is tens of
thousands.

## Decision

**pgvector, in the same database as the rows it describes.** One extension, one table, and
`<=>` in a query the data layer already knows how to write.

Three reasons, in the order they actually decided it.

**1. Tenancy is already solved here, and it would have to be solved twice there.**

This is the argument that matters and it is not about performance. [ADR
0008](0008-application-level-tenancy.md) retired RLS and put the tenancy boundary in
`services/api/src/data/`: `userId` first, `where user_id = $1` on every statement, no SQL
above the data layer. A vector search in the same database is *one more statement obeying
that rule* — the filter and the distance ordering are the same query, checked by reading one
function.

A separate vector service is a second datastore with its own notion of a namespace, its own
filter syntax, and its own failure mode when a filter is forgotten. And the failure mode
here is the worst one in the product: a nearest-neighbour search that loses its tenancy
filter does not error and does not look wrong — it returns another user's most relevant
passages and a language model rewrites them into a fluent answer with citations attached.
Having exactly one place where that can go wrong is worth more than any indexing feature on
offer.

It also keeps the search joinable. `data/chunks.ts` filters `chunk_embeddings`, `job_chunks`
and `jobs` in one statement — the vector's owner, the chunk's owner and the job's owner,
checked together, plus the deck scope. Across two systems that is a fetch from the vector
store followed by a filter in application code, which is the same logic with a network hop
in the middle and one more place to get it wrong.

**2. It is a second system to run, pay for and keep in sync, for a corpus this size.**

A managed vector database is another vendor, another key, another failure domain, and a
second copy of every chunk that can drift from the first. At a few hundred vectors it buys
nothing: a sequential scan over that many rows is sub-millisecond and faster than the model
call that follows it. The scale where a dedicated store earns itself is real, and it is
several orders of magnitude away.

**3. The SQL is identical when RDS returns, which is D6's whole claim.**

`create extension vector`, `vector(1536)`, `<=>`, `using hnsw (embedding vector_cosine_ops)`
— every one of those runs unchanged on RDS Postgres. Nothing in the code knows it is talking
to Neon ([D2](../plans/DEMO-SPRINT-BRIEF.md)), and retrieval does not change that: the move
back is still a connection string. A vector vendor chosen now would be a vendor the AWS
build inherits, which is exactly what the owner's constraint on this sprint forbids.

## Consequences

**The vector column lives in a separate table**, not on `job_chunks`. A `vector(1536)` is
6 KB, and `jobs-postgres.ts` reads chunk rows on the pipeline's hot path with no use for it —
that module already excludes `source_text` for the same reason. Separating them also
separates the lifecycles: re-embedding rewrites one table and leaves pipeline state alone.

**The ANN index is not a security boundary and may not even be used.** `hnsw` accelerates
the distance ordering; the `user_id` filter is applied around it. On a small corpus the
planner may ignore the index entirely, and nothing in DS2 measures whether it does. Only the
`where` clause scopes the tenant, and it does so whether or not the index participates.

**Changing the embedding model is a data migration, not a config change.** The column's
width is a property of the model, and vectors from two models are not comparable — a corpus
written by one and queried by another returns real rows in a plausible order that means
nothing. `chunk_embeddings.model` records which model wrote each row, which is the only way
to discover a table holding two. See [ADR 0012](0012-embedding-provider-seam.md).

**What this does not buy.** No hybrid search, no re-ranking, no metadata-filtered ANN
tuning, and no measurement of retrieval quality at all — there is no recall@k here and no
golden set to compute one against (ADR 0005: there are no tests). If retrieval quality turns
out to be the product's limiting factor, that is measured first and re-decided second; this
ADR is not a claim that pgvector is the endpoint, only that a second system was not worth
buying before anything had been measured.
