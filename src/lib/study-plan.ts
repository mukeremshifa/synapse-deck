import {
  divergenceKind,
  masteryBand,
  type MasteryBand,
  type TopicMastery,
} from './mastery';

/**
 * The diagnostic, and the plan it produces.
 *
 * **This is the half of the loop the brief cares most about** (§2): "the
 * diagnostic is what joins them — it converts exam failures into scheduled
 * cards, which is the single most demoable moment in the product." A score
 * report tells a student they got 68%. This tells them *what to do on Tuesday*,
 * which is the only output that changes an outcome.
 *
 * Pure, like `mastery.ts` which it reads from. It takes a mastery model and
 * produces an ordered plan; it does not fetch, schedule, or write anything.
 *
 * ── The rule this module is built around ──────────────────────────────────
 *
 * **Every recommendation must name the evidence that produced it.** A plan that
 * says "review enzyme inhibition for 10 minutes" with no reason is indistinct
 * from a plan generated at random, and the user cannot tell which they have. So
 * `PlanAction` carries `because`, it is required, and it is derived from the
 * mastery signals rather than written as prose alongside them.
 *
 * ── Why the action kinds are what they are ────────────────────────────────
 *
 * The most important finding this product can produce is `mastery.ts`'s
 * `fragile`: recalled when prompted, lost under exam conditions. It has a
 * specific remedy — sit more questions, not more flashcards — and a plan that
 * responds to it by scheduling flashcard review is actively unhelpful. So the
 * action kind is chosen *from the shape of the weakness*, which is the whole
 * argument for computing two signals separately in the first place.
 */

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * `drill` — flashcard practice. For material not reliably recalled at all.
 * `questions` — exam-style questions. For material recalled but not applied.
 * `review` — read the source again. For material with no foundation to drill.
 * `mini-exam` — a short timed exam over one topic. Confirms a fix held.
 */
export type PlanActionKind = 'review' | 'drill' | 'questions' | 'mini-exam';

export const ACTION_LABELS: Record<PlanActionKind, string> = {
  review: 'Review the material',
  drill: 'Flashcard drill',
  questions: 'Targeted questions',
  'mini-exam': 'Mini-exam',
};

export type PlanAction = {
  id: string;
  kind: PlanActionKind;
  topicId: string | null;
  topicName: string;
  /** Imperative, specific, and readable on its own in a list. */
  title: string;
  /**
   * The evidence. Required — see the header. Phrased as an observation about the
   * user's own data, never as a claim about the material.
   */
  because: string;
  /** Rough minutes. Honest about being an estimate; used to fill a day's budget. */
  minutes: number;
};

export type PlanDay = {
  /** 1-based. Not a calendar date: the plan is relative to when it is started. */
  day: number;
  actions: PlanAction[];
  minutes: number;
};

export type StudyPlan = {
  days: PlanDay[];
  /** Total estimated minutes across the plan. */
  minutes: number;
  /** Topics the plan deliberately leaves alone, and why. */
  ignored: { topicName: string; reason: string }[];
};

export type PlanOptions = {
  /** How many days the plan spans. Usually days until the exam, capped. */
  days: number;
  /** Minutes the student says they can give it per day. */
  minutesPerDay: number;
};

export const PLAN_DEFAULTS: PlanOptions = { days: 7, minutesPerDay: 30 };

export const PLAN_LIMITS = {
  minDays: 1,
  maxDays: 30,
  minMinutes: 10,
  maxMinutes: 240,
} as const;

// ---------------------------------------------------------------------------
// Estimating effort
// ---------------------------------------------------------------------------

/**
 * Minutes per action kind. Round numbers, and deliberately so.
 *
 * These are estimates presented to a human for planning, not a schedule anything
 * executes. Precision here would be false: the product cannot know how long a
 * given student takes over eight questions, and printing "17 min" would claim it
 * can. Rounding to five keeps the arithmetic legible and the claim modest.
 */
const BASE_MINUTES: Record<PlanActionKind, number> = {
  review: 10,
  drill: 10,
  questions: 15,
  'mini-exam': 20,
};

