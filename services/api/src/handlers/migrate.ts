/**
 * The migration runner, invoked inside the VPC.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * The RDS instance sits in a private isolated subnet with no public route
 * (`infra/lib/data-stack.ts`), so `npm run db:migrate` cannot reach it from a
 * laptop without a tunnel. P9 task 3 recorded that as open and handed it to
 * task 7, on the grounds that this is the session that first puts compute
 * inside the VPC. This is that compute.
 *
 * ── What it does not do ───────────────────────────────────────────────────
 *
 * **It does not reimplement the runner.** `services/api/migrations/run.mjs` is
 * copied into the deployment asset whole and spawned as a child process, so
 * what runs here is the same ~200 lines that run against a tunnel: the same
 * advisory lock, the same one-transaction-per-file, the same checksum ledger
 * that makes "never edit an applied migration" enforced rather than merely
 * stated. A second implementation of migration ordering is the one thing worse
 * than having none.
 *
 * **It is not wired to a CDK custom resource.** Applying a migration is a
 * decision, not a side effect of `cdk deploy`. It is invoked by hand:
 *
 *     aws lambda invoke --function-name synapsedeck-dev-migrate \
 *       --payload '{"statusOnly":true}' --cli-binary-format raw-in-base64-out out.json
 *
 * Run it with `statusOnly` first, every time — it is this environment's
 * equivalent of `supabase db push --dry-run`, and CLAUDE.md requires that step
 * before every push against a database that nothing else checks.
 *
 * ── This is a sharp tool ──────────────────────────────────────────────────
 *
 * There is no test suite (ADR 0005) and the PGlite harness that used to run
 * every migration before it reached a live database was deleted with it. The
 * SQL in `services/api/migrations/` has never been executed anywhere. Read it
 * before invoking this, and expect the first real run to be a debugging
 * session rather than a formality.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The copied-in runner, beside the bundled handler. See api-stack.ts. */
const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'migrations', 'run.mjs');

export interface MigrateEvent {
  /** List what is pending and exit without applying anything. */
  statusOnly?: boolean;
}

export interface MigrateResult {
  ok: boolean;
  exitCode: number;
  /** The runner's own output, verbatim — this is what the operator reads. */
  output: string;
}

export async function handler(event: MigrateEvent = {}): Promise<MigrateResult> {
  const args = [RUNNER];
  if (event.statusOnly === true) args.push('--status');

  return new Promise<MigrateResult>(resolve => {
    // `process.execPath` is the Lambda runtime's own Node, so the runner gets
    // the same version the handler is running under rather than whatever a
    // shell would resolve.
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    // stdout and stderr are interleaved into one string on purpose. The runner
    // prints its per-file progress to stdout and its failure to stderr, and
    // reading "which migration was being applied when it failed" means seeing
    // both in order.
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', error => {
      resolve({ ok: false, exitCode: -1, output: `${output}\nFailed to start: ${error.message}` });
    });

    child.on('close', code => {
      const exitCode = code ?? 1;
      // Logged as well as returned: the invoke response is easy to lose, and
      // the log group has P8's retention on it.
      console.log(output);
      resolve({ ok: exitCode === 0, exitCode, output });
    });
  });
}
