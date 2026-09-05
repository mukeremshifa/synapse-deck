/**
 * Per-environment configuration. The one place a magic number lives.
 *
 * Two environments that differ today in name and retention and almost nothing
 * else. That is deliberate: the point is that the difference is expressed in
 * one place from the first day, so Phase A adds an instance size to a structure
 * that already exists rather than inventing the structure while also inventing
 * RDS.
 *
 * ── Why no `enum` anywhere in infra/ ──────────────────────────────────────
 *
 * cdk.json runs this app through `node --experimental-strip-types`, which is
 * strip-only: it erases types and refuses anything that would need code
 * generated for it. A TypeScript `enum` is exactly that, and Node rejects it
 * with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 *
 * Verified on 2026-09-05, Node 24.19.0, and the distinction is narrower than it
 * first looks: *consuming* CDK's own enums (RetentionDays.ONE_WEEK, Tracing.ACTIVE)
 * is fine, because aws-cdk-lib ships compiled JavaScript. Only *declaring* one
 * in this directory fails. So: use union types of string literals here, which is
 * better practice anyway. If a future session truly needs a declared enum, the
 * fix is `--experimental-transform-types` in cdk.json (also verified working),
 * not abandoning type stripping.
 */

import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export type EnvName = 'dev' | 'prod';

export interface EnvConfig {
  readonly envName: EnvName;
  /** Resolved from CDK_DEFAULT_ACCOUNT at synth time. Never hardcoded — an
      account id in a public repo is not a credential but it is free
      reconnaissance. */
  readonly account: string | undefined;
  readonly region: string;
  readonly logRetention: RetentionDays;
  /** D9. Both ACTUAL and FORECASTED notifications at each threshold. */
  readonly budgetThresholdsUsd: readonly number[];
  /** From context (-c alertEmail=…), never committed. */
  readonly alertEmail: string | undefined;
  /** Applied at App level so no future resource can forget them. */
  readonly tags: Readonly<Record<string, string>>;
  /** P9. RDS: the instance is the single largest line item in this project. */
  readonly database: DatabaseConfig;
}

export interface DatabaseConfig {
  /**
   * `db.t4g.micro` on both, and the reason is worth stating: Graviton is
   * cheaper per hour than the t3 equivalent for identical specs, and at this
   * size prod has no more load than dev. When prod genuinely needs more, this
   * is the one line that changes.
   */
  readonly instanceClass: 'micro' | 'small';
  readonly allocatedStorageGb: number;
  /**
   * Refuses `cdk destroy` and any stack operation that would replace the
   * instance. True on prod because the data is the product; false on dev
   * because a dev database that cannot be torn down is a permanent bill.
   */
  readonly deletionProtection: boolean;
  /**
   * Single-AZ on both (§8 constraint 3). Multi-AZ doubles the instance cost to
   * buy an availability guarantee that a portfolio project does not need — and
   * the brief's §6 budget has no room for it. Named here rather than inlined so
   * that turning it on for prod later is a config change, not a stack rewrite.
   */
  readonly multiAz: boolean;
  /**
   * Backup retention in days. Snapshots within the allocated-storage size are
   * free, so 7 days on prod costs nothing; 1 day on dev keeps the restore path
   * exercised without accumulating snapshots nobody will read.
   */
  readonly backupRetentionDays: number;
}

/**
 * us-east-1, decided 2026-09-05 with the owner working from the UAE.
 *
 * me-central-1 (Dubai) would cut ~300 ms of round-trip latency, and it was
 * considered rather than defaulted past. It lost on one argument that outweighed
 * latency: Bedrock model availability is materially broader in us-east-1, and
 * D6 makes Bedrock the primary provider — a region whose model catalogue is thin
 * would force a worse model, a cross-region call, or a mid-project migration.
 *
 * Two supporting reasons: every cost figure in AWS-NATIVE-BRIEF.md §6 is priced
 * on-demand in us-east-1, and AWS Budgets is us-east-1 regardless. The accepted
 * cost is ~250-350 ms on interactive paths, which lands almost entirely on
 * asynchronous pipeline work where it is invisible; Phase G's CloudFront layer
 * has UAE edge locations and masks most of the rest.
 */
export const REGION = 'us-east-1';

const BASE_TAGS = {
  project: 'synapsedeck',
  owner: 'mukeremshifa',
} as const;

export function configFor(envName: EnvName, alertEmail: string | undefined): EnvConfig {
  return {
    envName,
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: REGION,
    // Short on purpose. The CloudWatch default is never-expire, which is D9's
    // third trap and the one that silently costs money — 5 GB of ingestion is
    // free, indefinite retention is not.
    logRetention: envName === 'prod' ? RetentionDays.TWO_WEEKS : RetentionDays.ONE_WEEK,
    budgetThresholdsUsd: [2, 5, 10, 15],
    alertEmail,
    tags: { ...BASE_TAGS, env: envName },
    database: {
      instanceClass: 'micro',
      // The RDS minimum for gp3 is 20 GB, so this is the floor rather than an
      // estimate. Five tables of flashcards will not approach it.
      allocatedStorageGb: 20,
      deletionProtection: envName === 'prod',
      multiAz: false,
      backupRetentionDays: envName === 'prod' ? 7 : 1,
    },
  };
}
