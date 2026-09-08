import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { FocusFrame } from '@/app/FocusFrame';
import {
  answersFromResult,
  prepareAttempt,
  type ExamResult,
  type PreparedAttempt,
} from '@/lib/exam';
import { notebookPath } from '@/lib/notebooks';
import { useDeck, useRecordAttempt } from '@/lib/queries';
import type { AttemptOutcome } from '@/lib/schemas';
import { ExamResults } from './ExamResults';
import { ExamRunner } from './ExamRunner';
import { ExamSetup } from './ExamSetup';
import { SAMPLE_EXAM } from './fixtures';

/**
 * The exam route: configure, sit, review.
 *
 * A three-phase state machine held in one component, because the three phases
 * share an attempt and nothing else needs to know about it. `PracticePage`
 * splits along the same seam.
 *
 * ── What is real here after DS3, and what is not ──────────────────────────
 *
 * **The attempt is now recorded.** Submitting posts the graded answers to
 * `/exams/answers`, and the diagnostic reads them as its exam signal — the half
 * of `mastery.ts` that had no source at all until DS3 task 4. An exam sat is no
 * longer forgotten when the tab closes.
 *
 * **The questions are still a fixture, and the setup screen says so on screen.**
 * Generating an exam from the user's own cards is model work — Phase C's
 * substance, not plumbing — and DS3 task 1 deliberately left it there rather
 * than half-building it. What that phase changes is `SAMPLE_EXAM` becoming a
 * query; everything below should need no other change, which is the property
 * this arrangement exists to prove.
 *
 * A sample exam's questions carry fixture topic ids (`'networking'`), not the
 * user's topic rows, so `answersFromResult` drops them to null rather than
 * recording pointers to nothing. The attempt is real; its topic attribution is
 * not, and neither the schema nor the mastery map is told otherwise.
 */

type Phase =
  | { status: 'setup' }
  | { status: 'running'; attempt: PreparedAttempt }
  | { status: 'results'; result: ExamResult; outcome: AttemptOutcome };

export function ExamPage() {
  const navigate = useNavigate();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const deck = useDeck(notebookId);
  const recordAttempt = useRecordAttempt();
  const [phase, setPhase] = useState<Phase>({ status: 'setup' });

  /*
   * FR2: the way out is the notebook, or home when the route gave no id.
   * There is no notebook *list* any more — `/` is the one front door.
   */
  const exitTo = notebookId ? notebookPath.open(notebookId) : notebookPath.home();

  const start = useCallback((exam: typeof SAMPLE_EXAM) => {
    setPhase({ status: 'running', attempt: prepareAttempt(exam) });
  }, []);

  const finish = useCallback(
    (result: ExamResult, outcome: AttemptOutcome) => {
      setPhase({ status: 'results', result, outcome });
      // The results screen is a different document; a candidate submitting from
      // question 20 should not land halfway down it.
      window.scrollTo({ top: 0 });

      /*
       * Record the attempt, and **show the results either way**.
       *
       * The candidate has finished; their score is computed and in hand. Making
       * them wait on a network round trip to see it — or worse, losing the
       * screen if it fails — would trade the thing they came for against
       * bookkeeping. So this is fire-and-forget by design, and a failure is
       * reported honestly rather than swallowed: the exam happened, and the
       * diagnostic simply will not know about it.
       */
      recordAttempt.mutate(
        { attemptId: crypto.randomUUID(), answers: answersFromResult(result) },
        {
          onError: () =>
            toast('This attempt was not saved', {
              description:
                'Your results below are correct, but the diagnostic will not count this exam.',
            }),
        },
      );
    },
    [recordAttempt],
  );

  switch (phase.status) {
    case 'setup':
      return (
        <FocusFrame
          title="Exam"
          {...(deck.data ? { subtitle: deck.data.title } : {})}
          exitTo={exitTo}
        >
          {/*
            `isSample` is a literal here because `SAMPLE_EXAM` is a literal
            here. When this import becomes a query (Phase C), both change
            together — which is the point of the prop rather than a hardcoded
            banner inside the setup screen.
          */}
          <ExamSetup exam={SAMPLE_EXAM} onStart={start} isSample />
        </FocusFrame>
      );

    /*
     * A running exam gets no frame at all — `bare`, and in fact not wrapped.
     * `ExamRunner` already owns the viewport when focus mode engages, and a
     * header with a close button on a timed exam is an invitation to lose an
     * attempt to a stray click. The way out of a running exam is to submit it,
     * which is what the runner's own controls do.
     */
    case 'running':
      return (
        <ExamRunner
          // Remounting on retake is the point: a fresh attempt must not inherit
          // the previous one's answers, index or elapsed timings, and keying by
          // start time is cheaper and less error-prone than resetting six
          // pieces of state correctly.
          key={phase.attempt.startedAt}
          attempt={phase.attempt}
          onFinish={finish}
        />
      );

    case 'results':
      return (
        <FocusFrame
          title="Results"
          {...(deck.data ? { subtitle: deck.data.title } : {})}
          exitTo={exitTo}
          width="wide"
        >
          <ExamResults
            result={phase.result}
            outcome={phase.outcome}
            onRetake={() => setPhase({ status: 'setup' })}
            onDone={() => void navigate(exitTo)}
            {...(notebookId
              ? {
                  /*
                   * FR2: the diagnostic is no longer its own route. Topic
                   * mastery is part of the notebook's overview (brief §3.4),
                   * which FR6 builds — the route resolves today and renders a
                   * placeholder naming that phase.
                   */
                  onSeeDiagnostic: () => void navigate(notebookPath.overview(notebookId)),
                }
              : {})}
          />
        </FocusFrame>
      );
  }
}
