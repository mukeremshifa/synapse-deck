import { MASTERY_THRESHOLDS, type MasteryBand } from '@/lib/mastery';
import {
  DEFAULT_EXAM_CONFIG,
  type Exam,
  type ExamAnswer,
  type ExamConfig,
  type ExamQuestion,
  type McqPayload,
} from '@/lib/schemas';

/**
 * The exam loop's pure functions — shuffling, grading, timing.
 *
 * Deliberately free of React and of any data layer, the way `src/lib/fsrs.ts`
 * is. Phase C moves grading server-side (a client-side grader is a scoreboard,
 * not an authority), and when it does, this module is what it ports rather than
 * what it untangles from components.
 */

// ---------------------------------------------------------------------------
// Presentation order
// ---------------------------------------------------------------------------

/**
 * Fisher–Yates, seeded by nothing — order is resolved once per attempt and then
 * frozen (see `prepareAttempt`), so a non-deterministic shuffle is correct here.
 * Phase C may want a seeded variant to reproduce an attempt from its record.
 */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i];
    const b = result[j];
    // noUncheckedIndexedAccess: both are in range by construction, but the
    // compiler cannot know that and a non-null assertion would be a lie.
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
}

/**
 * A question with its options in the order the candidate will actually see.
 *
 * **The whole reason this type exists**: `ExamAnswer.selectedOption` indexes
 * into the presented order. If options were shuffled during render, that index
 * would point at a different option on the next render and grade the wrong
 * answer. Resolving the order once, here, is what makes the index meaningful.
 */
export type PreparedQuestion = ExamQuestion & {
  payload: McqPayload;
};

export type PreparedAttempt = {
  exam: Exam;
  questions: PreparedQuestion[];
  startedAt: number;
  /** Absolute epoch ms the attempt auto-submits, or null when untimed. */
  expiresAt: number | null;
};

