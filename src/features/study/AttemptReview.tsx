import { Link } from 'react-router-dom';
import { CheckIcon, FlagIcon, MinusIcon, XIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Meter } from '@/components/Meter';
import { notebookPath } from '@/lib/notebooks';
import type { Attempt, AttemptAnswer, Question } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * What a sitting came to — for a quiz and for an exam, from one component.
 *
 * ── Why this one *is* shared, when the runners are not (FR5 §6.3) ─────────
 *
 * §3 forbids one runner with a `timed` flag, and §5 makes that an acceptance
 * criterion. It is a rule about **delivery**: timing, one-per-page versus a
 * navigable paper, when the answer appears. None of that exists any more by the
 * time someone is looking at their results.
 *
 * What is left is the record, and the contract is explicit that the record is
 * the same thing for both:
 *
 * > Quiz and exam "produce the same *record*, because what is recorded is the
 * > same thing: which questions were answered, how, and whether they were
 * > right. The difference is delivery … and delivery lives in the runner, not
 * > here." (`Attempt`, `contract.ts`.)
 *
 * So this takes an `Attempt` and renders it. It switches on nothing — not on
 * kind, not on a flag — which is what distinguishes sharing a renderer from
 * merging two runners. The only thing the caller varies is the label on the
 * button out, because "Take it again" and "Sit it again" are different acts.
 *
 * ── Unanswered is not wrong ──────────────────────────────────────────────
 *
 * `selectedOption: null` is a real value the fixtures ship (an exam that
 * expired with a question untouched), and it is reported as its own outcome.
 * Folding it into "incorrect" would tell someone they got a question wrong that
 * they never saw.
 */
