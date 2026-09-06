import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { UPLOAD_LIMITS } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { useJobProgress } from './useJobProgress';
import { useUploadDocument, validateFile } from './useUploadDocument';

/**
 * `/create/document` — drop a PDF, and it goes straight to S3.
 *
 * P10 tasks 3 and 5. The file is uploaded with a presigned PUT the API signs and
 * never passes through the API itself; the page then starts an ingestion job and
 * polls it, which is what replaced the SSE stream P2 built. A Lambda cannot hold
 * a connection open for the length of a Step Functions fan-out, so polling is
 * not a downgrade here — it is the only shape that composes with the pipeline.
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
  const { phase, percent, error, upload, reset } = useUploadDocument();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [jobId, setJobId] = useState<string | undefined>();
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { job, percent: jobPercent, isFinished } = useJobProgress(jobId);

  const busy = phase === 'preparing' || phase === 'uploading' || starting;

  /**
   * Upload, then start the job. Two calls rather than one because the file goes
   * to S3 directly and the API only ever sees the key it issued.
   */
  const uploadAndStart = useCallback(
    async (chosen: File) => {
      setStartError(null);
      const key = await upload(chosen);
      if (key === null) return; // upload() has already set its own error.

      setStarting(true);
      try {
        const started = await api.post<{ jobId: string; deckId: string }>('/jobs', {
          objectKey: key,
          // Fall back to the filename minus its extension: a title is required,
          // and making the user type one they already expressed by choosing the
          // file is friction for its own sake.
          deckTitle: title.trim() === '' ? chosen.name.replace(/\.pdf$/i, '') : title.trim(),
        });
        setJobId(started.jobId);
      } catch (caught) {
        setStartError(
          caught instanceof Error ? caught.message : 'The job could not be started.',
        );
      } finally {
        setStarting(false);
      }
    },
    [title, upload],
  );

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

          {file !== null && jobId === undefined && (
            <div className="space-y-2">
              <Label htmlFor="deck-title">Deck title</Label>
              <Input
                id="deck-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={file.name.replace(/\.pdf$/i, '')}
                maxLength={200}
                disabled={busy}
              />
              <p className="text-muted-foreground text-xs">
                Left blank, the file name is used.
              </p>
            </div>
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

          {startError !== null && (
            <p role="alert" className="text-destructive text-sm">
              {startError}
            </p>
          )}

          {jobId !== undefined && job !== undefined && (
            <div className="space-y-3 rounded-md border px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {job.status === 'pending' && 'Reading the document…'}
                  {job.status === 'running' && 'Writing cards…'}
                  {job.status === 'succeeded' && 'Cards are ready to review.'}
                  {job.status === 'failed' && 'No cards could be written.'}
                </p>
                {!isFinished && (
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {job.chunksCompleted}/{job.chunkCount || '…'}
                  </span>
                )}
              </div>

              {!isFinished && (
                <progress
                  value={jobPercent}
                  max={100}
                  className="h-2 w-full overflow-hidden rounded-full"
                >
                  {jobPercent}%
                </progress>
              )}

              {/*
                Partial failure is stated, not hidden (task 6). A deck that
                quietly contains three quarters of a document is a product that
                lies, so the gap gets a line of its own.
              */}
              {job.chunksFailed > 0 && (
                <p className="text-muted-foreground text-sm">
                  {job.chunksSucceeded} of {job.chunkCount} sections produced cards;{' '}
                  {job.chunksFailed} could not be read. The cards that did arrive are
                  below.
                </p>
              )}

              {job.truncated && (
                <p className="text-muted-foreground text-sm">
                  This document was longer than one job covers, so only the first part
                  was used.
                </p>
              )}

              {/*
                The stub provider is named in the UI, not just in a log. Fake
                cards that look real are the risk; a user seeing where they came
                from is the cheapest possible mitigation.
              */}
              {job.providers.includes('stub') && (
                <p className="text-destructive text-sm">
                  These are placeholder cards — no language model was called. Set a real
                  provider to generate real cards.
                </p>
              )}

              {job.error !== null && (
                <p className="text-destructive text-sm">{job.error}</p>
              )}

              {job.status === 'succeeded' && job.deckId !== null && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => navigate(`/create/review/${job.deckId!}`)}
                >
                  Review {job.cards.length} card{job.cards.length === 1 ? '' : 's'}
                </Button>
              )}

              {isFinished && job.status === 'failed' && (
                <Button type="button" variant="outline" size="sm" onClick={clear}>
                  Try another document
                </Button>
              )}
            </div>
          )}

          {file !== null && jobId === undefined && (
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => void uploadAndStart(file)}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Upload and write cards'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
