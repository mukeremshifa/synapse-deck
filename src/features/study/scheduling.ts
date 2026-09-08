import {
  applyGrade,
  previewSchedule,
  type CardScheduling,
  type SchedulePreview,
} from '@/lib/fsrs';
import type { Card, NextSchedule } from '@/lib/api';
import type { Grade } from '@/lib/schemas';

/**
 * The bridge between the contract's `Card` and the FSRS maths.
 *
 * FR5's plan §2 is explicit that scheduling is **re-pointed, not rewritten**:
 * `fsrs.ts`, `queue.ts` and `day.ts` are model-independent and keep their place
 * (brief §1.4). This file is the whole of the re-pointing — one adapter in one
 * place, so that no runner ever converts a card by hand.
 *
 * ── The three fields the contract does not carry ──────────────────────────
 *
 * **This is a real gap, and it is recorded rather than papered over.**
 * `fsrs.ts` takes a `CardScheduling`, which carries eleven fields. The FR0
 * contract's `Card` carries eight of them; `scheduled_days`, `elapsed_days` and
 * `learning_steps` have no home on the wire, and `NextSchedule` cannot send
 * them back either. Two of the three are recoverable and one is not:
 *
 * - **`elapsed_days`** — days between `lastReviewedAt` and now. Derived here,
 *   and correct: ts-fsrs recomputes it from `last_review` during scheduling
 *   anyway, so the value passed in is an input it overwrites.
 * - **`scheduled_days`** — the length of the interval the card is currently
 *   serving. Derived as `due - lastReviewedAt`, which is exactly what the
 *   scheduler wrote when it set that due date. Sound for every card that has
 *   been reviewed; zero for one that has not, which is what a new card carries.
 * - **`learning_steps`** — **not derivable, and not persisted anywhere.** It is
 *   the index into the learning-steps ladder, and it decides whether a `Good`
 *   on a learning card graduates it or advances it one step. With no field to
 *   read it from, every card is scheduled as though it were on step 0.
 *
 * ── What the third one actually costs ─────────────────────────────────────
 *
 * The default ladder is two steps (1m, 10m). A card in `learning` or
 * `relearning` that is on step 1 and rated `Good` should graduate to `review`;
 * treated as step 0, it is instead given the second step and comes back in ten
 * minutes. **The error is confined to same-session learning intervals** — it
 * cannot touch a `review` card, because the ladder is not consulted for one —
 * so no long interval is wrong, and no card is lost. A learning card can take
 * one extra repetition to graduate.
 *
 * That is a real behavioural cost and it is written down here, in
 * `FR-DRIFT-LOG.md`, and in FR5 §6 rather than left for someone to discover.
 * **The fix belongs to FR7**, which owns the schema: three columns on the card,
 * three fields on `Card` and `NextSchedule`, and this comment shrinks to the two
 * derivations. Doing it here would mean changing the contract from a consuming
 * phase, which is how a contract stops being one.
 *
 * Nothing here is a workaround for a bug — it is the honest projection of a
 * narrower shape onto a wider one, and the runner above it never sees the seam.
 */

const DAY_MS = 86_400_000;

/** Whole days between two instants, never negative — both columns are `>= 0`. */
function daysBetween(fromIso: string | null, to: number): number {
  if (fromIso === null) return 0;
  return Math.max(0, Math.round((to - Date.parse(fromIso)) / DAY_MS));
}

/**
 * Project a contract `Card` onto the shape the scheduler reads.
 *
 * `now` is a parameter rather than a `Date.now()` call inside, so that the
 * preview a runner shows and the grade it later commits are computed against
 * one instant. Two calls a few hundred milliseconds apart would otherwise
 * derive different `elapsed_days` and could round to different intervals.
 */
export function toScheduling(card: Card, now: number = Date.now()): CardScheduling {
  return {
    fsrs_state: card.fsrsState,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    last_review: card.lastReviewedAt,
    reps: card.reps,
    lapses: card.lapses,
    // The interval this card is currently serving: what the scheduler wrote
    // when it set `due` from `lastReviewedAt`.
    scheduled_days: daysBetween(card.lastReviewedAt, Date.parse(card.due)),
    // What has actually passed since. ts-fsrs recomputes this from
    // `last_review`, so it is an input it does not ultimately trust.
    elapsed_days: daysBetween(card.lastReviewedAt, now),
    // Not derivable — see the header. Every card schedules as step 0.
    learning_steps: 0,
  };
}

/**
 * The four intervals to put on the rating buttons.
 *
 * Computed once per card and handed back to `gradeToNext` so the interval the
 * user was **shown** is the interval that gets committed — `fsrs.ts` reuses the
 * outcomes rather than re-rolling the fuzz, and that is the entire reason the
 * preview is threaded through instead of recomputed.
 */
export function previewFor(
  card: Card,
  now: number = Date.now(),
  params?: Record<string, never> | null,
): SchedulePreview {
  return previewSchedule(toScheduling(card, now), new Date(now), params);
}

/**
 * Apply a grade and produce the `next` the contract wants.
 *
 * The contract's `NextSchedule` is a **narrower** shape than `SchedulingUpdate`:
 * it drops the three fields above and adds `reps` and `lapses`, which the
 * server would otherwise have to derive. The lapse rule is the app's own and is
 * stated once, in `fsrs.ts`'s `projectCard` — every `Again` is a lapse — so it
 * is mirrored here rather than re-invented.
 */
export function gradeToNext(
  card: Card,
  grade: Grade,
  options: {
    now?: number;
    durationMs?: number | null;
    preview?: SchedulePreview;
    params?: Record<string, never> | null;
  } = {},
): NextSchedule {
  const now = options.now ?? Date.now();
  const result = applyGrade(toScheduling(card, now), grade, new Date(now), {
    durationMs: options.durationMs ?? null,
    ...(options.preview ? { preview: options.preview } : {}),
    ...(options.params ? { params: options.params } : {}),
  });

  return {
    fsrsState: result.next.fsrs_state,
    due: result.next.due,
    stability: result.next.stability,
    difficulty: result.next.difficulty,
    reps: card.reps + 1,
    // `Grade.Again` is 1. Imported as a value only to compare, which is why the
    // numeric literal is not used — the enum is the definition.
    lapses: card.lapses + (grade === 1 ? 1 : 0),
    lastReviewedAt: result.next.last_review,
  };
}

/**
 * The card as it will be once the grade lands, for the optimistic update.
 *
 * Mirrors what the server writes, so a cached queue and the row that comes back
 * from `reviewCard` do not disagree for the length of a round trip.
 */
export function projectGraded(card: Card, next: NextSchedule): Card {
  return {
    ...card,
    fsrsState: next.fsrsState,
    due: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    lastReviewedAt: next.lastReviewedAt,
  };
}
