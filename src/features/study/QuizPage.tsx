import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2Icon, EyeIcon, FlagIcon, RotateCcwIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { notebookPath } from '@/lib/notebooks';
import type { Attempt, AttemptAnswer, Question } from '@/lib/api';
import { cn } from '@/lib/utils';
import { QuizOptions } from './QuizOptions';
import { AttemptReview } from './AttemptReview';
import { NotReady, WrongKind } from './WrongKind';
import {
  useArtifact,
  useQuestions,
  useSaveAttemptProgress,
  useStartAttempt,
  useSubmitAttempt,
} from './queries';

/**
 * `/notebooks/:notebookId/quizzes/:quizId` — the untimed runner.
 *
 * ── This is new work, and copying the exam would have been the wrong move ──
 *
 * Nothing in the app did this before. The nearest thing was the exam runner,
 * and FR5 §3 settles why reaching for it produces the wrong surface:
 *
 * | | Quiz | Exam |
 * | --- | --- | --- |
 * | Timing | none | timed |
 * | Delivery | **one question per page** | the whole paper, navigable |
 * | Reveal | **on answer or on demand** | at the end |
 * | Repeatable | yes, **resumable** | one sitting, one `Attempt` |
 *
 * A quiz built from the exam runner is a timed quiz with the answers hidden —
 * a bad quiz and an untrustworthy exam at once. They are separate runners, and
 * §5 of the plan makes that an acceptance criterion.
 *
 * ── Where resume state lives (FR5 §6.1) ──────────────────────────────────
 *
 * **On the server, in the attempt.** The contract already decided this and it
 * is the right answer: `startAttempt` on a quiz with an `in-progress` attempt
 * returns *that* attempt rather than opening a second one, and
 * `saveAttemptProgress` accumulates answers into it. So resume is not a feature
 * this runner implements — it is what the contract does — and the alternatives
 * are worse in ways worth naming:
 *
 * - **`localStorage`** would strand a half-finished quiz on one browser, and
 *   diverge silently from the attempt the server already has.
 * - **Component state alone** loses the sitting on a refresh, which §5.3 makes
 *   an acceptance criterion against.
 *
 * Progress is saved **after every answer**, not on a timer and not on unload:
 * `beforeunload` is unreliable on mobile and a timer loses whatever fell inside
 * its last interval. One answer is the unit of work, so it is the unit of save.
 *
 * ── What if the artifact changed underneath it? ──────────────────────────
 *
 * **It cannot.** FR4 §6.3 decided that a regeneration produces a *new* artifact
 * rather than replacing one, so a quiz's questions are stable for the life of
 * every attempt against it. This is the assumption FR4's handoff calls the
 * strongest thing it hands FR5, and it is what makes an answer recorded against
 * a question id permanently meaningful. `AttemptAnswer.questionText` still
 * copies the text — belt and braces, and ADR 0013's rule — so an attempt read
 * back stays legible even if the artifact is later deleted.
 */
export function QuizPage() {
  const { notebookId, quizId } = useParams<{ notebookId: string; quizId: string }>();
  if (!notebookId || !quizId) return null;
  return <Quiz notebookId={notebookId} quizId={quizId} />;
}

function Quiz({ notebookId, quizId }: { notebookId: string; quizId: string }) {
  const artifact = useArtifact(notebookId, quizId);
  const questions = useQuestions(notebookId, quizId);
  const startAttempt = useStartAttempt(notebookId, quizId);

  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const ready =
    artifact.data?.kind === 'quiz' &&
    artifact.data.status === 'ready' &&
    questions.data !== undefined;

  /*
   * Start — or rejoin — exactly one attempt.
   *
   * The ref guards against the effect running twice, which it does in StrictMode
   * and would on any re-render that changed `ready`. Starting twice is not
   * harmless: on a quiz the contract returns the same in-progress attempt, so it
   * would be a wasted round trip, but the same code shape on a surface without
   * that guarantee opens a second sitting.
   */
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    startAttempt.mutate(undefined, {
      onSuccess: setAttempt,
      onError: error =>
        toast.error('Could not start this quiz', {
          description: error instanceof Error ? error.message : undefined,
        }),
    });
  }, [ready, startAttempt]);

  const frameProps = {
    title: 'Quiz',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
  };

  if (artifact.isError || questions.isError) {
    const error = artifact.error ?? questions.error;
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load this quiz"
          {...(error instanceof Error ? { detail: error.message } : {})}
          onRetry={() => {
            void artifact.refetch();
            void questions.refetch();
          }}
        />
      </FocusFrame>
    );
  }

  if (artifact.isPending || questions.isPending) {
    return (
      <FocusFrame {...frameProps}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </FocusFrame>
    );
  }

  if (artifact.data.kind !== 'quiz') {
    return (
      <FocusFrame {...frameProps}>
        <WrongKind notebookId={notebookId} artifact={artifact.data} expected="quiz" />
      </FocusFrame>
    );
  }

  if (artifact.data.status !== 'ready') {
    return (
      <FocusFrame {...frameProps}>
        <NotReady notebookId={notebookId} artifact={artifact.data} />
      </FocusFrame>
    );
  }

  if (questions.data.length === 0) {
    return (
      <FocusFrame {...frameProps}>
        <EmptyState
          title="This quiz has no questions"
          description="It finished generating without producing any. Generating it again may work."
          action={
            <Button asChild>
              <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
            </Button>
          }
        />
      </FocusFrame>
    );
  }

  if (!attempt) {
    return (
      <FocusFrame {...frameProps}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </FocusFrame>
    );
  }

  return (
    <QuizRunner
      // A new attempt is a new run: never carry one sitting's local state into
      // the next.
      key={attempt.id}
      notebookId={notebookId}
      quizId={quizId}
      title={artifact.data.title}
      questions={questions.data}
      attempt={attempt}
      onRestart={() => {
        started.current = false;
        setAttempt(null);
      }}
    />
  );
}

