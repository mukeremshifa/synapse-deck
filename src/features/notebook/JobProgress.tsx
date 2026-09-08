import { CheckIcon, CircleDashedIcon, LoaderIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/api';
import { failureFromJob } from './generation-errors';
import {
  STAGE_LABELS,
  jobPercent,
  stageSentence,
  stageStates,
  unitsLabel,
  type StageState,
} from './jobs';

/**
 * One job, as stages. **FR4 task 2.**
 *
 * ═══ Stages, not a bare percentage ═══════════════════════════════════════
 *
 * The rule comes from the page this replaces, and it is worth restating because
 * it is the whole design:
 *
 * > A percentage says how much is left; stages say what is happening.
 *
 * A generation takes tens of seconds, which is long enough that "working…"
 * stops reassuring and starts worrying. Naming the step turns dead time into
 * something legible. Both are kept — the bar carries the proportion, the list
 * carries the meaning — but only where each is honest:
 *
 * - **The bar is drawn only when `unitsTotal > 0`.** Before splitting, the size
 *   of the work is genuinely unknown, so `jobPercent` returns null and the bar
 *   goes indeterminate. Drawing 0% there would claim we know the total and are
 *   nowhere, which is a different and false statement.
 * - **Every stage is derived from a field the job reports.** No stage here
 *   describes work the pipeline does not do, and none advances on a timer.
 *
 * ── The case this is built around ────────────────────────────────────────
 *
 * A job that fails **before any stage reports**, with `unitsTotal` still 0 — a
 * quota refusal happens exactly this way. FR0's drift log calls it the case a
 * stage-based UI handles worst, because the natural rendering is "still
 * starting" for ever. Here it renders as a failure pinned to "Queued", with the
 * reason and whatever the user can actually do — see `generation-errors.ts`.
 */
export function JobProgress({
  job,
  onRetry,
  onDismiss,
  className,
}: {
  job: Job;
  /** Offered only where the failure is one retrying could fix. */
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const failed = job.status === 'failed';
  const percent = jobPercent(job);
  const units = unitsLabel(job);
  const failure = failed ? failureFromJob(job.error) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-snug rounded-lg border p-snug',
        failed && 'border-destructive/50 bg-destructive/8',
        className,
      )}
    >
      <div className="flex items-start gap-tight">
        <p className="min-w-0 flex-1 text-sm font-medium">
          {failure ? failure.title : stageSentence(job)}
        </p>
        {/*
          The counter is the measurement behind the bar, and it is absent rather
          than zeroed while the total is unknown — the same rule the bar follows.
        */}
        {!failed && units && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
            {units}
          </span>
        )}
      </div>

      {failure ? (
        <p className="text-muted-foreground text-xs leading-relaxed">{failure.detail}</p>
      ) : (
        <Progress value={percent} />
      )}

      <StageList job={job} />

      {/*
        Partial success is stated, never hidden. A deck that quietly contains
        three quarters of a document is a product that lies — and this is the
        contract's own reason for `truncated` existing.
      */}
      {job.truncated && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {job.unitsFailed > 0
            ? `${String(job.unitsFailed)} section${job.unitsFailed === 1 ? '' : 's'} could not be used. What did arrive is here.`
            : 'This was longer than one job covers, so only the first part was used.'}
        </p>
      )}

      {(onRetry ?? onDismiss) && (
        <div className="flex gap-tight">
          {/* Only where retrying could plausibly work. See `generation-errors`. */}
          {onRetry && failure?.retry === true && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The stages, marked done / running / failed / ahead.
 *
 * An ordered list, because it is one: `<ol>` gives a screen reader the position
 * and the count for free, which is most of what the visual ticks convey.
 */
function StageList({ job }: { job: Job }) {
  return (
    <ol className="flex flex-col gap-tight">
      {stageStates(job).map(({ stage, state }) => (
        <li key={stage} className="flex items-center gap-tight">
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border',
              state === 'done' && 'bg-primary text-primary-foreground border-transparent',
              state === 'active' && 'text-foreground border-border-strong',
              state === 'failed' && 'border-destructive text-destructive',
              state === 'waiting' && 'text-muted-foreground border-dashed',
            )}
          >
            <StageIcon state={state} />
          </span>
          <span
            className={cn(
              'text-xs',
              state === 'waiting' ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {STAGE_LABELS[stage]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'done') return <CheckIcon className="size-2.5" aria-hidden />;
  if (state === 'failed') return <XIcon className="size-2.5" aria-hidden />;
  if (state === 'active') {
    /*
     * `animate-spin` is switched off wholesale by the reduced-motion block in
     * `globals.css`, which leaves a static ring — still visibly distinct from
     * the dashed circle a waiting stage gets, which is the point.
     */
    return <LoaderIcon className="size-2.5 animate-spin" aria-hidden />;
  }
  return <CircleDashedIcon className="size-2.5" aria-hidden />;
}
