/**
 * RDS Postgres and the VPC around it. The data half of P9.
 *
 * This is the stack that starts costing real money — roughly $12-15/month for
 * the instance and its storage, running whether or not anyone uses it. The
 * budgets from P8 are set at $2/$5/$10/$15, so deploying this **will** trip the
 * upper two, by design rather than by surprise. That is the correct behaviour
 * for a budget: it is telling the truth about a deliberate decision.
 *
 * ── The NAT Gateway trap, and why this VPC looks odd ──────────────────────
 *
 * §8 constraint 3 and the brief's §6 trap 1: a NAT Gateway is ~$32/mo, which is
 * more than double the database it would be serving. `natGateways: 0` below is
 * the single most important line in this file.
 *
 * The consequence is that Lambdas in this VPC have **no route to the internet
 * at all**. Not a slow one — none. Anything they need must arrive through a VPC
 * endpoint, and every AWS service call from a VPC Lambda is affected: no
 * endpoint means the SDK call hangs until it times out, which presents as a
 * mysteriously slow function rather than a connection error. That is the trap
 * behind the trap, and it is why the endpoints below are chosen explicitly
 * rather than added when something breaks.
 *
 * Two endpoint types, with very different prices:
 *   - **Gateway** endpoints (S3, DynamoDB) are free. Always add them.
 *   - **Interface** endpoints are ~$7.20/mo each, per AZ. Each one is half an
 *     RDS instance, so each must be justified rather than added defensively.
 *
 * So: the S3 gateway endpoint is here because it is free and Phase B's ingestion
 * will want it. **No interface endpoints are created.** The obvious candidate
 * was Secrets Manager, and the way to not need it is to not use Secrets Manager
 * — see the credentials section below.
 *
 * ── Cold start ────────────────────────────────────────────────────────────
 *
 * A Lambda in a VPC attaches an ENI, which historically added seconds to a cold
 * start. AWS's 2019 rearchitecture cut that to roughly the same as a non-VPC
 * Lambda, but the brief's §6 correctly calls it "a measurement for Phase A, not
 * an assumption". P9 task 2 requires the real number to be measured and written
 * into the plan before interactive paths depend on it. **Not yet measured** —
 * nothing is deployed as of this commit.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  GatewayVpcEndpointAwsService,
  InstanceClass,
  InstanceSize,
  InstanceType,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.ts';

export interface DataStackProps extends StackProps {
  readonly config: EnvConfig;
}

/**
 * The Postgres major version. Pinned, and pinned deliberately.
 *
 * `supabase/pg-version.json` records the major the Supabase project runs, and
 * `npm run db:pg-version` compares it. The point of matching here is that the
 * five migrations in `services/api/migrations/` were written against that
 * version and nothing tests them (ADR 0005) — running them against a different
 * major is a variable this phase does not need.
 */
const POSTGRES_MAJOR = PostgresEngineVersion.VER_17;

/** SSM parameter paths. Read by the API stack and by the migration runner. */
export function dbParameterPath(envName: string, key: string): string {
  return `/synapsedeck/${envName}/db/${key}`;
}

export class DataStack extends Stack {
  readonly vpc: Vpc;
  readonly database: DatabaseInstance;
  /** Attach this to anything that needs to reach the database. */
  readonly databaseSecurityGroup: SecurityGroup;
  readonly databaseName = 'synapsedeck';

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { database: dbConfig } = config;

