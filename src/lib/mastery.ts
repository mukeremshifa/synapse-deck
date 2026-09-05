import type { FsrsStateName } from './fsrs';

/**
 * Topic mastery from two independent signals.
 *
 * **The brief calls this "far cheaper than it looks", and that is the finding
 * this module exists to cash in** (AWS-native brief section 2, enhancement #1).
 * `cards.difficulty` and `cards.stability` are already FSRS's per-card model of
 * how hard something is *for this user*; exams add a second signal on the same
 * axis. The only genuinely missing piece was a topic label, which D11 supplies.
 * So this is arithmetic over data the product already collects — not a model
 * that has to be trained, and not a schema change.
 *
 * **Two signals, deliberately not averaged into one number.** Retention says
 * whether you can recall a fact when prompted, at your own pace, with a cue.
 * Exam accuracy says whether you can apply it under time, without one. They
 * measure different things, and a topic where they *disagree* is the most
 * informative case in the whole product (section 7, question 10) — averaging
 * them destroys exactly the information worth surfacing. `divergence` below is
 * what Phase D's mastery map is built to show.
 *
 * Pure, like `progress.ts` and `fsrs.ts`: no React, no data layer, nothing
 * Supabase- or AWS-shaped. It survives the backend migration untouched, which is
 * why it can be written now.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The card columns mastery reads, plus the topic label D11 adds. */
export type MasteryCard = {
  topicId: string | null;
  topicName: string | null;
  fsrs_state: FsrsStateName;
  stability?: number | null;
  difficulty?: number | null;
  /** ISO timestamp of the last review, or null for a card never seen. */
  last_reviewed_at?: string | null;
};

/** One graded exam answer, as the exam signal reads it. */
export type MasteryAnswer = {
  topicId: string | null;
  topicName: string | null;
  correct: boolean;
  /** When the exam was sat. Recent evidence outweighs old evidence. */
  answered_at: string;
};

// ---------------------------------------------------------------------------
// The retention signal
// ---------------------------------------------------------------------------

/**
 * FSRS's forgetting curve: the probability of recalling a card right now.
 *
 * `R(t) = (1 + FACTOR · t/S)^DECAY`, the FSRS-5 formulation, where `t` is days
 * elapsed since the last review and `S` is stability in days. At `t = S` this
 * returns 0.9 by construction — stability *is* the interval at which recall has
 * decayed to 90%, which is what makes the constants below what they are rather
 * than free parameters.
 *
 * Implemented here rather than imported because `ts-fsrs` exposes this only
 * through a scheduler instance, and the whole point of this module is to be
 * cheap, pure, and callable over thousands of cards without constructing one.
 * The constants are FSRS-5's published defaults; if `fsrs.ts` is ever
 * parameterised per user, these must follow it.
 */
const DECAY = -0.5;
const FACTOR = 19 / 81;

export function retrievability(
  stabilityDays: number,
  elapsedDays: number,
): number {
  if (stabilityDays <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (FACTOR * t) / stabilityDays, DECAY);
}

export type RetentionSignal = {
  /** Mean predicted recall across the topic's seen cards, 0–1. */
  recall: number;
  /** Cards the mean is over — the denominator, shown rather than implied. */
  cards: number;
  /** Cards in the topic never reviewed. Not evidence of anything yet. */
  newCards: number;
};

// ---------------------------------------------------------------------------
// The combined model
// ---------------------------------------------------------------------------

export type ExamSignal = {
  /** Correct / answered, 0–1. */
  accuracy: number;
  correct: number;
  answered: number;
};

/**
 * How much to trust a signal, 0–1.
 *
 * **Confidence is reported, never folded into the score.** Three questions and
 * thirty questions can both give 67% accuracy, and a mastery map that renders
 * them identically is lying by omission — so the number stays honest and the
 * confidence travels beside it for the UI to weaken.
 *
 * Saturating rather than linear: the tenth question adds much less than the
 * second, which is the actual shape of evidence.
 */
const CONFIDENCE_SATURATION = 8;

function confidenceFrom(sampleSize: number): number {
  if (sampleSize <= 0) return 0;
  return sampleSize / (sampleSize + CONFIDENCE_SATURATION);
}

/**
 * When the two signals disagree, which is the interesting case.
 *
 * Positive means retention outruns exam performance: the material is recallable
 * when prompted but falls apart under time or applied form. Negative means the
 * reverse — the exam went better than the schedule predicts, usually a topic
 * studied elsewhere or genuinely easy.
 *
 * `null` when either signal is missing; there is no disagreement to report
 * between a number and nothing, and reporting 0 there would read as "these
 * agree", which is a different and false claim.
 */
export type TopicMastery = {
  topicId: string | null;
  topicName: string;
  /** Recall predicted by FSRS, or null when no card in the topic was reviewed. */
  retention: RetentionSignal | null;
  /** Exam accuracy, or null when no exam question covered the topic. */
  exam: ExamSignal | null;
  /**
   * The headline number, 0–1, or null when neither signal has anything to say.
   *
   * Where both exist it is their mean weighted by confidence, so a topic with
   * one exam question and forty reviews is dominated by the reviews. Where only
   * one exists it *is* that signal — extrapolating a second is invention.
   */
  score: number | null;
  /** 0–1. How much evidence is behind `score`. */
  confidence: number;
  /** `retention.recall - exam.accuracy`, or null. See above. */
  divergence: number | null;
};

