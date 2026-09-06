import { CheckIcon, CircleDashedIcon, LoaderIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { JobProgress } from './useJobProgress';

/**
 * A generation job as named stages rather than one indeterminate bar.
 *
 * ── Why stages instead of a spinner ───────────────────────────────────────
 *
 * A job takes tens of seconds, which is long enough that "working…" stops
 * reassuring and starts worrying. Naming what is happening turns dead time into
 * something legible — and where the pipeline does real work (splitting a
 * document, calling a model per chunk, writing cards), saying so is also the
 * most honest description of where the user's wait is going.
 *
 * ── Every stage here is derived from a field the job actually reports ─────
 *
 * This is the constraint that decides which stages exist. It would be easy to
 * write a prettier list — "Extracting text", "Identifying topics", "Building
 * your exam blueprint" — and animate it on a timer. That is a progress bar that
 * lies: the ticks would advance whether or not anything happened, and two of
 * those stages describe work the pipeline does not do.
 *
 * So the stages below map one-to-one onto `JobProgress`:
 *
 * | Stage      | Derived from                                    |
 * | ---------- | ----------------------------------------------- |
 * | Queued     | a job id exists                                 |
 * | Split      | `chunkCount > 0` — the document has been divided |
 * | Cards      | `chunksCompleted` against `chunkCount`           |
 * | Ready      | `status === 'succeeded'` and a deck exists       |
 *
 * When the ingestion pipeline grows topic extraction and blueprint generation,
 * they become rows here — driven by the fields the job gains for them, not by a
 * timer.
 */

type StageState = 'waiting' | 'active' | 'done' | 'failed';

type Stage = {
  key: string;
  label: string;
  state: StageState;
  /** Shown under the label while the stage is active or done. */
  detail?: string;
};

function stagesFor(job: JobProgress): Stage[] {
  const failed = job.status === 'failed';
  const finished = job.status === 'succeeded';
  const split = job.chunkCount > 0;

  /*
   * A failure marks the stage that was in progress, not every stage. Reddening
   * the whole list implies the earlier work was lost, and it was not — the deck
   * from a partially failed job still holds the cards that landed.
   */
  const failAt = (active: boolean): StageState | null =>
    failed && active ? 'failed' : null;

  return [
    {
      key: 'queued',
      label: 'Job accepted',
      state: 'done',
      detail: `Job ${job.jobId.slice(0, 8)}`,
    },
    {
      key: 'split',
      label: 'Reading the source',
      state: failAt(!split) ?? (split ? 'done' : 'active'),
      detail: split ? `Split into ${job.chunkCount} sections` : undefined,
    },
    {
      key: 'cards',
      label: 'Writing cards',
      state:
        failAt(split && !finished) ?? (finished ? 'done' : split ? 'active' : 'waiting'),
      detail: split ? `${job.chunksCompleted} of ${job.chunkCount} done` : undefined,
    },
    {
      key: 'ready',
      label: 'Ready to review',
      state: finished ? 'done' : 'waiting',
      detail:
        finished && job.cards.length > 0
          ? `${job.cards.length} card${job.cards.length === 1 ? '' : 's'} waiting`
          : undefined,
    },
  ];
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'done') {
    return <CheckIcon className="size-3.5" aria-hidden />;
  }
  if (state === 'failed') {
    return <XIcon className="size-3.5" aria-hidden />;
  }
  if (state === 'active') {
    // `animate-spin` is disabled wholesale by the reduced-motion block in
    // globals.css, which leaves a static ring — still distinct from the dashed
    // circle a waiting stage gets.
    return <LoaderIcon className="size-3.5 animate-spin" aria-hidden />;
  }
  return <CircleDashedIcon className="size-3.5" aria-hidden />;
}

export function PipelineStages({ job }: { job: JobProgress }) {
  const stages = stagesFor(job);

  return (
    <ol className="space-y-2.5">
      {stages.map(stage => (
        <li key={stage.key} className="flex items-start gap-2.5">
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
              stage.state === 'done' && 'bg-primary text-primary-foreground border-transparent',
              stage.state === 'active' && 'text-foreground',
              stage.state === 'failed' && 'border-destructive text-destructive',
              stage.state === 'waiting' && 'text-muted-foreground border-dashed',
            )}
          >
            <StageIcon state={stage.state} />
          </span>

          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block text-sm',
                stage.state === 'waiting' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {stage.label}
            </span>
            {stage.detail ? (
              <span className="text-muted-foreground block font-mono text-xs tabular-nums">
                {stage.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
