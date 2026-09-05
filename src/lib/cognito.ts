/**
 * Cognito, wrapped in the shape the app already expected of Supabase Auth.
 *
 * ── Why a wrapper rather than the SDK at every call site ──────────────────
 *
 * ADR 0007 chose Cognito with **no hosted UI**: the app's own sign-in screens
 * stay exactly as they are, because redirecting to an Amazon-branded page to
 * log into a portfolio piece would be a visible downgrade. That decision only
 * holds if the screens do not have to be rewritten around a callback-based SDK,
 * so this module turns `amazon-cognito-identity-js`'s callback API into the
 * promise-returning functions `AuthPages.tsx` was already calling.
 *
 * The result is that `src/features/auth/` changes its imports and almost
 * nothing else — which is what P9 task 8 asks for.
 *
 * ── What Cognito gives us for free, and what it does not ──────────────────
 *
 * `CognitoUserSession` handles token storage (local storage, per pool and
 * client) and refresh. `getSession` below silently exchanges an expired access
 * token for a new one using the 30-day refresh token, which is why the app does
 * not need a refresh loop of its own.
 *
 * What it does not give us is Supabase's `onAuthStateChange`. Cognito has no
 * event stream, so `AuthProvider` polls its own store on mount and on focus —
 * see the comment there.
 *
 * ── SRP, not the password ─────────────────────────────────────────────────
 *
 * `authenticateUser` uses SRP: the password is never sent, not even inside TLS.
 * The user pool deliberately does not enable `USER_PASSWORD_AUTH` for the web
 * client (infra/lib/auth-stack.ts), so this is the only flow available to a
 * browser — a mistake here fails rather than silently downgrading.
 */

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { env } from './env';

const userPool = new CognitoUserPool({
  UserPoolId: env.VITE_COGNITO_USER_POOL_ID,
  ClientId: env.VITE_COGNITO_CLIENT_ID,
  // No `ClientSecret`: the app client is created without one, because a browser
  // SPA cannot hold a secret (ADR 0007).
});

/**
 * The session, in the shape the app uses.
 *
 * `userId` is the Cognito `sub` — the same value the API reads from the
 * verified token and puts into `where user_id = $1`. It is exposed here for
 * display and cache-keying only: **the client's copy of it authorises nothing.**
 * The server reads its own from the token and ignores anything the client says,
 * which is why `currentUserId()` was deleted rather than ported (P9 task 8).
 */
export interface AuthSession {
  userId: string;
  email: string;
  /** The bearer token for the API. Short-lived; re-read it, never cache it. */
  accessToken: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

function toSession(session: CognitoUserSession): AuthSession | null {
  if (!session.isValid()) return null;
  const accessToken = session.getAccessToken();
  const claims = session.getIdToken().payload;
  const sub = claims['sub'];
  if (typeof sub !== 'string') return null;
  return {
    userId: sub,
    email: typeof claims['email'] === 'string' ? claims['email'] : '',
    accessToken: accessToken.getJwtToken(),
    expiresAt: accessToken.getExpiration(),
  };
}

/**
 * Cognito's errors are `NotAuthorizedException`, `UserNotFoundException` and
 * friends, with messages written for an API consumer rather than a person.
 *
 * `preventUserExistenceErrors` is on in the pool, so Cognito already answers
 * "no such user" and "wrong password" identically — the mapping below must not
 * undo that by being more specific than Cognito was.
 */
function friendlyError(error: unknown): Error {
  const code = (error as { name?: string; code?: string } | null)?.name ??
    (error as { code?: string } | null)?.code ??
    '';
  const message = (error as { message?: string } | null)?.message ?? 'Something went wrong.';

  switch (code) {
    case 'NotAuthorizedException':
      return new Error('That email and password do not match an account.');
    case 'UserNotConfirmedException':
      return new Error('Check your email for the confirmation link, then sign in.');
    case 'UsernameExistsException':
      return new Error('An account with that email already exists.');
    case 'InvalidPasswordException':
      return new Error('That password does not meet the requirements.');
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return new Error('That confirmation code is wrong or has expired.');
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new Error('Too many attempts. Wait a minute and try again.');
    default:
      return new Error(message);
  }
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const details = new AuthenticationDetails({ Username: email, Password: password });

  return new Promise<AuthSession>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: session => {
        const mapped = toSession(session);
        if (!mapped) {
          reject(new Error('Signed in, but the session was not valid. Try again.'));
          return;
        }
        resolve(mapped);
      },
      onFailure: error => reject(friendlyError(error)),
      // A user created by an administrator starts in FORCE_CHANGE_PASSWORD.
      // Nothing in this app creates one — signup is self-service — so reaching
      // here means the account was made in the console, and saying so beats
      // hanging on a callback that never resolves.
      newPasswordRequired: () =>
        reject(
          new Error(
            'This account must set a new password before signing in. It was created ' +
              'administratively rather than through the app.',
          ),
        ),
    });
  });
}