export function prepareAttempt(exam: Exam, now: number = Date.now()): PreparedAttempt {
  const { config } = exam;

  const ordered = config.shuffleQuestions ? shuffled(exam.questions) : [...exam.questions];
  // Shuffle *then* cap, which is what draws a random subset from a larger bank:
  // a 50-question bank at questionCount 20 gives a different 20 each attempt.
  // Capping first would make `shuffleQuestions` reorder one fixed subset, so the
  // same 20 questions appear every time and a shared link becomes gameable —
  // the property the schema's `shuffleQuestions` comment claims to prevent.
  const capped = ordered.slice(0, config.questionCount);

  const questions: PreparedQuestion[] = capped.map(question => ({
    ...question,
    payload: config.shuffleOptions
      ? { ...question.payload, options: shuffled(question.payload.options) }
      : question.payload,
  }));

  return {
    exam,
    questions,
    startedAt: now,
    expiresAt:
      config.durationMinutes === null ? null : now + config.durationMinutes * 60_000,
  };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type QuestionResult = {
  question: PreparedQuestion;
  answer: ExamAnswer;
  /** Null when unanswered — which is not the same as wrong, and is reported apart. */
  correct: boolean | null;
  correctOption: number;
};

export type ExamResult = {
  results: QuestionResult[];
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  /** 0–1. Unanswered counts against the score, as it does in a real exam. */
  score: number;
  elapsedMs: number;
  byTopic: TopicResult[];
};

/**
 * Per-topic breakdown — the seed of the Phase D diagnostic.
 *
 * It is computed here, now, because the runner already has everything it needs
 * and because a topic breakdown is what turns a score into information. Phase D
 * builds the study plan and the mastery map on top; this is the arithmetic
 * underneath both. Questions without a topic collect under a single unlabelled
 * bucket rather than being dropped — silently losing questions from a breakdown
 * is worse than showing that some are unclassified.
 */
export type TopicResult = {
  topicId: string | null;
  topicName: string;
  correct: number;
  total: number;
  /** 0–1 over answered *and* unanswered, consistent with the overall score. */
  accuracy: number;
};

function correctOptionIndex(payload: McqPayload): number {
  const index = payload.options.findIndex(option => option.correct);
  // The schema guarantees exactly one correct option, so -1 is unreachable
  // unless a payload bypassed validation. Failing loudly beats grading silently.
  if (index === -1) throw new Error('Question has no correct option');
  return index;
}

export function gradeAttempt(
  attempt: PreparedAttempt,
  answers: ReadonlyMap<string, ExamAnswer>,
  submittedAt: number = Date.now(),
): ExamResult {
  const results: QuestionResult[] = attempt.questions.map(question => {
    const answer = answers.get(question.id) ?? emptyAnswer(question.id);
    const correctOption = correctOptionIndex(question.payload);
    return {
      question,
      answer,
      correct:
        answer.selectedOption === null ? null : answer.selectedOption === correctOption,
      correctOption,
    };
  });

  const correctCount = results.filter(result => result.correct === true).length;
  const incorrectCount = results.filter(result => result.correct === false).length;
  const unansweredCount = results.filter(result => result.correct === null).length;

  return {
    results,
    correctCount,
    incorrectCount,
    unansweredCount,
    score: results.length === 0 ? 0 : correctCount / results.length,
    elapsedMs: Math.max(0, submittedAt - attempt.startedAt),
    byTopic: summariseByTopic(results),
  };
}

const UNLABELLED = 'Unclassified';

function summariseByTopic(results: readonly QuestionResult[]): TopicResult[] {
  const buckets = new Map<string, TopicResult>();

  for (const result of results) {
    const { topicId, topicName } = result.question;
    const key = topicId ?? UNLABELLED;
    const existing = buckets.get(key);
    const bucket: TopicResult = existing ?? {
      topicId: topicId ?? null,
      topicName: topicName ?? UNLABELLED,
      correct: 0,
      total: 0,
      accuracy: 0,
    };

    bucket.total += 1;
    if (result.correct === true) bucket.correct += 1;
    bucket.accuracy = bucket.correct / bucket.total;
    buckets.set(key, bucket);
  }

  // Weakest first: a diagnostic leads with what needs work, not with what went
  // well. Ties break alphabetically so the order is stable between renders.
  return [...buckets.values()].sort(
    (a, b) => a.accuracy - b.accuracy || a.topicName.localeCompare(b.topicName),
  );
}

/**
 * How an exam score reads as a band, on the scale the rest of the app uses.
 *
 * **Deliberately `MASTERY_THRESHOLDS`, not a new scale.** The obvious move is a
 * grading scale of its own — 90 an A, 80 a B, the shape everyone recognises. It
 * would be a second definition of "good" living beside `mastery.ts`'s, and the
 * two would disagree: a 62% exam would read as a near-fail here and as
 * `developing` on the diagnostic, from the same numbers, on adjacent screens.
 * One scale, one meaning, and a band here is a claim the diagnostic will stand
 * behind.
 *
 * No letter grades for the same reason. A letter is a summary judgement of a
 * student and invites comparison to a cohort that does not exist; a band
 * describes the material, which is the thing this product can actually speak to.
 *
 * `unmeasured` is unreachable from a sat exam — an attempt with no questions
 * cannot be graded — but the band type is shared, so it is handled rather than
 * asserted away.
 */
export function examBand(result: ExamResult): MasteryBand {
  if (result.results.length === 0) return 'unmeasured';
  if (result.score < MASTERY_THRESHOLDS.weak) return 'weak';
  if (result.score < MASTERY_THRESHOLDS.developing) return 'developing';
  return 'strong';
}

export const EXAM_BAND_LABEL: Record<MasteryBand, string> = {
  unmeasured: 'Not graded',
  weak: 'Below where you want to be',
  developing: 'Getting there',
  strong: 'Solid',
};

export function emptyAnswer(questionId: string): ExamAnswer {
  return { questionId, selectedOption: null, flagged: false, elapsedMs: 0 };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** `mm:ss`, or `h:mm:ss` past an hour. Monospace tabular digits at the call site. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Below this, the timer turns urgent. Five minutes is the usual invigilator's warning. */
export const TIMER_WARNING_MS = 5 * 60_000;

export { DEFAULT_EXAM_CONFIG };
export type { Exam, ExamAnswer, ExamConfig, ExamQuestion };
