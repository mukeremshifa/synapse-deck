/**
 * Starting an ingestion run, whichever runner performs it. The
 * `PIPELINE_RUNNER` seam. DS1 task 5.
 *
 * The smallest of the three seams the demo sprint introduced, because
 * `startIngestion` is the *entire* interface — one function, one caller
 * (`handlers/jobs.ts`). That is what DEMO-SPRINT-BRIEF §3 meant by "replacing
 * them is implementing three interfaces that already have exactly one caller
 * each", and this is the file where that claim is cashed.
 *
 * Two implementations, both maintained:
 *
 *   - `pipeline-local.ts` — a bounded in-process loop. The demo path.
 *   - `pipeline-sfn.ts`   — the Step Functions execution P10 built. The AWS path.
 *
 * Both call the same three handlers, which is what keeps them the same
 * pipeline rather than two that resemble each other. See `pipeline-local.ts`
 * for what the local runner gives up: durability across a crash, and a retry
 * policy that is code rather than configuration.
 *
 * No default, for the reason `jobs.ts` and `providers/index.ts` both give: a
 * runner chosen by accident is a document that appears to be generating and is
 * not. Here it would be especially quiet — `startIngestion` returns void, so a
 * wrong choice produces no error at the call site at all.
 *
 *     grep -rn 'PIPELINE_RUNNER' src/ services/api/src/handlers/   # must be empty
 */

import * as local from './pipeline-local.ts';
import * as sfn from './pipeline-sfn.ts';

export type { IngestionInput } from './pipeline-sfn.ts';

const RUNNER_NAMES = ['local', 'sfn'] as const;
type RunnerName = (typeof RUNNER_NAMES)[number];

/**
 * Typed so the two implementations must match structurally — a signature that
 * drifts does not compile. See `jobs.ts` for the longer version of this
 * argument; it is the same one.
 */
const RUNNERS: Record<RunnerName, typeof sfn> = {
  local,
  sfn,
};

function isRunnerName(value: string): value is RunnerName {
  return (RUNNER_NAMES as readonly string[]).includes(value);
}

let cached: typeof sfn | undefined;

function runner(): typeof sfn {
  if (cached !== undefined) return cached;

  const configured = process.env['PIPELINE_RUNNER'];

  if (configured === undefined || configured === '') {
    throw new Error(
      'PIPELINE_RUNNER is not set. It must name a runner explicitly — there is ' +
        'no default, because a document dispatched to the wrong runner appears ' +
        `to be generating and never is. One of: ${RUNNER_NAMES.join(', ')}.`,
    );
  }

  if (!isRunnerName(configured)) {
    throw new Error(
      `PIPELINE_RUNNER is "${configured}", which is not a runner. ` +
        `One of: ${RUNNER_NAMES.join(', ')}.`,
    );
  }

  cached = RUNNERS[configured];
  return cached;
}

/** Forget the resolved runner, so a changed environment variable takes effect. */
// data-access-lint-disable-next-line Clears a cached module reference, reads no data, so there is no tenant to scope it to.
export function resetPipelineRunnerCache(): void {
  cached = undefined;
}

/**
 * Begin an ingestion run for one job.
 *
 * `userId` is passed into the run rather than inferred anywhere later — every
 * step receives it and hands it to the data layer, so the boundary is carried
 * explicitly from the verified JWT all the way through. That was true of the
 * Step Functions execution input and it is true of the local runner's
 * arguments; it is the property that must not change when the seam flips.
 */
export function startIngestion(
  userId: string,
  input: import('./pipeline-sfn.ts').IngestionInput,
): Promise<void> {
  return runner().startIngestion(userId, input);
}
