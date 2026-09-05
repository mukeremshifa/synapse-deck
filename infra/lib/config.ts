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
  };
}
