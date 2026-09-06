/**
 * `POST /uploads` — a ticket for one document, and `PUT /uploads/{objectId}`,
 * which accepts the bytes when the local store is in use.
 *
 * The smallest handler in the project, and it follows the same four steps as
 * every other: read `sub` from the authorizer, validate the body, call the data
 * layer, map errors. It builds no key and signs nothing itself — the key is
 * where the tenancy boundary lives, so it belongs in `data/uploads.ts`.
 *
 * No SQL and no datastore call here. See `handlers/profile.ts` for the pattern.
 */

import { createUploadTicket, putDocument, uploadKeyFor } from '../data/uploads.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  pathParam,
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

    // `PUT /uploads/{objectId}` — the local store's write path (DS1 task 6).
    //
    // It exists only when `UPLOAD_STORE=local`; on the S3 path the browser PUTs
    // to a presigned URL and never reaches the API at all. `putDocument` in the
    // data layer refuses when the store is not local, so this handler does not
    // branch on the store and the seam stays where it belongs.
    //
    // **The key is built here from the verified `sub`, never read from the
    // path.** The client supplies only an object id; the prefix comes from the
    // token. So there is no request shape that writes into another user's
    // prefix, which is the same property the presigned URL has on S3 and the
    // reason `uploadKeyFor` is the data layer's function rather than this
    // file's.
    if (method === 'PUT') {
      const objectId = pathParam(event, 'objectId');

      // The object id carries its extension (`<uuid>.txt`), and both halves are
      // constrained: a UUID, then an extension from the accepted list. Anything
      // else is refused before it can become a path segment. This is belt and
      // braces over `assertOwnedKey` and the root resolution in the data layer,
      // and it is cheap.
      const match = /^([0-9a-f-]{36})(\.[a-z]{1,5})$/i.exec(objectId);
      if (match === null) throw new ApiError(400, 'Malformed upload id.');

      const body = event.body ?? '';
      // API Gateway base64-encodes a binary body; `dev-api.mjs` does the same
      // for parity. A text upload arrives as text either way, so both are
      // handled rather than assuming one.
      const bytes = event.isBase64Encoded
        ? Buffer.from(body, 'base64')
        : Buffer.from(body, 'utf8');

      if (bytes.byteLength === 0) throw new ApiError(400, 'That file is empty.');

      await putDocument(userId, uploadKeyFor(userId, match[1]!, match[2]!), bytes);
      return noContent();
    }

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
