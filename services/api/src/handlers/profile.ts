/**
 * `/profile` — the signed-in user's settings.
 *
 * A handler's whole job, here and in every other file in this directory:
 *
 *   1. read `sub` from the authorizer (never from the body),
 *   2. validate the body with the shared Zod schemas,
 *   3. call the data layer,
 *   4. map the result to a status code.
 *
 * **No SQL lives here.** `scripts/check-data-access.mjs` fails the build on it,
 * and the reason is not tidiness: the ownership rule is only auditable if there
 * is exactly one directory to audit (ADR 0008).
 */

import { ensureProfile, updateProfile } from '../data/profiles.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  queryParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError } from '../lib/rows.ts';
import { ProfileSettings } from '../lib/schemas.ts';

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    switch (method) {
      case 'GET':
        // Not `getProfile`: on RDS the row is created on first authenticated
        // request rather than by a trigger on `auth.users`, which does not
        // exist here. This is that first request, for a brand-new account.
        //
        // `?tz=` is the browser's detected zone, used only when the row is
        // created. It is a convenience, not an authority — see `ensureProfile`.
        return json(200, await ensureProfile(userId, queryParam(event, 'tz')));

      case 'PATCH': {
        const settings = ProfileSettings.parse(readJsonBody(event));
        const updated = await updateProfile(userId, {
          display_name: settings.display_name?.trim() || null,
          timezone: settings.timezone,
          daily_new_limit: settings.daily_new_limit,
        });
        // No row means no profile yet — the account updated its settings before
        // anything read them. Create it, then apply the update.
        if (!updated) {
          await ensureProfile(userId);
          const retried = await updateProfile(userId, {
            display_name: settings.display_name?.trim() || null,
            timezone: settings.timezone,
            daily_new_limit: settings.daily_new_limit,
          });
          if (!retried) throw new ApiError(500, 'The profile could not be updated.');
          return json(200, retried);
        }
        return json(200, updated);
      }

      default:
        throw new ApiError(405, `${method} is not allowed here.`);
    }
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
