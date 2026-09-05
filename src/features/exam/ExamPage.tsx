import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { prepareAttempt, type ExamResult, type PreparedAttempt } from '@/lib/exam';
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
  const [phase, setPhase] = useState<Phase>({ status: 'setup' });

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
      return <ExamSetup exam={SAMPLE_EXAM} onStart={start} />;

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
        <ExamResults
          result={phase.result}
          outcome={phase.outcome}
          onRetake={() => setPhase({ status: 'setup' })}
          onDone={() => void navigate('/dashboard')}
        />
      );
  }
}