    // ── The VPC ─────────────────────────────────────────────────────────────
    //
    // Two AZs because RDS requires a subnet group spanning at least two, even
    // for a single-AZ instance. This costs nothing: subnets are free, and only
    // one AZ actually holds the instance.
    //
    // Two subnet types, and no public one. There is nothing to put in a public
    // subnet: the database must never be reachable from the internet, and the
    // Lambdas are invoked by API Gateway rather than by inbound traffic.
    this.vpc = new Vpc(this, 'Vpc', {
      vpcName: `synapsedeck-${config.envName}`,
      maxAzs: 2,
      // THE line. See the header. A NAT Gateway here would cost more than
      // everything else in this project combined.
      natGateways: 0,
      subnetConfiguration: [
        {
          // PRIVATE_ISOLATED, not PRIVATE_WITH_EGRESS: the latter *requires* a
          // NAT Gateway and CDK will silently create one to satisfy it. This is
          // the precise mechanism by which the $32/mo appears without anyone
          // deciding to spend it.
          name: 'isolated',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // Off: flow logs bill per GB ingested into CloudWatch, and there is no
      // network-forensics story here that would read them. Phase G can revisit.
      // DNS is on because endpoint resolution depends on it.
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Free, and Phase B's document ingestion will read from S3. Adding it now
    // costs nothing and saves a future session from debugging a hung SDK call.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: GatewayVpcEndpointAwsService.S3,
    });

    // No interface endpoints. Each is ~$7.20/mo per AZ, which at two AZs is more
    // than the database. If a later phase needs one, add it with the price in
    // the commit message.

    // ── Security groups ─────────────────────────────────────────────────────
    //
    // The database accepts connections from exactly one security group and
    // nothing else. Not a CIDR range — a security group reference, so "may talk
    // to the database" is a property of the Lambda rather than of where it
    // happens to sit in the address space.
    this.databaseSecurityGroup = new SecurityGroup(this, 'DbClientSg', {
      vpc: this.vpc,
      securityGroupName: `synapsedeck-${config.envName}-db-client`,
      description: 'Attach to anything that needs to reach the database.',
      // Nothing in this VPC has anywhere to go: no NAT, so egress rules are
      // about reaching endpoints and the database. Left open because closing it
      // buys nothing when there is no route out.
      allowAllOutbound: true,
    });

    const databaseSg = new SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      securityGroupName: `synapsedeck-${config.envName}-db`,
      description: 'The database itself. Ingress only from the client SG.',
      allowAllOutbound: false,
    });

    databaseSg.addIngressRule(
      this.databaseSecurityGroup,
      Port.tcp(5432),
      'Postgres from the db-client security group only.',
    );

    // ── Credentials ─────────────────────────────────────────────────────────
    //
    // **SSM Parameter Store, not Secrets Manager**, and this is a real decision
    // rather than a preference:
    //
    //   - Secrets Manager is $0.40/secret/month plus API calls, and — far more
    //     expensive — a VPC Lambda reading one needs an *interface endpoint* at
    //     ~$7.20/mo per AZ. That is $15/mo to store one password.
    //   - SSM Parameter Store standard parameters are free, and SecureString
    //     encrypts with a KMS key at rest exactly as Secrets Manager does.
    //
    // What is genuinely given up is **automatic rotation**, which Secrets
    // Manager does and this does not. For a single-database portfolio project
    // with one credential, rotation is a feature that would never fire. Say so
    // rather than pretending the choice is free.
    //
    // CDK generates the password (`Credentials.fromGeneratedSecret`) into a
    // Secrets Manager secret — that part is unavoidable, RDS itself wants it —
    // but nothing at *runtime* reads it from there. The API stack reads the
    // host and database name from the parameters below and the password from
    // the secret via an environment variable resolved at deploy time, so no
    // Lambda makes a Secrets Manager API call and no endpoint is needed.
    const credentials = Credentials.fromGeneratedSecret('synapsedeck_app', {
      secretName: `synapsedeck/${config.envName}/db/credentials`,
      // No slash, no quote, no @: all three break a Postgres connection URL in
      // a way that is tedious to diagnose from a connection-refused error.
      excludeCharacters: ' /"@\'\\',
    });

