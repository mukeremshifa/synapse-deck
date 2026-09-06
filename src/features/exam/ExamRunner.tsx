import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClockIcon, FlagIcon, MaximizeIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Kbd } from '@/components/ui/kbd';
import {
  emptyAnswer,
  formatDuration,
  gradeAttempt,
  TIMER_WARNING_MS,
  type ExamAnswer,
  type ExamResult,
  type PreparedAttempt,
} from '@/lib/exam';
import type { AttemptOutcome } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { ExamOptions } from './ExamOptions';
import { QuestionNavigator } from './QuestionNavigator';
import { useExamTimer } from './useExamTimer';
import { useFocusMode } from './useFocusMode';

/**
 * One exam attempt, from the first question to submission.
 *
 * **Attempt state is component state, not TanStack Query** — the same choice
 * `PracticeSession` makes and for the same reason (SPEC §8.3): the question set
 * arrives once as a prepared snapshot and this component works through it.
 * Refetching underneath a candidate would reorder an exam they are part-way
 * through, which in a timed attempt is not a glitch but a lost attempt.
 *
 * **Grading happens here for now, and that is temporary.** A client-side grader
 * is a scoreboard, not an authority: the answers are in memory and so are the
 * correct options. Phase C moves grading behind the API, at which point
 * `onFinish` posts answers and receives a result instead of computing one. The
 * arithmetic it will move is already isolated in `src/lib/exam.ts`.
 */