export interface SignUpResult {
  /**
   * Whether Cognito considers the account ready to use. With `autoVerify` on
   * the pool, an emailed link still has to be followed — so this is normally
   * false and the screen says to check email, matching what Supabase did.
   */
  confirmed: boolean;
}

export async function signUp(
  email: string,
  password: string,
  displayName?: string,
): Promise<SignUpResult> {
  const attributes = [new CognitoUserAttribute({ Name: 'email', Value: email })];
  if (displayName) {
    // `custom:displayName` exists for what the signup screen can collect before
    // a profile row exists. The row in RDS stays the source of truth.
    attributes.push(
      new CognitoUserAttribute({ Name: 'custom:displayName', Value: displayName }),
    );
  }

  return new Promise<SignUpResult>((resolve, reject) => {
    userPool.signUp(email, password, attributes, [], (error, result) => {
      if (error) {
        reject(friendlyError(error));
        return;
      }
      resolve({ confirmed: result?.userConfirmed === true });
    });
  });
}

/** Confirm a signup with the emailed code. */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise<void>((resolve, reject) => {
    user.confirmRegistration(code, true, error => {
      if (error) reject(friendlyError(error));
      else resolve();
    });
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise<void>((resolve, reject) => {
    user.resendConfirmationCode(error => {
      if (error) reject(friendlyError(error));
      else resolve();
    });
  });
}

/**
 * The stored session, refreshed if the access token has expired.
 *
 * `getSession` does the refresh itself using the 30-day refresh token, so this
 * is both "am I signed in?" and "give me a usable token". Every API call goes
 * through it rather than caching a token, because a cached token is a token
 * that expires mid-session.
 *
 * Returns null rather than throwing when signed out: being signed out is an
 * ordinary state, not an error.
 */
export async function getSession(): Promise<AuthSession | null> {
  const user = userPool.getCurrentUser();
  if (!user) return null;

  return new Promise<AuthSession | null>(resolve => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session) {
        resolve(null);
        return;
      }
      resolve(toSession(session));
    });
  });
}

/**
 * Sign out, everywhere.
 *
 * `globalSignOut` revokes the refresh token server-side rather than only
 * clearing local storage — the pool has `enableTokenRevocation`, and a sign-out
 * that leaves a working refresh token on a shared machine is not a sign-out.
 * It needs a valid session to call, so a local `signOut` always follows and is
 * what actually clears this browser.
 */
export async function signOut(): Promise<void> {
  const user = userPool.getCurrentUser();
  if (!user) return;

  await new Promise<void>(resolve => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session) {
        resolve();
        return;
      }
      user.globalSignOut({
        onSuccess: () => resolve(),
        // Best effort. A network failure here must not leave the user stuck
        // signed in locally, which the unconditional signOut below prevents.
        onFailure: () => resolve(),
      });
    });
  });

  user.signOut();
}
