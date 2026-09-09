/**
 * The `attempts` table — one sitting of a quiz or an exam, and its answers.
 *
 * This closes the gap `0008_answers.sql` recorded about itself: *"there is no
 * `exams` table, because an exam is currently assembled in the browser"*.
 * Answers were written loose, grouped by an `attempt_id` that pointed at
 * nothing, so a sitting could not be resumed, listed or scored server-side.
 *
 * Every statement carries `where user_id = $1` (ADR 0008). The answer
 * statements reach their rows through `attempts` and filter on `user_id` in
 * **both** tables — a join is not a substitute for a tenancy filter.
 */

import { query, withTransaction } from '../lib/db.ts';
import type { AttemptAnswerRow, AttemptRow } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, notebook_id, artifact_id, outcome, started_at, submitted_at, score';
const ANSWER_COLUMNS =
  'id, user_id, attempt_id, question_id, question_text, topic_id, topic_name, ' +
  'response, selected_option, correct, flagged, elapsed_ms, answered_at';

/**
 * Mark this user's stale in-progress attempts abandoned.
 *
 * **FR6 §8.7 item 2.** `abandoned` was written by nothing, so the overview saw
 * quiz attempts stuck `in-progress` for ever and correctly declined to count
 * them as sittings. A runner cannot write it: a browser that closed cannot
 * report why, and one that is merely offline must not be told its attempt is
 * over. Only the server can decide, and only on elapsed time.
 *
 * Called on every attempt read rather than by a cron, because this stack has no
 * scheduler. It is one indexed UPDATE over a partial index that holds only
 * in-progress rows, so the cost is proportional to what it can actually act on.
 */
export async function sweepAbandoned(userId: string): Promise<number> {
  const result = await query<{ sweep_abandoned_attempts: number }>(
    `select public.sweep_abandoned_attempts($1)`,
    [userId],
  );
  return result.rows[0]?.sweep_abandoned_attempts ?? 0;
}

export async function getAttempt(
  userId: string,
  attemptId: string,
): Promise<AttemptRow | null> {
  const result = await query<AttemptRow>(
    `select ${COLUMNS} from public.attempts where user_id = $1 and id = $2`,
    [userId, attemptId],
  );
  return result.rows[0] ?? null;
}

export async function listAnswers(
  userId: string,
  attemptId: string,
): Promise<AttemptAnswerRow[]> {
  const result = await query<AttemptAnswerRow>(
    `select ${ANSWER_COLUMNS}
       from public.attempt_answers
      where user_id = $1 and attempt_id = $2
      order by answered_at asc`,
    [userId, attemptId],
  );
  return result.rows;
}

/**
 * The attempts for one artifact, or for a whole notebook, newest first.
 *
 * `artifactId` narrows it; omitting it lists the notebook's sittings, which is
 * what the overview's diagnostics reads.
 */
export async function listAttempts(
  userId: string,
  notebookId: string,
  artifactId: string | null,
  limit: number,
  cursor: { startedAt: string; id: string } | null,
): Promise<AttemptRow[]> {
  const params: unknown[] = [userId, notebookId, limit];
  let filter = '';
  if (artifactId) {
    filter += ` and artifact_id = $${params.length + 1}`;
    params.push(artifactId);
  }
  if (cursor) {
    filter += ` and (started_at, id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid)`;
    params.push(cursor.startedAt, cursor.id);
  }

  const result = await query<AttemptRow>(
    `select ${COLUMNS}
       from public.attempts
      where user_id = $1 and notebook_id = $2${filter}
      order by started_at desc, id desc
      limit $3`,
    params,
  );
  return result.rows;
}

