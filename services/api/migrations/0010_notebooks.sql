-- FR7 task 1 — the notebook/artifact model.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE CHANGING ANYTHING HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This migration is the schema half of the FR re-architecture. Six phases of
-- frontend were built against `src/lib/api/contract.ts`, and the contract — not
-- this file and not the brief — is the specification. Everything below exists
-- because a contract shape demanded it.
--
-- **There is no Row Level Security here.** Same as 0001: RDS has no
-- `auth.uid()` and no `authenticated` role, so the boundary lives in
-- `services/api/src/data/` where every exported function takes `userId` first
-- and every statement carries `where user_id = $1` (ADR 0008). Every table this
-- migration creates has `user_id uuid not null` for exactly that reason — even
-- the ones reachable only through a parent, because a query that joins its way
-- to a row must still be able to filter on the tenant without a join.
--
-- ── What this migration does NOT do ───────────────────────────────────────
--
-- **It does not drop `decks`.** The old table keeps its rows, its cards and its
-- reviews. `notebooks` is created alongside, and 0011 backfills. Dropping a
-- table with live data in it is the owner's decision (CLAUDE.md), and nothing
-- here needs it gone to work: `cards.artifact_id` is added nullable, so every
-- existing card stays valid while it is null.
--
-- ── The central modelling decision: one artifact table ────────────────────
--
-- `artifacts` is ONE kind-tagged table, not four parallel ones. The contract's
-- `ArtifactPayload` is a discriminated union on `kind` and brief §1.1 calls this
-- "the central modelling move and the one a future session is most likely to
-- try to simplify back into four tables. Do not."
--
-- What the single table buys, concretely:
--   * one query lists everything a notebook has produced, ordered by one clock;
--   * provenance (`source_ids`, `sources_snapshot`) is declared once;
--   * a new kind is a new enum value, not a fifth table plus a fifth union arm.
--
-- The kind-specific half lives in `payload jsonb`, and the counts inside it are
-- NOT stored — they are recomputed by the data layer's aggregate queries, the
-- way `listDecks` already counts cards. A stored count drifts the first time a
-- write fails halfway. `payload` holds only what cannot be derived: an exam's
-- config and blueprint, a note set's origin.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.artifact_kind   as enum ('deck', 'quiz', 'noteset', 'exam');
create type public.artifact_status as enum ('generating', 'ready', 'failed');
create type public.source_kind     as enum ('text', 'document', 'url');
create type public.source_status   as enum ('processing', 'ready', 'failed');
create type public.attempt_outcome as enum ('in-progress', 'submitted', 'abandoned');

-- ---------------------------------------------------------------------------
-- notebooks — the only first-class citizen (contract `Notebook`)
-- ---------------------------------------------------------------------------
-- `readiness` and `counts` on the contract are COMPUTED, not columns. They are
-- a roll-up over the notebook's artifacts and their contents, and storing them
-- would mean every card review had to write back up the tree.
create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notebooks_user_updated_idx on public.notebooks (user_id, updated_at desc);

create trigger notebooks_touch_updated_at
  before update on public.notebooks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sources — persisted at last (contract `Source`)