export function AttemptReview({
  attempt,
  questions,
  notebookId,
  onRetake,
  retakeLabel,
}: {
  attempt: Attempt;
  questions: Question[];
  notebookId: string;
  onRetake: () => void;
  retakeLabel: string;
}) {
  const answered = attempt.answers.filter(answer => answer.selectedOption !== null);
  const correct = answered.filter(answer => answer.correct).length;
  const unanswered = questions.length - answered.length;

  /*
   * The score comes from the server, not from counting here.
   *
   * `submitAttempt` computes it and returns it, and re-deriving it in the UI is
   * how two numbers that should be one start disagreeing. Null is a real value
   * and not zero: a sitting where nothing was answered has **no score**, and
   * "0%" would be a claim about performance rather than the absence of one.
   */
  const score = attempt.score;

  const byTopic = groupByTopic(attempt.answers);

  return (
    <div className="mx-auto max-w-3xl space-y-gutter">
      <Card className="py-8">
        <CardContent className="space-y-gutter px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                {OUTCOME_LABEL[attempt.outcome]}
              </p>
              <p className="font-mono text-4xl tabular-nums">
                {score === null ? '—' : `${Math.round(score * 100)}%`}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-mono tabular-nums">{correct}</span>{' '}
              correct of{' '}
              <span className="font-mono tabular-nums">{answered.length}</span> answered
              {unanswered > 0 && (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums">{unanswered}</span> not answered
                </>
              )}
            </p>
          </div>

          {score !== null && <Meter value={score} label="Score" tone={meterTone(score)} />}

          {/*
            Null score is the one case worth a sentence. It happens when someone
            opens a quiz and finishes without answering anything, and a blank
            percentage with no explanation reads as a failure to load.
          */}
          {score === null && (
            <p className="text-muted-foreground text-sm">
              Nothing was answered, so there is no score to report.
            </p>
          )}
        </CardContent>
      </Card>

      {byTopic.length > 1 && (
        <section className="space-y-snug">
          <h2 className="text-sm font-medium">By topic</h2>
          <div className="space-y-tight">
            {byTopic.map(topic => (
              <div
                key={topic.topicId ?? 'unfiled'}
                className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{topic.topicName}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                  {topic.correct} / {topic.total}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-snug">
        <h2 className="text-sm font-medium">Every question</h2>
        <ol className="space-y-tight">
          {questions.map((question, position) => {
            const record = attempt.answers.find(
              answer => answer.questionId === question.id,
            );
            return (
              <QuestionRow
                key={question.id}
                position={position + 1}
                question={question}
                answer={record ?? null}
              />
            );
          })}
        </ol>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
        </Button>
        <Button type="button" onClick={onRetake}>
          {retakeLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * One question, with what was chosen and what was right.
 *
 * The correct option is shown even where the answer was correct: this is the
 * review, and someone who guessed right learns nothing from being told only
 * that they were right.
 */
function QuestionRow({
  position,
  question,
  answer,
}: {
  position: number;
  question: Question;
  answer: AttemptAnswer | null;
}) {
  const chosen = answer?.selectedOption ?? null;
  const state: 'correct' | 'wrong' | 'unanswered' =
    chosen === null ? 'unanswered' : answer?.correct ? 'correct' : 'wrong';

  return (
    <li className="space-y-2 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs',
            state === 'correct' && 'bg-primary text-primary-foreground',
            state === 'wrong' && 'bg-destructive text-white',
            state === 'unanswered' && 'bg-muted text-muted-foreground',
          )}
        >
          {state === 'correct' ? (
            <CheckIcon className="size-3" />
          ) : state === 'wrong' ? (
            <XIcon className="size-3" />
          ) : (
            <MinusIcon className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm leading-snug whitespace-pre-wrap">
            <span className="text-muted-foreground font-mono tabular-nums">
              {position}.
            </span>{' '}
            {question.payload.stem}
          </p>

          <ul className="space-y-1 text-sm">
            {question.payload.options.map((option, index) => {
              const isChosen = chosen === index;
              if (!option.correct && !isChosen) return null;
              return (
                <li
                  key={index}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-2 py-1',
                    option.correct && 'bg-primary/15',
                    isChosen && !option.correct && 'bg-destructive/10',
                  )}
                >
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {option.correct ? 'Answer' : 'You chose'}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
                </li>
              );
            })}
          </ul>

          {question.payload.explanation && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {question.payload.explanation}
            </p>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-2">
          {answer?.flagged && (
            <Badge variant="outline">
              <FlagIcon className="fill-current" />
              <span className="sr-only">Flagged</span>
            </Badge>
          )}
          {state === 'unanswered' && <Badge variant="outline">Not answered</Badge>}
        </span>
      </div>
    </li>
  );
}

type TopicTally = {
  topicId: string | null;
  topicName: string;
  correct: number;
  total: number;
};

/**
 * Correct-over-total per topic. **The seed of FR6's diagnostics**, which read
 * these attempts — questions with no topic collect under one "Unfiled" row
 * rather than being dropped, because silently losing questions from a breakdown
 * is worse than showing that some are unclassified. Same rule as the contract's
 * `BlueprintWeight`, whose null topic is the same row.
 */
function groupByTopic(answers: AttemptAnswer[]): TopicTally[] {
  const tallies = new Map<string, TopicTally>();
  for (const answer of answers) {
    const key = answer.topicId ?? 'unfiled';
    const existing = tallies.get(key) ?? {
      topicId: answer.topicId,
      topicName: answer.topicName ?? 'Unfiled',
      correct: 0,
      total: 0,
    };
    existing.total += 1;
    if (answer.correct) existing.correct += 1;
    tallies.set(key, existing);
  }
  return [...tallies.values()].sort((a, b) => a.topicName.localeCompare(b.topicName));
}

/**
 * The band the score sits in. Three stops rather than a gradient, because a
 * meter that shifts hue continuously invites reading a precision into it that
 * a handful of questions cannot support.
 */
function meterTone(score: number): 'weak' | 'developing' | 'strong' {
  if (score < 0.5) return 'weak';
  if (score < 0.8) return 'developing';
  return 'strong';
}

const OUTCOME_LABEL: Record<Attempt['outcome'], string> = {
  'in-progress': 'Still in progress',
  submitted: 'Submitted',
  expired: 'Time expired',
  abandoned: 'Abandoned',
};
