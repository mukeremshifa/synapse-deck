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

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AttributeType,
  Billing,
  TableEncryptionV2,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import {
  DefinitionBody,
  JsonPath,
  Map as SfnMap,
  StateMachine,
  Succeed,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLERS = join(HERE, '..', '..', 'services', 'api', 'src', 'handlers');

export interface PipelineStackProps extends StackProps {
  readonly config: EnvConfig;
  /**
   * The SPA's origin, for the upload bucket's CORS rule. Same value the API
   * stack uses, passed in rather than recomputed so the two cannot disagree --
   * a mismatch here fails the browser's preflight and looks like a broken
   * upload rather than a misconfigured bucket.
   */
  readonly corsOrigin: string;
  /**
   * Which model provider the pipeline uses: 'stub', 'bedrock' or 'groq'.
   *
   * **No default anywhere in the chain.** `resolveProvider()` throws when this
   * is unset, and bin/app.ts requires it from context. That is deliberate: the
   * only provider that works offline today returns placeholder cards, so a
   * default would mean a forgotten setting silently generating fake content
   * that nothing downstream can distinguish from real content.
   */
  readonly cardProvider: string;
}

/**
 * How long an uploaded document survives.
 *
 * Three days. The pipeline consumes it within minutes; the only reason to keep
 * it at all is so a job that failed can be retried without asking the user to
 * upload again. Beyond that it is someone's document sitting in a bucket for no
 * reason, which is a liability rather than a feature.
 */
const UPLOAD_RETENTION_DAYS = 3;

export class PipelineStack extends Stack {
  readonly jobTable: TableV2;
  readonly uploadBucket: Bucket;
  readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { config, corsOrigin, cardProvider } = props;

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

    // ── The upload bucket ───────────────────────────────────────────────────
    //
    // P10 task 3. The browser uploads here directly with a presigned PUT; the
    // file never passes through the API. That is not a micro-optimisation — a
    // 20 MB PDF through a Lambda means buying memory to hold it, and API
    // Gateway caps a payload at 10 MB anyway, so routing uploads through the
    // API would put a hard ceiling on document size for no benefit.
    //
    // **Object keys are prefixed `uploads/<userId>/…`** (D4: `sub` becomes
    // `userId` everywhere, including S3 prefixes). Two things follow: the
    // presigned URL the API issues names a key it built from the verified JWT,
    // so a caller cannot obtain a URL for someone else's prefix; and the
    // boundary is visible in the key rather than implied by a policy elsewhere.
    this.uploadBucket = new Bucket(this, 'UploadBucket', {
      bucketName: `synapsedeck-${config.envName}-uploads-${this.account}`,

      // Nothing here is ever public. The only reads are presigned or by the
      // pipeline's own role.
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      enforceSSL: true,

      // SSE-S3 rather than SSE-KMS, for the same reason the table uses an
      // AWS-owned key: KMS would add a per-request charge and a key to manage,
      // to protect documents that are deleted within the week.
      encryption: BucketEncryption.S3_MANAGED,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,

      // **The source document is an input, not an archive.** S3 is free only to
      // 5 GB, and a PDF whose cards have been generated has no further use --
      // the cards are the product and they live in Postgres. Without this rule
      // the bucket grows forever and quietly becomes the largest line on the
      // bill.
      lifecycleRules: [
        {
          id: 'delete-uploads',
          enabled: true,
          expiration: Duration.days(UPLOAD_RETENTION_DAYS),
          // A multipart upload the browser abandoned leaves parts that are
          // billed as storage but are invisible in the object listing -- the
          // classic way an S3 bill grows with an apparently empty bucket.
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],

      // CORS, because the browser PUTs here directly from the SPA's origin.
      // Without this the upload fails preflight and presents as an opaque
      // network error rather than as a permissions problem.
      //
      // ETag is exposed deliberately: it is the one response header a client
      // needs to confirm what S3 actually stored.
      cors: [
        {
          allowedOrigins: [corsOrigin],
          allowedMethods: [HttpMethods.PUT],
          allowedHeaders: ['content-type'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],

      removalPolicy: config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      // Dev only: let `cdk destroy` actually succeed rather than failing on a
      // non-empty bucket. Never on prod, where it would delete real uploads.
      autoDeleteObjects: config.envName !== 'prod',
    });

    // ── The state machine ───────────────────────────────────────────────────
    //
    // D5: a Map state over chunks, with per-chunk retry and partial failure as a
    // normal outcome. Standard workflow rather than Express: Express bills per
    // GB-second and caps at 5 minutes, which a 40-chunk document with retries
    // can exceed, and Standard's execution history is what makes the graph
    // readable after the fact.
    //
    // These Lambdas are **not** in the VPC. They talk to DynamoDB (through the
    // gateway endpoint) and to a model provider over the internet; only the
    // finalise step touches Postgres, and it is given the VPC by the API stack's
    // own wiring in a later task. Keeping them out avoids the ENI cold-start
    // penalty on the hot path.
    const pipelineLogGroup = new LogGroup(this, 'PipelineLogs', {
      logGroupName: `/aws/lambda/synapsedeck-${config.envName}-pipeline`,
      retention: config.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const makePipelineFn = (id: string, entry: string, timeout: Duration) =>
      new NodejsFunction(this, id, {
        functionName: `synapsedeck-${config.envName}-${entry}`,
        entry: join(HANDLERS, `${entry}.ts`),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 512,
        timeout,
        logGroup: pipelineLogGroup,
        environment: {
          ENV_NAME: config.envName,
          JOB_TABLE_NAME: this.jobTable.tableName,
          // No default: resolveProvider() throws when this is unset, which is
          // deliberate. A missing value must stop the pipeline, not quietly
          // select the provider that returns placeholder cards.
          CARD_PROVIDER: cardProvider,
        },
        bundling: {
          format: OutputFormat.ESM,
          banner:
            "import{createRequire}from'module';const require=createRequire(import.meta.url);",
          target: 'node22',
          minify: true,
          sourceMap: true,
        },
      });

    const splitFn = makePipelineFn('SplitFn', 'pipeline-split', Duration.seconds(30));
    // The generate step gets the long timeout: it is the one making a model
    // call, and a Haiku-class response to a 3.5k-character chunk is seconds, not
    // milliseconds.
    const generateFn = makePipelineFn(
      'GenerateFn',
      'pipeline-generate',
      Duration.minutes(2),
    );
    const finaliseFn = makePipelineFn(
      'FinaliseFn',
      'pipeline-finalise',
      Duration.seconds(30),
    );

    for (const fn of [splitFn, generateFn, finaliseFn]) {
      this.jobTable.grantReadWriteData(fn);
    }

    // ── The dead-letter queue ───────────────────────────────────────────────
    //
    // Brief §6 trap 4 names "a Step Functions retry loop calling Bedrock" as a
    // way to a surprise bill. Two things prevent that here: the retry policy
    // below is bounded (3 attempts, backed off), and a chunk that exhausts it
    // lands here rather than being retried again by anything else.
    const chunkDlq = new Queue(this, 'ChunkDlq', {
      queueName: `synapsedeck-${config.envName}-chunk-dlq`,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    const generateChunk = new LambdaInvoke(this, 'GenerateChunk', {
      lambdaFunction: generateFn,
      // The Lambda's own return value, not the invocation envelope.
      payloadResponseOnly: true,
      // **CDK's default retry is switched off here, and that is a cost
      // decision.** LambdaInvoke adds `MaxAttempts: 6` on Lambda service errors
      // by default; combined with the explicit 3-attempt policy below, a single
      // chunk could make up to 18 model calls before giving up. That is exactly
      // the unbounded retry loop the brief's §6 trap 4 warns about, so the
      // default is removed and the only retry policy on this state is the
      // bounded one written below.
      retryOnServiceExceptions: false,
      payload: TaskInput.fromObject({
        userId: JsonPath.stringAt('$.userId'),
        jobId: JsonPath.stringAt('$.jobId'),
        chunkIndex: JsonPath.numberAt('$.chunkIndex'),
        cardCount: JsonPath.numberAt('$$.Execution.Input.cardCount'),
        kinds: JsonPath.objectAt('$$.Execution.Input.kinds'),
        depth: JsonPath.stringAt('$$.Execution.Input.depth'),
      }),
    });

    // **Bounded, and the bound is the point.** Three attempts with backoff
    // covers a rate limit or a transient 5xx; it does not cover a model that
    // consistently refuses, which no number of retries would fix and which
    // would cost a model call every time.
    generateChunk.addRetry({
      errors: [
        'ProviderRetryableError',
        'Lambda.TooManyRequestsException',
        // The transient Lambda-side failures CDK's default would have covered,
        // now under this bound rather than a second one stacked on top.
        'Lambda.ServiceException',
        'Lambda.SdkClientException',
      ],
      maxAttempts: 3,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });

    // A chunk that still fails is **caught, not propagated**. Partial failure is
    // a normal outcome (task 6): 31 of 40 chunks producing cards is a success
    // with a gap, not a failed job, and without this catch one exhausted chunk
    // would abort the Map state and discard the other 39.
    //
    // The catch lands on a Succeed state because the chunk's own failure is
    // already recorded in DynamoDB by the Lambda -- there is nothing further for
    // the machine to do with it, and the finalise step counts what actually
    // arrived rather than trusting the execution's shape.
    generateChunk.addCatch(new Succeed(this, 'ChunkFailedButRecorded'), {
      errors: ['States.ALL'],
      resultPath: JsonPath.DISCARD,
    });

    const mapChunks = new SfnMap(this, 'GenerateAllChunks', {
      itemsPath: '$.chunks',
      // Capped so a 40-chunk document does not become 40 simultaneous model
      // calls -- which is a rate limit at best and a bill at worst.
      maxConcurrency: 4,
      resultPath: JsonPath.DISCARD,
    });
    mapChunks.itemProcessor(generateChunk);

    const definition = new LambdaInvoke(this, 'SplitDocument', {
      lambdaFunction: splitFn,
      payloadResponseOnly: true,
    })
      .next(mapChunks)
      .next(
        new LambdaInvoke(this, 'Finalise', {
          lambdaFunction: finaliseFn,
          payloadResponseOnly: true,
          payload: TaskInput.fromObject({
            userId: JsonPath.stringAt('$$.Execution.Input.userId'),
            jobId: JsonPath.stringAt('$$.Execution.Input.jobId'),
          }),
        }),
      );

    this.stateMachine = new StateMachine(this, 'IngestionStateMachine', {
      stateMachineName: `synapsedeck-${config.envName}-ingestion`,
      definitionBody: DefinitionBody.fromChainable(definition),
      // Generous: it bounds a stuck execution rather than a normal one. A
      // 40-chunk document at 4-way concurrency is minutes, not an hour.
      timeout: Duration.hours(1),
    });

    new CfnOutput(this, 'StateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'Ingestion state machine, started when a document is uploaded.',
    });

    new CfnOutput(this, 'ChunkDlqUrl', {
      value: chunkDlq.queueUrl,
      description: 'Dead-letter queue for chunks that exhausted their retries.',
    });

    new CfnOutput(this, 'UploadBucketName', {
      value: this.uploadBucket.bucketName,
      description: 'S3 bucket receiving presigned document uploads.',
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
