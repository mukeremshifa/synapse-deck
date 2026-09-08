import { ApiMode, ClientEnv } from './env-schema';

/**
 * The parsed environment.
 *
 * `VITE_API_MODE` defaults to `fake` when unset, which is what makes a fresh
 * clone runnable: `npm run dev` with no `.env.local` at all boots against the
 * in-memory fake rather than throwing on missing AWS variables (FR0 task 4).
 */
const mode = ApiMode.safeParse(import.meta.env.VITE_API_MODE);

const parsed = ClientEnv.safeParse({
  VITE_API_MODE: mode.success ? mode.data : 'fake',
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_COGNITO_USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
});

if (!parsed.success) {
  // Fail loudly at startup rather than as a confusing 401 on the first query.
  const issues = parsed.error.issues.map(issue => `  - ${issue.message}`).join('\n');
  throw new Error(
    `Missing or invalid environment variables:\n${issues}\n\n` +
      'VITE_API_MODE=live needs the three AWS values — copy .env.example to ' +
      '.env.local and fill them in. Unset (or "fake") needs nothing at all.',
  );
}

export const env = parsed.data;

/**
 * The AWS API URL, where the mode guarantees there is one.
 *
 * `env.VITE_API_URL` is `string | undefined` in fake mode, and the transport in
 * `api-client.ts` cannot be typed against a maybe-URL. Rather than assert one,
 * this throws with a sentence that says what went wrong — reachable only if
 * something calls the live transport in fake mode, which is a bug in the call
 * site rather than in the configuration.
 */
export function requireApiUrl(): string {
  if (env.VITE_API_URL === undefined) {
    throw new Error(
      'The live API was called while VITE_API_MODE is "fake". Set VITE_API_MODE=live ' +
        'and the three AWS variables, or use the fake client.',
    );
  }
  return env.VITE_API_URL;
}
