/**
 * Presigned uploads. P10 task 3.
 *
 * Not a datastore module, but it lives in `data/` deliberately, and the reason
 * is the same one that put `jobs.ts` here: **this is where the tenancy boundary
 * is drawn.** The object key is built from `userId` and nothing else, so a
 * presigned URL can only ever address the caller's own prefix. That is exactly
 * the kind of decision ADR 0008's rule 3 exists to keep in one auditable
 * directory — a handler that built its own key would be a handler reasoning
 * about ownership, which is the shape the rule forbids.
 *
 * ── Why presign at all ────────────────────────────────────────────────────
 *
 * The browser PUTs to S3 directly. The file never passes through the API, which
 * matters for two reasons: a 20 MB PDF through a Lambda means paying for memory
 * to hold it, and API Gateway caps a request payload at 10 MB regardless — so
 * routing uploads through the API would put a hard ceiling on document size in
 * exchange for nothing.
 *
 * ── The key is generated, never taken from the client ─────────────────────
 *
 * `uploads/<userId>/<uuid>.pdf`. The user's filename is *not* part of it.
 *
 * A key built from a user-supplied filename is a path-traversal bug waiting to
 * happen — `../` in a filename, a name that collides with another user's
 * object, a name long enough to break the key limit. The filename is kept as
 * display metadata, where it can be rendered as text and do no harm, and the
 * key is a UUID that cannot be anything else.
 *
 * ── The size limit is enforced on the URL, not just in the handler ────────
 *
 * `ContentLength` is signed into the presigned request. That distinction is the
 * whole point: a check in the handler validates the *claim* a client made about
 * its file, and a client is not a security boundary. Signing the length means
 * S3 itself rejects a PUT whose body is a different size — so a caller who
 * lies, or who reuses a URL for a larger file, is refused by S3 rather than
 * trusted by us.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { UPLOAD_LIMITS } from '../lib/schemas.ts';
import { ApiError } from '../lib/rows.ts';

/**
 * How long a presigned URL stays valid.
 *
 * Five minutes. Long enough for a 20 MB upload on a slow connection, short
 * enough that a URL leaked from a log or a browser history is not a standing
 * grant to write into someone's prefix.
 */
const URL_TTL_SECONDS = 5 * 60;

let s3Client: S3Client | undefined;

function client(): S3Client {
  s3Client ??= new S3Client({});
  return s3Client;
}

function bucketName(): string {
  const name = process.env['UPLOAD_BUCKET_NAME'];
  if (name === undefined || name === '') {
    throw new Error(
      'UPLOAD_BUCKET_NAME is not set. It is wired by infra/lib/api-stack.ts from ' +
        'PipelineStack.uploadBucket; dev-api.mjs reads it from .env.local.',
    );
  }
  return name;
}

/**
 * The object key for one upload. `userId` first, and it is the only thing that
 * decides the prefix.
 */
export function uploadKeyFor(userId: string, objectId: string, extension = '.pdf'): string {
  return `uploads/${userId}/${objectId}${extension}`;
}

/**
 * Refuse an object key that is not inside this user's own prefix.
 *
 * **A key is not a capability.** It arrives from the client in a request body,
 * so it can name anything — including another user's object. The prefix is the
 * boundary (`uploads/<userId>/…`), so checking membership of that prefix is the
 * whole of the ownership check, and it happens here rather than in a handler
 * because that is where ADR 0008 keeps decisions of this kind.
 *
 * Throws rather than returning a boolean: a caller that forgets to check a
 * returned flag is exactly the failure this must not permit.
 */
export function assertOwnedKey(userId: string, objectKey: string): void {
  const prefix = `uploads/${userId}/`;
  // `startsWith` alone would accept `uploads/<userId>/../<other>/x.pdf`, which
  // S3 treats as a literal key but which reads as an escape to anyone auditing
  // this. Rejecting traversal segments outright keeps the check honest.
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw new ApiError(404, 'No such document.');
  }
}

/**
 * Read an uploaded document's text.
 *
 * ── This does not parse PDFs, and says so ─────────────────────────────────
 *
 * Extracting a text layer from a PDF needs a parser, which is a dependency
 * decision this phase deliberately deferred (task 3's scanned-PDF check is the
 * other half of the same deferral). Until that lands, this reads the object as
 * UTF-8 text, which works for a `.txt` upload and produces mostly-binary noise
 * for a real PDF.
 *
 * **That is a known gap, not a hidden one.** A PDF whose extracted text is
 * unusable produces a job that fails with a message the user can act on, rather
 * than a deck of cards generated from binary. The pipeline around it is
 * complete; this one function is the seam a PDF parser slots into.
 */
export async function readDocumentText(userId: string, objectKey: string): Promise<string> {
  assertOwnedKey(userId, objectKey);

  const result = await client().send(
    new GetObjectCommand({ Bucket: bucketName(), Key: objectKey }),
  );

  const body = await result.Body?.transformToString('utf-8');
  if (body === undefined || body.trim() === '') {
    throw new ApiError(400, 'That document had no readable text.');
  }
  return body;
}

export interface UploadTicketResult {
  uploadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
}

/**
 * Issue a presigned PUT for one document.
 *
 * `userId` comes from the verified JWT and is the only source of the prefix, so
 * there is no request shape — body, query or header — that can produce a URL
 * for another user's objects.
 */
export async function createUploadTicket(
  userId: string,
  input: { filename: string; contentType: string; sizeBytes: number },
): Promise<UploadTicketResult> {
  // Re-checked here rather than trusted from the handler's parse. The schema
  // already enforces both, and this is the layer that actually signs the URL —
  // a future caller that skips validation should not be able to sign a 2 GB
  // request.
  if (input.sizeBytes > UPLOAD_LIMITS.maxBytes) {
    throw new Error(`Upload exceeds the ${UPLOAD_LIMITS.maxBytes}-byte limit.`);
  }

  // From a fixed list, matched against the user's filename but never taken from
  // it. `UPLOAD_LIMITS` accepts more than one format since DS1, and a key that
  // claimed `.pdf` for a `.txt` file would make the stored object lie about
  // itself to anything that later reads the bucket.
  const lower = input.filename.toLowerCase();
  const extension =
    UPLOAD_LIMITS.extensions.find((ext) => lower.endsWith(ext)) ?? '.pdf';

  const objectKey = uploadKeyFor(userId, randomUUID(), extension);

  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: objectKey,
    ContentType: input.contentType,
    // Signed into the URL, so S3 rejects a body of any other size. See header.
    ContentLength: input.sizeBytes,
    // The original filename travels as metadata, never as part of the key.
    // S3 metadata values must be ASCII, and a document named in Arabic or with
    // an em dash is entirely ordinary here — so it is encoded rather than sent
    // raw, which would otherwise fail the PUT with a signature mismatch that
    // looks nothing like a filename problem.
    Metadata: {
      'original-filename': encodeURIComponent(input.filename),
      'owner-sub': userId,
    },
  });

  const uploadUrl = await getSignedUrl(client(), command, { expiresIn: URL_TTL_SECONDS });

  return { uploadUrl, objectKey, expiresInSeconds: URL_TTL_SECONDS };
}
