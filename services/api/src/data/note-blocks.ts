/**
 * The `note_blocks` table — a note set's contents.
 *
 * **A discriminated union of blocks, never one text blob** (brief §1.2(2)), so
 * the notes editor that comes later is a feature rather than a migration.
 *
 * Every statement carries `where user_id = $1` (ADR 0008).
 */

import { query } from '../lib/db.ts';
import type { NoteBlockRow } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, artifact_id, block, position, source_id, read_at, created_at';

/** One note set's blocks, in reading order. Not paginated — see `questions.ts`. */
export async function listNoteBlocks(
  userId: string,
  artifactId: string,
): Promise<NoteBlockRow[]> {
  const result = await query<NoteBlockRow>(
    `select ${COLUMNS}
       from public.note_blocks
      where user_id = $1 and artifact_id = $2
      order by position asc, created_at asc`,
    [userId, artifactId],
  );
  return result.rows;
}

export interface NoteBlockInsert {
  artifactId: string;
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
    `insert into public.note_blocks (user_id, artifact_id, block, position, source_id)
     select $1, u.artifact_id, u.block::jsonb, u.position, u.source_id
       from unnest($2::uuid[], $3::jsonb[], $4::int[], $5::uuid[])
         as u(artifact_id, block, position, source_id)
     returning ${COLUMNS}`,
    [
      userId,
      rows.map(row => row.artifactId),
      rows.map(row => JSON.stringify(row.block)),
      rows.map(row => row.position),
      rows.map(row => row.sourceId ?? null),
    ],
  );
  return result.rows;
}

/**
 * Mark blocks read. **Monotonic**, and that is the whole design.
 *
 * `read_at is null` in the where clause is what makes it so: a block already
 * read keeps its original timestamp, and re-marking it is a no-op rather than a
 * rewrite. The reader batches marks as the user scrolls (FR5), so the same
 * block arrives many times; without this the "when did you first read it"
 * answer would drift forward every scroll.
 *
 * Returns the new total read count, so the caller does not need a second query
 * to update the artifact's readiness.
 */
export async function markBlocksRead(
  userId: string,
  artifactId: string,
  blockIds: string[],
): Promise<number> {
  if (blockIds.length > 0) {
    await query(
      `update public.note_blocks
          set read_at = now()
        where user_id = $1
          and artifact_id = $2
          and id = any($3::uuid[])
          and read_at is null`,
      [userId, artifactId, blockIds],
    );
  }

  const result = await query<{ n: number }>(
    `select count(*)::int as n
       from public.note_blocks
      where user_id = $1 and artifact_id = $2 and read_at is not null`,
    [userId, artifactId],
  );
  return result.rows[0]?.n ?? 0;
}
