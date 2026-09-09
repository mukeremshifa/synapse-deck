-- ---------------------------------------------------------------------------
-- 0016 — two more deterministic question kinds
-- ---------------------------------------------------------------------------
-- `fill_blank` (type the missing token into a sentence) and `categorize` (sort
-- items into named groups) join the six from 0014. Both grade in the browser
-- from the payload alone, which is the rule 0014 set and this keeps: nothing
-- here needs a model, a rubric, or a round trip to mark an answer.
--
-- ── Why both checks have to move, and what happens if only one does ────────
--
-- 0014 wrote two shape checks, and the two fail differently for a new kind:
--
--   * `attempt_answers_response_shape` ends in `else false`, so a `fill_blank`
--     response is rejected outright — a candidate answering one gets a 500 on
--     submit.
--   * `questions_payload_shape` ends in `else payload ? 'stem' and payload ?
--     'options'`, the mcq branch, which is the *more dangerous* of the two. It
--     accepts `categorize` by accident (it has a `stem`, though `options` is
--     missing, so it in fact rejects it) and rejects `fill_blank`, which has
--     neither — a generated question would fail to insert at the end of a
--     generation that had already been paid for.
--
-- So both are replaced. The `else` on the payload check is kept as the mcq
-- branch rather than widened to `true`, for 0014's stated reason: a check that
-- only proves the discriminant is present would accept `{"kind":"ordering"}`
-- with no items, which is a question the runner cannot render.
--
-- Nothing here is destructive: both changes only widen what is accepted, and
-- every existing row satisfies the new constraints exactly as it satisfied the
-- old ones. There is no backfill, because no existing row is of either new kind.
--
-- **This is a shape check, not a validation.** Zod owns arity and content — one
-- blank in the text, at least one accepted answer, every category used. The
-- database's job is only to refuse a payload that is not structurally the kind
-- it claims to be.

begin;

-- ---------------------------------------------------------------------------
-- 1. questions.payload
-- ---------------------------------------------------------------------------
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
      -- The sentence is the prompt, so there is no 'stem' to require.
      when 'fill_blank' then payload ? 'text' and payload ? 'accepted'
      when 'categorize' then payload ? 'stem' and payload ? 'categories' and payload ? 'items'
      -- 'mcq', and anything written before `kind` was required.
      else payload ? 'stem' and payload ? 'options'
    end
  );

-- ---------------------------------------------------------------------------
-- 2. attempt_answers.response
-- ---------------------------------------------------------------------------
alter table public.attempt_answers
  drop constraint attempt_answers_response_shape;

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
        -- What they typed, verbatim. Empty string is a legal response and
        -- means "answered with nothing", which grades wrong rather than
        -- unanswered — `response is null` is what unanswered looks like.
        when 'fill_blank' then response ? 'text'
        when 'categorize' then response ? 'assignments'
        else false
      end
    )
  );

commit;
