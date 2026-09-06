/**
 * Starting the ingestion state machine. P10 task 5.
 *
 * In `data/` for the same reason as `jobs.ts` and `uploads.ts`: it is a call to
 * an external system on behalf of one user, and `userId` is what scopes it.
 * ADR 0008's rule 3 keeps those out of handlers regardless of which service is
 * being called — a `SFNClient.send(...)` in a handler is as wrong as a SELECT,
 * and `scripts/check-data-access.mjs` catches it either way.
 */

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

let sfnClient: SFNClient | undefined;

function client(): SFNClient {
  sfnClient ??= new SFNClient({});
  return sfnClient;
}

function stateMachineArn(): string {
  const arn = process.env['INGESTION_STATE_MACHINE_ARN'];
  if (arn === undefined || arn === '') {
    throw new Error(
      'INGESTION_STATE_MACHINE_ARN is not set. It is wired by ' +
        'infra/lib/api-stack.ts from PipelineStack.stateMachine.',
    );
  }
  return arn;
}

export interface IngestionInput {
  jobId: string;
  text: string;
  cardCount: number;
  kinds: readonly string[];
  depth: string;
}

/**
 * Begin an execution for one job.
 *
 * The `name` is the job id, which makes the call **idempotent**: Step Functions
 * rejects a duplicate execution name within its retention window, so a client
 * that retries `POST /jobs` cannot start the same document generating twice and
 * pay for it twice. That is a cost control as much as a correctness one.
 *
 * `userId` is passed into the execution rather than inferred anywhere later --
 * every Lambda in the machine receives it and passes it to the data layer, so
 * the boundary is carried explicitly from the verified JWT all the way through.
 */
export async function startIngestion(
  userId: string,
  input: IngestionInput,
): Promise<void> {
  await client().send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn(),
      name: input.jobId,
      input: JSON.stringify({
        userId,
        jobId: input.jobId,
        text: input.text,
        cardCount: input.cardCount,
        kinds: input.kinds,
        depth: input.depth,
      }),
    }),
  );
}
