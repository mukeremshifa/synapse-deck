/**
 * The API client. `fetch`, with a Cognito access token attached.
 *
 * Replaces `src/lib/supabase.ts` for everything P9 moved: identity, decks,
 * cards, reviews and the practice queue. `supabase.ts` **stays** for what P9
 * deliberately did not move — `/progress` and card generation — until Phase F.
 * See the split table in docs/plans/P9-aws-slice.md.
 *
 * ── The token is fetched per request, never cached ────────────────────────
 *
 * `getSession()` returns the stored session and silently refreshes it if the
 * access token has expired, so calling it on every request is what keeps a long
 * session working. Caching the token in a module variable would work for an
 * hour and then fail, which is the worst possible interval to debug.
 *
 * ── What this client does not do ──────────────────────────────────────────
 *
 * **It does not send a user id.** Not in the body, not as a parameter, not as a
 * header. The server reads `sub` from the verified token and ignores anything
 * the client claims (ADR 0008). A client-supplied user id would be the single
 * most dangerous thing this file could add, which is why `currentUserId()` was
 * deleted from `queries.ts` rather than ported: a function that *looks* like it
 * scopes queries is worse than having none.
 */

import { getSession } from './cognito';
import { env } from './env';

/**
 * An error carrying the status and the server's error code.
 *
 * `code` is what `isStaleCardError` matches on, and it is the same `PT409` the
 * database raises — passed through API Gateway rather than translated, so the
 * client's handling of a stale rating did not have to change with the backend.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** Field-level messages from the server's Zod parse, if any. */
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiErrorBody {
  error?: string;
  code?: string;
  issues?: { path: string; message: string }[];
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const session = await getSession();
  if (!session) {
    // Not a network call at all. Being signed out is knowable here, and a 401
    // from the server would say the same thing a round trip later.
    throw new ApiError(401, 'You are signed out. Sign in and try again.');
  }

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    ...(init.signal ? { signal: init.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);

  if (!response.ok) {
    const body = parsed as ApiErrorBody;
    throw new ApiError(
      response.status,
      body.error ?? `Request failed (${response.status}).`,
      body.code,
      body.issues,
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
