import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Everything behind the app shell needs a session.
 *
 * While `loading` this renders nothing at all — not a redirect, not a spinner
 * that immediately replaces itself. Redirecting during the first tick is what
 * makes an app flash the login page on every refresh, and a signed-in user
 * bounced to /login by their own reload will not trust the app again.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!session) {
    // Remember where they were headed, so signing in resumes it rather than
    // dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/**
 * The mirror image: keep a signed-in user off /login, /signup — and, from P7,
 * off the landing page. Somebody with a session who opens `/` typed the bare
 * domain out of habit and wants the app, not a pitch for a product they already
 * use, so /dashboard is where all three send them.
 */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (session) return <Navigate to="/notebooks" replace />;
  return <>{children}</>;
}
