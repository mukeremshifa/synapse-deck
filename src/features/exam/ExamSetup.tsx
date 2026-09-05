import { useState } from 'react';
import { MaximizeIcon, ShuffleIcon, TimerIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { EXAM_LIMITS, type Exam, type ExamConfig } from '@/lib/schemas';

/**
 * Exam configuration, before an attempt starts.
 *
 * **The question-count options stop at the schema cap**, they are not a
 * hand-written list that happens to agree with it. `EXAM_LIMITS.maxQuestions`
 * is the first of the brief's three Bedrock cost controls (section 6), and a
 * control that lives in two places is one refactor away from living in none:
 * an uncapped "generate a 200-question exam" is a ~$1 single request.
 *
 * Untimed is offered because a first attempt at unfamiliar material under a
 * clock teaches less than the same attempt without one. The timer is the point
 * of exam mode; it is not the point of every sitting.
 */

const DURATION_CHOICES = [null, 5, 10, 20, 30, 45, 60, 90, 120] as const;

export function ExamSetup({
  exam,
  onStart,
}: {
  exam: Exam;
  onStart: (exam: Exam) => void;
}) {
  const [config, setConfig] = useState<ExamConfig>(exam.config);

  // Never offer more questions than exist, and never more than the cap allows.
  const maxAvailable = Math.min(exam.questions.length, EXAM_LIMITS.maxQuestions);
  const countChoices = [5, 10, 20, 30, 40, 50].filter(count => count <= maxAvailable);
  // A fixture of six questions would otherwise offer only "5".
  if (!countChoices.includes(maxAvailable)) countChoices.push(maxAvailable);

  const update = <K extends keyof ExamConfig>(key: K, value: ExamConfig[K]) =>
    setConfig(previous => ({ ...previous, [key]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-serif text-3xl">{exam.title}</h1>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono tabular-nums">{exam.questions.length}</span> questions
          available. Set the conditions, then sit it.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-count">Questions</Label>
              <Select
                id="question-count"
                value={String(config.questionCount)}
                onChange={event => update('questionCount', Number(event.target.value))}
              >
                {countChoices
                  .sort((a, b) => a - b)
                  .map(count => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Time limit</Label>
              <Select
                id="duration"
                value={config.durationMinutes === null ? 'none' : String(config.durationMinutes)}
                onChange={event =>
                  update(
                    'durationMinutes',
                    event.target.value === 'none' ? null : Number(event.target.value),
                  )
                }
              >
                {DURATION_CHOICES.map(minutes => (
                  <option key={minutes ?? 'none'} value={minutes ?? 'none'}>
                    {minutes === null ? 'Untimed' : `${minutes} minutes`}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-3 border-t pt-5">
            <Toggle
              icon={<ShuffleIcon className="size-4" />}
              label="Shuffle questions"
              description="Randomise the order questions are presented in."
              checked={config.shuffleQuestions}
              onChange={value => update('shuffleQuestions', value)}
            />
            <Toggle
              icon={<ShuffleIcon className="size-4" />}
              label="Shuffle options"
              description="Randomise the order of answers within each question."
              checked={config.shuffleOptions}
              onChange={value => update('shuffleOptions', value)}
            />
            <Toggle
              icon={<MaximizeIcon className="size-4" />}
              label="Focus mode"
              // Says what it does and, just as importantly, what it does not.
              // The brief is explicit that this is never sold as anti-cheat
              // (section 2, #5): browser lockdown is trivially defeated, and
              // claiming otherwise in a portfolio piece invites a reviewer to
              // poke it and win. Better to be the product that says so.
              description="Full-screen, with a warning before you navigate away. Makes the sitting feel like an exam — it does not prevent anything."
              checked={config.focusMode}
              onChange={value => update('focusMode', value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <TimerIcon className="size-4" aria-hidden />
          {config.durationMinutes === null ? (
            'No time limit'
          ) : (
            <>
              <span className="text-foreground font-mono tabular-nums">
                {config.durationMinutes}
              </span>{' '}
              minutes for{' '}
              <span className="text-foreground font-mono tabular-nums">
                {config.questionCount}
              </span>{' '}
              questions
            </>
          )}
        </p>
        <Button type="button" size="lg" onClick={() => onStart({ ...exam, config })}>
          Start exam
        </Button>
      </div>

      {/*
        The fixture is scaffolding and the UI should say so. A demo that quietly
        presents canned data as generated output is the kind of thing a reviewer
        finds out on their own, and it costs more than admitting it here.
      */}
      <Badge variant="outline" className="text-muted-foreground">
        Sample questions — generation arrives in Phase B
      </Badge>
    </div>
  );
}

/**
 * A labelled switch built on a native checkbox.
 *
 * Native rather than a Radix switch: it is one control, it needs no custom
 * option rendering, and the native input brings its own label association,
 * keyboard behaviour and form semantics.
 */
function Toggle({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-current"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="flex-1 space-y-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        <span className="text-muted-foreground block text-xs">{description}</span>
      </span>
    </label>
  );
}
