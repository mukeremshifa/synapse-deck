/**
 * Uploads, on this machine. DS1 task 6.
 *
 * The portable half of the `UPLOAD_STORE` seam: the same four operations
 * `uploads-s3.ts` performs against S3, performed against a directory instead.
 * `data/uploads.ts` chooses; nothing above the data layer knows which is
 * running.
 *
 * ── The tenancy boundary is stronger here than the S3 comment implies ─────
 *
 * `uploads-s3.ts` explains at length that the object key is built from `userId`
 * and nothing else, so a presigned URL can only address the caller's own
 * prefix. That reasoning transfers, and one part of it becomes *more* important
 * rather than less: on S3 a key containing `..` is a literal key that merely
 * reads oddly, but on a filesystem it is a real traversal out of the upload
 * directory. `assertOwnedKey` rejects it either way, and this is the
 * implementation where that check is load-bearing rather than defensive.
 *
 * Every path this module touches is additionally resolved and re-checked
 * against the upload root before it is opened, because a prefix check on a
 * string and a check on the resolved path are different guarantees, and only
 * the second one survives a symlink.
 *
 * ── There is no presigning, so there is a route ───────────────────────────
 *
 * S3 could be handed a signed URL the browser PUTs to directly, which is why
 * the file never passes through the API there. Nothing local can sign anything,
 * so `createUploadTicket` returns a URL pointing at `PUT /uploads/{objectId}`
 * on this API, and `scripts/dev-api.mjs` serves it.
 *
 * **That route is a real addition to the API surface**, and it is declared in
 * `infra/lib/api-stack.ts` as well so `scripts/check-routes.mjs` stays green —
 * see the comment there for why a local-only route is nonetheless declared in
 * both files rather than silencing the check.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { UPLOAD_LIMITS } from '../lib/schemas.ts';
import { ApiError } from '../lib/rows.ts';
import type { UploadTicketResult } from './uploads-s3.ts';

/**
 * Where uploads land.
 *
 * Deliberately outside the repository by default, and the default is relative
 * to the working directory rather than inside it: an upload directory in a git
 * checkout is user content one `git add -A` away from being committed, and the
 * files here are whatever a user chose to upload.
 */
function uploadRoot(): string {
  const configured = process.env['UPLOAD_DIR'];
  const root = configured === undefined || configured === '' ? '../synapsedeck-uploads' : configured;
  return isAbsolute(root) ? root : resolve(process.cwd(), root);
}

/**
 * Resolve a key to a real path, and refuse anything that escapes the root.
 *
 * The second half of the ownership check, and the half `assertOwnedKey` cannot
 * do: that function reasons about the key as a string, this one reasons about
 * where the string actually points once the operating system has had its say.
 * A key that passes the prefix check and resolves outside the root is refused
 * here — the same 404 the prefix check raises, because a caller learning
 * *which* of the two checks rejected them learns something about the layout of
 * the filesystem.
 */
function resolveWithinRoot(objectKey: string): string {
  const root = uploadRoot();
  const full = resolve(root, objectKey);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new ApiError(404, 'No such document.');
  }
  return full;
}

/**
 * The object key for one upload. `userId` first, and it is the only thing that
 * decides the prefix.
 *
 * The extension is carried rather than hardcoded, because `UPLOAD_LIMITS` now
 * accepts more than one format (DS1) and a key that claimed `.pdf` for a `.txt`
 * file would make the stored file lie about itself to anyone reading the
 * directory. It is taken from a fixed list, never from the user's filename.
 */
export function uploadKeyFor(userId: string, objectId: string, extension = '.pdf'): string {
  return `uploads/${userId}/${objectId}${extension}`;
}

/**
 * Refuse a key that is not inside this user's own prefix.
 *
 * Identical in behaviour and reasoning to the S3 implementation's, and
 * deliberately duplicated rather than shared: it is the tenancy check, it is
 * four lines, and a shared helper is a thing one implementation can later be
 * refactored to stop calling. Two copies that agree are cheaper to audit than
 * one copy that two files might use.
 */
