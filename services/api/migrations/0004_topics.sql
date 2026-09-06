-- Topics. P10 task 7, and the brief's D11.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS NOW AND NOT IN PHASE C
-- ═══════════════════════════════════════════════════════════════════════════
--
-- D11 makes `topics` the join: cards, questions, the blueprint, the mastery map
-- and the diagnostic all read it. Phase C cannot start without it, so it lands
-- here, in the phase that generates the content topics are extracted from.
--
-- **The mastery map stays on fixtures.** This migration is the schema and the
-- reconciliation seam, not the feature (P10 "out of scope").
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FAILURE MODE THIS SHAPE IS CHOSEN AGAINST
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A user studying one subject across five uploads must not end up with five
-- overlapping topic sets, because a mastery map over near-duplicate topics is
-- meaningless. So topics are **reconciled against the user's existing topics**
-- rather than created fresh per document, and the database enforces the part it
-- can: `topics_user_slug_key`.
--
-- The unique constraint is on a normalised `slug`, not on `name`. "Krebs Cycle",
-- "krebs cycle" and "Krebs  cycle" are one topic to a person and three rows to a
-- naive unique index on `name`. Normalising into a separate column - rather than
-- lower-casing `name` in place - keeps the display form the model produced while
-- making the match case- and whitespace-insensitive.
--
-- **This is a weaker match than the problem deserves, and that is deliberate.**
-- It catches only near-exact names: "Krebs cycle" and "Citric acid cycle" are
-- the same topic and will become two rows. Fixing that needs embeddings, which
-- is Phase G's pgvector, and pulling Phase G forward to improve topic matching
-- would be the tail wagging the dog. See ADR 0009.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TENANCY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No RLS, like every table here (ADR 0008). `user_id uuid not null`, indexed,
-- and `services/api/src/data/topics.ts` carries all four rules from the day this
-- lands - a new table on RDS without one is a cross-tenant leak, not a TODO
-- (CLAUDE.md).
--
-- Note the unique constraint is `(user_id, slug)` and not `(slug)`: topics are
-- per-user, so two users may each own "Krebs cycle" and neither may see the
-- other's. A global unique index here would be a cross-tenant collision that
-- leaks the existence of another user's topic through a constraint violation.

-- ---------------------------------------------------------------------------
-- topics
-- ---------------------------------------------------------------------------
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  -- Cognito sub. Not null and indexed, because every query filters on it
  -- explicitly rather than having Postgres do it.
  user_id uuid not null,

  -- The display form, as the model produced it.
  name text not null check (char_length(name) between 1 and 200),

  -- The match key: `name` lower-cased with whitespace collapsed. Written by the
  -- data layer (`normaliseSlug`), never by the client. Kept as a stored column
  -- rather than a generated one because the normalisation rule lives in
  -- TypeScript, where the reconciliation that depends on it can be read.
  slug text not null check (char_length(slug) between 1 and 200),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Per-user, not global. See the tenancy note above.
  constraint topics_user_slug_key unique (user_id, slug)
);

comment on table public.topics is
  'D11 join table. Reconciled by normalised slug per user; see ADR 0009 for why '
  'the match is deliberately weaker than embeddings would give.';

create index topics_user_name_idx on public.topics (user_id, name);

create trigger topics_touch_updated_at
  before update on public.topics
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- cards.topic_id
-- ---------------------------------------------------------------------------
-- Nullable, and it stays nullable. Every card that exists today predates topics,
-- and a card whose chunk produced no usable topic is still a good card - so
-- "untopiced" is an ordinary state rather than a defect to backfill away.
--
-- `on delete set null`: deleting a topic must not cascade away the user's cards.
-- The card survives, unfiled.
alter table public.cards
  add column topic_id uuid references public.topics on delete set null;

comment on column public.cards.topic_id is
  'Nullable by design: cards predating topics, and cards whose chunk yielded no '
  'topic, are unfiled rather than invalid.';

-- The mastery map's read (Phase D) and the "cards in this topic" query.
create index cards_topic_idx on public.cards (user_id, topic_id)
  where topic_id is not null;
