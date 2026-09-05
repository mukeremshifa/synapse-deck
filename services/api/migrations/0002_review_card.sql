-- review_card and undo_last_review, ported to RDS. P9 tasks 3 and 6.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE SHARPEST EDGE IN THE MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Supabase originals were `security invoker` **specifically because RLS was
-- the boundary**, and their comments said exactly that. `review_card` never
-- filtered by `user_id` at all: it fetched a card by primary key and trusted
-- the database to have refused if the card belonged to someone else.
--
--     select * into v_card from public.cards where id = p_card_id for update;
--
-- With RLS retired, that one line becomes a function that will happily review
-- **any user's card**, given its id. Nothing would catch it. There is no test
-- suite (ADR 0005), the id is a uuid so it would never be hit by accident, and
-- the function would behave perfectly for every legitimate call.
--
-- So both functions now take `p_user_id uuid` as their **first parameter**, and
-- **every statement inside them filters on it** — not just the outer fetch. The
-- inner `reviews` lookup in undo_last_review matters just as much: a card id
-- that passed the outer check is not a licence to read review rows without
-- rechecking, because defence that only happens once is defence that a later
-- edit removes without noticing.
--
-- `p_user_id` comes from the verified JWT and nowhere else. See
-- services/api/src/ — the handler reads `sub` from the API Gateway authorizer
-- context and passes it down. It is never a request body field, never a query
-- parameter, never a client-set header.
--
-- ── Error codes ───────────────────────────────────────────────────────────
--
-- Kept from the original so src/lib/queries.ts keeps matching on them. These
-- were PostgREST's convention (a `PTxxx` SQLSTATE became HTTP status xxx);
-- there is no PostgREST here, so the API layer maps them explicitly instead.
--
--   PT404  card not found -- or not yours. **Deliberately the same answer.**
--          RLS used to make those indistinguishable for free; now the mapping
--          does it on purpose. A 403 would confirm the id exists, which turns
--          a card id into an oracle. Acceptance criterion 5 checks for 404.
--   PT409  the card moved since it was shown (two tabs rating the same card)
--   22023  malformed p_next payload
--   PT403  an attempt to rewrite the append-only part of the review log

-- ---------------------------------------------------------------------------
-- review_card
-- ---------------------------------------------------------------------------

create or replace function public.review_card(
  -- First parameter, matching the data-access layer's rule. Not optional, no
  -- default: a default is how a bug becomes silent.
  p_user_id uuid,
  p_card_id uuid,
  p_rating smallint,
  p_duration_ms int,
  p_expected_updated_at timestamptz,
  p_next jsonb
)
returns public.cards
language plpgsql
-- Still `security invoker`, but for a different reason than the original gave.
-- There is no RLS left for a definer function to bypass; invoker is kept
-- because the API connects as an unprivileged role and nothing here needs more
-- than that role already has. Do not "upgrade" this to definer.
security invoker
set search_path = public
as $$
declare
  -- Exactly what src/lib/fsrs.ts SchedulingUpdate produces. The shape is
  -- validated here key by key, because the caller is application code and the
  -- database is no longer checking anything else about who is asking.
  c_allowed constant text[] := array[
    'fsrs_state', 'stability', 'difficulty', 'due', 'last_review',
    'scheduled_days', 'elapsed_days', 'learning_steps'
  ];
  v_key text;
  v_card public.cards;
  v_state public.fsrs_state;
  v_stability double precision;
  v_difficulty double precision;
  v_due timestamptz;
  v_last_review timestamptz;
  v_scheduled_days int;
  v_elapsed_days int;
  v_learning_steps int;
