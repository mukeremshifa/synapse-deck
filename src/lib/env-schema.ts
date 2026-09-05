import { z } from 'zod';

/**
 * Side-effect-free so it can be tested directly. `env.ts` applies it to
 * `import.meta.env` and throws; this module only describes the contract.
 *
 * ── Two backends, deliberately, for one phase ─────────────────────────────
 *
 * P9 moved identity, decks, cards and reviews to Cognito and the AWS API. It
 * did **not** move `/progress` or card generation, which still read Supabase —
 * see the split table in docs/plans/P9-aws-slice.md for why porting either now
 * would mean building it twice. So both sets of variables are required, and
 * both will be until Phase F retires the Supabase project.
 *
 * SPEC §10: only the Supabase URL and the *publishable* key may reach the
 * browser. Supabase's modern key system (`sb_publishable_…` / `sb_secret_…`)
 * replaces the legacy `anon` / `service_role` JWTs, which are deprecated at the
 * end of 2026. The publishable key carries no privileges of its own — requests
 * run as the `anon` or `authenticated` Postgres role, so RLS remains the
 * security boundary **on Supabase**.
 *
 * **It is not the boundary on AWS.** There, the JWT authorizer verifies the
 * token and the data-access layer filters every query by `user_id` (ADR 0008).
 * None of the AWS values below is a secret either: a user pool id and a public
 * app client id are in every browser bundle that talks to Cognito, by design.
 */
export const ClientEnv = z.object({
  // ── AWS (P9) ──────────────────────────────────────────────────────────────
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

  // ── Supabase (until Phase F) ──────────────────────────────────────────────
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL must be a URL'),

  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'VITE_SUPABASE_PUBLISHABLE_KEY is required')
    /*
     * The important check. A secret key in a client bundle is a total RLS bypass:
     * it maps to `service_role`, which holds BYPASSRLS. Supabase refuses secret
     * keys sent from a browser User-Agent, but the key would still sit in the
     * shipped JavaScript for anyone to lift and replay from curl. Refuse to boot
     * rather than ship it.
     */
    .refine(key => !key.startsWith('sb_secret_'), {
      message:
        'That is a SECRET key. It bypasses row level security and must never reach the ' +
        'browser — use the publishable key (sb_publishable_…) here.',
    })
    .refine(key => !key.startsWith('eyJ'), {
      message:
        'That looks like a legacy JWT key (anon/service_role). This project uses the ' +
        'modern key system — copy the publishable key (sb_publishable_…) from ' +
        'Supabase → Settings → API Keys.',
    })
    .refine(key => key.startsWith('sb_publishable_'), {
      message: 'Expected a publishable key beginning with "sb_publishable_".',
    }),
});

export type ClientEnv = z.infer<typeof ClientEnv>;
