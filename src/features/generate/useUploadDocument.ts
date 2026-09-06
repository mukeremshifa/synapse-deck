/**
 * The two-step document upload. P10 task 3.
 *
 * 1. `POST /uploads` — the API signs a PUT for a key under this user's prefix.
 * 2. `PUT <presigned url>` — the browser sends the file straight to S3.
 *
 * The file never touches the API. A 20 MB PDF through a Lambda would mean
 * paying for memory to hold it, and API Gateway caps a payload at 10 MB
 * regardless, so this is not an optimisation so much as the only shape that
 * works for documents of a realistic size.
 *
 * ── The PUT deliberately does not go through `api-client.ts` ──────────────
 *
 * That module attaches an `Authorization: Bearer` header to everything it
 * sends, which is exactly right for the API and **wrong for S3**: the presigned
 * URL already carries its own signature in the query string, and an unexpected
 * `Authorization` header makes S3 reject the request with a signature error
 * that reads as though the URL itself were bad. So this uses `fetch` directly
 * and sends only `content-type`, which is what the signature covers.
 */

import { useCallback, useState } from 'react';
import { api } from '@/lib/api-client';
import { UPLOAD_LIMITS, type UploadTicket } from '@/lib/schemas';

export type UploadPhase = 'idle' | 'preparing' | 'uploading' | 'done' | 'error';

export interface UploadState {
  phase: UploadPhase;
  /** 0-100, meaningful only while `phase` is `'uploading'`. */
  percent: number;
  /** The S3 key, once the upload has completed. What a job references. */
  objectKey: string | null;
  error: string | null;
}

const IDLE: UploadState = { phase: 'idle', percent: 0, objectKey: null, error: null };

/**
 * Reject a file the pipeline cannot use, before anything is sent.
 *
 * Cheap, local, and honest about what it does and does not check: this reads
 * the type and the size, not the contents. A PDF with no text layer — a scan —
 * passes this and is caught later; detecting that needs a PDF parser and is
 * deliberately not in this pass.
 *
 * The same caveat now covers PDFs generally (DS1): nothing here parses one, so
 * a PDF reaches the pipeline and fails there with a message the user can act
 * on. A .txt or .md file works end to end. See `UPLOAD_LIMITS` for why the
 * accepted list is what it is.
 */
export function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const extensionOk = UPLOAD_LIMITS.extensions.some((ext) => name.endsWith(ext));
  const typeOk = (UPLOAD_LIMITS.contentTypes as readonly string[]).includes(file.type);

  // Checked together rather than either alone: some browsers report an empty
  // `type` for a file dragged from certain sources, and a `.pdf` renamed to
  // `.txt` reports the wrong extension.
  if (!extensionOk || !typeOk) {
    return (
      'That file type cannot be turned into cards. Upload a .txt, .md or .pdf ' +
      'file.'
    );
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  if (file.size > UPLOAD_LIMITS.maxBytes) {
    const limitMb = Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024));
    const actualMb = (file.size / (1024 * 1024)).toFixed(1);
    return `That file is ${actualMb} MB. The limit is ${limitMb} MB.`;
  }
  return null;
}

export function useUploadDocument() {
  const [state, setState] = useState<UploadState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    const invalid = validateFile(file);
    if (invalid !== null) {
      setState({ phase: 'error', percent: 0, objectKey: null, error: invalid });
      return null;
    }

    setState({ phase: 'preparing', percent: 0, objectKey: null, error: null });

    try {
      const ticket = await api.post<UploadTicket>('/uploads', {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      setState({ phase: 'uploading', percent: 0, objectKey: null, error: null });

      // XMLHttpRequest rather than fetch, for exactly one reason: upload
      // progress. `fetch` still has no way to observe how much of a request
      // body has been sent, and a 20 MB upload with no progress bar is the
      // difference between "working" and "frozen" to someone watching it.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', ticket.uploadUrl, true);
        xhr.setRequestHeader('content-type', file.type);

        xhr.upload.addEventListener('progress', (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          setState((prev) =>
            prev.phase === 'uploading' ? { ...prev, percent } : prev,
          );
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            // S3 answers with an XML error document. Surfacing it raw would be
            // noise, so the status is what the user sees and the body goes to
            // the console for whoever is debugging.
            console.error('S3 upload failed', xhr.status, xhr.responseText);
            reject(new Error(`The upload was rejected (${xhr.status}).`));
          }
        });

        xhr.addEventListener('error', () =>
          reject(new Error('The upload failed. Check your connection and try again.')),
        );
        xhr.addEventListener('abort', () => reject(new Error('The upload was cancelled.')));

        xhr.send(file);
      });

      setState({ phase: 'done', percent: 100, objectKey: ticket.objectKey, error: null });
      return ticket.objectKey;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The upload failed. Try again.';
      setState({ phase: 'error', percent: 0, objectKey: null, error: message });
      return null;
    }
  }, []);

  return { ...state, upload, reset };
}