-- ---------------------------------------------------------------------------
-- Before FR7 a notebook's sources were `useState([])` in the browser: they
-- existed for the duration of one generate modal and were gone on reload. That
-- is why `client.ts` throws "Sources are not persisted" for four methods.
--
-- `status` exists because adding a source is a job — the pipeline has to fetch,
-- split and embed it — so a source is visible before it is usable.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  notebook_id uuid not null references public.notebooks on delete cascade,

  kind public.source_kind not null,
  title text not null check (char_length(title) between 1 and 255),
  status public.source_status not null default 'processing',
  -- Why the pipeline could not read it. Null unless status = 'failed'.
  error text check (error is null or char_length(error) <= 2000),
  -- Bytes for a document, characters for a paste. Null while unknown.
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),

  -- The raw per-source topic names from chunking. A notebook's topics are
  -- reconciled from these by name (ADR 0009) and are notebook-scoped; this
  -- column is the input to that, not the result.
  topic_names text[] not null default '{}',

  -- Where the text actually lives. For a paste this is the text; for a document
  -- it is the extracted text. Null while processing.
  content text,
  -- The upload object this came from, for a document. Not a foreign key: the
  -- upload store may be S3 or local disk and neither is a table here.
  object_id text check (object_id is null or char_length(object_id) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sources_notebook_idx on public.sources (user_id, notebook_id, created_at desc);

create trigger sources_touch_updated_at
  before update on public.sources
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- artifacts — the central noun (contract `Artifact`)
-- ---------------------------------------------------------------------------
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  notebook_id uuid not null references public.notebooks on delete cascade,

  kind public.artifact_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  status public.artifact_status not null default 'generating',
  -- Why a generation failed, shown on the failed row so the user can retry.
  error text check (error is null or char_length(error) <= 2000),

  /*
   * Provenance, in two columns that do different jobs.
   *
   * `source_ids` is for LINKING: it may name a source that has been deleted,
   * and the contract says every consumer must handle that. It is a uuid[]
   * rather than a join table precisely because it is allowed to dangle — a
   * foreign key would either block the delete or null the reference, and both
   * destroy the record of what the artifact was actually built from.
   *
   * `sources_snapshot` is for NAMING: frozen at generation, complete, never
   * dangles. This is what the provenance line renders. A deleted source shows
   * struck through, never omitted (FR3's pattern, verified in a browser).
   */
  source_ids uuid[] not null default '{}',
  sources_snapshot jsonb not null default '[]',

  /*
   * The kind-specific half. Holds ONLY what cannot be derived:
   *   deck     {}                                    counts are computed
   *   quiz     {}                                    counts are computed
   *   noteset  { origin }                            'generated' | 'chat'
   *   exam     { config, blueprint }                 counts are computed
   */
  payload jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Structural guard only; Zod at the boundary does the real validation. A
  -- note set must say where it came from, an exam must carry its config and
  -- blueprint — those are the fields with no derivable value.
  constraint artifacts_payload_shape check (
    case kind
      when 'noteset' then payload ? 'origin'
      when 'exam'    then payload ? 'config' and payload ? 'blueprint'
      else true
    end
  )
);

-- The artifact list: one notebook's artifacts, newest first, optionally by kind.
create index artifacts_notebook_idx
  on public.artifacts (user_id, notebook_id, created_at desc);
create index artifacts_notebook_kind_idx
  on public.artifacts (user_id, notebook_id, kind, created_at desc);

create trigger artifacts_touch_updated_at
  before update on public.artifacts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- questions — a quiz or exam's contents (contract `Question`)
-- ---------------------------------------------------------------------------
-- **A question is not a card, and this table is the seam that keeps it that
-- way.** A card fuses content with FSRS scheduling state; a question answered
-- once under time is not on a schedule at all. Forcing questions into `cards`
-- would mean nullable scheduling columns and a weakened
-- `cards_state_consistency` — compromising the flashcard model to accommodate
-- a different one.
--
-- Only MCQ exists: grading free text needs a model and a rubric, and the
-- contract leaves it out deliberately.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  artifact_id uuid not null references public.artifacts on delete cascade,

  -- { stem, options: [{ text, correct }] } — the contract's McqPayload.
  payload jsonb not null,
  topic_id uuid references public.topics on delete set null,

  -- Presentation order within its quiz or exam. Stable, so a resumed attempt
  -- sees the same paper.
  position int not null default 0 check (position >= 0),

  created_at timestamptz not null default now(),

  constraint questions_payload_shape check (payload ? 'stem' and payload ? 'options')
);

create index questions_artifact_idx on public.questions (user_id, artifact_id, position);

