/**
 * CDK app entrypoint. Two stacks, dev and prod.
 *
 * Run via cdk.json: `node --experimental-strip-types bin/app.ts`. See the header
 * of lib/config.ts for why nothing in this directory may declare a TypeScript
 * `enum`.
 */

import { App } from 'aws-cdk-lib';
import { configFor, REGION, type EnvName } from '../lib/config.ts';
import { applyTags } from '../lib/tags.ts';
import { FoundationStack } from '../lib/foundation-stack.ts';

const app = new App();

/**
 * The alert address is read from context (-c alertEmail=…) or the environment,
 * and is deliberately not committed: a personal address in a public repo is a
 * spam magnet, and this repo is a public portfolio piece.
 *
 * Absent, the stack still synths — which is what lets CI run synth with no
 * credentials and no secrets — but it creates no email subscription and no
 * budgets, because a budget nobody is notified about is decoration. The synth
 * warns rather than failing, so `cdk synth` stays a useful offline check.
 */
const alertEmail =
  (app.node.tryGetContext('alertEmail') as string | undefined) ?? process.env['ALERT_EMAIL'];

if (alertEmail === undefined) {
  console.warn(
    '⚠ No alertEmail: synthesising without budgets or alarm delivery.\n' +
      '  For a real deploy: cdk deploy -c alertEmail=you@example.com',
  );
}

/**
 * The git SHA of the commit being deployed — the entire payload of the version
 * endpoint, and the thing that makes the deployment path falsifiable. CI passes
 * it explicitly; a local deploy falls back to 'local'.
 */
const gitSha =
  (app.node.tryGetContext('gitSha') as string | undefined) ??
  process.env['GITHUB_SHA'] ??
  'local';

for (const envName of ['dev', 'prod'] as const satisfies readonly EnvName[]) {
  const config = configFor(envName, alertEmail);

  const stack = new FoundationStack(app, `SynapseDeck-Foundation-${envName}`, {
    config,
    gitSha,
    // Account comes from CDK_DEFAULT_ACCOUNT at synth time, never hardcoded.
    // Leaving it undefined keeps the stack environment-agnostic, which is what
    // lets CI synth without credentials.
    env: { account: config.account, region: REGION },
    description: `SynapseDeck AWS foundation (${envName}) — see docs/plans/P8-aws-foundation.md`,
  });

  applyTags(stack, config);
}

app.synth();
