/**
 * API Gateway and the Lambdas behind it. The compute half of P9.
 *
 * ── The JWT authorizer is the security boundary's front door ──────────────
 *
 * Every route below is behind a Cognito JWT authorizer, and that is not a
 * convenience — it is the *only* place a user id enters this system. API
 * Gateway verifies the token's signature, issuer, audience and expiry against
 * the user pool before the Lambda is invoked at all; the handler then reads
 * `sub` from the authorizer context and passes it as the first argument to
 * every data-access function.
 *
 * Since ADR 0008 retired Row Level Security, that chain *is* the tenancy
 * boundary. A route added here without `authorizer` would reach a handler whose
 * `requireUserId` fails closed with a 401 — deliberately, because a route with
 * no authorizer is a mistake and not a public endpoint.
 *
 * **There is exactly one unauthenticated resource in this project** and it is
 * the version endpoint in the foundation stack. Nothing here copies it.
 *
 * ── One Lambda per resource group ─────────────────────────────────────────
 *
 * Four functions: profile, decks, cards, reviews. Not one per route — a page
 * that fetches three things would pay three cold starts — and not a monolith,
 * where every deploy touches every path. A resource group is the unit that
 * changes together.
 *
 * ── Inside the VPC, with no way out ───────────────────────────────────────
 *
 * These functions join the isolated subnets so they can reach RDS, which means
 * they have **no route to the internet at all** (see data-stack.ts's header).
 * That is fine because they call nothing: no AWS SDK, no third-party API. The
 * database password arrives as an environment variable resolved at deploy time
 * rather than through a Secrets Manager call, which is what avoids a ~$7.20/mo
 * per-AZ interface endpoint to fetch one string.
 *
 * **Cold start in a VPC is still unmeasured** (P9 task 2). Nothing here is
 * deployed as of this commit, so it cannot be. Measure it before the
 * interactive paths are tuned around an assumption.
 */