-- ---------------------------------------------------------------------------
-- note_blocks — a note set's contents (contract `NoteBlock`)
-- ---------------------------------------------------------------------------
-- **A discriminated union of blocks, never one text blob** (brief §1.2(2)), so
-- the notes editor that comes later is a feature rather than a migration.
--
-- `read_at` is per block because readiness counts read blocks, and the reader
-- marks them monotonically — a block once read stays read.
create table public.note_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  artifact_id uuid not null references public.artifacts on delete cascade,

  -- { type: 'heading'|'paragraph'|'list'|'quote', ... } — the contract's union.
  block jsonb not null,
  position int not null default 0 check (position >= 0),

  -- The source a quote came from. **May dangle**, and unlike `artifacts` this
  -- one can name a source the artifact's own snapshot never recorded (FR5's
  -- drift row: three provenance states here, not two). No foreign key, for the
  -- same reason as `artifacts.source_ids`.
  source_id uuid,

  read_at timestamptz,

  created_at timestamptz not null default now(),

  constraint note_blocks_shape check (block ? 'type')
);

create index note_blocks_artifact_idx on public.note_blocks (user_id, artifact_id, position);

-- ---------------------------------------------------------------------------
-- attempts — one sitting of a quiz or an exam (contract `Attempt`)
-- ---------------------------------------------------------------------------
-- The same record serves both kinds. 0008_answers.sql recorded the gap this
-- closes: *"there is no `exams` table, because an exam is currently assembled
-- in the browser"* — answers were written loose, grouped by an `attempt_id`
-- that pointed at nothing.
--
-- `outcome = 'abandoned'` is written by a server-side sweep, not by a runner: a
-- browser cannot distinguish "walked away" from "lost the network" (FR5 §6.2).
-- The sweep is at the bottom of this file.
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  notebook_id uuid not null references public.notebooks on delete cascade,
  artifact_id uuid not null references public.artifacts on delete cascade,

  outcome public.attempt_outcome not null default 'in-progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,

  -- Correct over answered, 0..1. Null while in progress.
  score double precision check (score is null or (score >= 0 and score <= 1)),

  constraint attempts_submitted_consistency check (
    (outcome = 'in-progress' and submitted_at is null and score is null)
    or (outcome = 'submitted' and submitted_at is not null and score is not null)
    or (outcome = 'abandoned')
  )
);

create index attempts_artifact_idx on public.attempts (user_id, artifact_id, started_at desc);
create index attempts_notebook_idx on public.attempts (user_id, notebook_id, started_at desc);
-- The abandonment sweep's index: only rows it can act on.
create index attempts_in_progress_idx on public.attempts (user_id, started_at)
  where outcome = 'in-progress';

-- ---------------------------------------------------------------------------
-- attempt_answers — one answer within an attempt (contract `AttemptAnswer`)
-- ---------------------------------------------------------------------------
-- Separate from `public.answers`, which 0008 created for the browser-assembled
-- exam. That table stays for its existing rows; this one is attempt-parented
-- and carries the two fields the old one could not: `flagged`, and a null
-- `selected_option` meaning "never answered" rather than "answered nothing".
--
-- `question_text` is COPIED, not joined (ADR 0013). It is the authority for
-- what the answer meant once the question behind it has been regenerated or
-- deleted. `selected_option` indexes the **presented** order, which is why
-- shuffling is resolved once when the attempt starts.
--
-- NOT append-only, unlike `public.answers`: a quiz is resumable, so an answer
-- is written when the candidate picks an option and rewritten when they change
-- their mind before submitting. `saveAttemptProgress` is exactly that call.
create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  attempt_id uuid not null references public.attempts on delete cascade,
  -- The question asked. May be nulled by a regeneration; `question_text` is
  -- what survives that, which is the whole point of copying it.
  question_id uuid references public.questions on delete set null,

  question_text text not null check (char_length(question_text) between 1 and 4000),
  topic_id uuid references public.topics on delete set null,
  topic_name text check (topic_name is null or char_length(topic_name) <= 200),

  -- Null for a question the candidate never answered.
  selected_option int check (selected_option is null or selected_option >= 0),
  correct boolean not null default false,
  flagged boolean not null default false,
  elapsed_ms int check (elapsed_ms is null or elapsed_ms >= 0),

  answered_at timestamptz not null default now(),

  -- One row per question per attempt. `saveAttemptProgress` upserts on this.
  constraint attempt_answers_unique unique (attempt_id, question_id)
);

