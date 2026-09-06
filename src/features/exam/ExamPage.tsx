import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FocusFrame } from '@/app/FocusFrame';
import { prepareAttempt, type ExamResult, type PreparedAttempt } from '@/lib/exam';
import { notebookPath } from '@/lib/notebooks';
import { useDeck } from '@/lib/queries';
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
 * **The exam itself comes from a fixture, and that is the whole scaffold.**
 * Phase B generates blueprints and Phase C generates real exams; when that
 * lands, `SAMPLE_EXAM` is replaced by a query and the components below should
 * need no change — which is the property this arrangement exists to prove.
 * Everything backend-shaped is confined to the one import.
 */

type Phase =
  | { status: 'setup' }
  | { status: 'running'; attempt: PreparedAttempt }
  | { status: 'results'; result: ExamResult; outcome: AttemptOutcome };

export function ExamPage() {
  const navigate = useNavigate();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const deck = useDeck(notebookId);
  const [phase, setPhase] = useState<Phase>({ status: 'setup' });

  const exitTo = notebookId ? notebookPath.open(notebookId) : notebookPath.list();

  const start = useCallback((exam: typeof SAMPLE_EXAM) => {
    setPhase({ status: 'running', attempt: prepareAttempt(exam) });
  }, []);

  const finish = useCallback((result: ExamResult, outcome: AttemptOutcome) => {
    setPhase({ status: 'results', result, outcome });
    // The results screen is a different document; a candidate submitting from
    // question 20 should not land halfway down it.
    window.scrollTo({ top: 0 });
  }, []);

  switch (phase.status) {
    case 'setup':
      return (
        <FocusFrame
          title="Exam"
          {...(deck.data ? { subtitle: deck.data.title } : {})}
          exitTo={exitTo}
        >
          <ExamSetup exam={SAMPLE_EXAM} onStart={start} />
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
          />
        </FocusFrame>
      );
  }
}
