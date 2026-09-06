/**
 * Ingestion job state, in Postgres. DS1 task 3.
 *
 * The same eight operations `jobs-dynamo.ts` performs against DynamoDB, against
 * `public.jobs` and `public.job_chunks` instead. `data/jobs.ts` chooses between
 * them on `JOB_STORE`; nothing above the data layer knows which is running,
 * which is the whole of DEMO-SPRINT-BRIEF §6.
 *
 * ── Read the migration's header before changing anything here ─────────────
 *
 * On DynamoDB `userId` is the partition key -- the *address* of the data. Here
 * it is a column, so a statement that forgets `where user_id = $1` returns
 * every user's jobs rather than nothing. **Every statement in this file carries
 * that filter, including the single-row reads by primary key**, because a job
 * id arrives from a URL and a job id is not a capability.
 *
 * That is rule 2 of ADR 0008, and it is the rule `scripts/check-data-access.mjs`
 * explicitly cannot enforce: it checks that `userId` is the first parameter,
 * not that the query uses it. This file is one of the places where that gap is
 * load-bearing, so the filters are written out rather than factored into a
 * helper that could later be called without them.
 *
 * ── Timestamps ────────────────────────────────────────────────────────────
 *
 * `lib/db.ts` installs a `timestamptz` parser that returns ISO 8601 strings, so
 * every timestamp read here is already a string in the shape `JobRecord`
 * declares. No conversion happens in this file, and none should: doing it in
 * two places is how the two stores start disagreeing about a format.
 */

import { query } from '../lib/db.ts';
import { staleRunningBefore } from '../../../../src/lib/quota.ts';
import type { ChunkRecord, JobRecord, JobStatus } from './jobs-dynamo.ts';

/**
 * The row shapes, which are not the record shapes.
 *
 * Postgres returns snake_case columns and the records are camelCase, so the
 * mapping is explicit below rather than being a `select *` that happens to line
 * up. An explicit projection also means a column added later does not silently
 * start travelling to the client.
 */