begin
  -- A null user id would make every `user_id = p_user_id` comparison null, and
  -- therefore false, so the function would fail closed rather than open. It is
  -- rejected explicitly anyway: failing closed by accident is not a guarantee,
  -- and the error message should say what actually went wrong.
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  if p_rating is null or p_rating not between 1 and 4 then
    raise exception 'rating must be 1..4, got %', p_rating using errcode = '22023';
  end if;

  if p_next is null or jsonb_typeof(p_next) <> 'object' then
    raise exception 'p_next must be a json object' using errcode = '22023';
  end if;

  foreach v_key in array c_allowed loop
    if not (p_next ? v_key) or jsonb_typeof(p_next -> v_key) = 'null' then
      raise exception 'p_next is missing %', v_key using errcode = '22023';
    end if;
  end loop;

  for v_key in select jsonb_object_keys(p_next) loop
    if not (v_key = any (c_allowed)) then
      raise exception 'p_next has unexpected key %', v_key using errcode = '22023';
    end if;
  end loop;

  v_state         := (p_next ->> 'fsrs_state')::public.fsrs_state;
  v_stability     := (p_next ->> 'stability')::double precision;
  v_difficulty    := (p_next ->> 'difficulty')::double precision;
  v_due           := (p_next ->> 'due')::timestamptz;
  v_last_review   := (p_next ->> 'last_review')::timestamptz;
  v_scheduled_days := (p_next ->> 'scheduled_days')::int;
  v_elapsed_days  := (p_next ->> 'elapsed_days')::int;
  v_learning_steps := (p_next ->> 'learning_steps')::int;

  -- A review always leaves the card with memory state; `new` after a rating
  -- would violate cards_state_consistency further down anyway, but the message
  -- is more useful here.
  if v_state = 'new' then
    raise exception 'a reviewed card cannot return to state new' using errcode = '22023';
  end if;

  -- Lock first, then compare. Another tab holding the same card blocks here and
  -- loses the version check below rather than racing past it.
  --
  -- **`and user_id = p_user_id` is the line RLS used to provide.** Without it
  -- this fetches any user's card by id. It is inside the FOR UPDATE so the
  -- ownership check and the lock are one atomic step.
  select * into v_card
  from public.cards
  where id = p_card_id and user_id = p_user_id
  for update;

  if not found then
    -- Not found and not-yours are the same answer on purpose. See the header.
    raise exception 'card % not found', p_card_id using errcode = 'PT404';
  end if;

  if v_card.status <> 'active' then
    raise exception 'card % is % and is not in any queue', p_card_id, v_card.status
      using errcode = '22023';
  end if;

  -- The stale-rating guard: two tabs open on the same card, both showing the
  -- schedule as it was before the first of them rated it. Unchanged from the
  -- original — it is orthogonal to ownership and it works.
  if p_expected_updated_at is null or v_card.updated_at <> p_expected_updated_at then
    raise exception 'card % changed since it was loaded', p_card_id
      using errcode = 'PT409',
            hint = 'Reload the queue; this card was already rated elsewhere.';
  end if;

  insert into public.reviews (
    user_id, card_id, rating, duration_ms,
    state_before, stability_before, difficulty_before,
    due_before, last_review_before, elapsed_days_before, learning_steps_before,
    elapsed_days, scheduled_days,
    state_after, stability_after, difficulty_after
  ) values (
    -- v_card.user_id, not p_user_id. They are equal by the fetch above, and
    -- taking it from the row means the review is stamped with the card's actual
    -- owner even if a future edit loosens that check.
    v_card.user_id, v_card.id, p_rating, p_duration_ms,
    v_card.fsrs_state, v_card.stability, v_card.difficulty,
    v_card.due, v_card.last_review, v_card.elapsed_days, v_card.learning_steps,
    -- How long actually passed before this review, and the interval the card was
    -- carrying when it arrived — the two numbers an optimiser replays from.
    v_elapsed_days, v_card.scheduled_days,
    v_state, v_stability, v_difficulty
  );

  update public.cards set
    fsrs_state = v_state,
    stability = v_stability,
    difficulty = v_difficulty,
    due = v_due,
    last_review = v_last_review,
    scheduled_days = v_scheduled_days,
    elapsed_days = v_elapsed_days,
    learning_steps = v_learning_steps,
    reps = v_card.reps + 1,
    -- Counted here rather than taken from the client: every Again is a lapse.
    lapses = v_card.lapses + (case when p_rating = 1 then 1 else 0 end)
  -- Filtered again, though the row is already locked and its ownership already
  -- checked. Redundant by construction and kept deliberately: every statement
  -- in this function carries the filter, so no future edit can move code above
  -- the check and quietly lose it.
  where id = v_card.id and user_id = p_user_id
  returning * into v_card;

  return v_card;
