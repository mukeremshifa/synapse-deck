-- Chunk embeddings: the retrieval corpus gets a vector. DS2 task 3.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE TRAP IN THIS FILE IS THE WORST ONE IN THE CODEBASE. READ THIS FIRST.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A nearest-neighbour search is written like this:
--
--     select ... order by embedding <=> $1 limit 8
--
-- That query does not error. It does not look wrong. It returns **the most
-- relevant passages from every user in the system** and hands them to a
-- language model as the answer to *this* user's question. There is no 404, no
-- empty result, no Postgres complaint -- just another account's study material,
-- rewritten into fluent prose and cited as though it were the reader's own.
--
-- The only thing standing between this schema and that outcome is
-- `where user_id = $n` in `services/api/src/data/chunks.ts`, on this table and
-- on every table joined to it. RLS would have refused the query outright; on
-- Neon and RDS there is no `auth.uid()` to write a policy against, so the
-- boundary is four rules in a data-access module (ADR 0008) and a linter that
-- checks the shape of the code rather than its meaning.
--
-- `scripts/check-data-access.mjs` cannot catch this. A `searchChunks` that
-- takes `userId` and never uses it passes every gate in this repository.
--
-- ── The three schema decisions, made in DS2 task 1 ────────────────────────
--
-- **1. A separate table, not a vector column on `job_chunks`.**
--
-- The cheap answer was `alter table job_chunks add column embedding vector(n)`,
-- and it was rejected for two concrete reasons rather than for purity. First,
-- every read of a chunk row in `data/jobs-postgres.ts` would drag 6 KB of float
-- through a pipeline that has no use for it -- that module is already careful
-- to exclude `source_text` for exactly this reason, and a vector is larger.
-- Second, an embedding's lifecycle is genuinely not a chunk's: re-embedding
-- against a new model, or a model with a different dimension, rewrites this
-- table and leaves the pipeline's state completely alone.
--
-- **2. `expires_at` on `job_chunks` is now load-bearing, and must not be swept.**
--
-- `0006_jobs.sql` calls that column "intent, not a guarantee" and notes nothing
-- enforces it. That was harmless while chunks were pipeline scratch. It is
-- **actively dangerous now**, because those same chunks are the knowledge base
-- this table indexes.
--
-- So, stated as plainly as it can be put, for whoever reads that column next
-- and takes it as an instruction:
--
--     DO NOT WRITE A SWEEP FOR job_chunks.expires_at.
--
-- A job that deletes expired chunks would silently empty every notebook's
-- retrieval corpus. Nothing would error. The symptom would be chat answering
-- "your sources do not cover that" about documents sitting right there in the
-- sources rail, with no failure recorded anywhere to explain it. The column's
-- comment is rewritten below to say this, because a comment saying "intent" is
-- how the next person justifies acting on it.
--
-- **3. Deleting a deck does not delete its chat corpus, and that is deliberate.**
--
-- The chain: this table cascades from `job_chunks`, which cascades from `jobs`.
-- `jobs.deck_id` is **nullable with no foreign key at all** -- 0006 says why, and
-- the reason still holds: a job is a record of what happened and must survive
-- its deck being deleted, or the audit trail of a run disappears exactly when
-- someone is trying to work out what it did.
--
-- The consequence, which DS2 §6 asks to be said out loud: **deleting a notebook
-- leaves its chunks and their embeddings in this table.** They become
-- unreachable rather than deleted -- `searchChunks` joins through `jobs.deck_id`
-- to a deck that no longer exists, so no query can return them. That is a
-- storage cost and a privacy consideration, not a leak: the rows stay scoped to
-- their owner's `user_id` and no path reaches them. A real delete belongs with
-- the sweep that DS2 is not writing, and it is Phase F's to decide.

