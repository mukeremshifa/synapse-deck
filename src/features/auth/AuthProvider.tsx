import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, signOut as cognitoSignOut, type AuthSession } from '@/lib/cognito';

type AuthContextValue = {
  session: AuthSession | null;
  /**
   * Kept as `user` with an `email` and an `id` so no consumer changed when the
   * backend did — `DashboardPage` reads `user?.email`, and rewriting a dozen
   * components to say `session.email` would have been a frontend change with
   * nothing behind it.
   */
  user: { id: string; email: string } | null;
  /** True until the first answer arrives. Never render a decision on this. */
  loading: boolean;
  /**
   * Re-read the stored session.
   *
   * This is the piece Supabase gave us for free and Cognito does not.
   * `supabase.auth.onAuthStateChange` pushed sign-in and sign-out events at the
   * provider; `amazon-cognito-identity-js` has no such stream, so whoever
   * changes the session has to say so. `LoginPage` awaits this before
   * navigating — without it the navigate races the provider and
   * `ProtectedRoute` bounces the user straight back to /login.
   */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The session, and nothing else.
 *
 * ── What changed at P9, and what did not ──────────────────────────────────
 *
 * Cognito replaced Supabase Auth (ADR 0007). `amazon-cognito-identity-js` keeps
 * the tokens in local storage and refreshes the access token from the 30-day
 * refresh token, so this provider's job is unchanged in shape: make the current
 * session available to React, and say when it does not know yet — `loading`.
 * Every screen that cares must wait for it, because rendering "signed out"
 * during the first tick is what makes an app flash the login page on a refresh.
 *
 * Two things did change:
 *
 * 1. **There is no event stream**, so `refresh()` exists and callers use it.
 * 2. **The session is re-read when the tab regains focus.** A tab left open
 *    overnight has an access token that expired hours ago; `getSession` renews
 *    it silently, and doing that on focus means the first click after coming
 *    back works rather than 401-ing once and then working.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  /**
   * Cached decks and cards belong to whoever was signed in. Leaving them in
   * place across a change of user would show one account's data to the next —
   * so the cache is cleared whenever the identity changes, and deliberately not
   * when the same user's token is merely renewed.
   */
  const applySession = useCallback(
    (next: AuthSession | null) => {
      setSession(previous => {
        if (previous?.userId !== next?.userId) queryClient.clear();
        return next;
      });
      setLoading(false);
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    applySession(await getSession());
  }, [applySession]);

  useEffect(() => {
    let active = true;

    void getSession().then(next => {
      if (active) applySession(next);
    });

    // See the header: a tab left open overnight holds an expired access token,
    // and this is what renews it before the user's first click rather than
    // after it fails.
    const onFocus = () => {
      void getSession().then(next => {
        if (active) applySession(next);
      });
    };
    window.addEventListener('focus', onFocus);

    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session ? { id: session.userId, email: session.email } : null,
      loading,
      refresh,
      signOut: async () => {
        await cognitoSignOut();
        applySession(null);
      },
    }),
    [session, loading, refresh, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
