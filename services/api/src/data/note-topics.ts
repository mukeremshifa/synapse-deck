/**
 * The `note_topics` and `note_blocks` tables — a note set's contents.
 *
 * **A topic owns its blocks, and a topic is the unit of progress** (SPEC §4.2,
 * revised 2026-09-09). The blocks stay a discriminated union rather than a text
 * blob so the renderer can produce elements and never markup; the topics exist
 * so that ticking something off does not depend on inferring structure from the
 * heading levels the model happened to choose.
 *
 * Every statement carries `where user_id = $1` (ADR 0008).
 */

import { query } from '../lib/db.ts';
import type { NoteBlockRow, NoteTopicRow } from '../lib/rows.ts';

const TOPIC_COLUMNS =
  'id, user_id, artifact_id, title, position, source_topic_id, completed_at, created_at';

const BLOCK_COLUMNS =
  'id, user_id, artifact_id, topic_id, block, position, source_id, created_at';

/** One note set's topics, in reading order. Not paginated — see `questions.ts`. */
export async function listNoteTopics(
  userId: string,
  artifactId: string,
): Promise<NoteTopicRow[]> {
  const result = await query<NoteTopicRow>(
    `select ${TOPIC_COLUMNS}
       from public.note_topics
      where user_id = $1 and artifact_id = $2
      order by position asc, created_at asc`,
    [userId, artifactId],
  );
  return result.rows;
}

/**
 * Every block of one note set, in reading order, tagged with its topic.
 *
 * **One query for the whole set, not one per topic.** A note set is a dozen
 * topics at most (`NOTESET_LIMITS`), and the handler assembles them in memory —
 * which is cheaper and simpler than a query per topic, and avoids the N+1 that
 * a per-topic fetch would become on a page that always renders all of them.
 */
export async function listNoteBlocks(
  userId: string,
  artifactId: string,
): Promise<NoteBlockRow[]> {
  const result = await query<NoteBlockRow>(
    `select ${BLOCK_COLUMNS}
       from public.note_blocks
      where user_id = $1 and artifact_id = $2
      order by position asc, created_at asc`,
    [userId, artifactId],
  );
  return result.rows;
}

export interface NoteTopicInsert {
  artifactId: string;
  title: string;
  position: number;
  sourceTopicId?: string | null;
}

export async function createNoteTopics(
  userId: string,
  rows: NoteTopicInsert[],
): Promise<NoteTopicRow[]> {
  if (rows.length === 0) return [];

  const result = await query<NoteTopicRow>(
    `insert into public.note_topics (user_id, artifact_id, title, position, source_topic_id)
     select $1, u.artifact_id, u.title, u.position, u.source_topic_id
       from unnest($2::uuid[], $3::text[], $4::int[], $5::uuid[])
         as u(artifact_id, title, position, source_topic_id)
     returning ${TOPIC_COLUMNS}`,
    [
      userId,
      rows.map(row => row.artifactId),
      rows.map(row => row.title),
      rows.map(row => row.position),
      rows.map(row => row.sourceTopicId ?? null),
    ],
  );
  return result.rows;
}

export interface NoteBlockInsert {
  artifactId: string;
  topicId: string;
  block: unknown;
  position: number;
  sourceId?: string | null;
}

export async function createNoteBlocks(
  userId: string,
  rows: NoteBlockInsert[],
): Promise<NoteBlockRow[]> {
  if (rows.length === 0) return [];

  const result = await query<NoteBlockRow>(
    `insert into public.note_blocks (user_id, artifact_id, topic_id, block, position, source_id)
     select $1, u.artifact_id, u.topic_id, u.block::jsonb, u.position, u.source_id
       from unnest($2::uuid[], $3::uuid[], $4::jsonb[], $5::int[], $6::uuid[])
         as u(artifact_id, topic_id, block, position, source_id)
     returning ${BLOCK_COLUMNS}`,
    [
      userId,
      rows.map(row => row.artifactId),
      rows.map(row => row.topicId),
      rows.map(row => JSON.stringify(row.block)),
      rows.map(row => row.position),
      rows.map(row => row.sourceId ?? null),
    ],
  );
  return result.rows;
}

/**
 * Tick a topic off, or untick it.
 *
 * **Not monotonic**, unlike the `markBlocksRead` this replaced. That one had
 * `read_at is null` in its where clause so a block once read stayed read, which
 * was right for observation — passing something on screen is not a claim you
 * can withdraw. A tick *is* a claim, so it is set and cleared freely.
 *
 * Ticking an already-ticked topic **keeps the original timestamp**: re-affirming
 * a claim is not a new claim, and rewriting it would make "when did you first
 * mark this read" drift forward on every stray click.
 *
 * Returns the note set's new completed count, so the caller does not need a
 * second query to update the artifact's readiness. **Null means the topic does
 * not belong to this user's note set** — the caller turns that into a 404,
 * rather than reporting a count for a write that did not happen.
 */
export async function setTopicCompleted(
  userId: string,
  artifactId: string,
  topicId: string,
  completed: boolean,
): Promise<number | null> {
  const updated = await query<{ id: string }>(
    `update public.note_topics
        set completed_at = case
              when $4::boolean then coalesce(completed_at, now())
              else null
            end
      where user_id = $1 and artifact_id = $2 and id = $3
      returning id`,
    [userId, artifactId, topicId, completed],
  );
  if (updated.rows.length === 0) return null;

  const result = await query<{ n: number }>(
    `select count(*)::int as n
       from public.note_topics
      where user_id = $1 and artifact_id = $2 and completed_at is not null`,
    [userId, artifactId],
  );
  return result.rows[0]?.n ?? 0;
}
