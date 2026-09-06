/**
 * The fan-out, in this process. DS1 task 5, DEMO-SPRINT-BRIEF D5.
 *
 * What Step Functions did declaratively, done as a bounded loop: split the
 * document, generate each chunk with a small concurrency limit, finalise.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT CALLS THE SAME THREE HANDLERS THE STATE MACHINE CALLS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pipeline-split`, `pipeline-generate`, `pipeline-finalise` — unmodified, in
 * that order. This module is a *scheduler*, not a second pipeline. That is what
 * keeps the two runners honest about being the same thing: a bug fixed in a
 * handler is fixed for both, and neither runner can quietly grow behaviour the
 * other lacks. Reimplementing the steps here would have been easier to write
 * and would have made `PIPELINE_RUNNER=sfn` a claim nobody could check.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS LOST RELATIVE TO STEP FUNCTIONS. SAY THIS OUT LOUD.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two things, both real, and the brief requires them stated rather than
 * discovered during a demo:
 *
 * 1. **Durability across a crash.** Step Functions held the execution state
 *    outside the worker, so a Lambda dying mid-chunk cost that chunk and
 *    nothing more. Here the loop lives in one Node process. If it exits —
 *    a crash, a redeploy, someone pressing Ctrl-C — every chunk still queued
 *    simply never runs, and the job is left `running` with no one to advance
 *    it. `data/jobs-postgres.ts` sweeps those to `failed` on read, using the
 *    staleness threshold `lib/quota.ts` already defines, so the user gets an
 *    explanation instead of a spinner. **That is a mitigation, not a
 *    replacement**: the work is still lost.
 *
 * 2. **Retry as configuration.** `pipeline-stack.ts` declared the retry policy
 *    where anyone could read it. Here it is the code below, and it is only as
 *    correct as this file — which is why the retryable/non-retryable
 *    distinction is honoured explicitly rather than by catching everything.
 *
 * Neither is a reason to prefer Step Functions for a demo. Both are reasons the
 * AWS implementation stays in the repository rather than being deleted.
 */

import { handler as finalise } from '../handlers/pipeline-finalise.ts';
import { handler as generate } from '../handlers/pipeline-generate.ts';
import { handler as split } from '../handlers/pipeline-split.ts';
import { completeChunk, updateJobStatus } from './jobs.ts';
import { ProviderRetryableError } from '../lib/providers/index.ts';
import type { IngestionInput } from './pipeline-sfn.ts';

/**
 * How many chunks are generated at once.
 *
 * **Two, and the number was measured rather than chosen.** DS1 started at three
 * and lost two chunks of four to 429s on the first multi-chunk run. The reason
 * is that Groq's free tier limits **tokens per minute** — 8,000 on this account
 * — and one chunk costs roughly 1,000 in and 800 out. Three in flight plus
 * retries clears that budget in seconds.
 *
 * So the bound exists twice over, as a rate limit and as a bill, and it is set
 * by someone else's quota rather than by what this machine could manage.
 * `MAX_CHUNKS_PER_JOB = 40` bounds the total; this bounds the rate.
 *
 * Configurable because the right value is a property of the account's tier, not
 * of this code: a paid tier can raise it without a commit, and Bedrock's limits
 * will be different again. Raising it is a decision about someone else's rate
 * limit, not a local optimisation.
 */
const CONCURRENCY = Number(process.env['PIPELINE_CONCURRENCY'] ?? 2);

/**
 * How many times a *retryable* failure is retried, beyond the first attempt.
 *
 * Two. A rate limit or a 5xx usually clears within a second or two, and a
 * failure that survives three attempts is not transient whatever it claimed to
 * be. The brief's §6 names an unbounded retry loop against a model as a way to
 * produce a surprise bill; this is what bounding it looks like.
 */
const MAX_RETRIES = 2;

/** Exponential, from 500 ms. Short, because these are seconds-scale failures. */
const RETRY_BASE_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate one chunk, retrying only what is worth retrying.
 *
 * The distinction is `pipeline-generate.ts`'s, and this is the code that honours
 * it: that handler **throws** `ProviderRetryableError` for a transient provider
 * failure and **returns a failed result** for everything a retry cannot fix. So
 * a throw that is not retryable propagates and ends the chunk, a throw that is
 * gets another attempt, and a returned failure is already recorded on the chunk
 * row and is simply passed back.
 *
 * A chunk exhausting its retries is not an error for the job: partial failure
 * is a normal outcome here (P10 task 6), and `pipeline-finalise` decides what a
 * job with some failed chunks means.
 */
