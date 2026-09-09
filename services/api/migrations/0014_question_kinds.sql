-- ---------------------------------------------------------------------------
-- 0014 — the full set of question kinds
-- ---------------------------------------------------------------------------
-- A quiz could ask exactly one thing: a multiple-choice question with one right
-- answer. Five kinds join it — `msq` (select all that apply), `true_false`,
-- `numeric`, `matching` and `ordering` — and two constraints have to move for
-- them to be storable at all.
--
-- **Every one of them grades deterministically in the browser**, from the
-- payload alone, with no model call. That is the selection criterion rather
-- than a coincidence: free text (short answer, problem, essay) needs a model
-- and a rubric, which buys a per-attempt cost, a latency, and a score that
-- cannot be reproduced from the stored record. `blueprint.ts` still names those
-- formats because a blueprint that cannot say "30% essay" is not describing a
-- real exam; what it must not do is claim we can generate one.
--
-- Nothing here is destructive. Both changes widen a check: every row that
-- validated before still validates, and no column is dropped or retyped.

-- ---------------------------------------------------------------------------
-- 1. `questions.payload` — a shape check per kind
-- ---------------------------------------------------------------------------
-- The old constraint was `payload ? 'stem' and payload ? 'options'`, which is
-- exactly the MCQ shape and rejects all five new kinds: `true_false` has a
-- `statement` and no `options`, `ordering` has `items`, `matching` has `pairs`.
--
-- The replacement branches on `kind` rather than loosening to `payload ?
-- 'kind'`. A check that only proves the discriminant is present would accept
-- `{"kind":"ordering"}` with no items — a question the runner cannot render and
-- cannot grade, discovered by whoever opens the quiz rather than by whoever
-- wrote it. **This is a shape check and not a validation**: Zod owns the arity
-- rules (at least three options, at least two correct, distinct items). The
-- database's job is to refuse a payload that is structurally not a question of
-- the kind it claims to be.
--
-- `kind` is left absent-tolerant for `mcq` only, because every row written
-- before this migration carries one written by the old generator, which did set
-- it — but `questions_payload_shape` never required it, so a row without one is
-- possible and must not become unreadable.

alter table public.questions
  drop constraint questions_payload_shape;

alter table public.questions
  add constraint questions_payload_shape check (
    case payload ->> 'kind'
      when 'msq'        then payload ? 'stem' and payload ? 'options'
      when 'true_false' then payload ? 'statement' and payload ? 'answer'
      when 'numeric'    then payload ? 'stem' and payload ? 'answer' and payload ? 'tolerance'
      when 'matching'   then payload ? 'stem' and payload ? 'pairs'
      when 'ordering'   then payload ? 'stem' and payload ? 'items'
      -- 'mcq', and anything written before `kind` was required.
      else payload ? 'stem' and payload ? 'options'
    end
  );

-- ---------------------------------------------------------------------------
-- 2. `attempt_answers.response` — what the candidate actually did
-- ---------------------------------------------------------------------------
-- `selected_option int` says everything about an MCQ and nothing about the
-- other five. A multi-select answer is a set, a matching answer is a map, an
-- ordering answer is a permutation; none survives being flattened to one
-- integer.
--
-- **`selected_option` is kept, not replaced**, and that is the point of adding
-- a column rather than retyping one. It stays the projection for the two
-- single-choice kinds, so everything already reading it keeps working
-- unchanged — in particular `attempts.score`, computed as
--
--     count(*) filter (where correct)
--       / nullif(count(*) filter (where selected_option is not null), 0)
--
-- which would start dividing by a smaller denominator the moment a matching
-- answer wrote null into it. So `score_denominator` below replaces that
-- filter's meaning: **a question is answered when it has a response**, and the
-- score query is moved onto it in the same migration that makes the two differ.
--
-- Nullable with no default: null means unanswered, which is what a row written
-- before this migration was for any question the candidate skipped, and is also
-- what an old row's answered MCQ now looks like. That second case is handled by
-- the backfill below rather than left to read as "skipped".

alter table public.attempt_answers
  add column response jsonb;

-- Backfill: every existing answered row is an MCQ, because MCQ was the only
-- kind that existed. `selected_option is not null` is exactly "was answered"
-- for those rows, which is precisely the equivalence this migration ends —
-- so it has to be spent here, while it is still true.
update public.attempt_answers
   set response = jsonb_build_object('kind', 'mcq', 'option', selected_option)
 where selected_option is not null
   and response is null;

-- The same shape discipline as `questions.payload`: present and structurally a
-- response of the kind it claims. Null stays legal and means unanswered.
alter table public.attempt_answers
  add constraint attempt_answers_response_shape check (
    response is null or (
      case response ->> 'kind'
        when 'mcq'        then response ? 'option'
        when 'msq'        then response ? 'options'
        when 'true_false' then response ? 'value'
        when 'numeric'    then response ? 'value' and response ? 'raw'
        when 'matching'   then response ? 'pairs'
        when 'ordering'   then response ? 'order'
        else false
      end
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The score, recomputed against `response`
-- ---------------------------------------------------------------------------
-- `attempts.score` is written by the submit path in `data/attempts.ts`, which
-- carries the same expression this comment quotes. The query there is updated
-- alongside this migration; this index exists because that filter now runs
-- against a jsonb column on every submit and every attempt read.
--
-- Partial, on `is not null`: the only question ever asked of it is "which rows
-- were answered", and indexing the nulls would be indexing the majority of a
-- half-finished quiz for a query that never wants them.
create index attempt_answers_answered_idx
  on public.attempt_answers (user_id, attempt_id)
  where response is not null;
