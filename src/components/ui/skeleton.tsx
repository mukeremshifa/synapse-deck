import { cn } from '@/lib/utils';

/**
 * The loading placeholder.
 *
 * A **sweep, not a pulse** (FR1). `animate-pulse` fades a block in and out,
 * which reads as "something is wrong with this element"; a gradient travelling
 * across it reads as "this is arriving". The animation is `ui-skeleton` in
 * `globals.css` so its timing is the motion tokens rather than Tailwind's own
 * scale, and so the gradient is built from `--muted` and `--background` and
 * therefore correct in both themes without a `dark:` variant here.
 *
 * Inherits the `prefers-reduced-motion` block: an opted-out user gets a static
 * muted block, which is still a correct skeleton.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // Not `aria-busy` and not `role="status"`: a screen reader should hear
      // about loading once, from the region that is loading, not once per
      // placeholder block. `LoadingState` owns that announcement.
      aria-hidden
      className={cn('ui-skeleton rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
