import { Link } from 'react-router-dom';
import { CheckIcon, FlagIcon, MinusIcon, XIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Meter } from '@/components/Meter';
import { notebookPath } from '@/lib/notebooks';
import type { Attempt, AttemptAnswer, Question } from '@/lib/api';
import { questionStem, type QuestionPayload, type QuestionResponse } from '@/lib/schemas';
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
  /*
   * Answered means it has a response.
   *
   * It used to mean `selectedOption !== null`, and the two agreed while MCQ was
   * the only kind. They no longer do: a matching or ordering answer has no
   * single option index, so counting the old way would report a fully answered
   * paper as mostly unanswered and divide the score by the handful of
   * multiple-choice questions in it.
   */
  const answered = attempt.answers.filter(answer => answer.response !== null);
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
  const response = answer?.response ?? null;
  const state: 'correct' | 'wrong' | 'unanswered' =
    response === null ? 'unanswered' : answer?.correct ? 'correct' : 'wrong';

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
            {questionStem(question.payload)}
          </p>

          <ReviewAnswer payload={question.payload} response={response} />

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

/**
 * What was answered and what was right, for one question of any kind.
 *
 * **The correct answer is shown even where the answer was correct**, which is
 * the rule `QuestionRow` above already stated and this inherits: someone who
 * guessed right learns nothing from being told only that they were right.
 *
 * The shape is the same throughout — a row per relevant item, labelled
 * "Answer" or "You chose" — rather than six bespoke layouts. A review is
 * skimmed down the page, and six visual grammars is five more than it can be
 * read in.
 */
function ReviewAnswer({
  payload,
  response,
}: {
  payload: QuestionPayload;
  response: QuestionResponse | null;
}) {
  switch (payload.kind) {
    case 'mcq':
    case 'msq': {
      const chosen = new Set<number>(
        response?.kind === 'mcq'
          ? [response.option]
          : response?.kind === 'msq'
            ? response.options
            : [],
      );
      return (
        <ul className="space-y-1 text-sm">
          {payload.options.map((option, index) => {
            const isChosen = chosen.has(index);
            // Only the answer and what they picked. Listing every distractor
            // again turns a review into a re-read of the question.
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
                  {option.correct
                    ? isChosen
                      ? 'Answer'
                      : 'Missed'
                    : 'You chose'}
                </span>
                <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
              </li>
            );
          })}
        </ul>
      );
    }

    case 'true_false': {
      const chosen = response?.kind === 'true_false' ? response.value : null;
      return (
        <ul className="space-y-1 text-sm">
          <li className="bg-primary/15 flex items-start gap-2 rounded-md px-2 py-1">
            <span className="text-muted-foreground shrink-0 text-xs">Answer</span>
            <span className="flex-1">{payload.answer ? 'True' : 'False'}</span>
          </li>
          {chosen !== null && chosen !== payload.answer && (
            <li className="bg-destructive/10 flex items-start gap-2 rounded-md px-2 py-1">
              <span className="text-muted-foreground shrink-0 text-xs">You chose</span>
              <span className="flex-1">{chosen ? 'True' : 'False'}</span>
            </li>
          )}
        </ul>
      );
    }

    case 'numeric': {
      const given = response?.kind === 'numeric' ? response : null;
      const right =
        given?.value !== null &&
        given !== null &&
        Math.abs(given.value - payload.answer) <= payload.tolerance;
      return (
        <ul className="space-y-1 text-sm">
          <li className="bg-primary/15 flex items-start gap-2 rounded-md px-2 py-1">
            <span className="text-muted-foreground shrink-0 text-xs">Answer</span>
            <span className="flex-1 font-mono tabular-nums">
              {payload.answer}
              {payload.unit ? ` ${payload.unit}` : ''}
              {payload.tolerance > 0 && (
                <span className="text-muted-foreground"> (±{payload.tolerance})</span>
              )}
            </span>
          </li>
          {given && !right && (
            <li className="bg-destructive/10 flex items-start gap-2 rounded-md px-2 py-1">
              <span className="text-muted-foreground shrink-0 text-xs">You wrote</span>
              {/*
                The raw text, not the parsed number. Someone who typed "12,5"
                needs to see that, not a blank where a `null` value would be.
              */}
              <span className="flex-1 font-mono">{given.raw || '—'}</span>
            </li>
          )}
        </ul>
      );
    }

    case 'matching': {
      const pairs = response?.kind === 'matching' ? response.pairs : [];
      return (
        <ul className="space-y-1 text-sm">
          {payload.pairs.map((pair, index) => {
            const stored = pairs[index] ?? null;
            const right = stored === index;
            return (
              <li
                key={index}
                className={cn(
                  'flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1',
                  right ? 'bg-primary/15' : 'bg-destructive/10',
                )}
              >
                <span className="font-medium">{pair.left}</span>
                <span className="text-muted-foreground text-xs">→</span>
                <span>{pair.right}</span>
                {!right && (
                  <span className="text-muted-foreground w-full text-xs">
                    {stored === null
                      ? 'Left unmatched'
                      : `You chose: ${payload.pairs[stored]?.right ?? '—'}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'ordering': {
      const order = response?.kind === 'ordering' ? response.order : [];
      return (
        <ol className="space-y-1 text-sm">
          {payload.items.map((item, position) => {
            // What they put here, against what belongs here.
            const placed = order[position] ?? null;
            const right = placed === position;
            return (
              <li
                key={position}
                className={cn(
                  'flex items-baseline gap-2 rounded-md px-2 py-1',
                  order.length === 0
                    ? undefined
                    : right
                      ? 'bg-primary/15'
                      : 'bg-destructive/10',
                )}
              >
                <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                  {position + 1}.
                </span>
                <span className="flex-1 whitespace-pre-wrap">{item}</span>
                {order.length > 0 && !right && placed !== null && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    you put: {payload.items[placed] ?? '—'}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      );
    }
  }
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
