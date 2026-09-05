import { ClientEnv } from './env-schema';

const parsed = ClientEnv.safeParse({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_COGNITO_USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  // Fail loudly at startup rather than as a confusing 401 on the first query.
  const issues = parsed.error.issues.map(issue => `  - ${issue.message}`).join('\n');
  throw new Error(
    `Missing or invalid environment variables:\n${issues}\n\n` +
      'Copy .env.example to .env.local and fill in your Supabase project values.',
  );
}

export const env = parsed.data;
