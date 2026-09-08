/**
 * Notebook-scoped jobs — the contract's `Job`.
 *
 * The `jobs` table gained `notebook_id`, `kind`, `stage`, `artifact_id`,
 * `source_id`, `error_code` and `units_failed` at migration 0011. This module
 * reads and writes that vocabulary; `data/jobs.ts` keeps serving the pre-FR7
 * deck-scoped ingestion path from the same table, unchanged.
 *
 * Every statement carries `where user_id = $1` (ADR 0008).
 */

import { query } from '../lib/db.ts';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type JobStage =
  | 'queued'
  | 'extracting'
  | 'splitting'
  | 'generating'
  | 'saving'
  | 'done';
export type JobKind = 'add-source' | 'create-artifact';

export interface NotebookJobRow {
  id: string;
  user_id: string;
  notebook_id: string | null;
  kind: JobKind;
  status: JobStatus;
  stage: JobStage;
  chunk_count: number;
  chunks_completed: number;
  units_failed: number;
  truncated: boolean;
  artifact_id: string | null;
  source_id: string | null;
  error: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, user_id, notebook_id, kind, status, stage, chunk_count, chunks_completed, ' +
  'units_failed, truncated, artifact_id, source_id, error, error_code, ' +
  'created_at, updated_at';

export async function createNotebookJob(
  userId: string,
  input: {
    notebookId: string;
    kind: JobKind;
    artifactId?: string | null;
    sourceId?: string | null;
  },
): Promise<NotebookJobRow> {
  const result = await query<NotebookJobRow>(
    `insert into public.jobs
       (id, user_id, notebook_id, kind, artifact_id, source_id, status, stage)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending', 'queued')
     returning ${COLUMNS}`,
    [
      userId,
      input.notebookId,
      input.kind,
      input.artifactId ?? null,
      input.sourceId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

export async function getNotebookJob(
  userId: string,
  notebookId: string,
  jobId: string,
): Promise<NotebookJobRow | null> {
  const result = await query<NotebookJobRow>(
    `select ${COLUMNS}
       from public.jobs
      where user_id = $1 and notebook_id = $2 and id = $3`,
    [userId, notebookId, jobId],
  );
  return result.rows[0] ?? null;
}

/**
 * A notebook's jobs, newest first.
 *
 * Capped rather than paginated: the contract returns `Job[]`, and the
 * generation panel shows recent work rather than a history. A notebook that has
 * run a thousand generations does not want a thousand rows on every render.
 */
export async function listNotebookJobs(
  userId: string,
  notebookId: string,
  limit = 20,
): Promise<NotebookJobRow[]> {
  const result = await query<NotebookJobRow>(
    `select ${COLUMNS}
       from public.jobs
      where user_id = $1 and notebook_id = $2
      order by created_at desc
      limit $3`,
    [userId, notebookId, limit],
  );
  return result.rows;
}

/**
 * Advance a job.
 *
 * Every field optional and `coalesce`d, so a stage report does not have to
 * restate the counts and a failure does not have to restate the stage.
 */
export async function updateNotebookJob(
  userId: string,
  jobId: string,
  input: {
    status?: JobStatus;
    stage?: JobStage;
    unitsTotal?: number;
    unitsCompleted?: number;
    unitsFailed?: number;
    truncated?: boolean;
    error?: string | null;
    errorCode?: string | null;
  },
): Promise<NotebookJobRow | null> {
  const result = await query<NotebookJobRow>(
    `update public.jobs
        set status = coalesce($3, status),
            stage = coalesce($4, stage),
            chunk_count = coalesce($5, chunk_count),
            chunks_completed = coalesce($6, chunks_completed),
            units_failed = coalesce($7, units_failed),
            truncated = coalesce($8, truncated),
            error = $9,
            error_code = $10,
            updated_at = now()
      where user_id = $1 and id = $2
      returning ${COLUMNS}`,
    [
      userId,
      jobId,
      input.status ?? null,
      input.stage ?? null,
      input.unitsTotal ?? null,
      input.unitsCompleted ?? null,
      input.unitsFailed ?? null,
      input.truncated ?? null,
      input.error ?? null,
      input.errorCode ?? null,
    ],
  );
  return result.rows[0] ?? null;
}
