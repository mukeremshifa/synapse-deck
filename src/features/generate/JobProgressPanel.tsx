/**
 * What a running generation job looks like, for both the pages that start one.
 * P10 task 9.
 *
 * Extracted from `CreateFromDocumentPage` when `/create/text` moved onto the
 * same pipeline. The two screens differ in how they *collect* a source — a file
 * drop versus a textarea — and in nothing after that: one job shape, one set of
 * states, one way of reporting partial failure. §8 constraint 8 says no feature
 * is built twice, and two copies of this block would have been the first half of
 * building the progress UI twice, with the second copy quietly losing the
 * truncation notice or the stub warning the first time one of them changed.
 */

import { Button } from '@/components/ui/button';
import type { JobProgress } from './useJobProgress';

export function JobProgressPanel({
  job,
  percent,
  isFinished,
  busyLabel,
  onReview,
  onRetry,
  retryLabel,
}: {
  job: JobProgress;
  percent: number;
  isFinished: boolean;
  /** What "still working" reads as before any chunk has finished. */
  busyLabel: string;
  onReview: (deckId: string) => void;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-md border px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {job.status === 'pending' && busyLabel}
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
        <progress value={percent} max={100} className="h-2 w-full overflow-hidden rounded-full">
          {percent}%
        </progress>
      )}

      {/*
        Partial failure is stated, not hidden (task 6). A deck that quietly
        contains three quarters of a document is a product that lies, so the gap
        gets a line of its own.
      */}
      {job.chunksFailed !== null && job.chunksFailed > 0 && (
        <p className="text-muted-foreground text-sm">
          {job.chunksSucceeded ?? 0} of {job.chunkCount} sections produced cards;{' '}
          {job.chunksFailed} could not be read. The cards that did arrive are below.
        </p>
      )}

      {job.truncated && (
        <p className="text-muted-foreground text-sm">
          This was longer than one job covers, so only the first part was used.
        </p>
      )}

      {/*
        The stub provider is named in the UI, not just in a log. Fake cards that
        look real are the risk; a user seeing where they came from is the
        cheapest possible mitigation.
      */}
      {job.providers.includes('stub') && (
        <p className="text-destructive text-sm">
          These are placeholder cards — no language model was called. Set a real provider
          to generate real cards.
        </p>
      )}

      {job.error !== null && <p className="text-destructive text-sm">{job.error}</p>}

      {job.status === 'succeeded' && job.deckId !== null && (
        <Button type="button" size="sm" onClick={() => onReview(job.deckId!)}>
          Review {job.cards.length} card{job.cards.length === 1 ? '' : 's'}
        </Button>
      )}

      {isFinished && job.status === 'failed' && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
