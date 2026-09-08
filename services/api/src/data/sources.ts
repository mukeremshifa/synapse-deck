/**
 * The `sources` table — a notebook's inputs, persisted at last.
 *
 * Before FR7 a notebook's sources were `useState([])` in the browser: they
 * lived for the duration of one generate modal and vanished on reload, which is
 * why `client.ts` threw "Sources are not persisted" for four contract methods.
 *
 * Every statement carries `where user_id = $1`, including the single-row fetch
 * by primary key (ADR 0008). Statements that reach a source through its
 * notebook filter on **both** ids, so knowing a source id from another
 * notebook is not enough to read it.
 */

import { query } from '../lib/db.ts';
import type { SourceKind, SourceRow, SourceStatus } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, notebook_id, kind, title, status, error, size_bytes, ' +
  'topic_names, object_id, created_at, updated_at';

/**
 * `content` is deliberately absent from `COLUMNS`.
 *
 * It holds the whole extracted text of a document — potentially megabytes — and
 * the contract's `Source` has no field for it. Selecting it on every list would
 * ship a book to render a filename. `getSourceContent` fetches it explicitly,
 * for the one caller that needs it: the generation pipeline.
 */
export async function listSources(
  userId: string,
  notebookId: string,
  limit: number,
  cursor: { createdAt: string; id: string } | null,
): Promise<SourceRow[]> {
  const params: unknown[] = [userId, notebookId, limit];
  let keyset = '';
  if (cursor) {
    keyset = ` and (created_at, id) < ($4::timestamptz, $5::uuid)`;
    params.push(cursor.createdAt, cursor.id);
  }

  const result = await query<SourceRow>(
    `select ${COLUMNS}
       from public.sources
      where user_id = $1 and notebook_id = $2${keyset}
      order by created_at desc, id desc
      limit $3`,
    params,
  );
  return result.rows;
}

export async function getSource(
  userId: string,
  notebookId: string,
  sourceId: string,
): Promise<SourceRow | null> {
  const result = await query<SourceRow>(
    `select ${COLUMNS}
       from public.sources
      where user_id = $1 and notebook_id = $2 and id = $3`,
    [userId, notebookId, sourceId],
  );
  return result.rows[0] ?? null;
}

/** The extracted text, for the generation pipeline. See the note on `COLUMNS`. */
export async function getSourceContent(
  userId: string,
  sourceId: string,
): Promise<string | null> {
  const result = await query<{ content: string | null }>(
    `select content from public.sources where user_id = $1 and id = $2`,
    [userId, sourceId],
  );
  return result.rows[0]?.content ?? null;
}

/**
 * The text behind a set of sources, in the order given, for a generation.
 *
 * One statement rather than one per id: a generate over six sources should not
 * be six round trips. `= any($3)` with the ids as an array, and the notebook
 * filter is what stops a caller mixing in an id from another notebook — brief
 * §1.2(6), no cross-notebook sources.
 */
export async function getSourceTexts(
  userId: string,
  notebookId: string,
  sourceIds: string[],
): Promise<{ id: string; title: string; kind: SourceKind; content: string | null }[]> {
  const result = await query<{
    id: string;
    title: string;
    kind: SourceKind;
    content: string | null;
  }>(
    `select id, title, kind, content
       from public.sources
      where user_id = $1 and notebook_id = $2 and id = any($3::uuid[])
      order by created_at asc`,
    [userId, notebookId, sourceIds],
  );
  return result.rows;
}

export interface SourceInsert {
  notebookId: string;
  kind: SourceKind;
  title: string;
  status?: SourceStatus;
  content?: string | null;
  sizeBytes?: number | null;
  objectId?: string | null;
  topicNames?: string[];
}

export async function createSource(
  userId: string,
  input: SourceInsert,
): Promise<SourceRow> {
  const result = await query<SourceRow>(
    `insert into public.sources
       (user_id, notebook_id, kind, title, status, content, size_bytes, object_id, topic_names)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${COLUMNS}`,
    [
      userId,
      input.notebookId,
      input.kind,
      input.title,
      input.status ?? 'processing',
      input.content ?? null,
      input.sizeBytes ?? null,
      input.objectId ?? null,
      input.topicNames ?? [],
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

/**
 * Mark a source ready, or failed, once the pipeline has read it.
 *
 * Called by the job that `addSource` returned. `error` and `topic_names` are
 * both set here because both are outputs of the same pass.
 */
export async function finishSource(
  userId: string,
  sourceId: string,
  input: {
    status: SourceStatus;
    error?: string | null;
    content?: string | null;
    sizeBytes?: number | null;
    topicNames?: string[];
  },
): Promise<SourceRow | null> {
  const result = await query<SourceRow>(
    `update public.sources
        set status = $3,
            error = $4,
            content = coalesce($5, content),
            size_bytes = coalesce($6, size_bytes),
            topic_names = coalesce($7, topic_names)
      where user_id = $1 and id = $2
      returning ${COLUMNS}`,
    [
      userId,
      sourceId,
      input.status,
      input.error ?? null,
      input.content ?? null,
      input.sizeBytes ?? null,
      input.topicNames ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a source.
 *
 * **Artifacts made from it survive** (brief §1.2(7)). Nothing cascades from
 * here: `artifacts.source_ids` is a `uuid[]` with no foreign key precisely so
 * this delete leaves the id dangling rather than blocking or nulling it, and
 * `sources_snapshot` still carries the title so the provenance line can render
 * it struck through.
 */
export async function deleteSource(
  userId: string,
  notebookId: string,
  sourceId: string,
): Promise<boolean> {
  const result = await query(
    `delete from public.sources
      where user_id = $1 and notebook_id = $2 and id = $3`,
    [userId, notebookId, sourceId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Which of these ids are live sources in this notebook.
 *
 * The artifact list uses it to decide whether a name in `sources_snapshot` is
 * still current — FR3's provenance pattern, where a deleted source renders
 * struck through rather than being omitted.
 */
export async function liveSourceIds(
  userId: string,
  notebookId: string,
): Promise<string[]> {
  const result = await query<{ id: string }>(
    `select id from public.sources where user_id = $1 and notebook_id = $2`,
    [userId, notebookId],
  );
  return result.rows.map(row => row.id);
}
