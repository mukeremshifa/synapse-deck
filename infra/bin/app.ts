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
import { AuthStack } from '../lib/auth-stack.ts';
import { DataStack } from '../lib/data-stack.ts';
import { ApiStack } from '../lib/api-stack.ts';
import { PipelineStack } from '../lib/pipeline-stack.ts';

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

  // Account comes from CDK_DEFAULT_ACCOUNT at synth time, never hardcoded.
  // Leaving it undefined keeps the stacks environment-agnostic, which is what
  // lets CI synth without credentials.
  const env = { account: config.account, region: REGION };

  // ASCII only in every description below, deliberately. An em dash here
  // round-trips through the Windows console as '?' when cdk diff reads the
  // deployed template back, so every diff reports a phantom description change
  // forever. Cosmetic in the cloud, corrosive in the one guard this project
  // has: a diff that is never empty is a diff nobody reads.
  const foundation = new FoundationStack(app, `SynapseDeck-Foundation-${envName}`, {
    config,
    gitSha,
    env,
    description: `SynapseDeck AWS foundation (${envName}) - see docs/plans/P8-aws-foundation.md`,
  });

  // P9. Separate stacks rather than additions to the foundation, because
  // identity and data have different lifecycles from observability: a mistake
  // in either should not force a redeploy of the alarms that would report it.
  const auth = new AuthStack(app, `SynapseDeck-Auth-${envName}`, {
    config,
    env,
    description: `SynapseDeck Cognito identity (${envName}) - see docs/plans/P9-aws-slice.md`,
  });

  const data = new DataStack(app, `SynapseDeck-Data-${envName}`, {
    config,
    env,
    description: `SynapseDeck RDS Postgres and VPC (${envName}) - see docs/plans/P9-aws-slice.md`,
  });

  /**
   * P10. Ingestion job state, in its own stack because its lifecycle differs
   * from the API's: the table holds live job state, and a redeploy of a handler
   * should never be able to replace it. It is also the one P10 resource that is
   * free at idle, so it can be deployed well before DataStack's RDS instance.
   */
  const pipeline = new PipelineStack(app, `SynapseDeck-Pipeline-${envName}`, {
    config,
    env,
    description: `SynapseDeck ingestion job state (${envName}) - see docs/plans/P10-ingestion.md`,
  });

  /**
   * The API. Depends on both of the above by object reference — same app, same
   * account — which is what lets the JWT authorizer take the user pool directly
   * instead of through a cross-stack export that would pin the two together at
   * the CloudFormation level.
   *
   * `corsOrigin` is per environment and never `*`: `*` with an `Authorization`
   * header lets any page on the internet make authenticated calls with a stolen
   * token. Dev is the Vite dev server; prod is a placeholder until Phase G puts
   * a CloudFront distribution in front of the SPA, and it is a context value so
   * that changing it is not a code edit.
   */
  const corsOrigin =
    (app.node.tryGetContext(`corsOrigin:${envName}`) as string | undefined) ??
    (envName === 'dev' ? 'http://localhost:5173' : 'https://synapsedeck.invalid');

  const api = new ApiStack(app, `SynapseDeck-Api-${envName}`, {
    config,
    vpc: data.vpc,
    database: data.database,
    databaseSecurityGroup: data.databaseSecurityGroup,
    databaseName: data.databaseName,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    jobTable: pipeline.jobTable,
    corsOrigin,
    env,
    description: `SynapseDeck API Gateway and Lambdas (${envName}) - see docs/plans/P9-aws-slice.md`,
  });

  for (const stack of [foundation, auth, data, api, pipeline]) {
    applyTags(stack, config);
  }
}

app.synth();
