import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { confirmSignUp } from '@/lib/cognito';
import { getSession } from '@/lib/cognito';

/**
 * `/auth/callback` (SPEC §8.2) — where an email confirmation lands.
 *
 * ── What changed at P9, and why this page got simpler ─────────────────────
 *
 * Under Supabase this page handled two token-bearing shapes: an implicit
 * fragment that supabase-js had already consumed, and a PKCE `?code=` that had
 * to be exchanged. **Cognito does neither.**
 *
 * Cognito's built-in confirmation email carries a *code*, and the account is
 * confirmed by calling `ConfirmSignUp` with it — not by an OAuth exchange, and
 * not by a redirect that establishes a session. There is no hosted UI and no
 * OAuth flow at all on this pool (ADR 0007; `disableOAuth` in
 * `infra/lib/auth-stack.ts`), so a `?code=` here is a confirmation code rather
 * than an authorization code, and confirming does **not** sign the user in.
 *
 * So the flow is: confirm the account, then send them to /login to sign in.
 * That is one extra step compared to Supabase, and it is stated rather than
 * papered over — signing them in here would mean holding the password, which
 * this page does not have and should not.
 *
 * The route is kept rather than deleted for two reasons: links already sent
 * point at it, and Cognito's email template is configured to.
 *
 * Not wrapped in `PublicOnlyRoute`: an unauthenticated visitor is exactly who
 * arrives here, and nobody stays.
 */

/** Parameters may arrive in `?query` or `#fragment`; the names are identical. */
function readCallbackParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const query = parsed.searchParams;
  for (const [key, value] of fragment) if (!query.has(key)) query.append(key, value);
  return query;
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Confirming your account…');
  // StrictMode mounts effects twice in development, and a confirmation code is
  // single-use: the second call would fail and bounce a valid link.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = readCallbackParams(window.location.href);

    const toLogin = (message: string) => {
      navigate('/login', { replace: true, state: { authMessage: message } });
    };

    void (async () => {
      const error = params.get('error') ?? params.get('error_code');
      if (error) {
        const description = params.get('error_description') ?? error;
        console.error('Auth callback rejected:', description);
        setStatus('That link could not be used.');
        toLogin(
          `${description.replace(/\+/g, ' ')}. Links expire, and each one works only once — request a new email and try again.`,
        );
        return;
      }

      // Cognito's confirmation link carries the code and the account it belongs
      // to. Both are needed: `ConfirmSignUp` is not scoped to a session, since
      // the whole point is that nobody is signed in yet.
      const code = params.get('confirmation_code') ?? params.get('code');
      const email = params.get('user_name') ?? params.get('email');

      if (code && email) {
        try {
          await confirmSignUp(email, code);
        } catch (confirmError) {
          console.error('Confirmation failed:', confirmError);
          setStatus('That link could not be used.');
          toLogin(
            confirmError instanceof Error
              ? confirmError.message
              : 'That confirmation link could not be used.',
          );
          return;
        }
        setStatus('Account confirmed.');
        toLogin('Your account is confirmed. Sign in to get started.');
        return;
      }

      // Already signed in — someone opened the link in a browser that has a
      // session. Nothing to confirm; send them where they were going.
      if (await getSession()) {
        navigate('/dashboard', { replace: true });
        return;
      }

      // No error, no code, no session: the URL was opened directly, or the
      // parameters were stripped by something in front of the app.
      setStatus('That link could not be used.');
      toLogin('That confirmation link was not valid. Sign in with your email and password.');
    })();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-12">
      {/* A bare line of grey text on a white page is what a broken redirect
          looks like. The mark says the link landed somewhere real. */}
      <LogoLockup />
      <p className="text-muted-foreground text-center text-sm" role="status">
        {status}
      </p>
    </main>
  );
}