export function ExamRunner({
  attempt,
  onFinish,
}: {
  attempt: PreparedAttempt;
  onFinish: (result: ExamResult, outcome: AttemptOutcome) => void;
}) {
  const { questions, exam } = attempt;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, ExamAnswer>>(new Map());
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const enteredAt = useRef<number>(Date.now());
  // Submission must be idempotent: the timer can expire in the same tick the
  // candidate clicks Submit, and grading twice would fire `onFinish` twice.
  // A ref rather than the state above because it must be readable synchronously.
  const submittedRef = useRef(false);

  const question = questions[index];

  const focus = useFocusMode(exam.config.focusMode, !submitted);

  /** Fold the time spent on the question being left into its answer. */
  const commitElapsed = useCallback(() => {
    const current = questions[index];
    if (!current) return;
    const spent = Math.max(0, Date.now() - enteredAt.current);
    enteredAt.current = Date.now();
    setAnswers(previous => {
      const next = new Map(previous);
      const existing = next.get(current.id) ?? emptyAnswer(current.id);
      next.set(current.id, { ...existing, elapsedMs: existing.elapsedMs + spent });
      return next;
    });
  }, [index, questions]);

  const submit = useCallback(
    (outcome: AttemptOutcome) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitted(true);

      // Fold in the time on the final question before grading, so the per-question
      // timings add up to the attempt duration rather than missing the last visit.
      const current = questions[index];
      const spent = Math.max(0, Date.now() - enteredAt.current);
      const finalAnswers = new Map(answers);
      if (current) {
        const existing = finalAnswers.get(current.id) ?? emptyAnswer(current.id);
        finalAnswers.set(current.id, {
          ...existing,
          elapsedMs: existing.elapsedMs + spent,
        });
      }

      onFinish(gradeAttempt(attempt, finalAnswers), outcome);
    },
    [answers, attempt, index, onFinish, questions],
  );

  /**
   * Auto-submit on expiry — the one part of the timer that must not be missable.
   * A candidate whose time runs out gets their attempt graded as it stands,
   * exactly as they would if an invigilator collected the paper.
   */
  const handleExpire = useCallback(() => submit('expired'), [submit]);
  const remainingMs = useExamTimer(attempt.expiresAt, handleExpire);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= questions.length || target === index) return;
      commitElapsed();
      setIndex(target);
    },
    [commitElapsed, index, questions.length],
  );

  const select = useCallback(
    (option: number) => {
      if (!question) return;
      setAnswers(previous => {
        const next = new Map(previous);
        const existing = next.get(question.id) ?? emptyAnswer(question.id);
        next.set(question.id, { ...existing, selectedOption: option });
        return next;
      });
    },
    [question],
  );

  const toggleFlag = useCallback(() => {
    if (!question) return;
    setAnswers(previous => {
      const next = new Map(previous);
      const existing = next.get(question.id) ?? emptyAnswer(question.id);
      next.set(question.id, { ...existing, flagged: !existing.flagged });
      return next;
    });
  }, [question]);

  // Focus the runner so the keyboard shortcuts work without a click first.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const answeredCount = useMemo(
    () => [...answers.values()].filter(answer => answer.selectedOption !== null).length,
    [answers],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === 'arrowright' || key === 'n') {
        event.preventDefault();
        goTo(index + 1);
        return;
      }
      if (key === 'arrowleft' || key === 'p') {
        event.preventDefault();
        goTo(index - 1);
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        toggleFlag();
        return;
      }
      // 1–5 pick an option. Bounded by the schema max of 5 options.
      if (key >= '1' && key <= '5' && question) {
        const option = Number(key) - 1;
        if (option < question.payload.options.length) {
          event.preventDefault();
          select(option);
        }
      }
    },
    [goTo, index, question, select, toggleFlag],
  );

  if (!question) return null;

  const answer = answers.get(question.id) ?? emptyAnswer(question.id);
  const isLast = index === questions.length - 1;
  const urgent = remainingMs !== null && remainingMs <= TIMER_WARNING_MS;
  const unanswered = questions.length - answeredCount;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Exam in progress"
      className={cn(
        'focus-visible:ring-ring mx-auto max-w-3xl space-y-5 rounded-xl outline-none focus-visible:ring-2',
        // The runner always owns the viewport now. Through P6 it sat inside
        // `AppLayout`, which supplied the padding whenever focus mode was off;
        // P11 routes a running exam through no frame at all (see `ExamPage` for
        // why a timed exam gets no close button), so the padding is
        // unconditional and the min-height keeps a short exam from floating.
        'bg-background min-h-dvh px-4 py-8',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {exam.title}
          </p>
          <p className="text-sm">
            Question{' '}
            <span className="text-foreground font-mono tabular-nums">{index + 1}</span> of{' '}
            <span className="font-mono tabular-nums">{questions.length}</span>
            {question.topicName && (
              <>
                {' · '}
                <span className="text-muted-foreground">{question.topicName}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {remainingMs !== null && (
            <div
              // Announced politely rather than assertively: a live region that
              // interrupts every second would make the exam unusable with a
              // screen reader. The five-minute change of state is the moment
              // worth hearing, and `urgent` is what carries it visually.
              aria-live="polite"
              aria-atomic
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm tabular-nums',
                urgent && 'border-destructive/60 bg-destructive/10 text-destructive',
              )}
            >
              <ClockIcon className="size-3.5" aria-hidden />
              <span className="sr-only">Time remaining </span>
              {formatDuration(remainingMs)}
            </div>
          )}
          <Button
            type="button"
            variant={answer.flagged ? 'secondary' : 'ghost'}
            size="sm"
            onClick={toggleFlag}
            aria-pressed={answer.flagged}
          >
            <FlagIcon className={cn(answer.flagged && 'fill-current')} />
            {answer.flagged ? 'Flagged' : 'Flag'} <Kbd className="ml-1">F</Kbd>
          </Button>
        </div>
      </header>

      {/*
        Focus mode asked for full-screen and did not get it — an iframe, a
        browser policy, or the candidate pressing Escape. Say so plainly and
        offer it back, rather than either failing silently or blocking the
        attempt: this is realism, and losing it is not a reason to stop an exam.
      */}
      {focus.degraded && (
        <div className="text-muted-foreground flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-xs">
          <span>Focus mode is not active — full-screen was exited or refused.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void focus.enter()}
          >
            <MaximizeIcon /> Re-enter
          </Button>
        </div>
      )}

      <Card className="py-8">
        <CardContent className="space-y-6 px-8">
          <p className="font-serif text-xl leading-snug whitespace-pre-wrap">
            {question.payload.stem}
          </p>
          <ExamOptions
            questionId={question.id}
            payload={question.payload}
            selected={answer.selectedOption}
            onSelect={select}
          />
        </CardContent>
      </Card>

      <QuestionNavigator
        questions={questions}
        answers={answers}
        currentIndex={index}
        onNavigate={goTo}
      />

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          Previous
        </Button>

        <span className="text-muted-foreground hidden text-xs sm:inline">
          <Kbd>1</Kbd>–<Kbd>5</Kbd> answer · <Kbd>←</Kbd> <Kbd>→</Kbd> navigate
        </span>

        {isLast ? (
          <Button type="button" onClick={() => setConfirmingSubmit(true)}>
            Submit exam
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => goTo(index + 1)}>
            Next
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmingSubmit}
        onOpenChange={setConfirmingSubmit}
        title="Submit this exam?"
        // The count of what is *unanswered* rather than answered: it is the
        // number that changes someone's mind, and it is the reason to show a
        // confirmation at all.
        description={
          unanswered === 0
            ? 'All questions are answered. You cannot change your answers after submitting.'
            : `${unanswered} of ${questions.length} questions are unanswered. Unanswered questions are marked incorrect.`
        }
        confirmLabel="Submit"
        onConfirm={() => {
          setConfirmingSubmit(false);
          submit('submitted');
        }}
      />
    </div>
  );
}
