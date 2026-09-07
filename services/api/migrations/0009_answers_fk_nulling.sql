-- Let `on delete set null` through the append-only trigger. DS3 task 4, fixing 0008.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG, AND HOW IT WAS FOUND
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `0008_answers.sql` declared the table append-only with a trigger that raises
-- on *any* update, and called that "stricter than the reviews equivalent" as
-- though strictness were free. It is not:
--
--     answers.card_id  uuid references public.cards  on delete set null
--     answers.topic_id uuid references public.topics on delete set null
--
-- **Postgres implements `on delete set null` as an UPDATE on the referencing
-- row.** So the trigger fired on the cascade, and deleting a card the user had
-- once been examined on failed outright:
--
--     error: answers are append-only
--     where: SQL statement "UPDATE ONLY "public"."answers"
--            SET "card_id" = NULL WHERE $1 OPERATOR(pg_catalog.=) "card_id""
--
-- Two clauses of the same migration contradicting each other. The header argued
-- at length that an answer must survive its card being deleted — and the
-- trigger below it made deleting that card impossible.
--
-- It was caught by running the thing (DS3 task 7 step 5, which exists to check
-- exactly this), not by reading it. There is no test suite (ADR 0005) and
-- nothing else would have found it before a user deleted a deck.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHY IT IS NOT SIMPLY "ALLOW UPDATES"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The property worth keeping is the one 0008 was written for: **an exam result
-- must not be rewritable into a different exam result.** A `correct` that can
-- be flipped is not evidence, and a `question_text` that can be edited makes
-- every past answer unfalsifiable.
--
-- Dropping the trigger would give that up to fix a cascade. Instead the trigger
-- now permits exactly the shape a cascade produces and nothing else: **an
-- update that only sets `card_id` or `topic_id` to null.** Every other column
-- must be unchanged, and neither pointer may be set to a *different* id — only
-- cleared. That is precisely `on delete set null`'s effect and it is not a
-- shape any laundering of a result can take, since nothing about what was asked
-- or how it was answered can move through it.
--
-- The comparison is done the same way `reviews_tombstone_only` does it, with
-- `to_jsonb(new) - <col> <> to_jsonb(old) - <col>`, so a column added to this
-- table later is protected by default rather than by someone remembering to
-- extend a list. That failing-closed property is the reason for the jsonb
-- round-trip over naming each column.

create or replace function public.answers_append_only()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  -- Everything except the two nullable pointers must be byte-identical.
  if (to_jsonb(new) - 'card_id' - 'topic_id')
     <> (to_jsonb(old) - 'card_id' - 'topic_id') then
    raise exception 'answers are append-only'
      using errcode = 'PT403';
  end if;

  -- A pointer may be cleared, never repointed. `on delete set null` only ever
  -- clears; anything setting one to a different id is rewriting which card or
  -- topic an answer was about, which is the laundering this trigger exists to
  -- prevent.
  if new.card_id is not null and new.card_id is distinct from old.card_id then
    raise exception 'answers are append-only; card_id may only be cleared'
      using errcode = 'PT403';
  end if;
  if new.topic_id is not null and new.topic_id is distinct from old.topic_id then
    raise exception 'answers are append-only; topic_id may only be cleared'
      using errcode = 'PT403';
  end if;

  return new;
end;
$function$;

comment on function public.answers_append_only() is
  'Refuses every update except the null-setting one that on delete set null '
  'performs. See 0009_answers_fk_nulling.sql for why the 0008 version was wrong.';
