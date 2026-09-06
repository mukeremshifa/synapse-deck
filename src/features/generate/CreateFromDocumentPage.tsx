import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { UPLOAD_LIMITS } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { useUploadDocument, validateFile } from './useUploadDocument';

/**
 * `/create/document` — drop a PDF, and it goes straight to S3.
 *
 * P10 task 3. The file is uploaded with a presigned PUT the API signs; it never
 * passes through the API itself. What happens *after* the upload — splitting,
 * generation, the review gate — is task 5, and this page is honest about
 * stopping where it stops rather than implying a pipeline that does not exist
 * yet.
 *
 * **No OCR, and the copy says so.** A scanned PDF is a picture of text, and
 * nothing here can read it. Textract is the real answer and it is deliberately
 * out of scope for this phase (P10 task 3) — so the honest thing is to tell
 * someone that up front rather than to let them upload a scan and receive an
 * empty deck.
 *
 * Detecting a missing text layer *in the browser*, before the upload, is the
 * better version of this and is a follow-up: it needs a PDF parser on the
 * client, which is a dependency decision of its own.
 */

const MAX_MB = Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024));

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateFromDocumentPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { phase, percent, objectKey, error, upload, reset } = useUploadDocument();

  const busy = phase === 'preparing' || phase === 'uploading';

  const choose = useCallback(
    (chosen: File | undefined) => {
      if (!chosen) return;
      reset();
      const invalid = validateFile(chosen);
      // Validated before it is accepted into state, so the panel never shows a
      // file the upload would refuse a moment later.
      if (invalid !== null) {
        setFile(null);
        setRejected(invalid);
        return;
      }
      setRejected(null);
      setFile(chosen);
    },
    [reset],
  );

  const clear = useCallback(() => {
    setFile(null);
    setRejected(null);
    reset();
    // The input keeps its value after a pick, so choosing the same file twice
    // in a row would fire no change event without this.
    if (inputRef.current) inputRef.current.value = '';
  }, [reset]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight">Create from a document</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Upload a PDF and cards are written from it. You approve every card before it
          enters a deck.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Source document</CardTitle>
          <CardDescription>
            PDF, up to {MAX_MB} MB. The text has to be selectable — a scanned page is a
            picture of text, and nothing here can read it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/*
            The drop zone is a <button> rather than a <div onClick>, so it is
            reachable by keyboard and announced as actionable without any aria
            plumbing of its own.
          */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              choose(event.dataTransfer.files[0]);
            }}
            disabled={busy}
            className={cn(
              'border-border flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
              'hover:border-primary/60 hover:bg-muted/40',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              dragging && 'border-primary bg-muted/60',
              busy && 'cursor-not-allowed opacity-60',
            )}
          >
            <UploadIcon aria-hidden className="text-muted-foreground size-6" />
            <span className="text-sm font-medium">
              {dragging ? 'Drop it here' : 'Choose a PDF, or drag one here'}
            </span>
            <span className="text-muted-foreground text-xs">
              Up to {MAX_MB} MB. Nothing is uploaded until you press Upload.
            </span>
          </button>

          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_LIMITS.extensions.join(',')}
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0])}
          />

          {rejected !== null && (
            <p role="alert" className="text-destructive text-sm">
              {rejected}
            </p>
          )}

          {file !== null && (
            <div className="bg-muted/40 flex items-center gap-3 rounded-md border px-3 py-2">
              <FileTextIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                {/* `truncate` matters: a long filename would otherwise push the
                    remove button off the row. */}
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">{formatSize(file.size)}</p>
              </div>
              {!busy && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={clear}
                  aria-label={`Remove ${file.name}`}
                >
                  <XIcon aria-hidden className="size-4" />
                </Button>
              )}
            </div>
          )}

          {phase === 'uploading' && (
            <div className="space-y-1">
              {/*
                A real <progress> rather than a styled div: it is announced by
                screen readers and reports its own value without aria attributes.
              */}
              <progress
                value={percent}
                max={100}
                className="h-2 w-full overflow-hidden rounded-full"
              >
                {percent}%
              </progress>
              <p className="text-muted-foreground text-xs">Uploading… {percent}%</p>
            </div>
          )}

          {phase === 'preparing' && (
            <p className="text-muted-foreground text-sm">Preparing the upload…</p>
          )}

          {error !== null && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          {phase === 'done' && objectKey !== null && (
            <div className="space-y-2 rounded-md border border-dashed px-3 py-3">
              <p className="text-sm font-medium">Uploaded.</p>
              {/*
                Deliberately not pretending the pipeline exists. Generation from
                a document is P10 task 5; claiming "your cards are being written"
                here would be a lie the next screen would expose.
              */}
              <p className="text-muted-foreground text-sm">
                The document is stored and ready. Turning it into cards is not wired up
                yet — until it is,{' '}
                <Link to="/create/text" className="underline underline-offset-4">
                  create from text
                </Link>{' '}
                is the path that works end to end.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={clear}>
                Upload another
              </Button>
            </div>
          )}

          {file !== null && phase !== 'done' && (
            <div className="flex justify-end">
              <Button type="button" onClick={() => void upload(file)} disabled={busy}>
                {busy ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
