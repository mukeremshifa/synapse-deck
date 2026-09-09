import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ClockIcon, FlagIcon, MaximizeIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { BlueprintEditor } from './BlueprintEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { QuizAnswer, isComplete } from './QuizAnswer';
import { QuestionPrompt } from './QuestionPrompt';
import { useExamTimer } from '@/features/exam/useExamTimer';
import { useFocusMode } from '@/features/exam/useFocusMode';
import { formatDuration, shuffled, TIMER_WARNING_MS } from '@/lib/exam';
import { notebookPath } from '@/lib/notebooks';
import type {
  Artifact,
  Attempt,
  AttemptAnswer,
  AttemptOutcome,
  Blueprint,
  Question,
} from '@/lib/api';
// The contract imports `ExamConfig` from `schemas.ts` rather than redefining it
// — one Zod definition per concept (CLAUDE.md) — so it is imported from there.
import {
  gradeResponse,
  questionStem,
  responseSelectedOption,
  type ExamConfig,
  type QuestionResponse,
} from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { AttemptReview } from './AttemptReview';
import { ExamNavigator } from './ExamNavigator';
import { NotReady, WrongKind } from './WrongKind';
import { useArtifact, useQuestions, useStartAttempt, useSubmitAttempt } from './queries';

/**
 * `/notebooks/:notebookId/exams/:examId` — **an exam artifact, named in the route.**
 *
 * ── What changed, and why the old page could not just be re-pointed ───────
 *
 * The old page ignored its `:examId` entirely and rendered a hardcoded
 * `SAMPLE_EXAM` from `features/exam/fixtures.ts` (FR2's drift row: "the route
 * is honest; the page is not yet"). Underneath that, `0008_answers.sql:89`
 * recorded the real state of the model plainly:
 *
 * > "there is no `exams` table, because an exam is currently assembled in the
 * > browser"
 *
 * — loose answers grouped by a client-generated uuid. FR0's contract replaced
 * that: an exam is an **artifact**, it has an id, its questions are the
 * server's, and its blueprint belongs to it (brief §1.2(9)). So three things
 * changed together, which is why this is a new file rather than an edit:
 *
 * 1. It runs the exam the route names, not one assembled here.
 * 2. Its blueprint is read from `payload.blueprint` — the exam's own.
 * 3. **One sitting produces one `Attempt`**, created by `startAttempt` before
 *    the first question and closed by `submitAttempt`. The uuid grouping is
 *    gone with the table that needed it.
 *
 * ── What is kept ─────────────────────────────────────────────────────────
 *
 * `useExamTimer` and `useFocusMode` are good components that were wired to the
 * wrong parents (§1.4, and FR5 §3's "good components wired to the wrong
 * parents"). They are model-independent and are reused unchanged — the timer in
 * particular counts down to an absolute deadline rather than decrementing,
 * which is the only version that survives a backgrounded tab.
 *
 * `ExamOptions` was in that list until the quiz learned to ask six kinds of
 * question. It rendered one kind and would have needed five siblings; the
 * answer surface is now shared with the quiz and pinned to `revealed={false}`.
 * See the call site.
 *
 * ── Honesty, restated ────────────────────────────────────────────────────
 *
 * DS3 left exam questions as a fixture and said so on screen. Under the fake
 * they are real contract data, which is a different thing from being real: **no
 * model has generated an exam question.** That is FR5 §7.5 and it stays true
 * until FR7.
 */
export function ExamPage() {
  const { notebookId, examId } = useParams<{ notebookId: string; examId: string }>();
  if (!notebookId || !examId) return null;
  return <Exam notebookId={notebookId} examId={examId} />;
}