/**
 * Start a sitting — or hand back the one already in progress.
 *
 * **Resumability is the point.** FR5 built a quiz runner that survives a
 * reload, and `client.ts` threw "Quiz attempts are not resumable" because
 * nothing persisted a partial sitting. Returning the existing in-progress
 * attempt rather than creating a second one is what makes reload-and-continue
 * work, and it also stops a double-clicked "Start" producing two papers.
 *
 * The sweep runs first, so an attempt abandoned hours ago does not get resumed
 * as though the user had merely stepped away.
 */
export async function startAttempt(
  userId: string,
  notebookId: string,
  artifactId: string,
): Promise<AttemptRow> {
  await sweepAbandoned(userId);

  const existing = await query<AttemptRow>(
    `select ${COLUMNS}
       from public.attempts
      where user_id = $1
        and notebook_id = $2
        and artifact_id = $3
        and outcome = 'in-progress'
      order by started_at desc
      limit 1`,
    [userId, notebookId, artifactId],
  );
  const found = existing.rows[0];
  if (found) return found;

  const result = await query<AttemptRow>(
    `insert into public.attempts (user_id, notebook_id, artifact_id)
     values ($1, $2, $3)
     returning ${COLUMNS}`,
    [userId, notebookId, artifactId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

export interface AnswerInput {
  questionId: string;
  questionText: string;
  topicId: string | null;
  topicName: string | null;
  /**
   * The contract's `QuestionResponse` — what the candidate did, for every kind.
   * Null means unanswered, and it is the only thing that means that: a matching
   * or ordering answer has no `selectedOption` while being fully answered.
   */
  response: unknown;
  /** The single-choice projection of `response`. Null for the four kinds without one. */
  selectedOption: number | null;
  correct: boolean;
  flagged: boolean;
  elapsedMs: number | null;
}

/**
 * Save progress — the answers so far, without submitting.
 *
 * An upsert on `(attempt_id, question_id)`, because a candidate changes their
 * mind: the second save for a question must replace the first, not add a row.
 * That is why this table is not append-only while `public.answers` is.
 *
 * Guarded on `outcome = 'in-progress'` inside the transaction: writing answers
 * into a submitted attempt would silently rewrite a finished paper, and a
 * candidate with two tabs open is an ordinary way to reach that.
 */
export async function saveProgress(
  userId: string,
  attemptId: string,
  answers: AnswerInput[],
): Promise<AttemptRow | null> {
  return withTransaction(async client => {
    const attempt = await client.query<AttemptRow>(
      `select ${COLUMNS}
         from public.attempts
        where user_id = $1 and id = $2 and outcome = 'in-progress'
        for update`,
      [userId, attemptId],
    );
    const row = attempt.rows[0];
    if (!row) return null;

    if (answers.length > 0) {
      await client.query(
        `insert into public.attempt_answers
           (user_id, attempt_id, question_id, question_text, topic_id, topic_name,
            response, selected_option, correct, flagged, elapsed_ms)
         select $1, $2, u.question_id, u.question_text, u.topic_id, u.topic_name,
                u.response::jsonb, u.selected_option, u.correct, u.flagged, u.elapsed_ms
           from unnest($3::uuid[], $4::text[], $5::uuid[], $6::text[], $7::jsonb[],
                       $8::int[], $9::boolean[], $10::boolean[], $11::int[])
             as u(question_id, question_text, topic_id, topic_name,
                  response, selected_option, correct, flagged, elapsed_ms)
         on conflict (attempt_id, question_id) do update
            set response = excluded.response,
                selected_option = excluded.selected_option,
                correct = excluded.correct,
                flagged = excluded.flagged,
                elapsed_ms = excluded.elapsed_ms,
                answered_at = now()`,
        [
          userId,
          attemptId,
          answers.map(answer => answer.questionId),
          answers.map(answer => answer.questionText),
          answers.map(answer => answer.topicId),
          answers.map(answer => answer.topicName),
          // `null`, not `'null'`: a JSON null would satisfy `response is not
          // null` and count an unanswered question toward the score.
          answers.map(answer =>
            answer.response === null || answer.response === undefined
              ? null
              : JSON.stringify(answer.response),
          ),
          answers.map(answer => answer.selectedOption),
          answers.map(answer => answer.correct),
          answers.map(answer => answer.flagged),
          answers.map(answer => answer.elapsedMs),
        ],
      );
    }

    return row;
  });
}

/**
 * Submit — write the final answers and score the paper.
 *
 * **The score is computed here, not sent by the client.** A submitted score
 * that arrived in the request body would be a number the candidate could
 * choose. `correct` per answer is likewise recomputed by the handler against
 * the stored question before it reaches this function.
 *
 * Score is correct over **answered**, matching the contract's comment, so a
 * paper abandoned two questions in does not read as 8% when it was 100% of what
 * was attempted. A paper with nothing answered scores 0 rather than dividing by
 * zero.
 *
 * **"Answered" is `response is not null`, not `selected_option is not null`.**
 * Those were the same predicate until the quiz learned to ask matching and
 * ordering questions, which have no single option index — counting the old way
 * would drop every one of them from the denominator and score a fully answered
 * paper against the handful of MCQs in it. Migration 0014 adds the column and
 * the partial index this filter runs on.
 */
export async function submitAttempt(
  userId: string,
  attemptId: string,
  answers: AnswerInput[],
): Promise<AttemptRow | null> {
  return withTransaction(async client => {
    const attempt = await client.query<AttemptRow>(
      `select ${COLUMNS}
         from public.attempts
        where user_id = $1 and id = $2 and outcome = 'in-progress'
        for update`,
      [userId, attemptId],
    );
    if (!attempt.rows[0]) return null;

    if (answers.length > 0) {
      await client.query(
        `insert into public.attempt_answers
           (user_id, attempt_id, question_id, question_text, topic_id, topic_name,
            response, selected_option, correct, flagged, elapsed_ms)
         select $1, $2, u.question_id, u.question_text, u.topic_id, u.topic_name,
                u.response::jsonb, u.selected_option, u.correct, u.flagged, u.elapsed_ms
           from unnest($3::uuid[], $4::text[], $5::uuid[], $6::text[], $7::jsonb[],
                       $8::int[], $9::boolean[], $10::boolean[], $11::int[])
             as u(question_id, question_text, topic_id, topic_name,
                  response, selected_option, correct, flagged, elapsed_ms)
         on conflict (attempt_id, question_id) do update
            set response = excluded.response,
                selected_option = excluded.selected_option,
                correct = excluded.correct,
                flagged = excluded.flagged,
                elapsed_ms = excluded.elapsed_ms,
                answered_at = now()`,
        [
          userId,
          attemptId,
          answers.map(answer => answer.questionId),
          answers.map(answer => answer.questionText),
          answers.map(answer => answer.topicId),
          answers.map(answer => answer.topicName),
          // `null`, not `'null'`: a JSON null would satisfy `response is not
          // null` and count an unanswered question toward the score.
          answers.map(answer =>
            answer.response === null || answer.response === undefined
              ? null
              : JSON.stringify(answer.response),
          ),
          answers.map(answer => answer.selectedOption),
          answers.map(answer => answer.correct),
          answers.map(answer => answer.flagged),
          answers.map(answer => answer.elapsedMs),
        ],
      );
    }

    const submitted = await client.query<AttemptRow>(
      `update public.attempts a
          set outcome = 'submitted',
              submitted_at = now(),
              score = coalesce((
                select count(*) filter (where correct)::float
                     / nullif(count(*) filter (where response is not null), 0)
                  from public.attempt_answers
                 where user_id = $1 and attempt_id = $2
              ), 0)
        where a.user_id = $1 and a.id = $2 and a.outcome = 'in-progress'
        returning ${COLUMNS.split(', ')
          .map(column => `a.${column}`)
          .join(', ')}`,
      [userId, attemptId],
    );
    return submitted.rows[0] ?? null;
  });
}