async function generateWithRetry(input: {
  userId: string;
  jobId: string;
  chunkIndex: number;
  cardCount: number;
  kinds: string[];
  depth: string;
}): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await generate(input);
      return;
    } catch (error) {
      const retryable = error instanceof ProviderRetryableError;

      if (!retryable || attempt === MAX_RETRIES) {
        // Out of attempts, or never worth retrying. The handler records a
        // failed chunk itself for everything it catches; this path is the one
        // where it threw, so the chunk has *not* been recorded and would
        // otherwise stay `pending` forever — leaving the job's completed
        // counter short of its total and the progress bar stuck just below the
        // end. Recording it here is what makes the job finishable.
        //
        // Imported through `./jobs.ts`, so this respects the JOB_STORE seam
        // exactly as every other write does.
        await recordChunkFailure(
          input.userId,
          input.jobId,
          input.chunkIndex,
          error instanceof Error ? error.message : 'This section could not be written.',
        );
        return;
      }

      /*
       * The provider's own answer wins when it gave one.
       *
       * A `retry-after` is the server saying when it will next accept work;
       * exponential backoff is us guessing. Guessing is only right when there
       * is nothing to ask, which is why the fallback is still here.
       */
      await sleep(error.retryAfterMs ?? RETRY_BASE_MS * 2 ** attempt);
    }
  }
}

/**
 * Mark one chunk failed after its retries are gone.
 *
 * Split out rather than inlined because it is the one write in this module that
 * exists purely to keep the counters honest, and it is easy to read past.
 */
function recordChunkFailure(
  userId: string,
  jobId: string,
  chunkIndex: number,
  message: string,
): Promise<void> {
  return completeChunk(userId, jobId, chunkIndex, { status: 'failed', error: message });
}

/**
 * Run every chunk, at most `CONCURRENCY` at a time.
 *
 * A pool of workers pulling from a shared cursor rather than
 * `Promise.all(chunks.map(...))` with a semaphore: the cursor cannot start work
 * it has not been asked for, and a worker that finishes early picks up the next
 * chunk immediately instead of waiting for its batch. Batching would make the
 * whole run as slow as the slowest chunk in each batch, which on a model call
 * is a wide distribution.
 */
async function runChunks(
  chunks: Array<{ userId: string; jobId: string; chunkIndex: number }>,
  perChunk: { cardCount: number; kinds: string[]; depth: string },
): Promise<void> {
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const chunk = chunks[index];
      if (chunk === undefined) return;

      await generateWithRetry({ ...chunk, ...perChunk });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()),
  );
}

/**
 * Begin an ingestion run, and return immediately.
 *
 * ── The return is deliberately not the end of the work ────────────────────
 *
 * `POST /jobs` answers 202 with a job id and the client polls; awaiting the
 * whole run here would hold that request open for the length of a forty-chunk
 * document and time out behind any proxy. So the run is started and detached,
 * which is what Step Functions' `StartExecution` also did — the signature is
 * unchanged for that reason.
 *
 * **A detached run must never be able to reject silently.** An unhandled
 * rejection here is a job stuck `running` forever with no explanation and, in
 * some Node configurations, a process that exits. Hence the `catch` that writes
 * the failure to the job record: whatever goes wrong, the user's next poll
 * tells them something true.
 */
export function startIngestion(userId: string, input: IngestionInput): Promise<void> {
  void run(userId, input).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ level: 'error', msg: 'ingestion run failed', jobId: input.jobId, error: message }),
    );
    try {
      await updateJobStatus(userId, input.jobId, 'failed', {
        error: 'This run stopped before it finished. Nothing else will arrive.',
      });
    } catch (writeError) {
      // The job record itself is unreachable. Nothing further can be said to
      // the user from here; the stale sweep on read is what eventually closes
      // the job out. Logged rather than rethrown, because rethrowing inside a
      // detached catch is the unhandled rejection this block exists to prevent.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'could not record ingestion failure',
          jobId: input.jobId,
          error: writeError instanceof Error ? writeError.message : String(writeError),
        }),
      );
    }
  });

  return Promise.resolve();
}

/** Split, generate, finalise — the state machine's three states, in order. */
async function run(userId: string, input: IngestionInput): Promise<void> {
  const splitResult = await split({
    userId,
    jobId: input.jobId,
    text: input.text,
    cardCount: input.cardCount,
    kinds: [...input.kinds],
    depth: input.depth,
  });

  // An empty document. `pipeline-split` has already marked the job failed with
  // a message the user can act on, so finalising would overwrite that with a
  // less specific one.
  if (splitResult.chunks.length === 0) return;

  await runChunks(splitResult.chunks, {
    cardCount: input.cardCount,
    kinds: [...input.kinds],
    depth: input.depth,
  });

  await finalise({ userId, jobId: input.jobId });
}
