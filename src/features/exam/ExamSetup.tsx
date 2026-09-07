import { useState } from 'react';
import { InfoIcon, MaximizeIcon, ShuffleIcon, TimerIcon } from 'lucide-react';

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
 *
 * ── `isSample`, and why the notice is here rather than in a comment ───────
 *
 * DS3 task 6: the questions are still a fixture — generating an exam from the
 * user's own cards is Phase C's model work, and DS3 deliberately did not
 * half-build it. **A sample exam a user can tell is a sample is a demo asset; a
 * sample exam presented as theirs is a lie**, and the difference is entirely
 * whether it says so where somebody reads it.
 *
 * This screen, rather than the runner: it is the last thing a candidate reads
 * before committing several minutes, and a notice mid-exam is an interruption
 * rather than information. A prop rather than a literal, so the exams Phase C
 * generates do not inherit a disclaimer that has stopped being true.
 */

const DURATION_CHOICES = [null, 5, 10, 20, 30, 45, 60, 90, 120] as const;

export function ExamSetup({
  exam,
  onStart,
  isSample = false,
}: {
  exam: Exam;
  onStart: (exam: Exam) => void;
  /** Whether these questions are the shared sample rather than the user's own. */
  isSample?: boolean;
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

      {isSample ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
          <InfoIcon
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            These are sample questions about cloud architecture, not questions
            drawn from your own material — generating those is still to come.
            Your attempt is recorded either way, and it counts towards the
            diagnostic's overall exam signal; because the questions are not
            yours, it is not attributed to any of your topics.
          </p>
        </div>
      ) : null}

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
