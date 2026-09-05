/**
 * Cognito: the identity half of P9. A separate stack from the foundation on
 * purpose — identity has a different lifecycle from observability, and a
 * mistake in a user pool should not force a redeploy of the alarms that would
 * tell you about it.
 *
 * It replaces Supabase Auth, which today issues the JWT that RLS reads through
 * `auth.uid()`. After P9 there is no `auth.uid()`: the `sub` claim in the token
 * this pool issues is verified by API Gateway's JWT authorizer, handed to the
 * handler in the authorizer context, and passed as the first argument to every
 * data-access function. That chain is the entire security boundary now. See
 * ADR 0007 for why Cognito rather than staying on Supabase Auth or running
 * something self-hosted.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * **No hosted UI, and no domain to serve one from** (ADR 0007). The app already
 * has sign-in screens in `src/features/auth/`, they match the rest of the
 * product, and redirecting to an Amazon-branded page to log into a portfolio
 * piece would be a visible downgrade. The SDK talks to the pool directly.
 *
 * **No pre-token-generation Lambda.** The claim we want is `sub`, which every
 * token already carries. A Lambda here would be a cold start on the login path
 * to add nothing.
 *
 * **No app client secret.** A browser SPA cannot hold one — shipping it in a
 * bundle is publishing it — and Cognito's SRP flow does not need it.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  BooleanAttribute,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolEmail,
  type UserPoolProps,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { EnvConfig } from './config.ts';

export interface AuthStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class AuthStack extends Stack {
  /** Consumed by the API stack's JWT authorizer. */
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    // ── The user pool ───────────────────────────────────────────────────────
    //
    // Email sign-in and self-service signup, matching what Supabase Auth does
    // today. Task 4 starts this empty: no users are migrated, the owner signs up
    // through the app's own screens, and every `user_id` written from that point
    // on is a Cognito `sub`.
    const userPoolProps: UserPoolProps = {
      userPoolName: `synapsedeck-${config.envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      // Without this an email address can be registered twice, which turns
      // "sign in with your email" into an ambiguous instruction.
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      customAttributes: {
        // Carried for parity with `profiles.display_name`, which the app shows.
        // The profile row in RDS remains the source of truth — this is only what
        // the signup screen can collect before that row exists.
        displayName: new StringAttribute({ minLen: 0, maxLen: 100, mutable: true }),
        // Reserved for P9 task 4's re-seeded demo account, so a demo user can be
        // recognised without hardcoding its `sub` anywhere.
        isDemo: new BooleanAttribute({ mutable: true }),
      },
      // Cognito's own default is 8 characters with every class required. Relaxed
      // to match what the app's existing signup screen already validates, so the
      // client-side message and the server-side rule cannot disagree — a
      // password rejected only by the server, after a round trip, with a raw AWS
      // error string, is the worst version of this.
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Cognito's built-in sender: 50 emails/day, free, and no domain to verify.
      // That ceiling is fine for a portfolio project and would not be for a real
      // product — the upgrade is SES, and it is a one-line change here plus a
      // verified domain. Named rather than defaulted so the ceiling is visible
      // to whoever hits it.
      email: UserPoolEmail.withCognito(),
      // dev is disposable by design. prod is RETAIN because deleting a user pool
      // deletes every account in it, irreversibly, and no stack operation should
      // be able to do that as a side effect.
      removalPolicy: config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      // Off deliberately: advanced security features are billed per monthly
      // active user and the brief's §6 budget has no line for them.
      deletionProtection: config.envName === 'prod',
    };

    this.userPool = new UserPool(this, 'UserPool', userPoolProps);

    // ── The app client ──────────────────────────────────────────────────────
    //
    // One client, for the browser SPA. No secret (see the header).
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `synapsedeck-${config.envName}-web`,
      generateSecret: false,
      // SRP for sign-in, and the refresh flow so a session survives a reload.
      // USER_PASSWORD_AUTH is deliberately absent: it sends the password to
      // Cognito in the clear (inside TLS, but visible to anything that
      // terminates it), and SRP exists precisely to avoid that.
      authFlows: {
        userSrp: true,
        // Needed by `npm run demo:seed` (task 4), which has no browser to run
        // SRP in. Admin-only: it is callable with IAM credentials, never from
        // the client, so it does not widen what the SPA can do.
        adminUserPassword: true,
      },
      // OAuth is switched off entirely rather than configured with no flows.
      //
      // Setting `oAuth: { flows: { …: false }, scopes: […] }` looks equivalent
      // and is not: CDK still emits AllowedOAuthFlowsUserPoolClient: true with
      // an empty AllowedOAuthFlows, and Cognito rejects that combination at
      // deploy time. `disableOAuth` emits the flag as false, which is what a
      // client that authenticates over SRP and never redirects actually wants.
      //
      // There is no hosted UI (ADR 0007) and therefore no callback URL, so
      // there is no redirect to authorise. When Phase G adds CloudFront this
      // stays untouched — CloudFront serves the SPA, it does not change how the
      // SPA authenticates.
      disableOAuth: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      // An access token is what the API authorizer checks, so its lifetime is
      // how long a revoked user keeps working. One hour is the Cognito maximum
      // for the short-lived pair and a reasonable blast radius.
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      // 30 days of "stay signed in" for a study app that people open daily.
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
      // Cognito otherwise answers "no such user" differently from "wrong
      // password", which is a free user-enumeration oracle on a public signup.
      preventUserExistenceErrors: true,
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    //
    // The API stack takes the pool by object reference (same app, same account),
    // so these outputs are for the *frontend* — task 8's `api-client.ts` needs
    // the pool and client ids at build time, and reading them from a deployed
    // stack beats copying them into a file by hand.
    //
    // None of these is a secret. A pool id and a public client id are in every
    // browser bundle that talks to Cognito, by design.
    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID',
      exportName: `SynapseDeck-${config.envName}-UserPoolId`,
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
      exportName: `SynapseDeck-${config.envName}-UserPoolClientId`,
    });
    new CfnOutput(this, 'UserPoolIssuerUrl', {
      // What the JWT authorizer validates `iss` against, and what an OIDC client
      // appends /.well-known/openid-configuration to.
      value: `https://cognito-idp.${config.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'OIDC issuer. The JWT authorizer validates iss against this.',
      exportName: `SynapseDeck-${config.envName}-UserPoolIssuer`,
    });
  }
}