/** Weakness earns time, but not without bound — a 40-minute block is unusable. */
function minutesFor(kind: PlanActionKind, score: number | null): number {
  const base = BASE_MINUTES[kind];
  if (score === null) return base;
  const deficit = Math.max(0, 1 - score);
  return Math.min(base * 2, Math.round((base * (1 + deficit)) / 5) * 5);
}

// ---------------------------------------------------------------------------
// Choosing what to do about a topic
// ---------------------------------------------------------------------------

/**
 * The actions one topic earns, strongest reason first.
 *
 * Returns an empty array for a topic that needs nothing — a plan that finds
 * something to say about every topic is padding, and padding is what makes a
 * student stop reading their plan.
 */
export function actionsForTopic(mastery: TopicMastery): PlanAction[] {
  const band = masteryBand(mastery);
  const divergence = divergenceKind(mastery);
  const name = mastery.topicName;
  const key = mastery.topicId ?? name.toLowerCase().replace(/\s+/g, '-');
  const actions: PlanAction[] = [];

  const add = (kind: PlanActionKind, title: string, because: string) => {
    actions.push({
      id: `${key}:${kind}`,
      kind,
      topicId: mastery.topicId,
      topicName: name,
      title,
      because,
      minutes: minutesFor(kind, mastery.score),
    });
  };

  /*
   * Fragile first, and ahead of the band check, because it is the finding with
   * the most specific remedy. A fragile topic can sit in the `developing` band —
   * good retention pulls the blended score up — and treating it by its band
   * would schedule more flashcards, which is precisely what has already failed.
   */
  if (divergence === 'fragile' && mastery.exam) {
    add(
      'questions',
      `Work through exam questions on ${name}`,
      `You recall ${name} when prompted but got ${mastery.exam.correct} of ${mastery.exam.answered} exam questions right — it holds up in review and not under time.`,
    );
    if (band === 'weak') {
      add(
        'review',
        `Reread the ${name} material`,
        'Applying it is the gap, and the underlying explanation is worth one more pass.',
      );
    }
    return actions;
  }

  if (band === 'weak') {
    // No retention signal means nothing has been drilled yet, so drilling is
    // premature: there is nothing in the schedule to strengthen.
    if (!mastery.retention) {
      add(
        'review',
        `Read through ${name}`,
        `Nothing in ${name} has been reviewed yet, so there is no schedule to build on.`,
      );
      add(
        'drill',
        `Start drilling ${name}`,
        'New cards need a first pass before spacing can do anything.',
      );
      return actions;
    }

    add(
      'drill',
      `Drill ${name}`,
      `Predicted recall on ${name} is ${percent(mastery.retention.recall)}, the lowest in this notebook.`,
    );
    add(
      'mini-exam',
      `Sit a short ${name} exam`,
      'A timed pass confirms the drilling actually moved it.',
    );
    return actions;
  }

  if (band === 'developing') {
    add(
      'drill',
      `Keep ${name} moving`,
      mastery.retention
        ? `Recall on ${name} is ${percent(mastery.retention.recall)} — close, and it slips without contact.`
        : `${name} is partly there and has not been reviewed recently.`,
    );
    return actions;
  }

  /*
   * `strong` and `unmeasured` both get nothing, for opposite reasons, and both
   * are reported in `ignored` rather than silently dropped. A plan that says
   * nothing about a topic is ambiguous between "you are fine" and "we forgot".
   */
  return actions;
}

