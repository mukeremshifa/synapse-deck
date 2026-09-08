-- FR7 — jobs become notebook-scoped, and learn the contract's stages.
--
-- ── Why extend `jobs` rather than add a second table ──────────────────────
--
-- The table 0006 created is already the right *shape*: one row per unit of
-- background work, with a status, a chunk count and a completion count, behind
-- the `JOB_STORE` seam so DynamoDB or Postgres can serve it. What it is missing
-- is the contract's vocabulary — a job belongs to a notebook, has a kind, and
-- reports a stage — and those are four columns, not a new table.
--
-- A second jobs table would mean two polling paths, two stores to keep in step,
-- and the `JOB_STORE` seam meaning nothing. This is the cheaper and more honest
-- change.
--
-- Every column is added nullable or with a default, so every existing row stays
-- valid and the ingestion pipeline that writes them keeps working untouched.

-- The notebook this job is working in. Null for the pre-FR7 rows, which are
-- deck-scoped and predate notebooks entirely.
alter table public.jobs
  add column notebook_id uuid references public.notebooks on delete cascade;

-- What kind of work this is. The contract's `JobKind`.
--
-- Defaulted to 'create-artifact' rather than left null: every existing row is a
-- card generation, which is what that kind means, so the default is a true
-- statement about the rows rather than a convenience.
alter table public.jobs
  add column kind text not null default 'create-artifact'
    check (kind in ('add-source', 'create-artifact'));

-- The contract's `JobStage`. `queued` is always first, `done` is terminal and
-- `status` is what says whether a terminal job worked.
--
-- **These are the stages FR4's UI displays**, and that mapping was FR4's
-- discipline: a job that reports a stage no surface can render is a progress
-- bar that stalls at a name the user has never seen.
alter table public.jobs
  add column stage text not null default 'queued'
    check (stage in ('queued', 'extracting', 'splitting', 'generating', 'saving', 'done'));

-- What this job is building, or the source it is reading.
--
-- **FR6 §8.7 item 4:** `Job.result` is populated only on `succeeded`, so a
-- running job could not name the artifact it was building, which made a
-- per-row progress bar inexpressible and matched a failed job to its `failed`
-- artifact only heuristically. This column fixes that: it is set when the row
-- is created, so a running job can be joined to its artifact from the first
-- poll. The contract's `result` field still appears only on success — this is
-- the server knowing more than it publishes, which is the right direction.
alter table public.jobs
  add column artifact_id uuid references public.artifacts on delete cascade;

alter table public.jobs
  add column source_id uuid references public.sources on delete cascade;

-- The error code, alongside the message 0006 already stores. The contract's
-- `Job.error` is `{ code, message }`, and a client that must decide whether to
-- offer "retry" or "upgrade" needs the code rather than a string to match on.
alter table public.jobs
  add column error_code text check (error_code is null or char_length(error_code) <= 64);

-- Units that failed while the job still produced something. The review gate's
-- reason for existing: the user should see what did not make it in.
alter table public.jobs
  add column units_failed int not null default 0 check (units_failed >= 0);

comment on column public.jobs.notebook_id is
  'The notebook this job works in. Null for pre-FR7 deck-scoped rows.';
comment on column public.jobs.artifact_id is
  'What this job is building. Set at creation, so a RUNNING job can name its '
  'artifact -- see FR6 section 8.7 item 4.';

-- The poll: one notebook's jobs, newest first. This is what `listJobs` reads
-- on every generation panel render, so it is the one that must be indexed.
create index jobs_notebook_created_idx
  on public.jobs (user_id, notebook_id, created_at desc)
  where notebook_id is not null;

create index jobs_artifact_idx
  on public.jobs (user_id, artifact_id)
  where artifact_id is not null;
