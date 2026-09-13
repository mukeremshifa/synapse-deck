import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2Icon, RotateCcwIcon, TargetIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/states';
import type { Question } from '@/lib/api';
import { gradeResponse, type QuestionResponse } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { QuestionPrompt } from './QuestionPrompt';
import { QuizAnswer, commitsImmediately, isComplete } from './QuizAnswer';

/**
 * Drill the questions you got wrong — **practice, not a second sitting.**
 *
 * ═══ The decision this component is ═══════════════════════════════════════
 *
 * "Drill incorrect" could mean two quite different things, and picking the
 * wrong one quietly corrupts the record:
 *
 * 1. **A new attempt over the missed subset.** Tempting, because the runners
 *    already know how to run an attempt — and wrong. An `Attempt` is the record
 *    of *a sitting of this quiz*, and its `score` is the fraction of **its
 *    questions** answered correctly. A second attempt containing only the four
 *    questions someone missed would land in their history scoring 100% on a
 *    quiz they actually scored 60% on, and every aggregate that reads attempts
 *    — the overview's retention, a topic's mastery — would read that as
 *    improvement that never happened.
 * 2. **A practice pass that records nothing.** What this is. The questions are
 *    re-asked, graded on the spot by the same `gradeResponse` the runner and
 *    the server use, and nothing is written anywhere. It is the flashcard
 *    motion applied to the questions you missed, which is what someone means
 *    when they say they want to drill them.
 *
 * So: no `startAttempt`, no `submitAttempt`, no mutation of any kind. The
 * honesty of the attempt history is worth more than the convenience of reusing
 * the runner, and **`AttemptReview` stays a review of what happened** — this is
 * a thing you can do next to it, not a rewrite of it.
 *
 * ── Which questions, and the one that is not obvious ─────────────────────
 *
 * The ones answered incorrectly. **Not the unanswered ones**, which is the
 * distinction `AttemptReview` already draws in its own words — "unanswered is
 * not wrong", because an exam that expired with a question untouched did not
 * get it wrong. Someone who ran out of time has not demonstrated they do not
 * know it, and drilling it as a failure would be the app inventing a weakness.
 *
 * Order is the paper's, not shuffled. Shuffling would be defensible on its own
 * terms, but the review above this is in paper order and jumping between the
 * two is how you lose your place.
 */
export function DrillIncorrect({
  questions,
  /** Ids of the questions answered incorrectly, from the attempt. */
  incorrectIds,
  onDone,
}: {
  questions: Question[];
  incorrectIds: ReadonlySet<string>;
  onDone: () => void;
}) {
  const drilled = useMemo(
    () => questions.filter(question => incorrectIds.has(question.id)),
    [questions, incorrectIds],
  );

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<QuestionResponse | null>(null);
  /** Null until this question has been answered in the drill. */
  const [result, setResult] = useState<boolean | null>(null);
  /** How many of this pass were right, for the line at the end. */
  const [correctCount, setCorrectCount] = useState(0);

  const question = drilled[index];

  const commit = useCallback(
    (response: QuestionResponse) => {
      if (!question || result !== null || !isComplete(response)) return;
      /*
       * The same grader the runner and the server use. A comparison written
       * here would be a third implementation of six kinds of grading, and the
       * third one is the one that disagrees.
       */
      const correct = gradeResponse(question.payload, response);
      setDraft(response);
      setResult(correct);
      if (correct) setCorrectCount(previous => previous + 1);
    },
    [question, result],
  );

  const respond = useCallback(
    (response: QuestionResponse) => {
      if (!question || result !== null) return;
      setDraft(response);
      // The two single-choice kinds are answered by the click itself; the
      // composite kinds wait for the button, exactly as in the runner.
      if (commitsImmediately(question.payload.kind)) commit(response);
    },
    [commit, question, result],
  );

  const next = useCallback(() => {
    setDraft(null);
    setResult(null);
    setIndex(previous => previous + 1);
  }, []);

  const restart = useCallback(() => {
    setIndex(0);
    setDraft(null);
    setResult(null);
    setCorrectCount(0);
  }, []);

  // Defensive: the caller only renders this when there is something to drill,
  // but a set that resolves to nothing should say so rather than crash.
  if (drilled.length === 0) {
    return (
      <EmptyState
        icon={<TargetIcon />}
        title="Nothing to drill"
        description="Every question you answered was correct."
        action={<Button onClick={onDone}>Back to the results</Button>}
      />
    );
  }

  if (!question) {
    /*
     * The end of the pass. It reports how this *drill* went and says plainly
     * that it changed nothing — someone who has just answered four questions
     * correctly will otherwise reasonably assume their score moved.
     */
    const perfect = correctCount === drilled.length;
    return (
      <Card className="py-8">
        <CardContent className="gap-gutter flex flex-col px-8 text-center">
          <div className="gap-tight flex flex-col">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Drill complete
            </p>
            <p className="font-mono text-4xl tabular-nums">
              {correctCount} / {drilled.length}
            </p>
            <p className="text-muted-foreground text-sm">
              {perfect
                ? 'Every one right this time.'
                : 'Worth another pass before you move on.'}
            </p>
          </div>

          <p className="text-muted-foreground text-xs">
            This was practice — your score and your attempt history are unchanged.
          </p>

          <div className="gap-tight flex flex-wrap justify-center">
            <Button variant="outline" onClick={restart}>
              <RotateCcwIcon aria-hidden />
              Drill again
            </Button>
            <Button onClick={onDone}>Back to the results</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="gap-snug flex flex-col">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          Drilling <span className="text-foreground font-mono tabular-nums">
            {index + 1}
          </span>{' '}
          of <span className="font-mono tabular-nums">{drilled.length}</span> missed
          {question.topicName !== null && <> · {question.topicName}</>}
        </span>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Stop drilling
        </Button>
      </div>

      <Card className="py-8">
        <CardContent className="gap-gutter flex flex-col px-8">
          <QuestionPrompt payload={question.payload} />

          <QuizAnswer
            /*
             * Keyed by the drill position as well as the id, so answering the
             * same question again after "Drill again" mounts a fresh answer
             * surface rather than one holding the previous pass's selection.
             */
            key={`${question.id}-${String(index)}`}
            questionId={question.id}
            payload={question.payload}
            response={draft}
            onRespond={respond}
            revealed={result !== null}
          />

          {result === null && !commitsImmediately(question.payload.kind) && (
            <Button
              type="button"
              className="w-full"
              disabled={!isComplete(draft)}
              onClick={() => {
                if (draft) commit(draft);
              }}
            >
              <CheckCircle2Icon aria-hidden /> Check my answer
            </Button>
          )}

          {result !== null && (
            <div className="gap-snug ui-card-flip flex flex-col border-t pt-6">
              <p
                className={cn(
                  'text-sm font-medium',
                  result ? 'text-primary' : 'text-destructive',
                )}
              >
                {result ? 'Correct this time' : 'Still not right'}
              </p>
              {question.payload.explanation !== null && (
                <p className="text-muted-foreground leading-relaxed">
                  {question.payload.explanation}
                </p>
              )}
              <Button type="button" className="w-full" onClick={next}>
                {index === drilled.length - 1 ? 'Finish drill' : 'Next question'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