export function topicMastery(
  cards: readonly MasteryCard[],
  answers: readonly MasteryAnswer[],
  now: Date = new Date(),
): TopicMastery[] {
  const buckets = new Map<
    string,
    {
      topicId: string | null;
      topicName: string;
      recalls: number[];
      newCards: number;
      correct: number;
      answered: number;
    }
  >();

  const bucketFor = (topicId: string | null, topicName: string | null) => {
    const key = topicId ?? topicName ?? UNCLASSIFIED;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        topicId,
        topicName: topicName ?? UNCLASSIFIED,
        recalls: [],
        newCards: 0,
        correct: 0,
        answered: 0,
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  const nowMs = now.getTime();

  for (const card of cards) {
    const bucket = bucketFor(card.topicId, card.topicName);

    // A new card is not weak, it is unmeasured. Counting it as 0% recall would
    // make every freshly generated deck look like a catastrophe.
    if (card.fsrs_state === 'new' || card.last_reviewed_at == null) {
      bucket.newCards += 1;
      continue;
    }
    if (typeof card.stability !== 'number') {
      bucket.newCards += 1;
      continue;
    }

    const elapsedDays =
      (nowMs - new Date(card.last_reviewed_at).getTime()) / MS_PER_DAY;
    bucket.recalls.push(retrievability(card.stability, elapsedDays));
  }

  for (const answer of answers) {
    const bucket = bucketFor(answer.topicId, answer.topicName);
    bucket.answered += 1;
    if (answer.correct) bucket.correct += 1;
  }

  const results: TopicMastery[] = [...buckets.values()].map(bucket => {
    const retention: RetentionSignal | null =
      bucket.recalls.length === 0
        ? null
        : {
            recall: meanOf(bucket.recalls),
            cards: bucket.recalls.length,
            newCards: bucket.newCards,
          };

    const exam: ExamSignal | null =
      bucket.answered === 0
        ? null
        : {
            accuracy: bucket.correct / bucket.answered,
            correct: bucket.correct,
            answered: bucket.answered,
          };

    const retentionConfidence = confidenceFrom(retention?.cards ?? 0);
    const examConfidence = confidenceFrom(exam?.answered ?? 0);

    let score: number | null = null;
    if (retention && exam) {
      const total = retentionConfidence + examConfidence;
      score =
        total === 0
          ? (retention.recall + exam.accuracy) / 2
          : (retention.recall * retentionConfidence +
              exam.accuracy * examConfidence) /
            total;
    } else if (retention) {
      score = retention.recall;
    } else if (exam) {
      score = exam.accuracy;
    }

    return {
      topicId: bucket.topicId,
      topicName: bucket.topicName,
      retention,
      exam,
      score,
      // Two signals genuinely are more evidence than one, but not the sum —
      // capped, so a topic can never be more than fully confident.
      confidence: Math.min(1, retentionConfidence + examConfidence),
      divergence:
        retention && exam ? retention.recall - exam.accuracy : null,
    };
  });

  // Weakest first, as the exam's own topic breakdown is: a diagnostic leads with
  // what needs work. Topics with no score at all sort last — they are not weak,
  // they are unmeasured, and putting them at the top would bury the real signal.
  return results.sort((a, b) => {
    if (a.score === null && b.score === null) {
      return a.topicName.localeCompare(b.topicName);
    }
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score || a.topicName.localeCompare(b.topicName);
  });
}

// ---------------------------------------------------------------------------
// Reading the result
// ---------------------------------------------------------------------------

/**
 * Bands for the mastery map. Thresholds are a product decision, stated once.
 *
 * `unmeasured` is a band rather than an absence so the UI cannot accidentally
 * render it as "weak" — the distinction between "you are bad at this" and "we
 * have not asked you yet" is the one users most resent getting wrong.
 */
export type MasteryBand = 'unmeasured' | 'weak' | 'developing' | 'strong';

export const MASTERY_THRESHOLDS = { weak: 0.6, developing: 0.85 } as const;

export function masteryBand(mastery: TopicMastery): MasteryBand {
  if (mastery.score === null) return 'unmeasured';
  if (mastery.score < MASTERY_THRESHOLDS.weak) return 'weak';
  if (mastery.score < MASTERY_THRESHOLDS.developing) return 'developing';
  return 'strong';
}

/**
 * How far the two signals must part before it is worth telling the user.
 *
 * Below this they are noise against each other — a topic at 0.82 retention and
 * 0.78 exam accuracy does not mean anything, and flagging it would train people
 * to ignore the flag that matters.
 */
export const DIVERGENCE_THRESHOLD = 0.25;

export type DivergenceKind = 'none' | 'fragile' | 'underrated';

/**
 * `fragile`: recalled when prompted, lost under exam conditions. The most
 * actionable finding the product can produce — it means practise *the exam*,
 * not the cards, and no amount of extra flashcard review will fix it.
 *
 * `underrated`: performed better on the exam than the schedule predicted. Often
 * material learned elsewhere; the schedule is being pessimistic and the cards
 * can be advanced.
 */
export function divergenceKind(mastery: TopicMastery): DivergenceKind {
  const { divergence } = mastery;
  if (divergence === null || Math.abs(divergence) < DIVERGENCE_THRESHOLD) {
    return 'none';
  }
  return divergence > 0 ? 'fragile' : 'underrated';
}

// ---------------------------------------------------------------------------

const UNCLASSIFIED = 'Unclassified';
const MS_PER_DAY = 86_400_000;

function meanOf(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
