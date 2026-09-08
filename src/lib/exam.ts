/**
 * The three model-independent pieces of the old exam loop — **all that is left
 * of it.**
 *
 * This module used to hold the whole loop: `prepareAttempt`, `gradeAttempt`,
 * `examBand`, `answersFromResult` and the `ExamResult` / `QuestionResult` /
 * `TopicResult` shapes, over the old `Exam` and `ExamQuestion` types. Every one
 * of those served the browser-assembled exam that FR5 replaced — a sitting
 * whose answers were loose rows under a client-generated uuid — and FR5's
 * handoff recorded that only `shuffled`, `formatDuration` and
 * `TIMER_WARNING_MS` still had a caller. FR6 deleted the rest when the last
 * screen came off the old data stack.
 *
 * What went, and why it is not a loss: grading now happens against an
 * `Attempt`, which is a real record the server owns, and the results surface
 * reads it through `AttemptReview`. A client-side grader is a scoreboard, not
 * an authority, and the contract made that structural rather than aspirational.
 *
 * Deliberately free of React and of any data layer, the way `src/lib/fsrs.ts`
 * is.
 */

// ---------------------------------------------------------------------------
// Presentation order
// ---------------------------------------------------------------------------

/**
 * Fisher–Yates, seeded by nothing.
 *
 * Order is resolved **once when a sitting starts** — `startAttempt` is where the
 * contract says shuffling is resolved, because `AttemptAnswer.selectedOption`
 * indexes into the order the candidate was actually shown. Shuffling at render
 * time would make that index point at a different option on the next render and
 * grade the wrong answer. A non-deterministic shuffle is therefore correct here;
 * a seeded variant would only be needed to reproduce a sitting from its record,
 * and the record already stores `questionText` for that.
 */
export function shuffled<T>(items: readonly T[]): T[] {
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

// ---------------------------------------------------------------------------
// The clock
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
