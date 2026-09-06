/**
 * Job state for document ingestion. The first half of P10's Phase B.
 *
 * One DynamoDB table, single-table design, holding the state of an ingestion
 * job while it runs: which chunks exist, which have been generated, what the
 * draft cards are, and whether the whole thing succeeded. The Step Functions
 * fan-out of task 5 writes here; `/progress` reads here.
 *
 * **Nothing in this stack costs money at idle.** On-demand billing means the
 * bill is per request, and an ingestion job is a few hundred writes; the table
 * sitting empty between jobs is free. That matters because this stack, unlike
 * DataStack, can be deployed early without spending the Bedrock budget.
 *
 * ── Why `userId` is the partition key ─────────────────────────────────────
 *
 * ADR 0008 retired RLS and moved the tenancy boundary into application code,
 * which is **weaker than what it replaced** — a query that forgets its owner
 * filter returns every user's rows instead of none. On the SQL side the only
 * compensations are discipline and a lint.
 *
 * DynamoDB allows a genuinely stronger position, and this table takes it. With
 * `userId` as the *partition key*, the owner is not a filter applied after the
 * read — it is the address of the data. A `GetItem` or `Query` must name a
 * partition to read at all, so a request for another user's job is not a leak
 * that a `where` clause was supposed to prevent; it is a read of a different
 * partition, which returns nothing because the caller's id is the only one the
 * data layer will ever pass. There is no shape of forgetting here that returns
 * a stranger's row, which is not something the Postgres tables can claim.
 *
 * The plan states this as a constraint rather than a preference: **do not model
 * it any other way for convenience.** A `jobId`-partitioned table with a
 * `userId` attribute would be easier to query by job alone and would throw that
 * property away.
 *
 * The sort key is `jobId#…` — a compound key holding the job id and the record
 * kind, so one partition holds a job's summary and all of its per-chunk records
 * and a single `Query` with a `begins_with` condition reads the whole job.
 *
 * ── Why a TTL ─────────────────────────────────────────────────────────────
 *
 * Pipeline state is not history. A finished job is interesting while the user
 * watches it and for a little while after; the cards it produced live in
 * Postgres, which is the actual record. Without a TTL this table quietly
 * becomes a second database nobody decided to keep, holding every chunk of
 * every document ever uploaded, and paying storage for it forever.
 *
 * DynamoDB's TTL deletes expired items in the background at no charge — the
 * deletes are free, unlike a scan-and-delete job, which is the other reason to
 * use the built-in mechanism rather than housekeeping code.
 *
 * The attribute is a Unix **seconds** timestamp. Milliseconds is the classic
 * error here and it fails silently in the safe-looking direction: a value in
 * milliseconds is a timestamp roughly 50,000 years out, so the item simply
 * never expires and the table grows exactly as it would with no TTL at all.
 * `services/api/src/data/jobs.ts` computes it in one place for that reason.
 */

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AttributeType,
  Billing,
  TableEncryptionV2,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.ts';

export interface PipelineStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class PipelineStack extends Stack {
  readonly jobTable: TableV2;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.jobTable = new TableV2(this, 'JobTable', {
      tableName: `synapsedeck-${config.envName}-jobs`,

      // The tenancy decision, in two lines. See the header.
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },

      // On-demand. The alternative, provisioned capacity, bills for reserved
      // throughput whether or not anything uses it — the same "costs money
      // while idle" shape as the RDS instance, for a table that is idle almost
      // always. On-demand is free at rest and a few cents per thousand writes
      // when a job runs.
      billing: Billing.onDemand(),

      // See the header: seconds, not milliseconds.
      timeToLiveAttribute: 'expiresAt',

      // AWS-owned keys: encryption at rest with no KMS key to pay for. A
      // customer-managed key is ~$1/mo plus per-request charges and buys
      // key-rotation control this project has no requirement for.
      //
      // **This renders as `SSESpecification: { SSEEnabled: false }`, and that
      // does not mean the table is unencrypted.** DynamoDB encrypts every table
      // at rest unconditionally; the flag controls only whether a *KMS* key is
      // layered on top. Reading that line as "encryption off" is the obvious
      // misreading, so it is written down here rather than rediscovered by
      // someone reviewing the synthesised template.
      encryption: TableEncryptionV2.dynamoOwnedKey(),

      // Off. PITR is ~20% of storage cost to protect data whose whole point is
      // that it expires in hours. The durable record is Postgres.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },

      // Dev is disposable; prod's table is retained so a stack teardown cannot
      // take live job state with it. Matches DataStack's reasoning on the
      // database itself.
      removalPolicy: config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, 'JobTableName', {
      value: this.jobTable.tableName,
      description: 'DynamoDB table holding ingestion job state.',
    });

    new CfnOutput(this, 'JobTableArn', {
      value: this.jobTable.tableArn,
      description: 'ARN of the job-state table, for IAM grants from the API stack.',
    });
  }
}
