/**
 * The foundation stack: one trivial deployed thing, wrapped in everything every
 * later phase inherits.
 *
 * The Lambda here is not the point. The point is that the deployment path is
 * falsifiable while the thing being deployed is trivial enough that a failure is
 * unambiguous — every later phase gets to debug its own logic rather than its
 * pipeline. A version endpoint that answers with the SHA you just pushed proves
 * synth, assume-role, deploy and invoke in one curl, and it stays useful for the
 * rest of the project as the answer to "which build is actually live".
 *
 * Observability is here rather than in a later phase because D9 is explicit that
 * it cannot be retrofitted honestly: a dashboard added after the first incident
 * is a worse artifact than one the first deploy had, and a budget added after a
 * surprise bill is not a budget.
 *
 * ── No VPC, deliberately ──────────────────────────────────────────────────
 *
 * A VPC without a NAT Gateway needs interface endpoints, and endpoint selection
 * is a Phase A decision made against real data paths rather than guessed at
 * here. AWS-NATIVE-BRIEF.md §6 trap 1 is a ~$32/mo NAT Gateway; the way to not
 * pay it is to not create the VPC until something needs one.
 */

import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, Metric, Stats, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Architecture, Code, Function as LambdaFunction, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.ts';

export interface FoundationStackProps extends StackProps {
  readonly config: EnvConfig;
  /** Git SHA of the commit being deployed. The whole point of the endpoint. */
  readonly gitSha: string;
}