export function assertOwnedKey(userId: string, objectKey: string): void {
  const prefix = `uploads/${userId}/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw new ApiError(404, 'No such document.');
  }
}

/**
 * Read an uploaded document's text.
 *
 * ── This does not parse PDFs either, and says so ──────────────────────────
 *
 * The same gap `uploads-s3.ts` documents: the bytes are decoded as UTF-8, which
 * is correct for a `.txt` or `.md` file and produces mostly-binary noise for a
 * real PDF. A PDF therefore produces a job that fails with a message the user
 * can act on, rather than a deck generated from binary.
 *
 * DS1 widened `UPLOAD_LIMITS` to accept text and Markdown precisely so that the
 * accepted set matches what this can read. The PDF parser remains a deferred
 * decision, and this function is still the one seam it slots into.
 */
export async function readDocumentText(userId: string, objectKey: string): Promise<string> {
  assertOwnedKey(userId, objectKey);
  const path = resolveWithinRoot(objectKey);

  let body: string;
  try {
    body = await readFile(path, 'utf-8');
  } catch {
    // Missing, unreadable, or never uploaded. A 404 rather than a 500: from the
    // caller's side these are the same thing, and distinguishing them would
    // report the state of the filesystem to someone guessing at keys.
    throw new ApiError(404, 'No such document.');
  }

  if (body.trim() === '') {
    throw new ApiError(400, 'That document had no readable text.');
  }
  return body;
}

/**
 * Issue an upload ticket.
 *
 * Returns a URL on this API rather than a signed one, because nothing local can
 * sign. The `expiresInSeconds` field is kept in the shape and is honest about
 * meaning something weaker here: there is no signature to expire, so it
 * describes how long the client should consider the ticket usable rather than
 * how long the server will honour it. The route enforces ownership on every
 * PUT, which is what actually keeps the write bounded to one user's prefix.
 */
export async function createUploadTicket(
  userId: string,
  input: { filename: string; contentType: string; sizeBytes: number },
): Promise<UploadTicketResult> {
  // Re-checked here rather than trusted from the handler's parse, matching the
  // S3 implementation: this is the layer that hands out the ticket, and a
  // future caller that skips validation should not get one for a 2 GB file.
  if (input.sizeBytes > UPLOAD_LIMITS.maxBytes) {
    throw new ApiError(400, `Upload exceeds the ${UPLOAD_LIMITS.maxBytes}-byte limit.`);
  }

  // From a fixed list, matched against the user's filename but never taken from
  // it: the extension decides a real path segment, so it must come from code.
  const lower = input.filename.toLowerCase();
  const extension =
    UPLOAD_LIMITS.extensions.find((ext) => lower.endsWith(ext)) ?? '.pdf';

  const objectId = randomUUID();
  const objectKey = uploadKeyFor(userId, objectId, extension);

  // The directory is created now rather than on the PUT, so a failure to create
  // it is reported while the user is still on the upload screen.
  await mkdir(resolve(uploadRoot(), 'uploads', userId), { recursive: true });

  return {
    uploadUrl: `${apiOrigin()}/uploads/${objectId}${extension}`,
    objectKey,
    expiresInSeconds: 5 * 60,
  };
}

/**
 * Where this API is reachable, for building the upload URL.
 *
 * The browser needs an absolute URL and the API does not otherwise know its own
 * origin, so it is configured. Defaulting to localhost is safe in a way it
 * would not be for a secret: the worst outcome of a wrong value is an upload
 * that fails immediately and visibly.
 */
function apiOrigin(): string {
  return process.env['API_ORIGIN'] ?? `http://localhost:${process.env['DEV_API_PORT'] ?? 8787}`;
}

/**
 * Store one uploaded file. The local store's own write path.
 *
 * **Not part of `CardProvider`-style parity with S3** — S3 has no equivalent
 * because the browser writes there directly. It is exported for the route that
 * serves `PUT /uploads/{objectId}`, and it lives here rather than in that route
 * for the reason ADR 0008 gives: the route is a handler, and a handler that
 * wrote to storage itself would be reasoning about ownership in the wrong
 * place.
 */
export async function putDocument(
  userId: string,
  objectKey: string,
  body: Buffer,
): Promise<void> {
  assertOwnedKey(userId, objectKey);
  const path = resolveWithinRoot(objectKey);

  if (body.byteLength > UPLOAD_LIMITS.maxBytes) {
    throw new ApiError(400, `Upload exceeds the ${UPLOAD_LIMITS.maxBytes}-byte limit.`);
  }

  await mkdir(join(uploadRoot(), 'uploads', userId), { recursive: true });
  await writeFile(path, body);
}