create index attempt_answers_attempt_idx on public.attempt_answers (user_id, attempt_id);
create index attempt_answers_topic_idx on public.attempt_answers (user_id, topic_id)
  where topic_id is not null;

-- ---------------------------------------------------------------------------
-- Re-parenting: cards, reviews and topics onto the new model
-- ---------------------------------------------------------------------------
-- **Added nullable, deliberately.** Every existing card keeps working with a
-- null `artifact_id`; nothing is dropped and nothing is rewritten by this
-- migration. 0011 backfills, and only then could these be tightened — which is
-- a separate decision, on live data, and therefore the owner's.
alter table public.cards
  add column artifact_id uuid references public.artifacts on delete cascade;

comment on column public.cards.artifact_id is
  'The deck artifact this card belongs to. Nullable during the FR7 transition: '
  'cards created before the notebook model have no artifact. A card is locked '
  'to its deck -- no move operation exists anywhere in the contract.';

create index cards_artifact_status_idx on public.cards (artifact_id, status)
  where artifact_id is not null;
create index cards_artifact_due_idx on public.cards (artifact_id, due)
  where artifact_id is not null and status = 'active';

-- Topics become notebook-scoped. This is the fix for the live cross-notebook
-- bug the brief names: reconciliation by name (ADR 0009) was per-user, so two
-- notebooks studying "Resistance mechanisms" shared one topic row and their
-- mastery numbers contaminated each other.
--
-- Nullable for the same reason as above — existing topic rows have no notebook.
alter table public.topics
  add column notebook_id uuid references public.notebooks on delete cascade;

comment on column public.topics.notebook_id is
  'Notebook scope (ADR 0009 + FR7). Null for topics predating the notebook '
  'model. The unique constraint below is partial for that reason.';

-- The new reconciliation key. Partial, because the pre-FR7 rows have a null
-- notebook_id and `topics_user_slug_key` still governs them.
create unique index topics_notebook_slug_key
  on public.topics (user_id, notebook_id, slug)
  where notebook_id is not null;

create index topics_notebook_idx on public.topics (user_id, notebook_id)
  where notebook_id is not null;

-- ---------------------------------------------------------------------------
-- The abandonment sweep (FR6 §8.7 item 2)
-- ---------------------------------------------------------------------------
-- `abandoned` was written by nothing, so the overview saw quiz attempts stuck
-- `in-progress` for ever and correctly declined to count them as sittings.
--
-- A runner cannot write this: a browser that closed cannot report why, and a
-- browser that is merely offline must not be told its attempt is over. Only the
-- server can decide, and only on elapsed time.
--
-- Called by the data layer on every attempt read, scoped to one user — not a
-- cron, which would need a scheduler this stack does not have. `p_user_id` is
-- filtered in SQL, the same discipline as `review_card` (0002).
create or replace function public.sweep_abandoned_attempts(
  p_user_id uuid,
  p_older_than interval default interval '6 hours'
)
returns int
language sql
security invoker
set search_path = public
as $$
  with swept as (
    update public.attempts
       set outcome = 'abandoned'
     where user_id = p_user_id
       and outcome = 'in-progress'
       and started_at < now() - p_older_than
    returning 1
  )
  select coalesce(count(*), 0)::int from swept;
$$;

comment on function public.sweep_abandoned_attempts is
  'Marks stale in-progress attempts abandoned. FR6 §8.7 item 2: only the server '
  'can distinguish "walked away" from "lost the network", and it does it on '
  'elapsed time. Filters on p_user_id in SQL -- see ADR 0008.';