end;
$$;

comment on function public.review_card is
  'Log a rating and reschedule the card in one transaction, for p_user_id only. '
  'Raises PT409 if the card changed since the client loaded it, PT404 if it is '
  'not the caller''s. p_user_id comes from the verified JWT, never the client.';

-- ---------------------------------------------------------------------------
-- undo_last_review
-- ---------------------------------------------------------------------------
--
-- Undo is not a nicety (SPEC §4.2): mis-hitting `1` on a mature card throws away
-- months of interval. It restores the snapshot the review stored, and tombstones
-- the review rather than deleting it.

create or replace function public.undo_last_review(
  p_user_id uuid,
  p_card_id uuid
)
returns public.cards
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_card public.cards;
  v_review public.reviews;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  select * into v_card
  from public.cards
  where id = p_card_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'card % not found', p_card_id using errcode = 'PT404';
  end if;

  -- Filtered on user_id as well as card_id, even though the card above is
  -- already known to belong to the caller and reviews cascade from cards.
  --
  -- This is the "every statement, not just the outer fetch" rule from the
  -- header, and it is not ceremony: it is the statement that would silently
  -- start reading someone else's review log if the fetch above were ever
  -- refactored to drop its filter. Defence that happens once is defence a later
  -- edit removes without noticing.
  select * into v_review
  from public.reviews
  where card_id = p_card_id and user_id = p_user_id and undone_at is null
  order by reviewed_at desc, id desc
  limit 1
  for update;

  if not found then
    raise exception 'card % has no review to undo', p_card_id using errcode = 'PT404';
  end if;

  update public.reviews
  set undone_at = now()
  where id = v_review.id and user_id = p_user_id;

  update public.cards set
    fsrs_state = v_review.state_before,
    stability = v_review.stability_before,
    difficulty = v_review.difficulty_before,
    due = v_review.due_before,
    last_review = v_review.last_review_before,
    -- reviews.scheduled_days is the interval the card carried *into* that review.
    scheduled_days = v_review.scheduled_days,
    elapsed_days = v_review.elapsed_days_before,
    learning_steps = v_review.learning_steps_before,
    -- review_card added exactly one rep, and one lapse if the rating was Again.
    reps = greatest(v_card.reps - 1, 0),
    lapses = greatest(
      v_card.lapses - (case when v_review.rating = 1 then 1 else 0 end), 0
    )
  where id = v_card.id and user_id = p_user_id
  returning * into v_card;

  return v_card;
end;
$$;

comment on function public.undo_last_review is
  'Restore the card to its state before the most recent rating and tombstone '
  'that review, for p_user_id only. The review row itself is never deleted.';

