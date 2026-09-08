import { formatInterval } from '@/lib/format';
import { GRADES, GRADE_LABELS, type SchedulePreview } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * The four grades, each showing what it will do.
 *
 * "Good → 4d" before committing is the difference between rating honestly and
 * guessing. The intervals come from the same `previewSchedule` result that will
 * be written, so the number shown is the number the card gets.
 *
 * **These use the `--grade-*` field tokens, and should keep doing so** — but
 * for a reason worth restating, because the old one no longer holds.
 *
 * The original rationale was that the tokens were fixed and the buttons had to
 * match them. At FR1 the owner released every token except the brand tone, so
 * "the tokens are what they are" is no longer an argument for anything. What
 * survives is the agreement itself: through P1–P4 Again was
 * `variant="destructive"` and the rest were `outline`, while the charts read
 * the tokens — so the same rating was one colour on the button and another in
 * the chart, which is a lie about what the rating means. Whatever the ramp's
 * values are, the button and the chart have to say the same thing with them.
 *
 * That agreement is now unenforced. `RatingButtons.test.tsx` asserted it until
 * the suite was deleted (ADR 0005), so this comment is the whole guard: if you
 * reach for a `variant` here, you are re-introducing the P1–P4 bug.
 *
 * These are **field** tokens — the stop is the button's background and the
 * label sits on it. `GRADE_MARK_TOKEN` is the other ramp, for dots and chart
 * strokes; using it here would give four buttons far too dark to read as a set.
 *
 * Labels are ink on every grade, including Again. The field ramp runs
 * 0.655 → 0.922 in lightness, so ink clears 4.5:1 on all four (5.62 / 8.26 /
 * 11.71 / 16.09, per `scripts/check-contrast.mjs`) while white would fail on
 * the two lightest — one rule for the row beats four exceptions.
 */
const GRADE_FIELD: Record<Grade, string> = {
  [Grade.Again]: 'bg-grade-again hover:bg-grade-again/85',
  [Grade.Hard]: 'bg-grade-hard hover:bg-grade-hard/85',
  [Grade.Good]: 'bg-grade-good hover:bg-grade-good/85',
  [Grade.Easy]: 'bg-grade-easy hover:bg-grade-easy/85',
};

export function RatingButtons({
  preview,
  onRate,
  suggested,
  disabled,
}: {
  preview: SchedulePreview;
  onRate: (grade: Grade) => void;
  /** Auto-grade hint for multiple choice (SPEC §12). Still overridable. */
  suggested?: Grade | null;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GRADES.map((grade, index) => (
        <button
          key={grade}
          type="button"
          disabled={disabled}
          onClick={() => onRate(grade)}
          className={cn(
            'flex flex-col items-center gap-0.5 rounded-md px-2 py-2.5',
            'text-primary-foreground transition-colors outline-none',
            'focus-visible:ring-foreground focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
            GRADE_FIELD[grade],
            // The ring is ink/paper rather than the accent: grade-easy *is* the
            // accent, so an accent ring on it would be invisible.
            suggested === grade &&
              'ring-foreground ring-offset-background ring-2 ring-offset-2',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <kbd className="font-mono text-xs opacity-60">{index + 1}</kbd>
            {GRADE_LABELS[grade]}
          </span>
          <span className="font-mono text-xs opacity-75">
            {formatInterval(preview[grade].intervalMs)}
          </span>
        </button>
      ))}
    </div>
  );
}
