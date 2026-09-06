/**
 * Job state, whichever store holds it. The `JOB_STORE` seam. DS1 task 3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE IS THE ONLY PLACE THAT KNOWS WHICH STORE IS RUNNING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two implementations, both maintained, neither legacy:
 *
 *   - `jobs-postgres.ts` — `public.jobs` + `public.job_chunks`. The demo path.
 *   - `jobs-dynamo.ts`   — the single-table design P10 built. The AWS path.
 *
 * Every caller — `handlers/jobs.ts`, `pipeline-split.ts`, `pipeline-generate.ts`,
 * `pipeline-finalise.ts` — imports this module and is unchanged by the choice.
 * That is DEMO-SPRINT-BRIEF §6 stated as code: **the seam is the data-access
 * module boundary, and there is no branching above it.** An
 * `if (process.env.JOB_STORE)` in a handler would mean AWS's return is a hunt
 * through every branch rather than an environment variable.
 *
 * The check that this stays true is mechanical and worth running at every phase
 * boundary:
 *
 *     grep -rn 'JOB_STORE' src/ services/api/src/handlers/     # must be empty
 *
 * ── There is no default, for `resolveProvider()`'s exact reason ───────────
 *
 * `CARD_PROVIDER` refuses to default because defaulting means silently
 * generating fake cards. This refuses because defaulting means silently writing
 * job state where nothing will look for it: a job dispatched to Postgres and
 * polled from DynamoDB is a job that starts, runs, and reports 404 forever. The
 * failure is confusing and remote from its cause, and the fix costs one line in
 * `.env.local`.
 *
 * ── Why the record types come from the DynamoDB module ────────────────────
 *
 * `JobRecord`, `ChunkRecord` and `JobStatus` are declared in `jobs-dynamo.ts`
 * and re-exported here, rather than being lifted into a third file. Lifting
 * them would be tidier and would also be the moment the two stores stop being
 * *the same interface* and start being two interfaces that resemble each other.
 * Keeping the declaration in the older implementation means the Postgres one is
 * written against a shape it cannot quietly widen — a field it needs that
 * DynamoDB cannot express is a design conversation, not a silent divergence.
 */

import * as dynamo from './jobs-dynamo.ts';
import * as postgres from './jobs-postgres.ts';

export type { ChunkRecord, JobRecord, JobStatus } from './jobs-dynamo.ts';

const STORE_NAMES = ['postgres', 'dynamo'] as const;
type StoreName = (typeof STORE_NAMES)[number];

/**
 * The two implementations, structurally required to match.
 *
 * Typing this as `Record<StoreName, typeof dynamo>` is what makes the seam a
 * compile-time guarantee rather than a convention: a function added to one
 * store and forgotten in the other does not typecheck, and a signature that
 * drifts does not typecheck either. Without this the two files would be free to
 * diverge until the first runtime call after a `JOB_STORE` change.
 */
const STORES: Record<StoreName, typeof dynamo> = {
  dynamo,
  postgres,
};

function isStoreName(value: string): value is StoreName {
  return (STORE_NAMES as readonly string[]).includes(value);
}

let cached: typeof dynamo | undefined;

function store(): typeof dynamo {
  if (cached !== undefined) return cached;

  const configured = process.env['JOB_STORE'];

  if (configured === undefined || configured === '') {
    throw new Error(
      'JOB_STORE is not set. It must name a store explicitly — there is no ' +
        'default, because defaulting would mean writing job state where nothing ' +
        `will look for it. One of: ${STORE_NAMES.join(', ')}.`,
    );
  }

  if (!isStoreName(configured)) {
    throw new Error(
      `JOB_STORE is "${configured}", which is not a store. ` +
        `One of: ${STORE_NAMES.join(', ')}.`,
    );
  }

  cached = STORES[configured];
  return cached;
}

/**
 * Forget the resolved store, so a changed environment variable takes effect.
 *
 * Exempted from the userId-first rule below, and it is worth being precise
 * about why the exemption is safe: this function reaches no data at all. It
 * clears a module-scope variable holding which *module* to call. There is no
 * row it could return, no query it could forget a filter on, and therefore no
 * tenancy decision for `userId` to make. The rule exists so that a function
 * which touches user data cannot be called without naming whose it is; this
 * touches none.
 */
// data-access-lint-disable-next-line Clears a cached module reference, reads no data, so there is no tenant to scope it to.
export function resetJobStoreCache(): void {
  cached = undefined;
}

/*
 * The eight operations, each forwarding to the resolved store.
 *
 * Written out rather than generated, because `userId` must be a named first
 * parameter for `scripts/check-data-access.mjs` to see it — a spread-args proxy
 * would pass the lint by having no parameters at all to check, which is the
 * lint being satisfied rather than the rule being followed.
 *
 * The store is resolved per call rather than at module load. That costs a map
 * lookup and buys the thing that matters in a long-running process: the first
 * call, not the first import, is what fails when the variable is missing — so
 * the error arrives with a request to attach it to.
 */

export function createJob(
  userId: string,
  jobId: string,
  deckId: string | null,
): Promise<import('./jobs-dynamo.ts').JobRecord> {
  return store().createJob(userId, jobId, deckId);
}

export function getJob(
  userId: string,
  jobId: string,
): Promise<import('./jobs-dynamo.ts').JobRecord | null> {
  return store().getJob(userId, jobId);
}

export function getJobWithChunks(
  userId: string,
  jobId: string,
): Promise<{
  job: import('./jobs-dynamo.ts').JobRecord | null;
  chunks: import('./jobs-dynamo.ts').ChunkRecord[];
}> {
  return store().getJobWithChunks(userId, jobId);
}

export function findJobForDeck(
  userId: string,
  deckId: string,
): Promise<import('./jobs-dynamo.ts').JobRecord | null> {
  return store().findJobForDeck(userId, deckId);
}

export function updateJobStatus(
  userId: string,
  jobId: string,
  status: import('./jobs-dynamo.ts').JobStatus,
  fields: {
    chunkCount?: number;
    deckId?: string | null;
    error?: string | null;
    truncated?: boolean;
  } = {},
): Promise<void> {
  return store().updateJobStatus(userId, jobId, status, fields);
}

export function putChunkText(
  userId: string,
  jobId: string,
  chunkIndex: number,
  text: string,
): Promise<void> {
  return store().putChunkText(userId, jobId, chunkIndex, text);
}

export function getChunkText(
  userId: string,
  jobId: string,
  chunkIndex: number,
): Promise<string | null> {
  return store().getChunkText(userId, jobId, chunkIndex);
}

export function completeChunk(
  userId: string,
  jobId: string,
  chunkIndex: number,
  result: {
    status: import('./jobs-dynamo.ts').JobStatus;
    cards?: unknown[];
    provider?: string | null;
    topics?: string[];
    error?: string | null;
  },
): Promise<void> {
  return store().completeChunk(userId, jobId, chunkIndex, result);
}