function ignoredReason(band: MasteryBand, mastery: TopicMastery): string | null {
  if (band === 'strong') {
    return mastery.retention
      ? `Recall is ${percent(mastery.retention.recall)}. The schedule already has this.`
      : 'Strong on the evidence available. The schedule already has this.';
  }
  if (band === 'unmeasured') {
    return 'Not measured yet — no reviews and no exam questions have touched it.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Building the plan
// ---------------------------------------------------------------------------

/**
 * Turn a mastery model into a day-by-day plan.
 *
 * ── Why actions are laid out across days rather than sorted into them ─────
 *
 * The obvious implementation fills day 1 with the weakest topic's actions, day 2
 * with the next, and so on. That produces a plan that spends Monday entirely on
 * metabolism and never touches it again — which is the one shape spaced
 * repetition exists to rule out. So actions for a topic are *spread*: the first
 * pass over topics fills day 1, the second fills day 2, and a topic's follow-up
 * (its mini-exam) lands days after its drill rather than beside it.
 *
 * The day budget is respected but not enforced to the minute: an action is never
 * split, so a day can overshoot slightly rather than leaving a 5-minute stub.
 */
export function buildStudyPlan(
  topics: readonly TopicMastery[],
  options: PlanOptions = PLAN_DEFAULTS,
): StudyPlan {
  const days = clamp(options.days, PLAN_LIMITS.minDays, PLAN_LIMITS.maxDays);
  const budget = clamp(
    options.minutesPerDay,
    PLAN_LIMITS.minMinutes,
    PLAN_LIMITS.maxMinutes,
  );

  const ignored: StudyPlan['ignored'] = [];
  // Column-major: one row per topic, so the interleave below reads down the
  // columns and takes each topic's first action before any topic's second.
  const queues: PlanAction[][] = [];

  for (const mastery of topics) {
    const actions = actionsForTopic(mastery);
    if (actions.length === 0) {
      const reason = ignoredReason(masteryBand(mastery), mastery);
      if (reason) ignored.push({ topicName: mastery.topicName, reason });
      continue;
    }
    queues.push(actions);
  }

  const buckets: PlanDay[] = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    actions: [],
    minutes: 0,
  }));

  let cursor = 0;
  let round = 0;
  // `round` walks the columns; within a column the topics are already ordered
  // weakest-first by `topicMastery`, so the weakest topic is always served first
  // on any given day.
  for (;;) {
    const column = queues.filter(queue => queue.length > round);
    if (column.length === 0) break;

    for (const queue of column) {
      const action = queue[round];
      if (!action) continue;

      // Find the next day with room, starting where the last one landed. Wraps,
      // so a full day never strands an action that a later day could hold.
      let placed = false;
      for (let offset = 0; offset < days; offset += 1) {
        const index = (cursor + offset) % days;
        const bucket = buckets[index];
        if (!bucket) continue;
        if (bucket.minutes + action.minutes <= budget || bucket.actions.length === 0) {
          bucket.actions.push(action);
          bucket.minutes += action.minutes;
          cursor = (index + 1) % days;
          placed = true;
          break;
        }
      }
      // Every day is full. The plan is as large as the student said it could be,
      // and silently overfilling it would break the promise the budget makes.
      if (!placed) {
        return finish(buckets, ignored);
      }
    }
    round += 1;
  }

  return finish(buckets, ignored);
}

function finish(buckets: PlanDay[], ignored: StudyPlan['ignored']): StudyPlan {
  // Trailing empty days are dropped: a "7-day plan" whose last three days are
  // blank is a 4-day plan with padding, and should say so.
  let last = buckets.length;
  while (last > 0 && (buckets[last - 1]?.actions.length ?? 0) === 0) last -= 1;
  const days = buckets.slice(0, last);

  return {
    days,
    minutes: days.reduce((sum, day) => sum + day.minutes, 0),
    ignored,
  };
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

/**
 * One sentence naming the single most useful thing in the model, or null.
 *
 * This is the "AI diagnosis" line. It is **derived arithmetic, not generated
 * text** — no model writes it — which is why it can be shown without a review
 * gate in front of it. It says what the numbers say and nothing more.
 */
export function diagnosisFor(topics: readonly TopicMastery[]): string | null {
  const fragile = topics.find(topic => divergenceKind(topic) === 'fragile');
  if (fragile?.retention && fragile.exam) {
    return `Your weak point in ${fragile.topicName} is applying it under time, not recalling it: ${percent(fragile.retention.recall)} predicted recall against ${percent(fragile.exam.accuracy)} exam accuracy.`;
  }

  const weakest = topics.find(topic => masteryBand(topic) === 'weak');
  if (weakest?.score !== null && weakest !== undefined) {
    return `${weakest.topicName} is the weakest topic in this notebook at ${percent(weakest.score)}, and it is where the next session is worth spending.`;
  }

  const measured = topics.filter(topic => topic.score !== null);
  if (measured.length === 0) return null;

  return 'Nothing is weak on the evidence so far. Keep the schedule and sit an exam to test it under time.';
}

// ---------------------------------------------------------------------------

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
