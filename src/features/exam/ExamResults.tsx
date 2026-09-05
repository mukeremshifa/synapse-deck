import { CheckIcon, CircleDashedIcon, XIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDuration, type ExamResult, type TopicResult } from '@/lib/exam';
import type { AttemptOutcome } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * What the candidate sees after submitting.
 *
 * **The topic breakdown is the point of this screen, not the score.** A score
 * tells someone they got 60%; a breakdown tells them their networking is fine
 * and their cost management is not, which is the only part that changes what
 * they do next. The brief calls converting exam failures into scheduled cards
 * the single most demoable moment in the product (section 2) — this screen is
 * the half of it that exists before Phase D builds the other half.
 *
 * The "generate cards from misses" affordance is deliberately shown disabled
 * rather than hidden: it is the next step in the loop, and a reviewer being
 * shown the product should be able to see where it goes. Phase D wires it.
 */
export function ExamResults({
  result,
  outcome,
  onRetake,
  onDone,
}: {
  result: ExamResult;
  outcome: AttemptOutcome;
  onRetake: () => void;
  onDone: () => void;
}) {
  const percent = Math.round(result.score * 100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        {outcome === 'expired' && (
          <Badge variant="outline" className="border-destructive/60 text-destructive">
            Time expired — submitted automatically
          </Badge>
        )}
        <h1 className="font-serif text-3xl">Results</h1>
      </header>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="font-mono text-5xl tabular-nums">{percent}%</p>
              <p className="text-muted-foreground mt-1 text-sm">
                <span className="font-mono tabular-nums">{result.correctCount}</span> of{' '}
                <span className="font-mono tabular-nums">{result.results.length}</span>{' '}
                correct
              </p>
            </div>
            <div className="text-muted-foreground space-y-1 text-right text-sm">
              <p>
                Time taken{' '}
                <span className="text-foreground font-mono tabular-nums">
                  {formatDuration(result.elapsedMs)}
                </span>
              </p>
              {/*
                Unanswered is reported apart from incorrect even though it scores
                the same. Running out of time is a different problem from not
                knowing the material, and a diagnostic that conflates them tells
                the candidate to study when they should be pacing themselves.
              */}
              {result.unansweredCount > 0 && (
                <p>
                  <span className="font-mono tabular-nums">
                    {result.unansweredCount}
                  </span>{' '}
                  left unanswered
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-1" aria-hidden>
            {result.results.map(item => (
              <div
                key={item.question.id}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  item.correct === true && 'bg-primary',
                  item.correct === false && 'bg-destructive',
                  item.correct === null && 'bg-muted',
                )}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <TopicBreakdown topics={result.byTopic} />

      <section className="space-y-3">
        <h2 className="text-sm tracking-wide uppercase">Review</h2>
        {result.results.map((item, index) => (
          <Card key={item.question.id}>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <ResultMark correct={item.correct} />
                <div className="flex-1 space-y-1">
                  <p className="text-muted-foreground text-xs">
                    Question <span className="font-mono tabular-nums">{index + 1}</span>
                    {item.question.topicName && ` · ${item.question.topicName}`}
                  </p>
                  <p className="font-serif text-lg leading-snug whitespace-pre-wrap">
                    {item.question.payload.stem}
                  </p>
                </div>
              </div>

              <ul className="space-y-1.5">
                {item.question.payload.options.map((option, optionIndex) => {
                  const isCorrect = optionIndex === item.correctOption;
                  const isChosen = optionIndex === item.answer.selectedOption;
                  return (
                    <li
                      key={optionIndex}
                      className={cn(
                        'flex items-start gap-2 rounded-md border p-2.5 text-sm',
                        isCorrect && 'border-primary bg-primary/10',
                        isChosen && !isCorrect && 'border-destructive/60 bg-destructive/10',
                      )}
                    >
                      <span className="mt-0.5 font-mono text-xs">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="flex-1 whitespace-pre-wrap">{option.text}</span>
                      {isCorrect && (
                        <Badge variant="outline" className="border-primary">
                          Correct
                        </Badge>
                      )}
                      {isChosen && !isCorrect && (
                        <Badge variant="outline" className="border-destructive/60">
                          Your answer
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>

              {item.correct === null && (
                <p className="text-muted-foreground text-xs">Not answered.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onRetake}>
            Retake
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
        {/*
          Shown disabled rather than hidden. This is where the loop closes — exam
          misses become scheduled cards — and it is the thing worth pointing at
          when demoing even before it works. Phase D wires it; the disabled
          state is honest about that, where hiding it would just look like a
          missing feature.
        */}
        <Button type="button" disabled title="Arrives with the diagnostic in Phase D">
          Generate cards from misses
        </Button>
      </div>
    </div>
  );
}

function ResultMark({ correct }: { correct: boolean | null }) {
  const Icon = correct === true ? CheckIcon : correct === false ? XIcon : CircleDashedIcon;
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
        correct === true && 'bg-primary text-primary-foreground',
        correct === false && 'bg-destructive text-white',
        correct === null && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">
        {correct === true ? 'Correct' : correct === false ? 'Incorrect' : 'Unanswered'}
      </span>
    </span>
  );
}

/**
 * Accuracy per topic, weakest first.
 *
 * Bars rather than a chart: Recharts is a lazy-loaded dependency the progress
 * page already pays for, and six proportional bars do not justify pulling it
 * into this route's chunk. If this grows a trend over time it becomes a real
 * chart; today it would be a chart of one attempt, which is a bar.
 */
function TopicBreakdown({ topics }: { topics: readonly TopicResult[] }) {
  if (topics.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm tracking-wide uppercase">By topic</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Weakest first — this is what the study plan will be built from.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4 p-5">
          {topics.map(topic => (
            <div key={topic.topicId ?? topic.topicName} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{topic.topicName}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {topic.correct}/{topic.total}
                </span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500',
                    // A topic below half is the one to act on, and it should not
                    // need reading the numbers to spot.
                    topic.accuracy < 0.5 ? 'bg-destructive' : 'bg-foreground',
                  )}
                  style={{ width: `${topic.accuracy * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
