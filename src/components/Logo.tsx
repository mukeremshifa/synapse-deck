import { cn } from '@/lib/utils';

/**
 * The SynapseDeck mark: two offset plates with a node bridging the gap between
 * them. A deck is cards in a stack; a synapse is a gap a signal jumps. The mark
 * is both at once, in three primitives, which is what lets it survive being
 * shrunk to a favicon or printed in one colour.
 *
 * **Why the node is the accent and the plates are not.** `--primary` is
 * oklch(0.922 …) — near-white, invisible against a light background (see the
 * rules at the top of `globals.css`). Plates in `currentColor` and the node in
 * the accent is therefore the only assignment that reads on both themes, and it
 * happens to be the right meaning: the accent *is* the signal crossing the gap.
 *
 * Inline SVG rather than an `<img>`, so it inherits the theme for free, costs no
 * request, and needs no dark-mode file shipped. The masters in `assets/brand/`
 * are the same drawing, kept separately because the asset pipeline rasterises
 * them outside the bundler.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-7 shrink-0', className)}
      role="img"
      aria-label="SynapseDeck"
    >
      <rect x="3" y="4" width="11" height="22" rx="2.5" fill="currentColor" />
      <rect x="18" y="6" width="11" height="22" rx="2.5" fill="currentColor" />
      <circle cx="16" cy="16" r="3.6" fill="var(--color-primary)" />
    </svg>
  );
}

/**
 * Mark plus wordmark. The word is set solid in the display face — the mark
 * already carries the accent, and colouring "Deck" as well says the same thing
 * twice.
 */
export function LogoLockup({
  className,
  wordmarkClassName,
}: {
  className?: string;
  /**
   * Applied to the wordmark alone, so a caller can hide it and keep the mark.
   * The app header does this below `sm` (DS4b task 2); everywhere else the
   * lockup is unchanged.
   */
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark aria-hidden />
      <span
        className={cn('font-serif text-xl leading-none tracking-tight', wordmarkClassName)}
      >
        SynapseDeck
      </span>
    </span>
  );
}
