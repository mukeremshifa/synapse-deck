import { z } from 'zod';

/**
 * Side-effect-free so it can be reasoned about directly. `env.ts` applies it to
 * `import.meta.env` and throws; this module only describes the contract.
 *
 * ── Which variables are required depends on the mode ──────────────────────
 *
 * `VITE_API_MODE` chooses the backend: `fake` (the default) runs against the
 * in-memory implementation in `src/lib/api/fake.ts`, `live` runs against
 * Cognito and API Gateway.
 *
 * **The AWS variables are required only in `live` mode**, and that conditional
 * is load-bearing rather than tidy. They used to be unconditionally required,
 * so `env.ts` threw at startup for anyone without them — meaning a fresh clone
 * could not run `npm run dev` at all. The whole point of the fake (FR0, brief
 * §2.2(3)) is that the frontend can be built with no backend and no
 * credentials, and a schema that refuses to boot without them defeats it.
 *
 * The cost is named in FR0 §7.5 and is real: **a missing variable in `live`
 * mode is now a runtime failure where it used to be a startup one.** A
 * misconfigured deployment fails at the first request rather than at boot. That
 * is the price of a repo a new session can run, and it was paid knowingly.
 *
 * None of the AWS values is a secret: a user pool id and a public app client id
 * are in every browser bundle that talks to Cognito, by design, and the API
 * endpoint is useless without a valid token.
 *
 * ── What happened to the Supabase variables ───────────────────────────────
 *
 * Removed at FR0, with the Supabase client itself (brief §2.3). Carrying a
 * second backend into a re-architecture is how "two backends, for one phase"
 * becomes permanent.
 *
 * **The `sb_secret_…` refusal went with them, and that is not a weakening.**
 * Three `.refine` calls used to guard `VITE_SUPABASE_PUBLISHABLE_KEY` against a
 * secret key reaching the browser bundle. That variable no longer exists and is
 * no longer read anywhere, so the refusal had nothing left to refuse — a check
 * on a variable nothing reads is dead code, not a security boundary.
 *
 * It **looks** identical to a weakening in a diff, which is exactly why it is
 * written down here, in the commit message, and in FR0 §6.2. If any Supabase
 * variable is ever reintroduced, **its refusal is reintroduced with it,
 * unchanged.** CLAUDE.md, AGENTS.md §7 and the brief each say separately not to
 * weaken it, and none of them is being overridden here.
 */

export const ApiMode = z.enum(['fake', 'live']);
export type ApiMode = z.infer<typeof ApiMode>;

const AwsVars = z.object({
  VITE_API_URL: z
    .string()
    .url('VITE_API_URL must be a URL — the API Gateway endpoint from SynapseDeck-Api-dev'),

  VITE_COGNITO_USER_POOL_ID: z
    .string()
    .min(1, 'VITE_COGNITO_USER_POOL_ID is required')
    // us-east-1_XXXXXXXXX. Checked for shape because a pool id pasted with the
    // region missing fails as an opaque network error at first sign-in.
    .regex(/^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/, {
      message:
        'Expected a Cognito user pool id like "us-east-1_ABC123def" — the ' +
        'UserPoolId output of the SynapseDeck-Auth-dev stack.',
    }),

  VITE_COGNITO_CLIENT_ID: z
    .string()
    .min(1, 'VITE_COGNITO_CLIENT_ID is required')
    /*
     * The app client has **no secret** (ADR 0007, and infra/lib/auth-stack.ts):
     * a browser SPA cannot hold one, because shipping it in a bundle is
     * publishing it. If a value here ever arrives paired with a secret, the
     * client was created wrong rather than configured wrong.
     */
    .regex(/^[a-z0-9]{10,}$/, {
      message:
        'Expected a Cognito app client id — the UserPoolClientId output of the ' +
        'SynapseDeck-Auth-dev stack.',
    }),
});

/**
 * The client's environment.
 *
 * A discriminated union on the mode rather than a `superRefine`, so the *type*
 * carries the difference too: in `fake` mode the AWS fields are optional and
 * anything reading them has to say what it does when they are absent.
 */
export const ClientEnv = z.discriminatedUnion('VITE_API_MODE', [
  z
    .object({ VITE_API_MODE: z.literal('fake') })
    // Still parsed when present, so a developer with a `.env.local` who flips to
    // fake mode finds a malformed value now rather than when they flip back.
    .merge(AwsVars.partial()),
  z.object({ VITE_API_MODE: z.literal('live') }).merge(AwsVars),
]);

export type ClientEnv = z.infer<typeof ClientEnv>;
