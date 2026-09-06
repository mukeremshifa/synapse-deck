/**
 * Ingestion job state, in DynamoDB. P10 task 2.
 *
 * The only module in this directory that does not talk to Postgres, and it lives
 * here for exactly that reason: ADR 0008's four rules are about *where the
 * tenancy boundary is enforced*, not about which engine enforces it. A DynamoDB
 * call in a handler is as wrong as SQL in one, so it belongs behind the same
 * door — and `scripts/check-data-access.mjs` was extended in the same commit to
 * say so mechanically rather than by convention.
 *
 * ── The key, and why the boundary here is stronger than the SQL side ──────
 *
 * `userId` is the **partition key**, so the owner is the address of the data
 * rather than a filter over it. On the Postgres tables, a statement missing
 * `where user_id = $1` returns every user's rows — that is ADR 0008's admitted
 * weakness, and only discipline and a lint stand behind it. Here there is no
 * equivalent forgetting: a `Query` or `GetItem` must name a partition, and the
 * only partition this module ever names is the caller's own.
 *
 * The sort key `sk` is compound, `job#<jobId>` for the job summary and
 * `job#<jobId>#chunk#<n>` for each chunk. One `Query` with `begins_with(sk,
 * 'job#<jobId>')` therefore reads a whole job — summary and chunks together —
 * in a single request, which is the entire reason for the single-table design.
 *
 * The chunk index is **zero-padded** (`chunk#0007`). DynamoDB sorts sort keys
 * lexicographically, not numerically, so unpadded `chunk#10` sorts before
 * `chunk#2` and the chunks come back shuffled. Six digits is far past any
 * document this pipeline will accept.
 *
 * ── Reads are strongly consistent, deliberately ───────────────────────────
 *
 * DynamoDB defaults to eventually consistent reads, which are half the price.
 * This table takes the more expensive option because the read pattern is a
 * progress poll immediately following a write: the Step Functions fan-out marks
 * a chunk done and the user's next `/progress` call must see it. An eventually
 * consistent read can legitimately return the prior state, which presents as
 * progress that stalls and then jumps — a bug that would be blamed on the
 * pipeline rather than on the read. The cost difference on a table this size is
 * immaterial; the confusion would not be.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * How long a job's records survive after they are written.
 *
 * Seven days. Long enough that a user who starts an import, closes the laptop
 * and comes back after a weekend still sees what happened; short enough that
 * this table never becomes the second database the header warns about. The
 * cards themselves are in Postgres from the moment they are accepted, so
 * nothing durable is lost when a job record expires.
 */
const JOB_TTL_DAYS = 7;

/** The document client, created once per container rather than per call. */
let documentClient: DynamoDBDocumentClient | undefined;

function client(): DynamoDBDocumentClient {
  if (documentClient === undefined) {
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: {
        // An attribute set to `undefined` is dropped rather than rejected. This
        // is what lets an optional field be passed as `undefined` without every
        // caller composing the object conditionally.
        removeUndefinedValues: true,
      },
    });
  }
  return documentClient;
}

function tableName(): string {
  const name = process.env['JOB_TABLE_NAME'];
  if (name === undefined || name === '') {
    // Failing loudly at the first call beats a cryptic SDK error about a
    // missing table name several frames deeper.
    throw new Error(
      'JOB_TABLE_NAME is not set. It is wired by infra/lib/api-stack.ts from ' +
        'PipelineStack.jobTable; dev-api.mjs sets it from .env.local.',
    );
  }
  return name;
}

/**
 * The TTL value: Unix **seconds**, not milliseconds.
 *
 * Computed here and nowhere else, because the milliseconds version of this bug
 * is silent — DynamoDB treats a millisecond timestamp as a date ~50,000 years
 * out, so nothing ever expires and the table grows exactly as it would with no
 * TTL configured at all. There is no error and no symptom until a bill.
 */
function expiresAt(): number {
  return Math.floor(Date.now() / 1000) + JOB_TTL_DAYS * 24 * 60 * 60;
}

/** Zero-padded so lexicographic sort order matches numeric order. */
function chunkSortKey(jobId: string, index: number): string {
  return `job#${jobId}#chunk#${String(index).padStart(6, '0')}`;
}

function jobSortKey(jobId: string): string {
  return `job#${jobId}`;
}

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  userId: string;
  sk: string;
  jobId: string;
  status: JobStatus;
  /** How many chunks the document was split into. Zero until splitting is done. */
  chunkCount: number;
  /** How many chunks have finished generating, successfully or not. */
  chunksCompleted: number;
  /** The deck these cards will land in once accepted at the review gate. */
  deckId: string | null;
  /** Set only when `status` is `'failed'`. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

export interface ChunkRecord {
  userId: string;
  sk: string;
  jobId: string;
  chunkIndex: number;
  status: JobStatus;
  /** The draft cards this chunk produced, unvalidated LLM output. */
  cards: unknown[];
  error: string | null;
  updatedAt: string;
  expiresAt: number;
}

