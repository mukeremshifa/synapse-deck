import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type FSRSParameters,
  type Grade as FsrsGrade,
  type RecordLogItem,
} from 'ts-fsrs';
import { Grade } from './schemas.ts';

/**
 * The scheduler, wrapped once.
 *
 * SPEC §6 puts FSRS on the client and the write in a single RPC. That only works
 * if "what the schedule becomes" is decided in exactly one place — this file —
 * rather than inside a component that also knows about buttons.
 *
 * Everything here is pure. No Supabase import, no React, no clock read that is
 * not passed in as `now`. That is what makes a simulated week testable.
 *
 * Configuration:
 *   ts-fsrs 5.4.1, default weights `w`, default request_retention (0.90),
 *   default learning/relearning steps, fuzz ENABLED.
 */

// ---------------------------------------------------------------------------
// The enum mapping. Every conversion between ts-fsrs and the database goes
// through these tables and nowhere else — a mismatch here corrupts schedules
// silently, which is why fsrs.test.ts walks every combination.
// ---------------------------------------------------------------------------

/** `fsrs_state` in the database (SPEC §5.1). */
export type FsrsStateName = 'new' | 'learning' | 'review' | 'relearning';

const STATE_TO_DB = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
} as const satisfies Record<State, FsrsStateName>;

const DB_TO_STATE = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
} as const satisfies Record<FsrsStateName, State>;

const GRADE_TO_RATING = {
  [Grade.Again]: Rating.Again,
  [Grade.Hard]: Rating.Hard,
  [Grade.Good]: Rating.Good,
  [Grade.Easy]: Rating.Easy,
} as const satisfies Record<Grade, FsrsGrade>;

export const GRADE_LABELS = {
  [Grade.Again]: 'Again',
  [Grade.Hard]: 'Hard',
  [Grade.Good]: 'Good',
  [Grade.Easy]: 'Easy',
} as const satisfies Record<Grade, string>;

/** Rating order as the buttons and the keyboard shortcuts 1-4 present them. */
export const GRADES = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy] as const;

export const FSRS_STATES = [
  'new',
  'learning',
  'review',
  'relearning',
] as const satisfies readonly FsrsStateName[];

export function toDbState(state: State): FsrsStateName {
  return STATE_TO_DB[state];
}

export function fromDbState(state: FsrsStateName): State {
  return DB_TO_STATE[state];
}

export function toFsrsRating(grade: Grade): FsrsGrade {
  return GRADE_TO_RATING[grade];
}

// ---------------------------------------------------------------------------
// The shapes this module speaks: database columns, not ts-fsrs objects.
// ---------------------------------------------------------------------------

/** The scheduling columns of a `cards` row. Content (`payload`) is never read. */
export type CardScheduling = {
  fsrs_state: FsrsStateName;
  stability: number | null;
  difficulty: number | null;
  due: string;
  last_review: string | null;
  reps: number;
  lapses: number;
  scheduled_days: number;
  elapsed_days: number;
  learning_steps: number;
};

/**
 * Exactly the columns `review_card(p_next)` writes. The RPC validates these keys
 * and rejects anything else, so adding a field here means changing the migration
 * too — deliberately awkward, because this payload arrives from the browser.
 */
export type SchedulingUpdate = {
  fsrs_state: FsrsStateName;
  stability: number;
  difficulty: number;
  due: string;
  last_review: string;
  scheduled_days: number;
  elapsed_days: number;
  learning_steps: number;
};

/** Exactly the `reviews` row this rating produces (SPEC §5.4). */
export type ReviewLogRow = {
  rating: Grade;
  reviewed_at: string;
  duration_ms: number | null;
  state_before: FsrsStateName;
  stability_before: number | null;
  difficulty_before: number | null;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps_before: number;
  due_before: string;
  last_review_before: string | null;
  state_after: FsrsStateName;
  stability_after: number;
  difficulty_after: number;
};

export type Preview = {
  grade: Grade;
  label: string;
  due: Date;
  /** Milliseconds from `now` until the card comes back. Drives "Good → 4d". */
  intervalMs: number;
  state: FsrsStateName;
};

// ---------------------------------------------------------------------------
// The scheduler instance
// ---------------------------------------------------------------------------

/**
 * Build a scheduler.
 *
 * Fuzz is on: without it every card created in one session is scheduled to the
 * same minute forever, and a single heavy day buries the user under a spike that
 * never disperses. ts-fsrs seeds the fuzz from the card itself, so two cards with
 * the same interval scatter while one card asked twice answers the same — which
 * is why `applyGrade` can accept the preview the user was shown and commit
 * exactly that, rather than hoping a recomputation agrees.
 *
 * `params` is `profiles.fsrs_params`: null until an optimiser runs post-v1.
 */
export function scheduler(params?: Partial<FSRSParameters> | null): FSRS {
  return fsrs(schedulerParameters(params));
}

export function schedulerParameters(
  params?: Partial<FSRSParameters> | null,
): FSRSParameters {
  return generatorParameters({ ...(params ?? {}), enable_fuzz: true });
}

