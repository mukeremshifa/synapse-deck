/**
 * `POST /uploads` — a presigned PUT for one document.
 *
 * The smallest handler in the project, and it follows the same four steps as
 * every other: read `sub` from the authorizer, validate the body, call the data
 * layer, map errors. It builds no key and signs nothing itself — the key is
 * where the tenancy boundary lives, so it belongs in `data/uploads.ts`.
 *
 * No SQL and no datastore call here. See `handlers/profile.ts` for the pattern.
 */

import { createUploadTicket } from '../data/uploads.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError } from '../lib/rows.ts';
import { UploadRequest } from '../lib/schemas.ts';

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);

    const parsed = UploadRequest.safeParse(readJsonBody(event));
    if (!parsed.success) {
      // The client validates too, so reaching this is either a bug or a caller
      // that is not the SPA. Either way the message names the field rather than
      // returning a bare 400.
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid upload request.');
    }

    const ticket = await createUploadTicket(userId, parsed.data);
    return json(200, ticket);
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