/**
 * Create the job summary record.
 *
 * `PutCommand` with a condition that the item does not already exist, so a
 * retried invocation cannot silently reset a running job's counters back to
 * zero. Step Functions retries are the normal case, not the exceptional one.
 */
export async function createJob(
  userId: string,
  jobId: string,
  deckId: string | null,
): Promise<JobRecord> {
  const now = new Date().toISOString();
  const record: JobRecord = {
    userId,
    sk: jobSortKey(jobId),
    jobId,
    status: 'pending',
    chunkCount: 0,
    chunksCompleted: 0,
    deckId,
    error: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiresAt(),
  };

  await client().send(
    new PutCommand({
      TableName: tableName(),
      Item: record,
      ConditionExpression: 'attribute_not_exists(sk)',
    }),
  );

  return record;
}

/**
 * The job summary, or null.
 *
 * `userId` is the partition key, so a job id belonging to another user is not
 * found here rather than filtered out afterwards — the read never reaches that
 * partition. A handler turns the null into a 404, never a 403, matching the
 * behaviour P9 established for every other resource: a 403 would confirm the
 * job exists.
 */
export async function getJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const result = await client().send(
    new GetCommand({
      TableName: tableName(),
      Key: { userId, sk: jobSortKey(jobId) },
      ConsistentRead: true,
    }),
  );
  return (result.Item as JobRecord | undefined) ?? null;
}

/**
 * Every record for one job — the summary and all of its chunks — in one read.
 *
 * This is what the compound sort key buys, and it is why `/progress` costs a
 * single request rather than one per chunk.
 */
export async function getJobWithChunks(
  userId: string,
  jobId: string,
): Promise<{ job: JobRecord | null; chunks: ChunkRecord[] }> {
  const result = await client().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'userId = :userId and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':prefix': jobSortKey(jobId),
      },
      ConsistentRead: true,
    }),
  );

  const items = (result.Items ?? []) as Array<JobRecord | ChunkRecord>;
  const summarySk = jobSortKey(jobId);

  let job: JobRecord | null = null;
  const chunks: ChunkRecord[] = [];

  for (const item of items) {
    if (item.sk === summarySk) {
      job = item as JobRecord;
    } else {
      chunks.push(item as ChunkRecord);
    }
  }

  // The zero-padded sort key already returns these in order; sorting again is
  // cheap insurance against a future key format change reordering them silently.
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return { job, chunks };
}

/**
 * Move a job to a new status, and optionally record how many chunks it has.
 *
 * The condition expression is the important part: the update applies only to an
 * item that already exists **in this user's partition**. Without it, DynamoDB's
 * `UpdateItem` would create the item — so an update naming a job id that does
 * not belong to the caller would write a brand-new record into their own
 * partition rather than failing. That is not a cross-tenant leak, but it is a
 * silent no-op masquerading as success, and the condition turns it into an
 * error the handler can map.
 */
export async function updateJobStatus(
  userId: string,
  jobId: string,
  status: JobStatus,
  fields: { chunkCount?: number; deckId?: string | null; error?: string | null } = {},
): Promise<void> {
  const sets = ['#status = :status', 'updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (fields.chunkCount !== undefined) {
    sets.push('chunkCount = :chunkCount');
    values[':chunkCount'] = fields.chunkCount;
  }
  if (fields.deckId !== undefined) {
    sets.push('deckId = :deckId');
    values[':deckId'] = fields.deckId;
  }
  if (fields.error !== undefined) {
    sets.push('#error = :error');
    names['#error'] = 'error';
    values[':error'] = fields.error;
  }

  await client().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { userId, sk: jobSortKey(jobId) },
      UpdateExpression: `set ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(sk)',
    }),
  );
}

/**
 * Record one chunk's result, and advance the job's completed counter.
 *
 * Two writes rather than one transaction, and that is a deliberate trade. A
 * `TransactWriteItems` would make the pair atomic at twice the write cost; what
 * it would buy is not worth it here, because the counter is advanced with an
 * atomic `ADD` rather than a read-modify-write. Two concurrent chunk completions
 * therefore cannot lose an increment — which is the failure this would otherwise
 * need a transaction to prevent.
 */
export async function completeChunk(
  userId: string,
  jobId: string,
  chunkIndex: number,
  result: { status: JobStatus; cards?: unknown[]; error?: string | null },
): Promise<void> {
  const record: ChunkRecord = {
    userId,
    sk: chunkSortKey(jobId, chunkIndex),
    jobId,
    chunkIndex,
    status: result.status,
    cards: result.cards ?? [],
    error: result.error ?? null,
    updatedAt: new Date().toISOString(),
    expiresAt: expiresAt(),
  };

  await client().send(
    new PutCommand({
      TableName: tableName(),
      Item: record,
    }),
  );

  // `ADD` is atomic server-side, so parallel chunk completions each increment
  // exactly once. A read-then-write would drop increments under the fan-out
  // this table exists to serve.
  await client().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { userId, sk: jobSortKey(jobId) },
      UpdateExpression: 'add chunksCompleted :one set updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':one': 1,
        ':updatedAt': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(sk)',
    }),
  );
}