/** Scheduling columns for a brand-new, never-reviewed card. */
export function newCardScheduling(now: Date): CardScheduling {
  const empty = createEmptyCard(now);
  return {
    fsrs_state: 'new',
    stability: null,
    difficulty: null,
    due: empty.due.toISOString(),
    last_review: null,
    reps: 0,
    lapses: 0,
    scheduled_days: 0,
    elapsed_days: 0,
    learning_steps: 0,
  };
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

function toFsrsCard(card: CardScheduling): FsrsCard {
  return {
    due: new Date(card.due),
    // A `new` card has no memory state yet; ts-fsrs reads 0 as "not set", and the
    // database stores null for the same reason (SPEC §5.3 cards_state_consistency).
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 0,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: fromDbState(card.fsrs_state),
    ...(card.last_review ? { last_review: new Date(card.last_review) } : {}),
  };
}

/** Integer, never negative — both columns carry a `>= 0` check constraint. */
function wholeDays(value: number): number {
  return Math.max(0, Math.round(value));
}

function toSchedulingUpdate(item: RecordLogItem): SchedulingUpdate {
  const { card, log } = item;
  return {
    fsrs_state: toDbState(card.state),
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due.toISOString(),
    last_review: (card.last_review ?? log.review).toISOString(),
    scheduled_days: wholeDays(card.scheduled_days),
    // The days that actually passed before this review, recomputed by ts-fsrs
    // from last_review — not the stale value sitting on the card row.
    elapsed_days: wholeDays(log.elapsed_days),
    learning_steps: card.learning_steps,
  };
}

// ---------------------------------------------------------------------------
// The two operations the app performs
// ---------------------------------------------------------------------------

/** The raw ts-fsrs outcomes behind a preview, so a commit can reuse them. */
const OUTCOMES = Symbol('fsrs.outcomes');

export type SchedulePreview = Record<Grade, Preview> & {
  [OUTCOMES]: Record<Grade, RecordLogItem>;
};

/**
 * The four outcomes of the rating buttons, so "Good → 4d" can be shown before
 * the user commits.
 *
 * Preview and commit share one `repeat()` result (see the fuzz note on
 * `scheduler`); pass the preview back to `applyGrade` to commit the interval the
 * user was actually shown.
 */
export function previewSchedule(
  card: CardScheduling,
  now: Date,
  params?: Partial<FSRSParameters> | null,
): SchedulePreview {
  const outcomes = scheduler(params).repeat(toFsrsCard(card), now);

  const previews = {} as Record<Grade, Preview>;
  const raw = {} as Record<Grade, RecordLogItem>;
  for (const grade of GRADES) {
    const item = outcomes[toFsrsRating(grade)];
    raw[grade] = item;
    previews[grade] = {
      grade,
      label: GRADE_LABELS[grade],
      due: item.card.due,
      intervalMs: item.card.due.getTime() - now.getTime(),
      state: toDbState(item.card.state),
    };
  }

  return { ...previews, [OUTCOMES]: raw };
}

export type GradeResult = {
  /** Exactly the columns to write, as `review_card(p_next)`. */
  next: SchedulingUpdate;
  /**
   * Exactly the `reviews` row this rating produces.
   *
   * The RPC re-derives every `*_before` field from the locked card row rather
   * than trusting this, so the copy here is what the UI shows and what undo
   * previews — never the authority.
   */
  log: ReviewLogRow;
};

/** Apply a grade. Pure: `now` is passed in so a week can be simulated in a test. */
export function applyGrade(
  card: CardScheduling,
  grade: Grade,
  now: Date,
  options?: {
    durationMs?: number | null;
    params?: Partial<FSRSParameters> | null;
    /** A `previewSchedule` result already shown to the user, so fuzz is not re-rolled. */
    preview?: SchedulePreview;
  },
): GradeResult {
  const item =
    options?.preview?.[OUTCOMES][grade] ??
    scheduler(options?.params).next(toFsrsCard(card), now, toFsrsRating(grade));

  const next = toSchedulingUpdate(item);

  return {
    next,
    log: {
      rating: grade,
      reviewed_at: item.log.review.toISOString(),
      duration_ms: options?.durationMs ?? null,
      state_before: card.fsrs_state,
      stability_before: card.stability,
      difficulty_before: card.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: card.scheduled_days,
      learning_steps_before: card.learning_steps,
      due_before: card.due,
      last_review_before: card.last_review,
      state_after: next.fsrs_state,
      stability_after: next.stability,
      difficulty_after: next.difficulty,
    },
  };
}

/**
 * Apply a grade and return the resulting card row, for simulations and for the
 * optimistic cache update. Mirrors what `review_card` writes server-side:
 * `reps` always increments, `lapses` only on Again.
 *
 * That lapse rule is the app's, not ts-fsrs's — the library counts a lapse only
 * when a card in `review` is failed. `lapses` is a display counter and is not an
 * input to the FSRS model, so the simpler "every Again is a lapse" rule costs
 * nothing and is the one the RPC enforces. Counting it in two ways would not.
 */
export function projectCard(card: CardScheduling, result: GradeResult): CardScheduling {
  return {
    ...card,
    ...result.next,
    reps: card.reps + 1,
    lapses: card.lapses + (result.log.rating === Grade.Again ? 1 : 0),
  };
}
