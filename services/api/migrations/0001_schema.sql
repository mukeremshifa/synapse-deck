-- Initial schema for RDS Postgres. Ported from supabase/migrations/, P9 task 3.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE CHANGING ANYTHING HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- **There is no Row Level Security in this schema, and that is deliberate.**
--
-- The Supabase original had 15 policies plus `force row level security` on
-- every table, and Postgres refused any row the caller did not own. That was
-- the entire security boundary. It is gone.
--
-- What replaces it lives in application code — `services/api/src/data/`, where
-- every exported function takes `userId` as a required first parameter and
-- every statement carries `where user_id = $1`. A query that forgets it used to
-- return **nothing**, because the database refused. Now it returns **every
-- user's rows**.
--
-- This is weaker than what it replaces and the plan (docs/plans/P9-aws-slice.md)
-- says so rather than implying otherwise. RLS was a guarantee; this is a
-- discipline with a lint behind it (scripts/check-data-access.mjs). Four
-- mechanisms compensate structurally, all of which fail closed, none of which
-- depends on a human remembering:
--
--   1. `userId` is a required first parameter on every data-access function.
--   2. No route handler may build a query.
--   3. The RPCs filter on `p_user_id` in SQL (see 0002_review_card.sql).
--   4. A verify-time lint fails the build on a violation of 1 or 2.
--
-- **Do not add a table here without adding its data-access module with the
-- same discipline.** A table whose rows are only ever reached through a
-- function that filters by `user_id` is fine. A table reached any other way is
-- a cross-tenant leak, and nothing in this repository will tell you.
--
-- ── Other differences from the Supabase original ──────────────────────────
--
-- **`auth.users` does not exist here.** Supabase provided that table, and every
-- `user_id` referenced it with `on delete cascade`. RDS has no such table:
-- identity lives in Cognito, outside the database entirely. So `user_id` is a
-- plain `uuid not null` holding the Cognito `sub`.
--
-- That is a real loss of referential integrity and it is worth naming: the
-- database can no longer verify that a `user_id` corresponds to an account that
-- exists, and deleting a Cognito user no longer cascades away their data. Both
-- become application responsibilities. Deck-scoped and card-scoped cascades
-- (cards -> decks, reviews -> cards) survive intact, because those are
-- relationships between tables that both live here.
--
-- **The `handle_new_user` trigger is gone** with `auth.users`. A profile row is
-- created by the API on first authenticated request instead; see the data layer.
--
-- **Every CHECK constraint is kept.** `cards_state_consistency`,
-- `cards_payload_shape` and the rest guarantee something real and have nothing
-- to do with RLS. They are the only integrity guarantees left in the database,
-- which makes them more important here than they were in the original.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Supabase preinstalled this; stock Postgres does not. `gen_random_uuid()` is
-- in core from Postgres 13, but pgcrypto is what the original relied on and
-- creating it keeps the DDL below identical to the version that was reviewed.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums (SPEC §5.1)
-- ---------------------------------------------------------------------------
create type public.card_kind   as enum ('basic', 'cloze', 'mcq');
create type public.card_status as enum ('draft', 'active', 'suspended', 'archived');
create type public.fsrs_state  as enum ('new', 'learning', 'review', 'relearning');
create type public.deck_status as enum ('generating', 'draft', 'active', 'failed');
create type public.gen_source  as enum ('text', 'document', 'manual');

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (§5.6)
-- ---------------------------------------------------------------------------
-- `id` is the Cognito `sub`. There is no foreign key to point it at: the
-- account it identifies lives in a user pool, not in this database.
--
-- The row is no longer created by a trigger on auth.users — that table is gone.
-- The API creates it on first authenticated request, which means the app must
-- tolerate its absence for exactly one request rather than never. See
-- services/api/src/data/profiles.ts.
create table public.profiles (
  id uuid primary key,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  -- Streaks and the review heatmap are computed against this zone. Computing them
  -- in UTC silently breaks streaks for most of the world.
  timezone text not null default 'UTC',
  daily_new_limit int not null default 20 check (daily_new_limit between 0 and 500),
  -- null = use the ts-fsrs defaults; populated later by the optimiser (post-v1).
  fsrs_params jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.id is
  'The Cognito sub. No FK: the account lives in a user pool, not this database.';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- decks (§5.2)
-- ---------------------------------------------------------------------------
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  -- Cognito sub. Not null and indexed, because every query now filters on it
  -- explicitly rather than having Postgres do it.
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  status public.deck_status not null default 'active',
  source public.gen_source not null default 'manual',
  new_cards_per_day int not null default 20 check (new_cards_per_day between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_user_updated_idx on public.decks (user_id, updated_at desc);

create trigger decks_touch_updated_at
  before update on public.decks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- cards (§5.3)
-- Content varies by kind; scheduling state does not. The scheduler touches only
-- the scheduling columns and never reads `payload`.
-- ---------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  deck_id uuid not null references public.decks on delete cascade,

  kind public.card_kind not null,
  payload jsonb not null,

  status public.card_status not null default 'active',

  -- Which slice of the source text produced this card; shown in the review gate.
  source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 2000),

  -- FSRS state
  fsrs_state public.fsrs_state not null default 'new',
  stability double precision check (stability is null or stability > 0),
  difficulty double precision check (difficulty is null or (difficulty >= 1 and difficulty <= 10)),
  due timestamptz not null default now(),
  last_review timestamptz,
  reps int not null default 0 check (reps >= 0),
  lapses int not null default 0 check (lapses >= 0),
  scheduled_days int not null default 0 check (scheduled_days >= 0),
  elapsed_days int not null default 0 check (elapsed_days >= 0),
  -- Folded in from 20260812093000_review_card.sql rather than left as a later
  -- ALTER. Which (re)learning step a card sits on: without it ts-fsrs restarts
  -- every learning card at step 0 on every review, so a card rated Good
  -- repeatedly loops on the 10-minute step and never graduates.
  learning_steps int not null default 0 check (learning_steps >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Cheap structural guard only. Zod (src/lib/schemas.ts) does the real validation
  -- at the app boundary; this exists so a bad direct INSERT cannot land garbage.
  constraint cards_payload_shape check (
    case kind
      when 'basic' then payload ? 'front' and payload ? 'back'
      when 'cloze' then payload ? 'text'
      when 'mcq'   then payload ? 'stem' and payload ? 'options'
    end
  ),
  -- A reviewed card must carry FSRS state; a new one must not pretend to.
  constraint cards_state_consistency check (
    (fsrs_state = 'new' and last_review is null)
    or (fsrs_state <> 'new' and stability is not null and difficulty is not null)
  )
);

-- The practice-queue query (§10 perf budget). Partial index: only active cards
-- are ever queued, and they are a small fraction of the table over time.
create index cards_queue_idx on public.cards (user_id, due)
  where status = 'active';
create index cards_deck_status_idx on public.cards (deck_id, status);
create index cards_deck_due_idx on public.cards (deck_id, due)
  where status = 'active';

create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- reviews (§5.4) — append-only
-- ---------------------------------------------------------------------------
-- The original made this append-only by *policy*: `reviews` had SELECT and
-- INSERT policies and no UPDATE or DELETE policy, so neither was possible.
-- With RLS gone, that guarantee is gone with it — nothing here stops an UPDATE.
--
-- The tombstone trigger below is what remains, and it is narrower than what it
-- replaces: it constrains *which column* an update may change, not *who* may
-- issue one. Ownership is the data layer's job now.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null references public.cards on delete cascade,

  rating smallint not null check (rating between 1 and 4),  -- 1 Again .. 4 Easy
  reviewed_at timestamptz not null default now(),
  duration_ms int check (duration_ms is null or duration_ms >= 0),

  -- State BEFORE this review. Undo restores from here, and an FSRS parameter
  -- optimiser needs it to replay history.
  state_before public.fsrs_state not null,
  stability_before double precision,
  difficulty_before double precision,
  elapsed_days int not null,
  scheduled_days int not null,

  -- The rest of the pre-review snapshot, folded in from the review_card
  -- migration. Undo has to put back `due`, `last_review`, the step index and the
  -- elapsed counter, and none of those are derivable after the fact once a later
  -- review has been undone.
  due_before timestamptz not null,
  last_review_before timestamptz,
  elapsed_days_before int not null default 0,
  learning_steps_before int not null default 0,
  -- An undone rating is real history: it is not deleted, it is tombstoned, so
  -- P3's retention math can exclude it and a future FSRS optimiser can decide
  -- for itself whether to.
  undone_at timestamptz,

  -- State AFTER.
  state_after public.fsrs_state not null,
  stability_after double precision,
  difficulty_after double precision
);