-- ---------------------------------------------------------------------------
-- pgvector
-- ---------------------------------------------------------------------------
-- Available on Neon at 0.8.6, not installed until this line. Needs no console
-- work and no Neon-specific API -- which is the point of D2: the same statement
-- runs on RDS when RDS returns, and `<=>` means the same thing there.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- chunk_embeddings -- one row per embedded chunk
-- ---------------------------------------------------------------------------
create table public.chunk_embeddings (
  job_id      uuid not null,

  -- Denormalised, for `job_chunks`'s stated reason and with more at stake here.
  -- Carrying `user_id` means the similarity search filters on this table
  -- directly instead of relying on a join to scope it. A join is a place to
  -- forget the filter; a column is not. See the header.
  user_id     uuid not null,

  chunk_index int not null check (chunk_index >= 0),

  -- ── Why 1536 ────────────────────────────────────────────────────────────
  --
  -- This column was written for **OpenAI `text-embedding-3-small` at its native
  -- 1536 dimensions**. The number is a property of that model, not a choice
  -- made here, and it is named so the next reader knows what to check rather
  -- than guessing why the constant is what it is.
  --
  -- A provider whose `dimensions` disagrees with this fails at **startup**,
  -- with a sentence naming both numbers -- see `lib/embeddings/index.ts`. That
  -- assertion exists because the alternative is a Postgres type error at query
  -- time, arriving mid-question with no indication that a config change three
  -- deploys ago caused it.
  --
  -- **Changing this number is a re-embedding, not a migration.** Vectors from
  -- two different models occupy different spaces: a corpus embedded by one and
  -- queried by another returns confident nonsense -- real rows, plausible
  -- ordering, no error, wrong answers. A new dimension means every row here is
  -- rewritten, and that is a paid pass over the whole corpus.
  embedding   vector(1536) not null,

  -- Which model produced this vector. Traceability, exactly as
  -- `job_chunks.provider` is for cards, and for a sharper reason: a table
  -- holding vectors from two models is silently broken, and this column is the
  -- only way to find out that it does.
  model       text not null,

  created_at  timestamptz not null default now(),

  -- Re-embedding a chunk is an upsert, never a duplicate. Task 4's retry path
  -- depends on this: a chunk re-run after a transient embedding failure must
  -- replace its vector rather than add a second one, or the same passage
  -- competes with itself for the k slots in a search.
  primary key (job_id, chunk_index),

  -- Cascades from the chunk, which cascades from the job. An embedding without
  -- its `source_text` is unusable -- the search returns a row whose text the
  -- pane cannot render -- so it must not outlive it.
  foreign key (job_id, chunk_index)
    references public.job_chunks (job_id, chunk_index) on delete cascade
);

comment on table public.chunk_embeddings is
  'One vector per chunk: the retrieval corpus for grounded chat. Every query '
  'MUST filter user_id -- a nearest-neighbour search without it returns other '
  'users passages as this user answer. See the header of '
  '0007_chunk_embeddings.sql and ADR 0008.';

comment on column public.chunk_embeddings.embedding is
  'vector(1536), written for OpenAI text-embedding-3-small. Changing the '
  'dimension requires re-embedding the whole corpus, not just a migration: '
  'vectors from different models are not comparable.';

-- ── The tenancy index, and honesty about what it does ─────────────────────
--
-- `user_id` leads, so the planner has a cheap way to reach one user's rows
-- before any distance is computed. On a demo corpus of a few hundred chunks it
-- will very likely choose a sequential scan instead, and that is fine -- a
-- filter over a few hundred rows is sub-millisecond.
--
-- **This index is not the security boundary.** An index is a performance hint;
-- the planner may ignore it and the query still returns whatever the `where`
-- clause allows. Only the `where` clause scopes the tenant.
create index chunk_embeddings_user_idx on public.chunk_embeddings (user_id);

-- ── The ANN index, and what it cannot do ──────────────────────────────────
--
-- `hnsw` with `vector_cosine_ops`, matching the `<=>` operator the search uses.
-- Chosen over `ivfflat` because it needs no training pass over existing data --
-- an `ivfflat` index built on an empty table has useless lists, and this table
-- is empty at the moment this migration runs.
--
-- **What it accelerates is the distance ordering, not the tenancy filter.**
-- Postgres applies `where user_id = $1` around the index scan, which means:
--
--   - The index does not make the query safe. It never did and cannot.
--   - On a small corpus the planner may skip it entirely. **Do not conclude
--     from a working query that this index is being used** -- and do not spend
--     time tuning it, because a sequential scan over a few hundred vectors is
--     already faster than the model call that follows it.
--
-- Nothing in DS2 measures whether this index is used. That is stated in the
-- plan's §7 as an unverified claim rather than implied to be a solved problem.
create index chunk_embeddings_vector_idx on public.chunk_embeddings
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- The comment that stops someone emptying the knowledge base
-- ---------------------------------------------------------------------------
-- 0006 set this to "Intent, not a guarantee. Postgres has no TTL and nothing
-- sweeps this yet." Read today, that is an invitation to write the sweep. It is
-- replaced rather than supplemented, because the old sentence is the dangerous
-- half and leaving it available to be quoted defeats the point.
comment on column public.job_chunks.expires_at is
  'RETAINED DELIBERATELY -- DO NOT SWEEP. Chunks stopped being pipeline scratch '
  'at DS2: job_chunks.source_text is the retrieval corpus for grounded chat, and '
  'public.chunk_embeddings indexes it. Deleting expired chunks would silently '
  'empty every notebook knowledge base with no error anywhere -- chat would '
  'answer "your sources do not cover that" about documents still visible in the '
  'sources rail. The column is kept so both JOB_STORE halves carry the same '
  'fields, not as an instruction to act on. See 0007_chunk_embeddings.sql.';
