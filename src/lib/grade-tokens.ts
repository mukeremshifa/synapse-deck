import type { FsrsStateName } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';

/**
 * The grade ramp, as CSS values, in one place.
 *
 * `globals.css` has always said the rating buttons and the progress charts must
 * mean the same thing by the same colour; through P3–P5 they agreed only because
 * three files happened to contain the same four strings. `ForecastChart` and
 * `StateDistribution` each carried their own copy of the state→colour map, which
 * is exactly the arrangement that let the buttons drift away from the tokens
 * once already (see `RatingButtons.tsx`).
 *
 * These are `var(…)` strings rather than Tailwind classes because their
 * consumers are Recharts `fill` props and inline `backgroundColor` — a chart
 * library cannot be handed a utility class. Anything that *can* use a class
 * should: `bg-grade-easy` resolves to the same token.
 *
 * ── Two ramps, and picking the right one (FR1) ────────────────────────────
 *
 * The ramp was re-derived at FR1 and split in two, because one ramp could not
 * do both jobs: a stop light enough for ink to sit on it is too light to *be*
 * a mark on white paper. The old single ramp put an Easy dot at 1.21:1 against
 * the page, which is invisible. Rule 4 in `globals.css` has the full argument.
 *
 *   GRADE_FIELD_TOKEN   the stop is a *background*. Something sits on it —
 *                       a filled button, a bar, a badge. Ink goes on top.
 *   GRADE_MARK_TOKEN    the stop is a *foreground*. It sits on the page —
 *                       a dot, a chart stroke, an icon, a rule.
 *
 * If you are setting `backgroundColor` and putting text over it, you want
 * FIELD. If you are setting `fill`, `color`, or a small `backgroundColor` with
 * nothing on top, you want MARK. Guessing wrong is not a typecheck error, so
 * this is the comment that has to carry it.
 */

export const GRADE_FIELD_TOKEN: Record<Grade, string> = {
  [Grade.Again]: 'var(--color-grade-again)',
  [Grade.Hard]: 'var(--color-grade-hard)',
  [Grade.Good]: 'var(--color-grade-good)',
  [Grade.Easy]: 'var(--color-grade-easy)',
};

export const GRADE_MARK_TOKEN: Record<Grade, string> = {
  [Grade.Again]: 'var(--color-grade-again-mark)',
  [Grade.Hard]: 'var(--color-grade-hard-mark)',
  [Grade.Good]: 'var(--color-grade-good-mark)',
  [Grade.Easy]: 'var(--color-grade-easy-mark)',
};

/**
 * Where each scheduler state sits on that same ramp.
 *
 * Relearning is the Again colour because that is literally how a card gets
 * there, and New is the accent because a new card is what the product exists to
 * produce — `--grade-easy` and `--primary` are the same value, so this is one
 * ramp and not two.
 *
 * These are **mark** values: every consumer is a chart, and a chart series is
 * drawn on the page rather than under text. `new` therefore uses the Easy mark
 * rather than `--primary` directly — `--primary` is a field (rule 2), and on
 * white it is 1.21:1, so a `--primary` chart series against the page was
 * unreadable for the same reason the old Easy dot was.
 */
export const STATE_MARK_TOKEN: Record<FsrsStateName, string> = {
  new: 'var(--color-grade-easy-mark)',
  learning: 'var(--color-grade-hard-mark)',
  review: 'var(--color-grade-good-mark)',
  relearning: 'var(--color-grade-again-mark)',
};