-- ---------------------------------------------------------------------------
-- review_day_counts (the /progress aggregate)
-- ---------------------------------------------------------------------------
--
-- **Nothing calls this during P9.** /progress stays on Supabase for this phase
-- (the split table in docs/plans/P9-aws-slice.md), because porting the
-- aggregate wholesale is work Phase F has to do anyway.
--
-- It is ported here under the same `p_user_id` rule so that Phase F inherits a
-- correct version rather than repeating this analysis — and, more to the point,
-- so nobody discovers in Phase F that the obvious port of a `security invoker`
-- function reads every user's review log. The original had no `user_id` filter
-- for exactly the same reason review_card had none: RLS was doing it.
--
-- A year of reviews is up to ~70,000 rows for a serious user. Fetching them to
-- count them would not survive §10's performance budget, so the daily counts
-- are grouped in Postgres and 365 rows come back instead of 70,000.
create or replace function public.review_day_counts(
  p_user_id uuid,
  p_timezone text,
  p_from timestamptz
)
returns table (
  day date, reviews int, again int, hard int, good int, easy int, introduced int
)
language sql
stable
security invoker
set search_path = public
as $$
  -- The day bucket is a transcription of `studyDayKey` in src/lib/day.ts:
  --
  --   (reviewed_at at time zone tz - interval '4 hours')::date
  --
  -- Reading the wall clock in the user's zone and then shifting back four hours
  -- makes 04:00 local the start of the day (§6), so a session at 01:00 counts
  -- towards the previous day. The subtraction happens on a `timestamp without
  -- time zone`, which is plain arithmetic with no DST of its own — exactly what
  -- day.ts does when it compares the local hour against 4.
  --
  -- src/test/stats.test.ts used to assert the two agree, including across a DST
  -- transition, because that is the case where a second implementation of "what
  -- day is it" disagrees invisibly. That test is gone (ADR 0005). The agreement
  -- is now unverified, and this comment is all that records the requirement.
  --
  -- An unknown zone name falls back to UTC rather than raising. That is the same
  -- choice `resolveTimeZone` makes in the client: a profile can hold whatever a
  -- past version wrote, and a bad zone should give a wrong-but-working heatmap
  -- rather than a page that 500s.
  with zone as (
    select coalesce(
      (select name from pg_timezone_names where name = p_timezone),
      'UTC'
    ) as tz
  )
  select
    ((r.reviewed_at at time zone z.tz) - interval '4 hours')::date,
    count(*)::int,
    count(*) filter (where r.rating = 1)::int,
    count(*) filter (where r.rating = 2)::int,
    count(*) filter (where r.rating = 3)::int,
    count(*) filter (where r.rating = 4)::int,
    -- What the daily new-card cap already counts in P1's queue: a review whose
    -- card was `new` beforehand is the moment that card was introduced.
    count(*) filter (where r.state_before = 'new')::int
  from public.reviews r
  cross join zone z
  -- The line RLS used to provide. Without it this aggregates every user's
  -- reviews into one heatmap.
  where r.user_id = p_user_id
    and r.undone_at is null   -- an undone rating is history, never a metric
    and r.reviewed_at >= p_from
  group by 1
  order by 1
$$;

comment on function public.review_day_counts is
  'Reviews per study day (04:00 boundary, p_timezone) since p_from for '
  'p_user_id, split by rating, with the day''s new-card introductions. Undone '
  'ratings excluded. Unused in P9 - /progress stays on Supabase until Phase F.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- The Supabase originals ended with a dance of `revoke ... from public` and
-- `revoke ... from anon`, because Supabase ships `alter default privileges ...
-- grant all on functions to anon, authenticated` and a new function is
-- therefore executable by signed-out callers the moment it is created.
--
-- **None of that applies here.** There is no `anon` role, no `authenticated`
-- role, and no PostgREST turning an HTTP request into a function call. The only
-- thing that can reach these functions is the API Lambda, connecting as the
-- application role from inside a VPC with no public route to the database.
--
-- That is a genuinely smaller attack surface than the original had. It is worth
-- being precise about why: the door is shut by the network and the connection,
-- not by a grant. Adding a role here would be theatre.
--
-- `revoke from public` is kept anyway, because it costs nothing and PUBLIC does
-- default to EXECUTE on new functions in stock Postgres.
revoke all on function public.review_card(uuid, uuid, smallint, int, timestamptz, jsonb) from public;
revoke all on function public.undo_last_review(uuid, uuid) from public;
revoke all on function public.review_day_counts(uuid, text, timestamptz) from public;
