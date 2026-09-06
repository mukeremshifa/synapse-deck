/**
 * Uploaded documents, wherever they are kept. The `UPLOAD_STORE` seam.
 * DS1 task 6.
 *
 * Two implementations, both maintained:
 *
 *   - `uploads-local.ts` — a directory on this machine, plus a route that
 *     accepts the PUT. Self-contained, which is what a demo needs.
 *   - `uploads-s3.ts`    — a presigned PUT the browser sends directly to S3.
 *     The AWS path, and still the better one: the file never passes through the
 *     API, which is what makes a 20 MB document cheap.
 *
 * ── This seam is not symmetric, and the asymmetry is the interesting part ──
 *
 * The other two seams swap implementations that do the same work in different
 * places. This one swaps implementations with **different shapes of trust**:
 *
 *   - On S3 the size limit is signed into the URL, so S3 itself rejects a body
 *     of the wrong size and a lying client is refused by someone other than us.
 *   - Locally there is no signature. The limit is enforced by the route on the
 *     bytes it actually received, which is a *check* rather than a
 *     *constraint* — strictly weaker, and worth naming rather than assuming
 *     the two are equivalent because the same constant appears in both.
 *
 * Both are bounded, so neither can be used to fill a disk. But if a future
 * phase adds something that depends on S3's signature doing the enforcing, this
 * is the paragraph that says it will not hold locally.
 *
 * No default, for the reason the other two seams give.
 *
 *     grep -rn 'UPLOAD_STORE' src/ services/api/src/handlers/   # must be empty
 */

import * as local from './uploads-local.ts';
import * as s3 from './uploads-s3.ts';
import { ApiError } from '../lib/rows.ts';

export type { UploadTicketResult } from './uploads-s3.ts';

const STORE_NAMES = ['local', 's3'] as const;
type StoreName = (typeof STORE_NAMES)[number];

/**
 * The shape both implementations must satisfy.
 *
 * Declared explicitly rather than as `typeof s3`, which is what `jobs.ts` and
 * `pipeline.ts` do. The difference is that the local store has one export the
 * S3 store cannot have — `putDocument`, the write path S3 does not need because
 * the browser writes directly — so requiring the two to match exactly would
 * mean either deleting a function the local route needs or adding a stub to S3
 * that throws. Naming the shared four here says precisely what the seam
 * guarantees, and leaves `putDocument` reachable only through the module that
 * actually has it.
 */
interface UploadStore {
  uploadKeyFor(userId: string, objectId: string, extension?: string): string;
  assertOwnedKey(userId: string, objectKey: string): void;
  readDocumentText(userId: string, objectKey: string): Promise<string>;
  createUploadTicket(
    userId: string,
    input: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<s3.UploadTicketResult>;
}

const STORES: Record<StoreName, UploadStore> = {
  local,
  s3,
};

function isStoreName(value: string): value is StoreName {
  return (STORE_NAMES as readonly string[]).includes(value);
}

let cached: UploadStore | undefined;

function store(): UploadStore {
  if (cached !== undefined) return cached;

  const configured = process.env['UPLOAD_STORE'];

  if (configured === undefined || configured === '') {
    throw new Error(
      'UPLOAD_STORE is not set. It must name a store explicitly — there is no ' +
        'default, because a document written to one store and read from the ' +
        `other is a job that fails with a confusing 404. One of: ${STORE_NAMES.join(', ')}.`,
    );
  }

  if (!isStoreName(configured)) {
    throw new Error(
      `UPLOAD_STORE is "${configured}", which is not a store. ` +
        `One of: ${STORE_NAMES.join(', ')}.`,
    );
  }

  cached = STORES[configured];
  return cached;
}

/** Forget the resolved store, so a changed environment variable takes effect. */
// data-access-lint-disable-next-line Clears a cached module reference, reads no data, so there is no tenant to scope it to.
export function resetUploadStoreCache(): void {
  cached = undefined;
}

export function uploadKeyFor(userId: string, objectId: string, extension?: string): string {
  return store().uploadKeyFor(userId, objectId, extension);
}

export function assertOwnedKey(userId: string, objectKey: string): void {
  store().assertOwnedKey(userId, objectKey);
}

export function readDocumentText(userId: string, objectKey: string): Promise<string> {
  return store().readDocumentText(userId, objectKey);
}

export function createUploadTicket(
  userId: string,
  input: { filename: string; contentType: string; sizeBytes: number },
): Promise<s3.UploadTicketResult> {
  return store().createUploadTicket(userId, input);
}

/**
 * Store one uploaded document. Only the local store can do this.
 *
 * Throwing rather than being absent from the interface is deliberate. The route
 * that calls this exists only when `UPLOAD_STORE=local`, so on the S3 path
 * nothing should ever reach here — and if something does, a 404 that says the
 * route is not in use is a better answer than a missing export crashing the
 * process. The error names the configuration rather than the code, because that
 * is what would need changing.
 */
export function putDocument(
  userId: string,
  objectKey: string,
  body: Buffer,
): Promise<void> {
  const configured = process.env['UPLOAD_STORE'];
  if (configured !== 'local') {
    throw new ApiError(
      404,
      'No such route. Documents are uploaded directly to object storage when ' +
        'UPLOAD_STORE is not "local".',
    );
  }
  return local.putDocument(userId, objectKey, body);
}