export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { config, gitSha } = props;

    // ── Alerting ────────────────────────────────────────────────────────────
    // Everything that alarms points here. One topic, because at this size a
    // second one is a routing decision with nothing to route.
    const alertTopic = new Topic(this, 'AlertTopic', {
      displayName: `synapsedeck-${config.envName}-alerts`,
    });

    // An unconfirmed subscription fails silently, which is the worst possible
    // property for an alerting system — AWS emails a confirmation link and until
    // someone clicks it, every alarm below fires into nothing. Acceptance
    // criterion 7 exists to catch exactly this.
    if (config.alertEmail !== undefined) {
      alertTopic.addSubscription(new EmailSubscription(config.alertEmail));
    }

    // ── The version endpoint ────────────────────────────────────────────────

    // Constructed explicitly rather than letting Lambda create its own. A log
    // group Lambda creates defaults to never-expire, and that default is D9's
    // third trap: it looks fine in code and costs money quietly.
    const logGroup = new LogGroup(this, 'VersionFnLogs', {
      logGroupName: `/aws/lambda/synapsedeck-${config.envName}-version`,
      retention: config.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // D9 asks for a DLQ with "a deliberate story for what lands in it". For a
    // version endpoint the honest story is that nothing ever should — which is
    // precisely what makes an alarm on it meaningful rather than noise. Phase B
    // inherits the convention; its pipeline DLQ will have a real story.
    const deadLetterQueue = new Queue(this, 'VersionFnDlq', {
      queueName: `synapsedeck-${config.envName}-version-dlq`,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    const versionFn = new LambdaFunction(this, 'VersionFn', {
      functionName: `synapsedeck-${config.envName}-version`,
      runtime: Runtime.NODEJS_22_X,
      // Graviton: cheaper per ms, and the default worth establishing before
      // there is a fleet of functions to convert.
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      memorySize: 128,
      tracing: Tracing.ACTIVE, // D9, X-Ray
      logGroup,
      deadLetterQueue,
      environment: {
        GIT_SHA: gitSha,
        ENV_NAME: config.envName,
        CDK_VERSION: process.env['npm_package_devDependencies_aws_cdk_lib'] ?? 'unknown',
      },
      // Inline rather than NodejsFunction: bundling pulls esbuild into the
      // deploy path for eight lines of handler. When Phase A has real handlers
      // with dependencies, that trade flips.
      code: Code.fromInline(`
exports.handler = async (event) => {
  // A thrown error is how acceptance criterion 7 forces an alarm to fire. An
  // alarm nobody has ever seen fire is a hypothesis, not an alarm.
  if (event?.queryStringParameters?.fail === '1') {
    throw new Error('Deliberate failure: proving the error alarm delivers.');
  }
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      service: 'synapsedeck',
      env: process.env.ENV_NAME,
      gitSha: process.env.GIT_SHA,
      cdkVersion: process.env.CDK_VERSION,
      time: new Date().toISOString(),
    }),
  };
};
`),
    });

    // The ONLY resource in this project with unauthenticated access. It returns
    // a version string and nothing else. Phase A's API Gateway is not to copy
    // this — everything that touches user data goes behind a JWT authorizer.
    const fnUrl = versionFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });

    // ── Alarms ──────────────────────────────────────────────────────────────

    const errorAlarm = new Alarm(this, 'VersionFnErrorAlarm', {
      alarmName: `synapsedeck-${config.envName}-version-errors`,
      alarmDescription: 'The version endpoint returned an error. It has no dependencies, so any error is real.',
      metric: versionFn.metricErrors({ period: Duration.minutes(5), statistic: Stats.SUM }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Absent data means nobody called it, which is not a problem.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(new SnsAction(alertTopic));

    const durationAlarm = new Alarm(this, 'VersionFnDurationAlarm', {
      alarmName: `synapsedeck-${config.envName}-version-p99-duration`,
      alarmDescription: 'p99 latency on a function that does no work. Cold starts aside, this should never fire.',
      metric: versionFn.metricDuration({ period: Duration.minutes(5), statistic: 'p99' }),
      threshold: 3000,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    durationAlarm.addAlarmAction(new SnsAction(alertTopic));

    const dlqAlarm = new Alarm(this, 'VersionFnDlqAlarm', {
      alarmName: `synapsedeck-${config.envName}-version-dlq-not-empty`,
      alarmDescription: 'Anything in this DLQ is unexpected by construction. See the DLQ comment above.',
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new SnsAction(alertTopic));

    // ── Dashboard ───────────────────────────────────────────────────────────
    // Four widgets. A dashboard nobody reads is worse than no dashboard, so this
    // stays at what can be taken in at a glance until there is more to show.
    const dashboard = new Dashboard(this, 'FoundationDashboard', {
      dashboardName: `synapsedeck-${config.envName}-foundation`,
    });

    dashboard.addWidgets(
      new GraphWidget({
        title: 'Invocations',
        left: [versionFn.metricInvocations({ statistic: Stats.SUM })],
        width: 12,
      }),
      new GraphWidget({
        title: 'Errors and throttles',
        left: [
          versionFn.metricErrors({ statistic: Stats.SUM }),
          versionFn.metricThrottles({ statistic: Stats.SUM }),
        ],
        width: 12,
      }),
      new GraphWidget({
        title: 'Duration p50 / p99',
        left: [
          versionFn.metricDuration({ statistic: 'p50' }),
          versionFn.metricDuration({ statistic: 'p99' }),
        ],
        width: 12,
      }),
      new GraphWidget({
        title: 'DLQ depth',
        left: [
          new Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: { QueueName: deadLetterQueue.queueName },
            statistic: Stats.MAXIMUM,
          }),
        ],
        width: 12,
      }),
    );

    // ── Budgets ─────────────────────────────────────────────────────────────
    //
    // §8 constraint 4: budgets exist before the first billable resource. The
    // Lambda above IS billable, so this must go up in the same `cdk deploy` —
    // deploying the function in one session and the budget in the next violates
    // the constraint even though both land in this phase.
    //
    // Budgets are a global service and always live in us-east-1 regardless of
    // where the rest of the stack is. That is currently the same region, so it
    // looks like a coincidence; it is not, and if a future phase moves the stack
    // this must stay put. Do not "fix" this by making it follow config.region.
    //
    // Both ACTUAL and FORECASTED at each threshold: forecast is what gives
    // warning while there is still time to act, which is the entire point at
    // these amounts.
    if (config.alertEmail !== undefined) {
      const email = config.alertEmail;
      for (const threshold of config.budgetThresholdsUsd) {
        new CfnBudget(this, `Budget${threshold}Usd`, {
          budget: {
            budgetName: `synapsedeck-${config.envName}-${threshold}usd`,
            budgetType: 'COST',
            timeUnit: 'MONTHLY',
            budgetLimit: { amount: threshold, unit: 'USD' },
            costFilters: {
              // Scope the budget to this project's tagged resources. Without
              // this it reports the whole account, which for a portfolio
              // account is nearly the same thing today and will not be later.
              TagKeyValue: [`user:project$${config.tags['project'] ?? 'synapsedeck'}`],
            },
          },
          notificationsWithSubscribers: (['ACTUAL', 'FORECASTED'] as const).map((notificationType) => ({
            notification: {
              notificationType,
              comparisonOperator: 'GREATER_THAN',
              threshold: 100, // percent of the budget limit above
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: email }],
          })),
        });
      }
    }

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'VersionUrl', {
      value: fnUrl.url,
      description: 'curl this; it returns the git SHA that is actually deployed.',
    });
    new CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'Confirm the email subscription or nothing alarms.',
    });
    new CfnOutput(this, 'DashboardName', {
      value: dashboard.dashboardName,
      description: 'CloudWatch dashboard for this stack.',
    });
  }
}