/* ── The runner ───────────────────────────────────────────────────────── */

function QuizRunner({
  notebookId,
  quizId,
  title,
  questions,
  attempt,
  onRestart,
}: {
  notebookId: string;
  quizId: string;
  title: string;
  questions: Question[];
  attempt: Attempt;
  onRestart: () => void;
}) {
  /*
   * The sitting's answers, keyed by question id.
   *
   * Seeded from the attempt, which is what makes rejoining work: an attempt
   * with two of five answered comes back with those two, and the runner opens
   * on the third. Nothing else is needed for resume — that is the point of
   * putting the state on the server.
   */
  const [answers, setAnswers] = useState<Map<string, AttemptAnswer>>(
    () => new Map(attempt.answers.map(answer => [answer.questionId, answer])),
  );

  /** Open on the first unanswered question — where the reader left off. */
  const [index, setIndex] = useState(() => {
    const answered = new Set(attempt.answers.map(answer => answer.questionId));
    const next = questions.findIndex(question => !answered.has(question.id));
    return next === -1 ? 0 : next;
  });

  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState<Attempt | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shownAt = useRef<number>(Date.now());

  const saveProgress = useSaveAttemptProgress(notebookId);
  const submit = useSubmitAttempt(notebookId, quizId);

  const question = questions[index];
  const answer = question ? (answers.get(question.id) ?? null) : null;
  const resumed = attempt.answers.length > 0;

  useEffect(() => {
    shownAt.current = Date.now();
    // An already-answered question opens revealed: it has been seen, and
    // hiding what was already shown would be a worse kind of surprise.
    setRevealed(question ? answers.has(question.id) : false);
    containerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the question, not on the answers map it reads
  }, [question?.id]);

  const answeredCount = answers.size;
  const allAnswered = answeredCount === questions.length;

  /** Record one answer, reveal it, and persist the sitting. */
  const choose = useCallback(
    (option: number) => {
      if (!question || answers.has(question.id)) return;

      const correct = question.payload.options[option]?.correct === true;
      const recorded: AttemptAnswer = {
        questionId: question.id,
        // Copied, not joined: the authority for what this answer meant once the
        // question behind it is gone (ADR 0013, and the contract's comment).
        questionText: question.payload.stem,
        topicId: question.topicId,
        topicName: question.topicName,
        selectedOption: option,
        correct,
        flagged: answers.get(question.id)?.flagged ?? false,
        elapsedMs: Math.max(0, Date.now() - shownAt.current),
      };

      const next = new Map(answers);
      next.set(question.id, recorded);
      setAnswers(next);
      setRevealed(true);

      // Save after every answer. The whole map, not a delta — the contract
      // takes the answers as they stand, so a save that lost the network does
      // not leave a hole for the next one to build on.
      saveProgress.mutate(
        { attemptId: attempt.id, answers: [...next.values()] },
        {
          onError: () =>
            toast.error('Could not save your progress', {
              description: 'Your answer is recorded here, but leaving now may lose it.',
            }),
        },
      );
    },
    [answers, attempt.id, question, saveProgress],
  );

  /** Flagging survives a save, so it is part of the answer record. */
  const toggleFlag = useCallback(() => {
    if (!question) return;
    const existing = answers.get(question.id);
    if (!existing) return;
    const next = new Map(answers);
    next.set(question.id, { ...existing, flagged: !existing.flagged });
    setAnswers(next);
    saveProgress.mutate({ attemptId: attempt.id, answers: [...next.values()] });
  }, [answers, attempt.id, question, saveProgress]);

  const go = useCallback(
    (target: number) => {
      if (target < 0 || target >= questions.length) return;
      setIndex(target);
    },
    [questions.length],
  );

  /**
   * Finish the quiz.
   *
   * Only ever `submitted` — a quiz has no timer to expire and leaving one is
   * not abandoning it, it is pausing. That is the difference the outcome
   * vocabulary is carrying (see `endedBecause` in the exam runner for the other
   * half).
   */
  const finish = useCallback(() => {
    submit.mutate(
      {
        attemptId: attempt.id,
        input: { answers: [...answers.values()], outcome: 'submitted' },
      },
      {
        onSuccess: result => {
          setFinished(result);
          window.scrollTo({ top: 0 });
        },
        onError: error =>
          toast.error('Could not submit this quiz', {
            description: error instanceof Error ? error.message : undefined,
          }),
      },
    );
  }, [answers, attempt.id, submit]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === 'arrowright' || key === 'n') {
        event.preventDefault();
        go(index + 1);
        return;
      }
      if (key === 'arrowleft' || key === 'p') {
        event.preventDefault();
        go(index - 1);
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        toggleFlag();
        return;
      }
      if (key >= '1' && key <= '5' && question && !revealed) {
        const option = Number(key) - 1;
        if (option < question.payload.options.length) {
          event.preventDefault();
          choose(option);
        }
      }
    },
    [choose, go, index, question, revealed, toggleFlag],
  );

  if (finished) {
    return (
      <FocusFrame
        title="Quiz results"
        subtitle={title}
        exitTo={notebookPath.open(notebookId)}
        width="wide"
      >
        <AttemptReview
          attempt={finished}
          questions={questions}
          onRetake={() => {
            setFinished(null);
            onRestart();
          }}
          retakeLabel="Take it again"
          notebookId={notebookId}
        />
      </FocusFrame>
    );
  }

  if (!question) return null;

  return (
    <FocusFrame
      title="Quiz"
      subtitle={title}
      exitTo={notebookPath.open(notebookId)}
      status={
        <span className="text-muted-foreground text-sm tabular-nums">
          {answeredCount} / {questions.length}
        </span>
      }
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        role="region"
        aria-label="Quiz in progress"
        className="focus-visible:ring-ring mx-auto max-w-2xl space-y-5 rounded-xl outline-none focus-visible:ring-2"
      >
        {/*
          Say plainly that this is a sitting already under way. Someone who
          left three days ago and came back to question 4 needs to know why
          they are not on question 1 — an unexplained jump reads as a bug.
        */}
        {resumed && (
          <p className="text-muted-foreground text-xs">
            Picking up where you left off — {attempt.answers.length} of{' '}
            {questions.length} already answered.
          </p>
        )}

        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>
              Question{' '}
              <span className="text-foreground font-mono tabular-nums">{index + 1}</span>{' '}
              of <span className="font-mono tabular-nums">{questions.length}</span>
              {question.topicName && <> · {question.topicName}</>}
            </span>
            {answer?.flagged && (
              <Badge variant="outline">
                <FlagIcon className="fill-current" /> Flagged
              </Badge>
            )}
          </div>
          <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-foreground h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(answeredCount / questions.length) * 100}%` }}
            />
          </div>
        </div>

        <Card className="py-8">
          <CardContent className="space-y-6 px-8">
            <p className="font-serif text-xl leading-snug whitespace-pre-wrap">
              {question.payload.stem}
            </p>

            <QuizOptions
              questionId={question.id}
              payload={question.payload}
              selected={answer?.selectedOption ?? null}
              onSelect={choose}
              revealed={revealed}
            />

            {/*
              Reveal on demand — the half of §3's "on answer or on demand" that
              an auto-revealing runner would miss. Someone who does not know
              can look, and what they looked at is not recorded as an answer:
              the question stays unanswered until they pick one.
            */}
            {!revealed && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setRevealed(true)}
              >
                <EyeIcon /> Show the answer <Kbd className="ml-1">R</Kbd>
              </Button>
            )}

            {revealed && (
              <div className="space-y-4 border-t pt-6 motion-safe:animate-in">
                {answer ? (
                  <p
                    className={cn(
                      'text-sm font-medium',
                      answer.correct ? 'text-primary' : 'text-destructive',
                    )}
                  >
                    {answer.correct ? 'Correct' : 'Not quite'}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm font-medium">
                    Shown without answering — this question is still unanswered.
                  </p>
                )}
                {question.payload.explanation && (
                  <p className="text-muted-foreground leading-relaxed">
                    {question.payload.explanation}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => go(index - 1)}
            disabled={index === 0}
          >
            Previous
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleFlag}
              disabled={!answer}
              aria-pressed={answer?.flagged ?? false}
            >
              <FlagIcon className={cn(answer?.flagged && 'fill-current')} />
              <span className="sr-only sm:not-sr-only">
                {answer?.flagged ? 'Unflag' : 'Flag'}
              </span>
              <Kbd className="ml-1">F</Kbd>
            </Button>

            {index === questions.length - 1 ? (
              <Button type="button" onClick={finish} disabled={submit.isPending}>
                <CheckCircle2Icon /> Finish
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => go(index + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Kbd>1</Kbd>–<Kbd>5</Kbd> answer · <Kbd>←</Kbd> <Kbd>→</Kbd> move ·{' '}
            <Kbd>R</Kbd> reveal
          </span>
          {/*
            Finishing early is allowed and unanswered questions are simply
            unanswered — a quiz is not a paper, and forcing someone to walk to
            the last question to stop is friction with nothing behind it.
          */}
          {!allAnswered && index !== questions.length - 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={finish}
              disabled={submit.isPending}
            >
              <RotateCcwIcon /> Finish early
            </Button>
          )}
        </div>
      </div>
    </FocusFrame>
  );
}
