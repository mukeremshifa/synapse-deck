-- ---------------------------------------------------------------------------
-- 0015 — note sets become topics of one resource
-- ---------------------------------------------------------------------------
-- SPEC §4.2, revised 2026-09-09. Three product changes land here:
--
--   1. A note set is generated from **exactly one source**, and the knob at
--      generation is how many of *that resource's* topics to cover.
--   2. A **topic** is a real noun, not a span inferred by splitting blocks at
--      `level: 2` headings. Progress is stored against topics, and a heading
--      level is a rendering choice — inferring from it would let the model's
--      formatting decide how many things a student must tick off.
--   3. Progress is **declared, not observed**, on two independent axes: a
--      per-topic tick (reversible) and a completion the student presses at the
--      end (`artifacts.completed_at`).
--
-- `note_blocks.read_at` is what this replaces. It recorded observation — the
-- reader marked blocks as they crossed the viewport — and it was monotonic
-- because passing something on screen is not a claim you can withdraw. A tick
-- is a claim, so `note_topics.completed_at` is nullable in both directions.
--
-- ── What this does to existing rows ────────────────────────────────────────
--
-- **Every existing note set is given one topic holding all of its blocks**, and
-- that is a deliberate choice over dropping them. The alternative — splitting
-- on heading blocks — is exactly the inference decision 2 above rejects, and
-- doing it here would bake one guess into stored data permanently. One topic is
-- honest: it says "this note set predates topics", it reads identically, and it
-- can be regenerated into a real topic set whenever the owner wants.
--
-- Read counts are **not** carried over. `read_at` measured something the new
-- model does not claim to know, and translating "6 blocks were on screen" into
-- "this topic is ticked" would invent a declaration the student never made.

begin;

-- ---------------------------------------------------------------------------
-- note_topics — the unit of reading, and of progress
-- ---------------------------------------------------------------------------
create table public.note_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  artifact_id uuid not null references public.artifacts on delete cascade,

  title text not null check (length(btrim(title)) between 1 and 200),
  position int not null default 0 check (position >= 0),

  -- The notebook topic this covers, when one matched. **May dangle**, and has
  -- no foreign key for the same reason as `artifacts.source_ids`: a deleted
  -- topic must not delete the notes written about it. It is a link, never the
  -- identity — two note sets over the same notebook topic are two things to
  -- read, so completion is stored against `id`.
  source_topic_id uuid,

  -- The tick. Null means not ticked; **clearing it is expected**, because a
  -- student can withdraw a claim.
  completed_at timestamptz,

  created_at timestamptz not null default now()
);

create index note_topics_artifact_idx
  on public.note_topics (user_id, artifact_id, position);

-- ---------------------------------------------------------------------------
-- note_blocks now hang off a topic
-- ---------------------------------------------------------------------------
alter table public.note_blocks
  add column topic_id uuid references public.note_topics on delete cascade;

-- Backfill: one topic per existing note set, holding all of its blocks.
--
-- Titled from the artifact, because that is the only name these notes have —
-- the alternative is reading the first heading block out of the jsonb, which is
-- the inference this migration exists to stop doing.
with created as (
  insert into public.note_topics (user_id, artifact_id, title, position)
  select a.user_id,
         a.id,
         -- The check constraint requires 1..200 trimmed characters, and
         -- `artifacts.title` is not guaranteed to satisfy it here, so it is
         -- clamped rather than trusted.
         coalesce(nullif(btrim(left(a.title, 200)), ''), 'Notes'),
         0
    from public.artifacts a
   where a.kind = 'noteset'
     and exists (
       select 1 from public.note_blocks nb
        where nb.artifact_id = a.id and nb.user_id = a.user_id
     )
  returning id, user_id, artifact_id
)
update public.note_blocks nb
   set topic_id = created.id
  from created
 where nb.artifact_id = created.artifact_id
   and nb.user_id = created.user_id;

-- Any block that somehow has no topic now would be unreachable through the API,
-- which reads blocks *via* topics. Deleting them keeps the table honest rather
-- than leaving orphans a later join silently drops.
delete from public.note_blocks where topic_id is null;

alter table public.note_blocks
  alter column topic_id set not null;

-- `read_at` measured observation. Nothing reads it now.
alter table public.note_blocks drop column read_at;

create index note_blocks_topic_idx
  on public.note_blocks (user_id, topic_id, position);

-- ---------------------------------------------------------------------------
-- artifacts.completed_at — the button at the end
-- ---------------------------------------------------------------------------
-- **Independent of the per-topic ticks in both directions**: this may be set
-- with topics outstanding, and ticking every topic does not set it. Ticking the
-- last topic says the reading is done; this says the *student* says it is.
-- Deriving one from the other deletes the only moment in the surface where a
-- person makes a claim about their own understanding.
--
-- On `artifacts` rather than a note-set table because there is no note-set
-- table — a note set is an `artifacts` row with `kind = 'noteset'` (ADR 0015).
alter table public.artifacts
  add column completed_at timestamptz;

commit;
