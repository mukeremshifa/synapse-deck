-- Exam answers: the exam runner stops forgetting. DS3 task 4.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `src/lib/mastery.ts` computes topic mastery from two signals it keeps
-- deliberately apart: FSRS retention (can you recall this when prompted) and
-- exam accuracy (can you apply it under time). The first has had a real source
-- since P1 -- `cards` and `reviews`. **The second has never had one at all.**
--
-- `MasteryAnswer` was a *shape* fed entirely by a fixture. An exam was sat in
-- the browser, graded in the browser, and forgotten when the tab closed, so the
-- diagnostic's most valuable finding -- a topic where the two signals disagree
-- -- was computed over data belonging to nobody. This table is that second
-- signal's source.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TENANCY -- READ 0001_schema.sql's HEADER IF YOU HAVE NOT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No RLS, like every table here (ADR 0008). There is no `auth.uid()` on Neon or
-- RDS to write a policy against. `user_id uuid not null`, every index leads
-- with it, and `services/api/src/data/answers.ts` carries all four rules from
-- the day this lands -- a new table on RDS without one is a cross-tenant leak,
-- not a TODO (CLAUDE.md).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE SHAPE DECISION: AN ANSWER STORES THE QUESTION *AND* REFERENCES THE CARD
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is the decision DS3 §6 asks to be recorded, and it went the way it did
-- because the two obvious options each lose something the other keeps.
--
-- **Reference the card alone** (`card_id references cards on delete cascade`)
-- is normalised and wrong. A card can be edited after the fact -- `CardEditor`
-- exists and the review gate encourages exactly this -- and it can be deleted.
-- An answer whose stem is fetched through a join therefore *silently changes
-- meaning*: "you got this wrong" starts pointing at a question the user was
-- never asked. Worse, a deleted card takes its answers with it, so a user
-- tidying their deck quietly erases their own exam history and the mastery map
-- shifts with no visible cause.
--
-- **Store the stem alone** keeps the evidence honest but severs the answer from
-- the material. "Generate cards from my misses" (SPEC §4.6) needs to know which
-- card a miss came from; so does any future "review this again".
--
-- So: **both, with the copy as the authority.**
--
--   * `question_text` is a snapshot, written at submission and never updated.
--     It is what the user was actually asked. This is the same reasoning that
--     makes `reviews` carry `stability_before` rather than recomputing it.
--   * `card_id` is a nullable reference, `on delete set null`. It is a pointer
--     for features that want the card, not the source of the question's
--     meaning. When the card goes, the answer survives and still says what was
--     asked.
--
-- `topic_id` follows `cards.topic_id`'s reasoning exactly: nullable,
-- `on delete set null`. Deleting a topic must not delete the record that
-- someone answered a question about it. The answer becomes unfiled, like the
-- cards do, and `topic_name` is snapshotted for the same reason as the stem --
-- a renamed topic must not silently relabel history.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY, FOLLOWING `reviews`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- An exam result that can be rewritten is not evidence. `0001_schema.sql`'s
-- reviews table is the precedent and this follows it, with one difference worth
-- stating: reviews permit exactly one update (`undone_at`, the tombstone),
-- because undo is a real product feature there. **There is no undo for an exam
-- answer**, so this trigger admits no exception at all -- no update changes any
-- column, ever.
--
-- Deletes are not blocked. Cascading from a deleted user, or an owner clearing
-- test data, are legitimate; what the trigger prevents is a bad answer being
-- laundered into a good one, which is the thing that would corrupt the mastery
-- signal while leaving the row count unchanged.

-- ---------------------------------------------------------------------------
-- answers
-- ---------------------------------------------------------------------------
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  -- Cognito sub. Not null and indexed: every query filters on it explicitly
  -- rather than having Postgres do it.
  user_id uuid not null,

  -- Which sitting this answer belonged to. Not a foreign key: there is no
  -- `exams` table, because an exam is currently assembled in the browser and
  -- has no server-side existence. A client-supplied uuid grouping one sitting's
  -- answers is enough for "how did that attempt go", and it costs nothing to
  -- keep should exams later become rows.
  --
  -- **It is not a capability.** It arrives from the client, so every read
  -- filters `user_id` as well -- an attempt id belonging to another user must
  -- select nothing rather than someone else's exam.
  attempt_id uuid not null,

  -- The question as it was asked. The authority; see the header.
  question_text text not null check (char_length(question_text) between 1 and 4000),

  -- A pointer, not the meaning. Null once the card is deleted.
  card_id uuid references public.cards on delete set null,

  -- Snapshotted alongside the reference, for the same reason as the stem: a
  -- renamed or deleted topic must not silently relabel what happened.
  topic_id uuid references public.topics on delete set null,
  topic_name text check (topic_name is null or char_length(topic_name) <= 200),

  -- The signal itself. `mastery.ts` reads exactly this.
  correct boolean not null,

  -- Which option was chosen, and null for an unanswered question. Unanswered is
  -- a real outcome an exam records -- it counts against the score in
  -- `gradeAttempt` -- and it is distinct from "answered wrongly" to anything
  -- later trying to tell "did not know" from "ran out of time".
  selected_option int check (selected_option is null or selected_option >= 0),

  -- How long the candidate spent on this question. Optional because a submitted
  -- attempt may carry no timing for a question never opened.
  elapsed_ms int check (elapsed_ms is null or elapsed_ms >= 0),

  -- When the exam was sat. `MasteryAnswer.answered_at` reads this.
  answered_at timestamptz not null default now()
);

comment on table public.answers is
  'Exam answers, append-only. question_text is the authority; card_id and '
  'topic_id are pointers that may become null. See the file header for why.';

comment on column public.answers.question_text is
  'A snapshot of what was asked. Never updated -- a card edited afterwards must '
  'not silently change what the user was tested on.';

-- The mastery read: every answer for a user, most recent first. Leads with
-- user_id, like every index in this schema.
create index answers_user_time_idx on public.answers (user_id, answered_at desc);

-- "How did that attempt go" -- the results screen, and any later attempt list.
create index answers_user_attempt_idx on public.answers (user_id, attempt_id);

-- The topic breakdown the diagnostic groups by. Partial: unfiled answers are
-- read through the first index, and excluding them keeps this one small.
create index answers_user_topic_idx on public.answers (user_id, topic_id)
  where topic_id is not null;

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------
-- Stricter than the `reviews` equivalent, which permits the single `undone_at`
-- tombstone because undo is a feature there. There is no undo for an exam
-- answer, so nothing may change.
create or replace function public.answers_append_only()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'answers are append-only'
    using errcode = 'PT403';
end;
$function$;

create trigger answers_append_only
  before update on public.answers
  for each row execute function public.answers_append_only();
