import { cn } from '@/lib/utils';

/**
 * A horizontal proportion bar, and the only one in the app.
 *
 * ── Why this exists rather than a bar per screen ──────────────────────────
 *
 * Five screens draw a 0–1 proportion: topic mastery, blueprint weights, exam
 * topic breakdown, the format mix, and readiness. Hand-rolling each is how an
 * app ends up with five subtly different bars — different heights, different
 * rounding, one of them animating — which reads as five products.
 *
 * ── Colour, and the rule it obeys ─────────────────────────────────────────
 *
 * `globals.css` is emphatic that `--primary` is a *field*, never a foreground,
 * and that neutrals are chroma 0. A meter's fill is a field, so the accent is
 * legitimate here — but only for the one meaning the palette gives it: mastery
 * achieved. Everything else (a weight, a share of an exam) is neutral, because
 * a blueprint weight is not good or bad and colouring it would imply it were.
 *
 * The grade ramp is reused for band colouring rather than inventing a second
 * scale, because `--grade-*` already encodes "alarm → accent" with lightness
 * climbing in even steps — the property that keeps it readable under
 * deuteranopia. A second red-to-green ramp in the same app would be both
 * redundant and, being unaudited, probably worse.
 */

export type MeterTone = 'neutral' | 'accent' | 'weak' | 'developing' | 'strong';

const TONE_FILL: Record<MeterTone, string> = {
  neutral: 'bg-foreground/70',
  accent: 'bg-primary',
  weak: 'bg-grade-again',
  developing: 'bg-grade-good',
  strong: 'bg-grade-easy',
};

export function Meter({
  value,
  tone = 'neutral',
  className,
  label,
}: {
  /** 0–1. Clamped, so a caller's rounding error cannot overflow the track. */
  value: number;
  tone?: MeterTone;
  className?: string;
  /**
   * Accessible name. Required in spirit: a bare bar announces nothing, and every
   * caller has a name to hand because it is already rendering one beside it.
   */
  label: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);

  return (
    <div
      className={cn('bg-muted h-1.5 w-full overflow-hidden rounded-full', className)}
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', TONE_FILL[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * The unmeasured case, drawn as absence rather than as zero.
 *
 * `mastery.ts` is explicit that "you are bad at this" and "we have not asked you
 * yet" are the distinction users most resent getting wrong, and a 0%-filled bar
 * says the first while meaning the second. A dashed empty track says the second.
 */
export function EmptyMeter({ className, label }: { className?: string; label: string }) {
  return (
    <div
      className={cn('h-1.5 w-full rounded-full border border-dashed', className)}
      role="img"
      aria-label={label}
    />
  );
}
