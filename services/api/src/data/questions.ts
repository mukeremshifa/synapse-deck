/**
 * The `questions` table — a quiz's or an exam's contents.
 *
 * **A question is not a card.** A card fuses content with FSRS scheduling
 * state; a question answered once under time is not on a schedule at all.
 * Keeping them in separate tables is what stops the flashcard model being
 * weakened to accommodate a different one — see the migration's comment.
 *
 * Every statement carries `where user_id = $1` (ADR 0008). Reads go through the
 * artifact, and filter on both ids.
 */

import { query } from '../lib/db.ts';
import type { QuestionRow } from '../lib/rows.ts';

const COLUMNS = 'id, user_id, artifact_id, payload, topic_id, position, created_at';

/** A question with its topic's name resolved, for the attempt answer's copy. */
export interface QuestionWithTopic extends QuestionRow {
  topic_name: string | null;
}

/**
 * One artifact's questions, in presentation order.
 *
 * Not paginated: the contract returns `Question[]` rather than a `Page`, because
 * generation is capped at 50 and a quiz you cannot hold in memory is not a quiz.
 * The join to `topics` is what lets an attempt copy `topicName` alongside
 * `topicId` — ADR 0013, the answer must stay readable after the topic is gone.
 */
export async function listQuestions(
  userId: string,
  artifactId: string,
): Promise<QuestionWithTopic[]> {
  const result = await query<QuestionWithTopic>(
    `select ${COLUMNS.split(', ')
      .map(column => `q.${column}`)
      .join(', ')},
            t.name as topic_name
       from public.questions q
       left join public.topics t on t.id = q.topic_id and t.user_id = $1
      where q.user_id = $1 and q.artifact_id = $2
      order by q.position asc, q.created_at asc`,
    [userId, artifactId],
  );
  return result.rows;
}

export interface QuestionInsert {
  artifactId: string;
  payload: unknown;
  topicId?: string | null;
  position: number;
}

/**
 * Insert a generated set in one statement.
 *
 * `unnest` rather than a loop: a 50-question exam should be one round trip, not
 * fifty. The arrays are positionally aligned, which Postgres guarantees.
 */
export async function createQuestions(
  userId: string,
  rows: QuestionInsert[],
): Promise<QuestionRow[]> {
  if (rows.length === 0) return [];

  const result = await query<QuestionRow>(
    `insert into public.questions (user_id, artifact_id, payload, topic_id, position)
     select $1, u.artifact_id, u.payload::jsonb, u.topic_id, u.position
       from unnest($2::uuid[], $3::jsonb[], $4::uuid[], $5::int[])
         as u(artifact_id, payload, topic_id, position)
     returning ${COLUMNS}`,
    [
      userId,
      rows.map(row => row.artifactId),
      rows.map(row => JSON.stringify(row.payload)),
      rows.map(row => row.topicId ?? null),
      rows.map(row => row.position),
    ],
  );
  return result.rows;
}