interface JobRow {
  id: string;
  user_id: string;
  status: JobStatus;
  chunk_count: number;
  chunks_completed: number;
  deck_id: string | null;
  error: string | null;
  truncated: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface ChunkRow {
  job_id: string;
  user_id: string;
  chunk_index: number;
  status: JobStatus;
  cards: unknown[];
  provider: string | null;
  topics: string[];
  error: string | null;
  updated_at: string;
  expires_at: string;
}

/**
 * `sk` and `expiresAt` exist on `JobRecord` because DynamoDB needs them, and
 * they are filled in here so the two stores return the same shape.
 *
 * That is a real cost of sharing one interface across two engines, and it is
 * the right one: the alternative is two record types and a mapping at every
 * call site, which puts store-specific knowledge above the seam -- exactly what
 * the seam exists to prevent. `sk` is reconstructed to the format the DynamoDB
 * module would have written, so a log line reads identically either way.
 */
function toJobRecord(row: JobRow): JobRecord {
  return {
    userId: row.user_id,
    sk: `job#${row.id}`,
    jobId: row.id,
    status: row.status,
    chunkCount: row.chunk_count,
    chunksCompleted: row.chunks_completed,
    deckId: row.deck_id,
    error: row.error,
    truncated: row.truncated,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
  };
}

function toChunkRecord(row: ChunkRow): ChunkRecord {
  return {
    userId: row.user_id,
    sk: `job#${row.job_id}#chunk#${String(row.chunk_index).padStart(6, '0')}`,
    jobId: row.job_id,
    chunkIndex: row.chunk_index,
    status: row.status,
    cards: row.cards,
    provider: row.provider,
    topics: row.topics,
    error: row.error,
    updatedAt: row.updated_at,
    expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
  };
}

const JOB_COLUMNS = `
  id, user_id, status, chunk_count, chunks_completed,
  deck_id, error, truncated, created_at, updated_at, expires_at
`;

const CHUNK_COLUMNS = `
  job_id, user_id, chunk_index, status, cards,
  provider, topics, error, updated_at, expires_at
`;

/**
 * Fail a job that has been `running` longer than any real job could be. DS1
 * task 9.
 *
 * ── Why this exists, and why it is on the read path ───────────────────────
 *
 * Step Functions survived a crashed worker; a Node process does not. A job
 * whose in-process run died mid-fan-out stays `running` forever, and the
 * frontend polls a job in that state indefinitely -- a spinner that never
 * resolves and never explains itself, which is the worst of the available
 * failure modes because it looks like the product is merely slow.
 *
 * Swept on read rather than by a scheduler for three reasons: there is no
 * scheduler in the demo stack, a stranded job nobody is looking at harms
 * nobody, and the read is exactly the moment someone cares.
 *
 * The threshold is `staleRunningBefore` from `src/lib/quota.ts` -- the same one
 * that already decides when a `running` generation row stopped counting against
 * quota. Reusing it means a job and its generation row cannot disagree about
 * whether the same run was abandoned; a second constant would eventually drift
 * from the first and the disagreement would present as a quota that will not
 * clear.
 *
 * The update is conditional in SQL rather than checked in JavaScript, so two
 * concurrent polls cannot both decide to fail the same job and write over each
 * other.
 */
async function sweepStale(userId: string, jobId: string): Promise<void> {
  await query(
    `update public.jobs
        set status = 'failed',
            error = $3,
            updated_at = now()
      where id = $2
        and user_id = $1
        and status in ('pending', 'running')
        and updated_at < $4`,
    [
      userId,
      jobId,
      'This run was interrupted before it finished. Nothing was charged for the ' +
        'sections that never ran; start it again to pick up from the beginning.',
      staleRunningBefore(new Date()).toISOString(),
    ],
  );
}

/**
 * Create the job summary row.
 *
 * `on conflict do nothing` plus a returning-row check, which is the Postgres
 * equivalent of DynamoDB's `attribute_not_exists(sk)` condition: a retried
 * dispatch cannot reset a running job's counters back to zero. The job id is a
 * UUID generated by the caller, so a collision here means a genuine retry
 * rather than an id clash.
 */
export async function createJob(
  userId: string,
  jobId: string,
  deckId: string | null,
): Promise<JobRecord> {
  const inserted = await query<JobRow>(
    `insert into public.jobs (id, user_id, deck_id)
     values ($2, $1, $3)
     on conflict (id) do nothing
     returning ${JOB_COLUMNS}`,
    [userId, jobId, deckId],
  );

  const row = inserted.rows[0];
  if (row !== undefined) return toJobRecord(row);

  // The insert was a no-op, so the job already existed. Read it back **scoped
  // to this user**: without that filter a caller could probe for another user's
  // job ids by watching which inserts conflict.
  const existing = await query<JobRow>(
    `select ${JOB_COLUMNS} from public.jobs where id = $2 and user_id = $1`,
    [userId, jobId],
  );
  const found = existing.rows[0];
  if (found === undefined) {
    throw new Error(`Job ${jobId} could not be created and does not belong to this user.`);
  }
  return toJobRecord(found);
}

/**
 * The job summary, or null.
 *
 * `where user_id = $1` on a lookup by primary key. That is not redundant: it is
 * what turns another user's job id into a 404 rather than a disclosure, and it
 * is the reason the handler can map null to "not found" without knowing whether
 * the job is missing or merely someone else's.
 */
export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  await sweepStale(userId, jobId);
  const result = await query<JobRow>(
    `select ${JOB_COLUMNS} from public.jobs where id = $2 and user_id = $1`,
    [userId, jobId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toJobRecord(row);
}

/**
 * The job and all of its chunks.
 *
 * Two statements rather than the join DynamoDB's single Query stood in for. A
 * join would return the summary repeated once per chunk and then need
 * de-duplicating in JavaScript, which is more code and more allocation to save
 * one round trip on a query that is already indexed.
 *
 * `source_text` is deliberately not selected. It is an input, it is the largest
 * column in the table, and it would otherwise travel to the client on every
 * poll -- the DynamoDB module filtered it out by sort-key prefix for the same
 * reason.
 */
export async function getJobWithChunks(
  userId: string,
  jobId: string,
): Promise<{ job: JobRecord | null; chunks: ChunkRecord[] }> {
  const job = await getJob(userId, jobId);
  if (job === null) return { job: null, chunks: [] };

  const chunks = await query<ChunkRow>(
    `select ${CHUNK_COLUMNS}
       from public.job_chunks
      where user_id = $1 and job_id = $2
      order by chunk_index`,
    [userId, jobId],
  );

  return { job, chunks: chunks.rows.map(toChunkRecord) };
}

/**
 * The most recent job that produced a given deck, or null.
 *
 * The review gate knows a deck id and needs the run that filled it, so it can
 * say what did *not* make it in -- the failed sections left no rows behind, so
 * the deck cannot carry that itself.
 *
 * Newest first, because a deck can legitimately be regenerated and the gate
 * should describe the run the user is looking at.
 */
export async function findJobForDeck(
  userId: string,
  deckId: string,
): Promise<JobRecord | null> {
  const result = await query<JobRow>(
    `select ${JOB_COLUMNS}
       from public.jobs
      where user_id = $1 and deck_id = $2
      order by created_at desc
      limit 1`,
    [userId, deckId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  // Swept after the lookup rather than before: the sweep needs a job id, and
  // this is the query that finds one. A gate opened on a stranded job therefore
  // still sees it fail rather than reporting it as running.
  await sweepStale(userId, row.id);
  const fresh = await query<JobRow>(
    `select ${JOB_COLUMNS} from public.jobs where id = $2 and user_id = $1`,
    [userId, row.id],
  );
  const after = fresh.rows[0];
  return after === undefined ? null : toJobRecord(after);
}

/**
 * Move a job to a new status, and optionally record the fields that go with it.
 *
 * Built as a dynamic SET list for the same reason the DynamoDB version builds a
 * dynamic UpdateExpression: an `undefined` field must mean "leave it alone",
 * not "set it to null". `deckId` in particular is legitimately nullable, so
 * `undefined` and `null` are different instructions here.
 *
 * Parameter numbering starts at 3 because $1 and $2 are always `userId` and
 * `jobId` -- the two that are never optional and never come from a request body.
 */
export async function updateJobStatus(
  userId: string,
  jobId: string,
  status: JobStatus,
  fields: {
    chunkCount?: number;
    deckId?: string | null;
    error?: string | null;
    truncated?: boolean;
  } = {},
): Promise<void> {
  const sets = ['status = $3', 'updated_at = now()'];
  const values: unknown[] = [userId, jobId, status];

  if (fields.chunkCount !== undefined) {
    values.push(fields.chunkCount);
    sets.push(`chunk_count = $${values.length}`);
  }
  if (fields.deckId !== undefined) {
    values.push(fields.deckId);
    sets.push(`deck_id = $${values.length}`);
  }
  if (fields.truncated !== undefined) {
    values.push(fields.truncated);
    sets.push(`truncated = $${values.length}`);
  }
  if (fields.error !== undefined) {
    values.push(fields.error);
    sets.push(`error = $${values.length}`);
  }

  await query(
    `update public.jobs set ${sets.join(', ')} where id = $2 and user_id = $1`,
    values,
  );
}

/**
 * Store one chunk's source text, before the fan-out begins.
 *
 * The row is created here and completed later, which is why `status` starts
 * `'pending'` and the result columns start empty. Writing the text before any
 * worker starts is what guarantees a worker never races the splitter for its
 * own input -- true of the in-process runner as much as of Step Functions.
 *
 * `on conflict … do update` rather than `do nothing`: re-splitting a job is a
 * legitimate retry, and it should replace the text rather than silently keep a
 * stale copy.
 */
export async function putChunkText(
  userId: string,
  jobId: string,
  chunkIndex: number,
  text: string,
): Promise<void> {
  await query(
    `insert into public.job_chunks (job_id, user_id, chunk_index, source_text)
     values ($2, $1, $3, $4)
     on conflict (job_id, chunk_index) do update
       set source_text = excluded.source_text,
           updated_at = now()
      where public.job_chunks.user_id = $1`,
    [userId, jobId, chunkIndex, text],
  );
}

/**
 * Read back one chunk's source text.
 *
 * Null rather than a throw when it is missing: a worker whose chunk text has
 * gone is a failed chunk, which the pipeline already knows how to record, not a
 * crash that takes the whole job with it.
 */
export async function getChunkText(
  userId: string,
  jobId: string,
  chunkIndex: number,
): Promise<string | null> {
  const result = await query<{ source_text: string | null }>(
    `select source_text
       from public.job_chunks
      where user_id = $1 and job_id = $2 and chunk_index = $3`,
    [userId, jobId, chunkIndex],
  );
  return result.rows[0]?.source_text ?? null;
}

/**
 * Record one chunk's result, and advance the job's completed counter.
 *
 * ── The increment is atomic, and that is not incidental ───────────────────
 *
 * `chunks_completed = chunks_completed + 1` is evaluated by Postgres under a
 * row lock, so two chunks finishing at the same instant each increment exactly
 * once. Reading the count into JavaScript and writing back `count + 1` would
 * lose increments under precisely the concurrency this exists to serve, and the
 * symptom would be progress that stalls short of its total on the runs with the
 * most parallelism -- the hardest kind to reproduce.
 *
 * The two statements are not wrapped in a transaction, matching the DynamoDB
 * module's deliberate choice: the counter is advanced atomically on its own, so
 * a transaction would buy ordering that nothing here depends on.
 *
 * `source_text` is left alone. The result is written over the input row, and
 * keeping the text means a retry after a partial run still has something to
 * work from.
 */
export async function completeChunk(
  userId: string,
  jobId: string,
  chunkIndex: number,
  result: {
    status: JobStatus;
    cards?: unknown[];
    provider?: string | null;
    topics?: string[];
    error?: string | null;
  },
): Promise<void> {
  await query(
    `insert into public.job_chunks
       (job_id, user_id, chunk_index, status, cards, provider, topics, error, updated_at)
     values ($2, $1, $3, $4, $5::jsonb, $6, $7, $8, now())
     on conflict (job_id, chunk_index) do update
       set status = excluded.status,
           cards = excluded.cards,
           provider = excluded.provider,
           topics = excluded.topics,
           error = excluded.error,
           updated_at = now()
      where public.job_chunks.user_id = $1`,
    [
      userId,
      jobId,
      chunkIndex,
      result.status,
      JSON.stringify(result.cards ?? []),
      result.provider ?? null,
      result.topics ?? [],
      result.error ?? null,
    ],
  );

  await query(
    `update public.jobs
        set chunks_completed = chunks_completed + 1,
            updated_at = now()
      where id = $2 and user_id = $1`,
    [userId, jobId],
  );
}