comment on column public.reviews.undone_at is
  'Set when the user undid this rating. The row stays: the log is append-only.';

create index reviews_user_time_idx on public.reviews (user_id, reviewed_at desc);
create index reviews_card_time_idx on public.reviews (card_id, reviewed_at desc);

-- The daily new-card cap counts today's introductions (§6). Partial, because
-- introductions are a small and shrinking fraction of the log.
create index reviews_new_intro_idx on public.reviews (user_id, reviewed_at desc)
  where state_before = 'new' and undone_at is null;

-- The one exception to append-only: `undone_at` may be set, once, and nothing
-- else may change. In the original this backed a narrow UPDATE policy that
-- existed because RLS otherwise made undo impossible. Here there is no policy
-- to work around, but the trigger keeps its full value — it is what stops the
-- data layer from laundering a bad rating out of the history the optimiser
-- learns from.
create or replace function public.reviews_tombstone_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'undone_at') <> (to_jsonb(old) - 'undone_at') then
    raise exception 'reviews are append-only; only undone_at may be set'
      using errcode = 'PT403';
  end if;
  -- Undo once. Clearing the tombstone would let a bad rating be laundered out of
  -- the history the optimiser learns from.
  if old.undone_at is not null and new.undone_at is distinct from old.undone_at then
    raise exception 'this review was already undone'
      using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger reviews_tombstone_only
  before update on public.reviews
  for each row execute function public.reviews_tombstone_only();

-- ---------------------------------------------------------------------------
-- generations (§5.5) — audit trail and the quota source of truth
-- ---------------------------------------------------------------------------
-- **Nothing reads or writes this table during P9.** Generation stays on
-- Supabase for this phase (the split table in docs/plans/P9-aws-slice.md),
-- because Phase B rewrites that path entirely — SSE to job polling — and
-- migrating it now would mean building it twice.
--
-- The DDL is here anyway so the schema is whole and Phase B has somewhere to
-- write, rather than starting with a migration nobody has reviewed.
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  deck_id uuid references public.decks on delete set null,
  source public.gen_source not null,
  model text not null,
  prompt_version text,
  input_chars int not null check (input_chars >= 0),
  input_tokens int,
  output_tokens int,
  cards_requested int not null check (cards_requested > 0),
  cards_returned int not null default 0 check (cards_returned >= 0),
  cards_accepted int check (cards_accepted is null or cards_accepted >= 0),
  cost_usd numeric(10, 6),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'refused')),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.generations is
  'Unused in P9 - generation stays on Supabase until Phase B. Present so the '
  'schema is whole.';

-- Quota is counted from this table, so the count must be cheap.
create index generations_user_time_idx on public.generations (user_id, created_at desc);