import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { SubnetType, type ISecurityGroup, type IVpc } from 'aws-cdk-lib/aws-ec2';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import type { IStateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import type { EnvConfig } from './config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLERS = join(HERE, '..', '..', 'services', 'api', 'src', 'handlers');

export interface ApiStackProps extends StackProps {
  readonly config: EnvConfig;
  /**
   * P10's job-state table, from PipelineStack. Passed by object reference like
   * the user pool above, so the grant below is a real IAM policy rather than a
   * cross-stack ARN export that would couple the two stacks' deployments.
   */
  readonly jobTable: ITableV2;
  /** P10's upload bucket, from PipelineStack. Only the uploads handler signs for it. */
  readonly uploadBucket: IBucket;
  /** P10's ingestion state machine, started when a document job is created. */
  readonly stateMachine: IStateMachine;
  readonly vpc: IVpc;
  readonly database: DatabaseInstance;
  readonly databaseSecurityGroup: ISecurityGroup;
  readonly databaseName: string;
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  /**
   * Where the SPA is served from. The API sends this back as
   * `Access-Control-Allow-Origin`, so it is not `*`: `*` with `Authorization`
   * lets any page on the internet make authenticated calls with a stolen token.
   */
  readonly corsOrigin: string;
}

export class ApiStack extends Stack {
  readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      config,
      vpc,
      database,
      databaseSecurityGroup,
      databaseName,
      userPool,
      userPoolClient,
      corsOrigin,
    } = props;

    // ── The functions ───────────────────────────────────────────────────────
    //
    // NodejsFunction rather than the inline code P8 used for the version
    // endpoint. That file says the trade flips "when Phase A has real handlers
    // with dependencies" — this is that moment: these handlers import `pg`, the
    // shared Zod schemas and the day-boundary module, none of which can be
    // inlined into a template.
    const logGroup = new LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/synapsedeck-${config.envName}-api`,
      retention: config.logRetention,
    });

    const secret = database.secret;
    if (!secret) {
      // The instance is created with `Credentials.fromGeneratedSecret`, so this
      // is unreachable — but an undefined password silently becoming the string
      // "undefined" is exactly the failure that presents as a connection error
      // nobody can explain.
      throw new Error('The database has no generated secret to read credentials from.');
    }

    const commonEnvironment = {
      ENV_NAME: config.envName,
      CORS_ORIGIN: corsOrigin,
      // Standard PG* variables — the same ones services/api/migrations/run.mjs
      // reads, so a connection that works for the runner works for the API.
      PGHOST: database.dbInstanceEndpointAddress,
      PGPORT: database.dbInstanceEndpointPort,
      PGDATABASE: databaseName,
      PGUSER: secret.secretValueFromJson('username').unsafeUnwrap(),
      // Resolved at deploy time into the function's environment rather than
      // fetched at runtime. `unsafeUnwrap` names what it does: the value lands
      // in the CloudFormation template and in the Lambda's configuration, both
      // readable by anyone with the IAM permission to describe them.
      //
      // That is a real trade and the alternative was considered: a runtime
      // Secrets Manager call needs an interface endpoint from this VPC, at
      // ~$7.20/mo per AZ, to read one string on every cold start. For a
      // single-database portfolio project whose account has one principal, the
      // endpoint costs more than it protects. Phase F revisits it if the
      // account ever has more than one human in it.
      PGPASSWORD: secret.secretValueFromJson('password').unsafeUnwrap(),
      // P10. Read by services/api/src/data/jobs.ts, which throws at the first
      // call if it is missing rather than failing deeper in the SDK.
      JOB_TABLE_NAME: props.jobTable.tableName,
      UPLOAD_BUCKET_NAME: props.uploadBucket.bucketName,
      INGESTION_STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
    };

    const makeHandler = (name: string, entry: string) =>
      new NodejsFunction(this, name, {
        functionName: `synapsedeck-${config.envName}-${entry}`,
        entry: join(HANDLERS, `${entry}.ts`),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        // Enough for a JSON response and a pool, and no more. Memory is also
        // CPU on Lambda, so this is the number to raise first if the cold start
        // measurement comes back bad — raising it can make a function cheaper
        // by finishing sooner.
        memorySize: 512,
        // Longer than any query (`statement_timeout` is 10s in lib/db.ts), so a
        // slow query fails as a database error with a log line rather than as
        // an opaque Lambda timeout.
        timeout: Duration.seconds(15),
        vpc,
        vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        securityGroups: [databaseSecurityGroup],
        environment: commonEnvironment,
        logGroup,
        tracing: Tracing.ACTIVE,
        bundling: {
          // ESM, matching the source. The handlers use `import` and the repo is
          // `"type": "module"`; bundling to CommonJS would work and would make
          // the built artifact stop resembling the code that was written.
          format: OutputFormat.ESM,
          // esbuild emits `require` shims for ESM output that Node's ESM loader
          // does not provide. This is the documented banner for that.
          banner:
            "import{createRequire}from'module';const require=createRequire(import.meta.url);",
          target: 'node22',
          minify: true,
          sourceMap: true,
          // `pg` is bundled rather than left external: there is no layer here,
          // and an unbundled dependency is a runtime "cannot find module".
        },
      });

    const profileFn = makeHandler('ProfileFn', 'profile');
    const decksFn = makeHandler('DecksFn', 'decks');
    const cardsFn = makeHandler('CardsFn', 'cards');
    const reviewsFn = makeHandler('ReviewsFn', 'reviews');
    const uploadsFn = makeHandler('UploadsFn', 'uploads');
    const jobsFn = makeHandler('JobsFn', 'jobs');

    // ── The job table's grant ───────────────────────────────────────────────
    //
    // P10 task 2 creates the table; tasks 3-5 add the routes that use it. The
    // grant is deliberately **not** given to all four handlers: every one of
    // them receives JOB_TABLE_NAME through commonEnvironment, but only the one
    // that owns ingestion jobs gets permission to touch it, so a mistake in an
    // unrelated handler cannot reach job state.
    //
    // `cards` is the holder because the review gate - accepting drafts into
    // real cards - is where job state and card state meet. When task 5 gives
    // the pipeline its own Lambdas, they take their own grants; this one does
    // not widen to cover them.
    props.jobTable.grantReadWriteData(cardsFn);

    // The uploads handler signs PUTs and does nothing else, so `grantPut`
    // rather than `grantReadWrite`: it has no reason to read a document back or
    // to delete one, and the presigned URL it issues can only carry permissions
    // this role already holds. A wider grant here would widen every URL it
    // signs.
    props.uploadBucket.grantPut(uploadsFn);

    // The jobs handler reads progress and also *creates* a job, so it needs
    // write access -- narrower than the pipeline's own Lambdas, which is why the
    // grant is stated per function rather than once for everything.
    props.jobTable.grantReadWriteData(jobsFn);
    // It reads the uploaded document to seed the execution. Read-only: it has
    // no reason to write or delete an upload.
    props.uploadBucket.grantRead(jobsFn);
    props.stateMachine.grantStartExecution(jobsFn);

    // ── The migration runner ────────────────────────────────────────────────
    //
    // **This settles the question task 3 left open**: the database sits in an
    // isolated subnet with no public route, so `npm run db:migrate` cannot
    // reach it from a laptop. This is the session that first puts compute
    // inside the VPC, and a Lambda is the boring answer the plan asked for.
    //
    // It is deliberately *not* wired to a CDK custom resource that runs on
    // every deploy. Migrations are a decision, not a side effect of `cdk
    // deploy`: the owner invokes this by hand
    // (`aws lambda invoke --function-name synapsedeck-dev-migrate …`) after
    // reading what the dry run reported. That also keeps a failed migration
    // from rolling back a stack that deployed correctly.
    //
    // The runner's own safety rails — one transaction per file, an advisory
    // lock, and a checksum ledger that refuses an edited migration — all live
    // in `services/api/migrations/run.mjs` and are unchanged by running here.
    const migrateFn = new NodejsFunction(this, 'MigrateFn', {
      functionName: `synapsedeck-${config.envName}-migrate`,
      entry: join(HERE, '..', '..', 'services', 'api', 'src', 'handlers', 'migrate.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // Minutes, not seconds: this one legitimately takes a while, and a
      // migration killed halfway is the failure mode with the worst blast
      // radius in the project. Each file is its own transaction, so a timeout
      // leaves whole migrations applied or not at all — never half of one.
      timeout: Duration.minutes(10),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      environment: commonEnvironment,
      logGroup,
      bundling: {
        format: OutputFormat.ESM,
        banner:
          "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        target: 'node22',
        // Not minified, unlike the handlers. This function's output is read by
        // a human deciding whether a schema change went in correctly, and a
        // stack trace through minified code is the wrong place to save 40 KB.
        minify: false,
        sourceMap: true,
        // `run.mjs` and the .sql files are copied in whole rather than bundled.
        //
        // The runner resolves its migrations directory from its own location
        // (`dirname(fileURLToPath(import.meta.url))`), so copying the directory
        // intact is what lets it run here completely unmodified — the same
        // script, with the same advisory lock, the same one-transaction-per-file
        // and the same checksum ledger that the owner runs against a tunnel.
        // Reimplementing any of that for Lambda would be a second migration
        // runner, which is the one thing worse than none.
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          // The paths arrive as argv rather than interpolated into the script
          // string. On Windows this command is run through `cmd.exe /c "…"`,
          // and a nested double quote — which JSON.stringify of a path with
          // backslashes needs — terminates the outer quoting and the whole
          // thing fails to parse. argv sidesteps the quoting problem entirely.
          afterBundling: (inputDir: string, outputDir: string) => [
            `node -e "require('fs').cpSync(process.argv[1],process.argv[2],{recursive:true})" ` +
              `"${inputDir}/services/api/migrations" "${outputDir}/migrations"`,
          ],
        },
        // `pg` stays bundled into the handler, and `run.mjs` imports it by bare
        // specifier from its copied-in location — so the runner needs it
        // resolvable as a real module rather than inlined. nodeModules puts it
        // in the asset's node_modules, which is where `import pg from 'pg'`
        // will find it.
        nodeModules: ['pg'],
      },
    });

    // ── The API ─────────────────────────────────────────────────────────────
    //
    // HTTP API, not REST: roughly a third of the price per million requests,
    // and the JWT authorizer is native rather than a Lambda of its own.
    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `synapsedeck-${config.envName}`,
      description: 'SynapseDeck API. Every route is behind the Cognito JWT authorizer.',
      corsPreflight: {
        allowOrigins: [corsOrigin],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          // PUT is here for `/uploads/{objectId}`, which is inert on this stack
          // (see the route's comment). Listed anyway so the preflight matches
          // the declared route table rather than the subset that happens to be
          // reachable in one configuration.
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowCredentials: false,
        maxAge: Duration.days(1),
      },
    });

    /**
     * The authorizer. `sub` is the claim every handler reads and it is on every
     * token already, which is why ADR 0007's "no pre-token-generation Lambda"
     * holds: there is nothing to add to a token that would not be a cold start
     * on the login path for no gain.
     *
     * The access token is what is validated, not the id token. The audience of
     * an access token from this pool is the app client id.
     */
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${config.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        authorizerName: `synapsedeck-${config.envName}-jwt`,
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    );

    const route = (path: string, methods: HttpMethod[], fn: NodejsFunction, id: string) =>
      this.httpApi.addRoutes({
        path,
        methods,
        integration: new HttpLambdaIntegration(id, fn),
        // Never omitted. A route without this is a route with no tenancy
        // boundary in front of it.
        authorizer,
      });

    route('/profile', [HttpMethod.GET, HttpMethod.PATCH], profileFn, 'ProfileInt');

    route('/decks', [HttpMethod.GET, HttpMethod.POST], decksFn, 'DecksInt');
    route(
      '/decks/{deckId}',
      [HttpMethod.GET, HttpMethod.PATCH, HttpMethod.DELETE],
      decksFn,
      'DeckInt',
    );
    route('/decks/{deckId}/finish-gate', [HttpMethod.POST], decksFn, 'FinishGateInt');

    route(
      '/decks/{deckId}/cards',
      [HttpMethod.GET, HttpMethod.POST],
      cardsFn,
      'DeckCardsInt',
    );
    route('/cards/{cardId}', [HttpMethod.PATCH], cardsFn, 'CardInt');
    // The bulk operations. POST rather than PATCH on a collection: each takes a
    // list of ids in the body, so there is no single resource being addressed.
    // Declared before nothing — `/cards/{cardId}` is a different method, so
    // there is no ambiguity for API Gateway to resolve.
    route('/cards/accept', [HttpMethod.POST], cardsFn, 'AcceptDraftsInt');
    route('/cards/status', [HttpMethod.POST], cardsFn, 'CardStatusInt');
    route('/cards/delete', [HttpMethod.POST], cardsFn, 'DeleteCardsInt');

    route('/uploads', [HttpMethod.POST], uploadsFn, 'UploadsInt');
    /*
     * `PUT /uploads/{objectId}` — the local upload store's write path (DS1).
     *
     * **Declared here but inert on AWS, and that is deliberate.** When
     * `UPLOAD_STORE=s3` — which is what this stack deploys — the browser PUTs to
     * a presigned URL and never reaches the API, so nothing routes here and
     * `data/uploads.ts` refuses the call with a 404 if anything tries.
     *
     * It is declared anyway because `scripts/check-routes.mjs` compares this
     * table against `scripts/dev-api.mjs` and fails on any difference in either
     * direction. The alternative was an exception in that check, and an
     * exception is how a route-parity check stops being a guarantee — the whole
     * value of it is that it has no special cases to argue about. A declared
     * route that no configuration reaches costs a few lines of template; a
     * weakened check costs the one class of bug this development setup
     * introduces.
     */
    route('/uploads/{objectId}', [HttpMethod.PUT], uploadsFn, 'UploadPutInt');
    route('/jobs', [HttpMethod.GET, HttpMethod.POST], jobsFn, 'JobsInt');
    route('/jobs/{jobId}', [HttpMethod.GET], jobsFn, 'JobInt');
    // Served by the jobs function because quota is read from the same table it
    // writes on dispatch (P10 task 8).
    route('/quota', [HttpMethod.GET], jobsFn, 'QuotaInt');

    route('/queue', [HttpMethod.GET], reviewsFn, 'QueueInt');
    route('/summary', [HttpMethod.GET], reviewsFn, 'SummaryInt');
    route('/reviews', [HttpMethod.POST], reviewsFn, 'ReviewsInt');
    route('/reviews/undo', [HttpMethod.POST], reviewsFn, 'UndoInt');

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'VITE_API_URL. Every route requires a Cognito access token.',
      exportName: `SynapseDeck-${config.envName}-ApiUrl`,
    });

    new CfnOutput(this, 'MigrateFunctionName', {
      value: migrateFn.functionName,
      description:
        'Run migrations inside the VPC. Invoke with {"statusOnly":true} first, every time.',
    });
  }
}
