-- Ingestion job state, in Postgres. DS1 task 2.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS IS THE WEAKER HALF OF A SEAM, AND THAT IS THE POINT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The same eight operations `services/api/src/data/jobs-dynamo.ts` performs
-- against DynamoDB, performed here instead. `JOB_STORE` chooses; both
-- implementations are kept, and neither is legacy (DEMO-SPRINT-BRIEF D4).
--
-- **What is genuinely lost, stated rather than glossed.** On DynamoDB `userId`
-- is the partition key: it is the *address* of the data, and a read that names
-- the wrong partition finds nothing because there is nothing there to find.
-- Here it is a column, and a statement that forgets `where user_id = $1`
-- returns every user's jobs. That is ADR 0008's admitted weakness applied to
-- two more tables, and it is why every index below leads with `user_id` and
-- why `data/jobs-postgres.ts` carries all four tenancy rules rather than three.
--
-- ── Expiry is a column, and nothing enforces it ───────────────────────────
--
-- DynamoDB has TTL; Postgres does not. `expires_at` below is therefore a
-- *record of intent*, not a guarantee -- a row past it stays until something
-- deletes it, and there is no scheduler in the demo stack to do that. It is
-- kept anyway so the two stores carry the same information and so a later
-- sweep has the column it needs.
--
-- The related failure that DOES have a mechanism is a job stranded `running`
-- by a crashed process: `data/jobs-postgres.ts` sweeps those on read, reusing
-- the staleness threshold `services/api/src/lib/quota.ts` already defines for
-- stuck generations rather than inventing a second one that can disagree.

-- ---------------------------------------------------------------------------
-- jobs -- one row per ingestion run
-- ---------------------------------------------------------------------------
create table public.jobs (
  id          uuid primary key,
  user_id     uuid not null,

  status      text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),

  -- How many chunks the document was split into. Zero until splitting is done,
  -- which is why the progress UI must not divide by it unguarded.
  chunk_count       int not null default 0 check (chunk_count >= 0),

  -- Advanced with `set chunks_completed = chunks_completed + 1`, which is
  -- atomic in Postgres exactly as DynamoDB's `ADD` is. A read-modify-write
  -- here would drop increments under the fan-out -- the same bug the DynamoDB
  -- module's comment warns about, available in this dialect too.
  chunks_completed  int not null default 0 check (chunks_completed >= 0),

  -- Nullable, and no foreign key to decks. The deck is created alongside the
  -- job today, but a job is a record of what happened and must survive its
  -- deck being deleted -- a cascade here would erase the audit trail of a run
  -- precisely when someone is trying to work out what it did.
  deck_id     uuid,

  error       text,

  -- True when the document exceeded MAX_CHUNKS_PER_JOB and the tail was
  -- dropped. Surfaced to the user rather than hidden: a deck that quietly
  -- covers three quarters of a document is a product that lies.
  truncated   boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);

comment on table public.jobs is
  'Ingestion runs. The Postgres half of the JOB_STORE seam; data/jobs-dynamo.ts '
  'is the other. user_id is a filter here, not a partition key -- see the header '
  'of 0006_jobs.sql and ADR 0008.';

comment on column public.jobs.expires_at is
  'Intent, not a guarantee. Postgres has no TTL and nothing sweeps this yet.';

-- `user_id` leads, because every read is scoped to one user and an index that
-- did not lead with it would invite a plan that scans other users'' rows before
-- filtering them out.
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);

-- The review gate's lookup: the newest job that produced a given deck. Partial,
-- because a job with no deck can never match it.
create index jobs_user_deck_idx on public.jobs (user_id, deck_id, created_at desc)
  where deck_id is not null;

-- ---------------------------------------------------------------------------
-- job_chunks -- one row per chunk, carrying both its input and its result
-- ---------------------------------------------------------------------------
--
-- DynamoDB kept these as two item kinds under one sort-key prefix (`#text#`
-- for the input, `#chunk#` for the result) because a single Query then read a
-- whole job. Postgres has joins, so one row holds both and the split buys
-- nothing here.
--
-- The text lives in the database rather than in the runner's memory for the
-- reason the DynamoDB module gives: the state machine's 256 KB payload limit
-- made it necessary there, and keeping it necessary here is what lets both
-- runners call the same three handlers unmodified.
create table public.job_chunks (
  job_id      uuid not null references public.jobs (id) on delete cascade,

  -- Denormalised deliberately. It is derivable through `job_id`, and carrying
  -- it means every statement in the data layer can filter on `user_id`
  -- directly -- rule 2 applied without a join. A join is a place to forget the
  -- filter; a column is not.
  user_id     uuid not null,

  chunk_index int not null check (chunk_index >= 0),

  status      text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),

  -- The chunk's source text: an input, never returned to a client. The
  -- progress response filters it out, as `getJobWithChunks` did on DynamoDB.
  source_text text,

  -- Draft cards, unvalidated LLM output at the moment they are written and
  -- validated by CardPayload before they get here. jsonb rather than json so a
  -- later query can index into them without reparsing.
  cards       jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),

  -- Which provider wrote these. Traceability, not telemetry: a card the stub
  -- produced must stay identifiable after it is stored, or fake content becomes
  -- anonymous the moment it is written down.
  provider    text,

  -- Topic names as the model gave them (D11). Raw and unreconciled: these
  -- become rows in public.topics only at the review gate, so a job the user
  -- abandons leaves no topics behind.
  topics      text[] not null default '{}',

  error       text,

  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',

  primary key (job_id, chunk_index)
);

comment on table public.job_chunks is
  'One row per chunk: its source text and its result. Cascades from jobs.';

-- The read is always "every chunk of one job, for this user, in order". The
-- primary key already orders by chunk_index within a job; this adds the tenancy
-- filter to the front so that read never touches another user''s rows.
create index job_chunks_user_job_idx on public.job_chunks (user_id, job_id, chunk_index);