function Exam({ notebookId, examId }: { notebookId: string; examId: string }) {
  const artifact = useArtifact(notebookId, examId);
  const questions = useQuestions(notebookId, examId);

  const frameProps = {
    title: 'Exam',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
  };

  if (artifact.isError || questions.isError) {
    const error = artifact.error ?? questions.error;
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load this exam"
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

  if (artifact.data.kind !== 'exam') {
    return (
      <FocusFrame {...frameProps}>
        <WrongKind notebookId={notebookId} artifact={artifact.data} expected="exam" />
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
          title="This exam has no questions"
          description="It finished generating without producing any, so there is nothing to sit."
          action={
            <Button asChild>
              <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
            </Button>
          }
        />
      </FocusFrame>
    );
  }

  return (
    <ExamSitting
      notebookId={notebookId}
      examId={examId}
      artifact={artifact.data}
      questions={questions.data}
    />
  );
}

/* ── The three phases of a sitting ────────────────────────────────────── */

type Phase =
  | { status: 'brief' }
  | { status: 'sitting'; attempt: Attempt; questions: Question[]; expiresAt: number | null }
  | { status: 'results'; attempt: Attempt; questions: Question[] };

function ExamSitting({
  notebookId,
  examId,
  artifact,
  questions,
}: {
  notebookId: string;
  examId: string;
  artifact: Artifact;
  questions: Question[];
}) {
  const [phase, setPhase] = useState<Phase>({ status: 'brief' });
  const startAttempt = useStartAttempt(notebookId, examId);

  // Narrowed once. The caller already checked the kind, but the payload union
  // has to be narrowed for the config and blueprint to be readable.
  const payload = artifact.payload.kind === 'exam' ? artifact.payload : null;

  const begin = useCallback(() => {
    if (!payload) return;
    startAttempt.mutate(undefined, {
      onSuccess: attempt => {
        /*
         * **Presentation order is resolved here, once, and then frozen.**
         *
         * `AttemptAnswer.selectedOption` indexes into the order the candidate
         * was shown (the contract says so, and it is why `startAttempt` is
         * documented as the place shuffling is resolved). Shuffling during
         * render would make that index point at a different option on the next
         * render and grade the wrong answer.
         *
         * Shuffle *then* cap: a bank larger than `questionCount` gives a
         * different subset each sitting. Capping first would make
         * `shuffleQuestions` reorder one fixed subset, so the same questions
         * appear every time — the property the config claims to prevent.
         */
        const ordered = payload.config.shuffleQuestions ? shuffled(questions) : questions;
        /*
         * `shuffleOptions` applies to the kinds that *have* options — `mcq` and
         * `msq`. The other four are not exempt by oversight:
         *
         * - `true_false` has two, and reordering them puts False above True for
         *   no gain and some confusion.
         * - `numeric` has none.
         * - `matching` and `ordering` **carry their answer in their order**, so
         *   they are shuffled unconditionally by the answer surface rather than
         *   here. Presenting either as stored would hand over the key, which is
         *   not something a config flag should be able to turn off.
         */
        const presented = ordered.slice(0, payload.config.questionCount).map(question => {
          if (!payload.config.shuffleOptions) return question;
          const questionPayload = question.payload;
          if (questionPayload.kind !== 'mcq' && questionPayload.kind !== 'msq') {
            return question;
          }
          return {
            ...question,
            payload: {
              ...questionPayload,
              options: shuffled(questionPayload.options),
            },
          };
        });

        setPhase({
          status: 'sitting',
          attempt,
          questions: presented,
          expiresAt:
            payload.config.durationMinutes === null
              ? null
              : Date.parse(attempt.startedAt) + payload.config.durationMinutes * 60_000,
        });
      },
      onError: error =>
        toast.error('Could not start this exam', {
          description: error instanceof Error ? error.message : undefined,
        }),
    });
  }, [payload, questions, startAttempt]);

  if (!payload) return null;

  if (phase.status === 'brief') {
    return (
      <ExamBrief
        notebookId={notebookId}
        examId={examId}
        title={artifact.title}
        config={payload.config}
        blueprint={payload.blueprint}
        available={questions.length}
        attemptCount={payload.attemptCount}
        pending={startAttempt.isPending}
        onBegin={begin}
      />
    );
  }

  if (phase.status === 'results') {
    return (
      <FocusFrame
        title="Exam results"
        subtitle={artifact.title}
        exitTo={notebookPath.open(notebookId)}
        width="wide"
      >
        <AttemptReview
          attempt={phase.attempt}
          questions={phase.questions}
          notebookId={notebookId}
          onRetake={() => setPhase({ status: 'brief' })}
          retakeLabel="Sit it again"
        />
      </FocusFrame>
    );
  }

  return (
    <ExamRunner
      key={phase.attempt.id}
      notebookId={notebookId}
      examId={examId}
      title={artifact.title}
      config={payload.config}
      questions={phase.questions}
      attempt={phase.attempt}
      expiresAt={phase.expiresAt}
      onFinished={attempt =>
        setPhase({ status: 'results', attempt, questions: phase.questions })
      }
    />
  );
}

/* ── Before the clock starts ──────────────────────────────────────────── */

/**
 * What this exam is, before committing to sitting it.
 *
 * **A timed sitting needs a deliberate start.** Landing on question 1 with the
 * clock already running — which is what happens if a runner starts on mount —
 * means the seconds spent reading the page came out of the candidate's time.
 * This is also where the blueprint is shown, because after this screen it is
 * not information the candidate can act on.
 */
function ExamBrief({
  notebookId,
  examId,
  title,
  config,
  blueprint,
  available,
  attemptCount,
  pending,
  onBegin,
}: {
  notebookId: string;
  examId: string;
  title: string;
  config: ExamConfig;
  blueprint: Blueprint;
  available: number;
  attemptCount: number;
  pending: boolean;
  onBegin: () => void;
}) {
  const count = Math.min(config.questionCount, available);
  const [editing, setEditing] = useState(false);

  return (
    <FocusFrame title="Exam" subtitle={title} exitTo={notebookPath.open(notebookId)}>
      <div className="mx-auto max-w-2xl space-y-gutter">
        <Card className="py-8">
          <CardContent className="space-y-gutter px-8">
            <dl className="grid grid-cols-2 gap-gutter text-sm sm:grid-cols-3">
              <Fact label="Questions" value={String(count)} />
              <Fact
                label="Time"
                value={
                  config.durationMinutes === null
                    ? 'Untimed'
                    : `${config.durationMinutes} min`
                }
              />
              <Fact
                label="Sittings so far"
                value={String(attemptCount)}
              />
            </dl>

            {/*
              The blueprint belongs to this exam (brief §1.2(9)) — which is what
              finally gives a blueprint something to blueprint. A per-notebook
              one described an exam that did not exist, so nothing could be
              checked against it.
            */}
            <section className="space-y-snug">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium">How it is weighted</h2>
                <div className="flex items-baseline gap-snug">
                  <span className="text-muted-foreground text-xs">
                    {BASIS_LABEL[blueprint.basis]}
                  </span>
                  {/*
                    The promise FR4's generate modal made, finally keepable: it
                    tells the user the blueprint can be adjusted once the exam
                    exists, and until FR6 widened `updateArtifact` nothing could.
                  */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Adjust
                  </Button>
                </div>
              </div>
              <ul className="space-y-tight">
                {blueprint.weights.map(weight => (
                  <li
                    key={weight.topicId ?? 'unfiled'}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{weight.topicName}</span>
                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                      {weight.questions}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-muted-foreground text-sm leading-relaxed">
              {config.durationMinutes === null ? (
                <>This exam is untimed. Answers are revealed only after you submit.</>
              ) : (
                <>
                  Once you begin, the clock runs to the end whether or not this tab is
                  open. Answers are revealed only after you submit.
                </>
              )}
              {config.focusMode && ' Focus mode will ask for full screen.'}
            </p>

            {/*
              Said plainly, on the screen, because it is true and the user cannot
              tell from the questions. FR5 §7.5: no model has generated one.
            */}
            <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
              These questions are fixture data. No model has generated an exam question
              yet — that arrives with the real backend.
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link to={notebookPath.open(notebookId)}>Not now</Link>
          </Button>
          <Button type="button" size="lg" onClick={onBegin} disabled={pending}>
            Begin the exam
          </Button>
        </div>
      </div>

      <BlueprintEditor
        notebookId={notebookId}
        examId={examId}
        blueprint={blueprint}
        questionCount={config.questionCount}
        open={editing}
        onOpenChange={setEditing}
      />
    </FocusFrame>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}

const BASIS_LABEL: Record<Blueprint['basis'], string> = {
  'card-counts': 'From how much material each topic has',
  mastery: 'Weighted towards weaker topics',
  manual: 'Set by you',
};

/* ── The sitting ──────────────────────────────────────────────────────── */

function ExamRunner({
  notebookId,
  examId,
  title,
  config,
  questions,
  attempt,
  expiresAt,
  onFinished,
}: {
  notebookId: string;
  examId: string;
  title: string;
  config: ExamConfig;
  questions: Question[];
  attempt: Attempt;
  expiresAt: number | null;
  onFinished: (attempt: Attempt) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, AttemptAnswer>>(new Map());
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const enteredAt = useRef<number>(Date.now());
  /*
   * Submission must be idempotent: the timer can expire in the same tick the
   * candidate clicks Submit, and submitting twice would post the attempt twice.
   * A ref rather than state because it must be readable synchronously.
   */
  const submittedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useSubmitAttempt(notebookId, examId);
  const question = questions[index];
  // Armed while the sitting is live; released the moment it is being submitted.
  const focus = useFocusMode(config.focusMode, !submitting);

  /** Fold the time spent on the question being left into its answer. */
  const commitElapsed = useCallback(() => {
    const current = questions[index];
    if (!current) return;
    const spent = Math.max(0, Date.now() - enteredAt.current);
    enteredAt.current = Date.now();
    setAnswers(previous => {
      const next = new Map(previous);
      const existing = next.get(current.id) ?? blankAnswer(current);
      next.set(current.id, {
        ...existing,
        elapsedMs: (existing.elapsedMs ?? 0) + spent,
      });
      return next;
    });
  }, [index, questions]);

  /**
   * End the sitting. **One sitting, one `Attempt`** — and this is the only
   * place an exam attempt is closed.
   *
   * ── What ends an exam, and what each records (FR5 §6.2) ────────────────
   *
   * - **`submitted`** — the candidate chose to finish, from the confirmation.
   * - **`expired`** — the timer ran out. Auto-submitted with whatever stands,
   *   exactly as an invigilator collecting the paper would. It is not a failure
   *   state and is scored normally on what was answered.
   * - **`abandoned`** — recorded by nothing here, deliberately. The runner
   *   cannot distinguish "walked away" from "lost the network", and
   *   `beforeunload` is unreliable on mobile, so writing `abandoned` on unload
   *   would file real sittings under the one outcome that says the candidate
   *   gave up. It stays in the vocabulary for a server-side sweep — a sitting
   *   still `in-progress` long past its duration — which is the only place the
   *   distinction can actually be made. **FR7 owns that**; the contract already
   *   carries the value.
   *
   * Unanswered questions are submitted as `response: null`, never as a wrong
   * answer: `null` is a real value and the results screen reports it apart,
   * because telling someone they got a question wrong that they never saw is a
   * different claim.
   */
  const finish = useCallback(
    (outcome: Extract<AttemptOutcome, 'submitted' | 'expired'>) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      // Fold in the time on the final question before submitting, so the
      // per-question timings add up to the sitting rather than missing the
      // last visit.
      const current = questions[index];
      const finalAnswers = new Map(answers);
      if (current) {
        const existing = finalAnswers.get(current.id) ?? blankAnswer(current);
        finalAnswers.set(current.id, {
          ...existing,
          elapsedMs:
            (existing.elapsedMs ?? 0) + Math.max(0, Date.now() - enteredAt.current),
        });
      }

      // Every question, answered or not. An exam records what was put in front
      // of the candidate, which is what makes the unanswered count meaningful.
      const complete = questions.map(
        item => finalAnswers.get(item.id) ?? blankAnswer(item),
      );

      void focus.exit();

      submit.mutate(
        { attemptId: attempt.id, input: { answers: complete, outcome } },
        {
          onSuccess: onFinished,
          onError: error => {
            // The sitting is over either way — re-opening it would let someone
            // keep answering after time ran out. Say what was lost.
            toast.error('Could not record this attempt', {
              description: error instanceof Error ? error.message : undefined,
            });
            setSubmitting(false);
          },
        },
      );
    },
    [answers, attempt.id, focus, index, onFinished, questions, submit],
  );

  /**
   * Auto-submit on expiry — the one part of the timer that must not be missable.
   */
  const handleExpire = useCallback(() => finish('expired'), [finish]);
  const remainingMs = useExamTimer(expiresAt, handleExpire);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= questions.length || target === index) return;
      commitElapsed();
      setIndex(target);
    },
    [commitElapsed, index, questions.length],
  );

  /**
   * Record a response.
   *
   * **No confirm step, unlike the quiz.** An exam does not reveal, so there is
   * nothing to lock: an answer can be changed until the paper is submitted, and
   * a "check my answer" button on a surface that shows nothing back would be a
   * button that appears to do nothing. Every response is recorded as it is
   * built, and `isComplete` decides only whether it counts as answered.
   *
   * Graded from the presented order, which is the order these indices refer to
   * — resolved once when the sitting started.
   */
  const select = useCallback(
    (response: QuestionResponse) => {
      if (!question) return;
      setAnswers(previous => {
        const next = new Map(previous);
        const existing = next.get(question.id) ?? blankAnswer(question);
        const complete = isComplete(response);
        next.set(question.id, {
          ...existing,
          // A half-built response is not an answer. Storing it as one would
          // count a partly-filled matching grid toward the score's denominator.
          response: complete ? response : null,
          selectedOption: complete ? responseSelectedOption(response) : null,
          correct: complete && gradeResponse(question.payload, response),
        });
        return next;
      });
    },
    [question],
  );

  const toggleFlag = useCallback(() => {
    if (!question) return;
    setAnswers(previous => {
      const next = new Map(previous);
      const existing = next.get(question.id) ?? blankAnswer(question);
      next.set(question.id, { ...existing, flagged: !existing.flagged });
      return next;
    });
  }, [question]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const answeredCount = useMemo(
    // Answered means it has a response — `selectedOption` is null for the four
    // kinds that have no single option index, and counting that way would
    // report a finished paper as barely started.
    () => [...answers.values()].filter(answer => answer.response !== null).length,
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
      // Digits choose, and only where a numbered option is a choice. On
      // `matching` and `ordering` a digit is a position, not an answer.
      if (key >= '1' && key <= '6' && question) {
        const optionIndex = Number(key) - 1;
        const questionPayload = question.payload;
        const current = answers.get(question.id)?.response ?? null;
        if (questionPayload.kind === 'mcq' && optionIndex < questionPayload.options.length) {
          event.preventDefault();
          select({ kind: 'mcq', option: optionIndex });
        } else if (
          questionPayload.kind === 'msq' &&
          optionIndex < questionPayload.options.length
        ) {
          event.preventDefault();
          const chosen = new Set(current?.kind === 'msq' ? current.options : []);
          if (chosen.has(optionIndex)) chosen.delete(optionIndex);
          else chosen.add(optionIndex);
          select({ kind: 'msq', options: [...chosen].sort((a, b) => a - b) });
        } else if (questionPayload.kind === 'true_false' && optionIndex < 2) {
          event.preventDefault();
          select({ kind: 'true_false', value: optionIndex === 0 });
        }
      }
    },
    [answers, goTo, index, question, select, toggleFlag],
  );

  if (!question) return null;

  const answer = answers.get(question.id) ?? blankAnswer(question);
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
        // The runner owns the viewport: a timed exam gets no close button, so
        // there is no `FocusFrame` here and the padding is unconditional.
        'bg-background min-h-dvh px-4 py-8',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">{title}</p>
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
              // screen reader.
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
        Focus mode asked for full screen and did not get it. Say so plainly and
        offer it back, rather than failing silently or blocking the attempt:
        this is realism, and losing it is not a reason to stop an exam.
      */}
      {focus.degraded && (
        <div className="text-muted-foreground flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-xs">
          <span>Focus mode is not active — full screen was exited or refused.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void focus.enter()}>
            <MaximizeIcon /> Re-enter
          </Button>
        </div>
      )}

      <Card className="py-8">
        <CardContent className="space-y-6 px-8">
          <QuestionPrompt payload={question.payload} />
          {/*
            The same six input shapes as the quiz, with `revealed` pinned false.

            `ExamOptions` used to render this, on the principle that a component
            branching on `revealed` puts the exam's correctness behind dead
            code. That principle held for one kind and stops scaling at six:
            keeping it would mean a second matching grid, a second ordering
            list and a second numeric field, each free to drift from the
            quiz's. The constant here is what makes the reveal branch dead —
            visibly, at the call site, rather than by there being two files.
          */}
          <QuizAnswer
            questionId={question.id}
            payload={question.payload}
            response={answer.response}
            onRespond={select}
            revealed={false}
          />
        </CardContent>
      </Card>

      <ExamNavigator
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
          <Kbd>1</Kbd>–<Kbd>6</Kbd> answer · <Kbd>←</Kbd> <Kbd>→</Kbd> navigate
        </span>

        {isLast ? (
          <Button
            type="button"
            onClick={() => setConfirmingSubmit(true)}
            disabled={submitting}
          >
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
        // number that changes someone's mind, and the reason to confirm at all.
        description={
          unanswered === 0
            ? 'All questions are answered. You cannot change your answers after submitting.'
            : `${unanswered} of ${questions.length} questions are unanswered. Unanswered questions are marked incorrect.`
        }
        confirmLabel="Submit"
        onConfirm={() => {
          setConfirmingSubmit(false);
          finish('submitted');
        }}
      />
    </div>
  );
}

/**
 * An untouched question, as the record will carry it.
 *
 * `response: null` and `correct: false` together mean "not answered" — the
 * contract's own combination, and the reason the results screen counts
 * unanswered from `response` rather than from `correct`.
 *
 * **`response`, not `selectedOption`.** The two agreed while MCQ was the only
 * kind; a matching answer has no single option index, so counting the old way
 * would call a finished paper unanswered.
 */
function blankAnswer(question: Question): AttemptAnswer {
  return {
    questionId: question.id,
    // Copied rather than joined: the authority for what the answer meant once
    // the question behind it is gone (ADR 0013).
    questionText: questionStem(question.payload),
    topicId: question.topicId,
    topicName: question.topicName,
    response: null,
    selectedOption: null,
    correct: false,
    flagged: false,
    elapsedMs: null,
  };
}
