import type { ReactNode } from 'react';
import { AlertTriangleIcon, SparklesIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * The four states, in one file, so every screen shows them the same way.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Before FR1 each screen decided for itself: `SettingsPage` rendered a bare
 * `<Skeleton className="h-96">` while its quota card rendered a sentence of
 * grey text, and the two were the same condition. Nine screens each inventing
 * an answer is how an app stops looking like one product — the same argument
 * `EmptyState` and `Meter` already carry, applied to the states rather than to
 * a bar.
 *
 * ── The four, and the distinctions that matter ────────────────────────────
 *
 *   LoadingState     We asked, and we are waiting. Skeleton, never a spinner:
 *                    a skeleton says what is coming and takes the space it
 *                    will need, so nothing jumps when the data lands.
 *
 *   EmptyState       We asked, we got an answer, and the answer is "none".
 *                    In an SRS this is usually *success* — "nothing due" is the
 *                    healthy case, and it should read that way.
 *
 *   ErrorState       We asked and could not get an answer. Says what failed and
 *                    offers the retry, because a dead end with no action is a
 *                    screen the user has to reload the app to escape.
 *
 *   GeneratingState  A model is working. **This is the one the pre-FR1 app
 *                    lacked entirely**, and FR4 depends on it: generation takes
 *                    tens of seconds, which is far past what a loading skeleton
 *                    can honestly promise. A different animation, a stage, and
 *                    an elapsed sense — because "we are working" and "this is
 *                    loading" are different promises.
 *
 * The distinction that gets missed most: **loading and generating are not the
 * same state.** A skeleton implies the answer already exists and is in transit.
 * Generation implies it is being made and might fail partway. FR0's drift log
 * records the sharpest case — a job can fail before any stage reports, with
 * `unitsTotal` still 0 — so "no progress yet" and "0% done" must not render
 * identically. `GeneratingState` takes `value={null}` for exactly that.
 */

/* ── Loading ──────────────────────────────────────────────────────────── */

/**
 * `lines` is a hint about the shape of what is coming, not a pixel spec. Give
 * it the number of rows the real content has, so the skeleton reserves roughly
 * the right space and the page does not jump.
 */
export function LoadingState({
  lines = 3,
  className,
  label = 'Loading',
}: {
  lines?: number;
  className?: string;
  /** Announced once for the whole region. Say what is loading. */
  label?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-snug', className)}
      // One announcement for the region, which is why the individual
      // Skeletons are aria-hidden.
      role="status"
      aria-live="polite"
      aria-busy
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          // The last line is short, the way a paragraph's last line is. A
          // stack of identical full-width bars reads as a table, not as text.
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

/** A skeleton shaped like a card, for grids of them. */
export function LoadingCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex flex-col gap-snug rounded-lg border p-gutter', className)}
      role="status"
      aria-busy
    >
      <span className="sr-only">Loading</span>
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────── */

/**
 * The screen a healthy user sees most often.
 *
 * In a spaced-repetition app "nothing due" is not an error state or an empty
 * shell — it is success, and it should read that way. Every list gets one, and
 * each says what to do next rather than only what is absent.
 *
 * The icon sits in a filled disc so it reads as a deliberate mark instead of a
 * stray glyph, and the whole block is given room.
 *
 * **Moved here from `src/components/EmptyState.tsx` at FR1** and re-exported
 * from that path, so the nine existing callers keep working — FR1 §5.7 says
 * fold it in, not duplicate it. The old module is now a one-line re-export.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed px-gutter text-center',
        'py-page',
        className,
      )}
    >
      {icon && (
        <div className="bg-muted text-muted-foreground mb-base flex size-12 items-center justify-center rounded-full [&>svg]:size-6">
          {icon}
        </div>
      )}
      <p className="text-base font-medium">{title}</p>
      {description && (
        <div className="text-muted-foreground mt-tight max-w-sm text-sm leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-gutter">{action}</div>}
    </div>
  );
}

/* ── Error ────────────────────────────────────────────────────────────── */

/**
 * Something failed and the user needs a way out.
 *
 * `onRetry` is optional but nearly always right to pass. An error with no
 * action is a screen you can only leave by reloading, and most failures here
 * are transient — a fetch that lost the network, a job that hit a rate limit.
 *
 * `detail` is for the message from the API. Keep it: "Could not load your
 * cards" plus the actual reason is diagnosable; the sentence alone is not.
 * It is rendered as text, never as markup — the same rule the card content
 * follows, because an error string can carry provider output.
 */
export function ErrorState({
  title = 'Something went wrong',
  detail,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/50 bg-destructive/8 flex flex-col items-start gap-snug',
        'rounded-lg border p-gutter',
        className,
      )}
    >
      <div className="flex items-start gap-tight">
        <AlertTriangleIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-hairline">
          <p className="text-sm font-medium">{title}</p>
          {detail && (
            <p className="text-muted-foreground text-sm leading-relaxed">{detail}</p>
          )}
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/* ── Generating ───────────────────────────────────────────────────────── */

/**
 * A model is working. Distinct from loading, deliberately and visibly.
 *
 * `value` is the percentage complete, or **null when the total is not yet
 * known** — which is the case FR0's drift log singles out as the one to design
 * for first: a job can fail before any stage reports, with `unitsTotal` still
 * 0. Passing 0 there would draw an empty bar and claim we know the size; null
 * draws a breathing bar and claims only that we are working.
 *
 * `stage` is the human sentence for where the job is ("Reading your document").
 * It carries more than the bar does, because a percentage on a job with four
 * uneven stages is mostly fiction.
 */
export function GeneratingState({
  stage,
  value = null,
  detail,
  onCancel,
  className,
}: {
  stage: string;
  value?: number | null;
  detail?: ReactNode;
  onCancel?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col gap-snug rounded-lg border p-gutter', className)}
    >
      <div className="flex items-center gap-tight">
        {/* The mark ramp's top stop, not `--primary`: this is a glyph on a
            card, and `--primary` is a field (rule 2 in globals.css) — at
            1.21:1 on paper the icon would be invisible. */}
        <SparklesIcon
          className="ui-generating size-4 shrink-0 text-(--color-grade-easy-mark)"
          aria-hidden
        />
        <p className="text-sm font-medium">{stage}</p>
        {value !== null && (
          <span className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
            {Math.round(value)}%
          </span>
        )}
      </div>

      <Progress value={value} />

      {detail && (
        <div className="text-muted-foreground text-xs leading-relaxed">{detail}</div>
      )}

      {onCancel && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