    // ── The instance ────────────────────────────────────────────────────────
    this.database = new DatabaseInstance(this, 'Database', {
      instanceIdentifier: `synapsedeck-${config.envName}`,
      engine: DatabaseInstanceEngine.postgres({ version: POSTGRES_MAJOR }),
      instanceType: InstanceType.of(
        // Graviton. Cheaper per hour than t3 for the same specs, and the burst
        // credits behave identically for a workload this small.
        InstanceClass.BURSTABLE4_GRAVITON,
        dbConfig.instanceClass === 'micro' ? InstanceSize.MICRO : InstanceSize.SMALL,
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSg],
      credentials,
      databaseName: this.databaseName,
      allocatedStorage: dbConfig.allocatedStorageGb,
      // gp3 is the current generation and is cheaper per GB than gp2 while
      // giving baseline IOPS that do not depend on volume size.
      storageType: StorageType.GP3,
      // No autoscaling ceiling: storage that grows on its own is storage that
      // bills on its own. 20 GB is far beyond what five tables of flashcards
      // will use, and hitting it would mean something is wrong.
      multiAz: dbConfig.multiAz,
      backupRetention: Duration.days(dbConfig.backupRetentionDays),
      deletionProtection: dbConfig.deletionProtection,
      // dev is disposable; prod keeps a final snapshot so an accidental teardown
      // is recoverable rather than terminal.
      removalPolicy:
        config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      deleteAutomatedBackups: config.envName !== 'prod',
      // Never. This is what keeps the instance off the public internet, and it
      // is also why it is in an isolated subnet with no NAT.
      publiclyAccessible: false,
      // Free-tier storage encryption. There is no reason not to.
      storageEncrypted: true,
      // Off: Performance Insights is free only for 7 days of retention on some
      // instance classes and bills on others, and there is no query-tuning work
      // in this phase that would read it.
      enablePerformanceInsights: false,
      // Minor versions only, in a window when nobody is studying. A major
      // upgrade is a decision, never an automatic one.
      autoMinorVersionUpgrade: true,
      preferredMaintenanceWindow: 'Sun:04:00-Sun:05:00',
      preferredBackupWindow: '03:00-04:00',
      // Postgres logs to CloudWatch so a failed migration leaves evidence. The
      // retention P8 configured does not apply to RDS-exported log groups, which
      // create themselves with never-expire — a known gap, called out here
      // rather than silently inherited. Worth a follow-up in Phase F cleanup.
      cloudwatchLogsExports: ['postgresql'],
    });

    // ── Connection details, for the API stack and the migration runner ──────
    //
    // Plain String parameters, not SecureString: a hostname and a database name
    // are not secrets, and marking them so would force a KMS decrypt call from
    // a VPC with no KMS endpoint. Only the password is sensitive, and it stays
    // in the generated secret.
    new StringParameter(this, 'DbHostParam', {
      parameterName: dbParameterPath(config.envName, 'host'),
      stringValue: this.database.dbInstanceEndpointAddress,
      description: 'RDS endpoint hostname. Not a secret.',
    });
    new StringParameter(this, 'DbPortParam', {
      parameterName: dbParameterPath(config.envName, 'port'),
      stringValue: this.database.dbInstanceEndpointPort,
      description: 'RDS port. Not a secret.',
    });
    new StringParameter(this, 'DbNameParam', {
      parameterName: dbParameterPath(config.envName, 'name'),
      stringValue: this.databaseName,
      description: 'Database name. Not a secret.',
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'DbEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'RDS endpoint. Reachable only from inside the VPC.',
      exportName: `SynapseDeck-${config.envName}-DbEndpoint`,
    });
    new CfnOutput(this, 'DbSecretName', {
      // The name, not the value. CloudFormation outputs are readable by anyone
      // with describe-stacks, so a password here would be a password published.
      value: this.database.secret?.secretName ?? 'none',
      description: 'Secrets Manager secret holding the database password.',
    });
    new CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC with no NAT Gateway. Lambdas here have no internet route.',
      exportName: `SynapseDeck-${config.envName}-VpcId`,
    });
    new CfnOutput(this, 'DbClientSecurityGroupId', {
      value: this.databaseSecurityGroup.securityGroupId,
      description: 'Attach to anything that needs to reach the database.',
      exportName: `SynapseDeck-${config.envName}-DbClientSgId`,
    });
  }
}
