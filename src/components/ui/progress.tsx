import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Determinate progress — a task with a known end.
 *
 * ── This is not `Meter`, and the difference matters ───────────────────────
 *
 * `Meter` (src/components/Meter.tsx) draws a *proportion that is true right
 * now*: mastery, a blueprint weight, a share of an exam. It is a fact about the
 * world and it is not going anywhere.
 *
 * `Progress` draws *a task advancing toward completion*. It implies something
 * is happening and that the bar will reach the end. FR4's job progress is the
 * real consumer.
 *
 * Using the wrong one is not a visual mistake, it is a false promise: a mastery
 * bar rendered as Progress tells the user their mastery is on its way to 100%.
 *
 * ── The indeterminate case ────────────────────────────────────────────────
 *
 * Pass `value={null}` for work whose size is unknown — which FR0's drift log
 * flags as real: a job can fail before any stage reports, with `unitsTotal`
 * still 0. "No progress yet" and "0% done" must not render identically, so
 * indeterminate gets the breathing animation rather than an empty track.
 */
function Progress({
  className,
  value,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'value'> & {
  /** 0–100, or null when the total is not yet known. */
  value: number | null;
}) {
  const indeterminate = value === null;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      // Radix wants `undefined`, not `null`, to mean indeterminate — and that
      // is what sets `data-state="indeterminate"` and drops `aria-valuenow`,
      // which is the whole accessibility difference between the two states.
      value={indeterminate ? undefined : clamped}
      className={cn('bg-muted relative h-1.5 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'bg-primary h-full w-full flex-1 rounded-full',
          indeterminate ? 'ui-generating' : 'transition-transform',
        )}
        style={{
          // Indeterminate fills the track and breathes, rather than sitting at
          // -100% where it would be invisible — "we are working, size unknown"
          // has to look like something, not like an empty bar.
          transform: indeterminate ? undefined : `translateX(-${100 - clamped}%)`,
          transitionDuration: 'var(--duration-moving)',
          transitionTimingFunction: 'var(--ease-standard)',
        }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
