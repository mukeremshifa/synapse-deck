import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InfoIcon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { topicMastery } from '@/lib/mastery';
import { notebookPath } from '@/lib/notebooks';
import {
  buildStudyPlan,
  diagnosisFor,
  PLAN_DEFAULTS,
  PLAN_LIMITS,
  type PlanAction,
} from '@/lib/study-plan';
import { TopicMasteryList } from '@/features/mastery/TopicMasteryList';
import { sampleMasteryAnswers, sampleMasteryCards } from '@/features/blueprint/fixtures';
import { StudyPlanView } from './StudyPlanView';

/**
 * The diagnostic, and the plan it produces.
 *
 * **This is the screen the brief calls the most demoable moment in the product**
 * (§2): the point where an exam result stops being a score and becomes a set of
 * scheduled actions. It is also the screen that makes the two-signal mastery
 * model worth having — everything on it is derived from `mastery.ts` and
 * `study-plan.ts`, both pure and both previously invisible.
 *
 * ── The diagnosis line is arithmetic, not generated prose ─────────────────
 *
 * `diagnosisFor` composes a sentence out of numbers the app computed. No model
 * writes it, which is why it can be shown without a review gate in front of it —
 * unlike card content, it cannot hallucinate, because it is not generated. This
 * matters here more than anywhere: a fluent, confident, wrong statement about a
 * student's own weaknesses would be believed.
 *
 * ── Why the plan is adjustable on this screen ─────────────────────────────
 *
 * Days and minutes-per-day are the two inputs the product genuinely cannot
 * infer. Everything else the plan needs — which topics are weak, in what way,
 * and what to do about each — comes from evidence. Asking for the two unknowable
 * things and deriving the rest is the correct division; asking the user to pick
 * topics as well would be handing back the work they came here for.
 */
export function DiagnosticPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();

  const [days, setDays] = useState(PLAN_DEFAULTS.days);
  const [minutesPerDay, setMinutesPerDay] = useState(PLAN_DEFAULTS.minutesPerDay);

  const topics = useMemo(
    () => topicMastery(sampleMasteryCards, sampleMasteryAnswers),
    [],
  );
  const diagnosis = useMemo(() => diagnosisFor(topics), [topics]);
  const plan = useMemo(
    () => buildStudyPlan(topics, { days, minutesPerDay }),
    [topics, days, minutesPerDay],
  );

  /**
   * What a plan row does when started.
   *
   * Drills and mini-exams have real destinations — practice and the exam runner
   * both exist and both work. `review` and `questions` do not: there is no
   * source-reader route and no topic-scoped question generator. Rather than
   * route those somewhere approximate, they say what they need. A button that
   * lands somewhere unrelated is worse than one that explains itself.
   */
  const start = (action: PlanAction) => {
    if (!notebookId) return;
    if (action.kind === 'drill') {
      void navigate(notebookPath.practice(notebookId));
      return;
    }
    if (action.kind === 'mini-exam') {
      void navigate(notebookPath.exam(notebookId));
      return;
    }
    toast(`${action.topicName}: not wired up yet`, {
      description:
        action.kind === 'review'
          ? 'Reading a source in place needs the source viewer, which is not built.'
          : 'Topic-scoped question generation needs the exam generator behind the blueprint.',
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Diagnostic</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What your reviews and exams together say about this material.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-xs leading-relaxed">
          Running on sample review and exam data. The model behind it is real —
          the same code will run on your own cards and attempts once topics are
          stored with them.
        </p>
      </div>

      {diagnosis && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              What stands out
            </h2>
            <p className="mt-2 leading-relaxed">{diagnosis}</p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Topic mastery</h2>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Two signals, kept apart on purpose. Recall is how reliably you
            retrieve something when prompted; exam accuracy is whether you can
            apply it under time. A topic where they disagree is the most useful
            thing here.
          </p>
        </div>
        <Card>
          <CardContent className="p-4">
            <TopicMasteryList topics={topics} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Your plan</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {plan.days.length > 0
                ? `${plan.days.length} ${plan.days.length === 1 ? 'day' : 'days'}, about ${plan.minutes} minutes in total.`
                : 'Nothing needs scheduling.'}
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-days" className="text-xs">
                Days
              </Label>
              <Input
                id="plan-days"
                type="number"
                min={PLAN_LIMITS.minDays}
                max={PLAN_LIMITS.maxDays}
                value={days}
                onChange={event =>
                  setDays(
                    clamp(
                      event.target.valueAsNumber,
                      PLAN_LIMITS.minDays,
                      PLAN_LIMITS.maxDays,
                    ),
                  )
                }
                className="h-9 w-20 font-mono tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-minutes" className="text-xs">
                Minutes a day
              </Label>
              <Input
                id="plan-minutes"
                type="number"
                min={PLAN_LIMITS.minMinutes}
                max={PLAN_LIMITS.maxMinutes}
                step={5}
                value={minutesPerDay}
                onChange={event =>
                  setMinutesPerDay(
                    clamp(
                      event.target.valueAsNumber,
                      PLAN_LIMITS.minMinutes,
                      PLAN_LIMITS.maxMinutes,
                    ),
                  )
                }
                className="h-9 w-24 font-mono tabular-nums"
              />
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            <StudyPlanView plan={plan} onStart={start} />
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            toast('Remedial cards are not generated yet', {
              description:
                'Turning exam misses into scheduled cards needs the generator to accept a topic and a set of missed questions.',
            })
          }
        >
          <SparklesIcon aria-hidden /> Make cards from my weak topics
        </Button>
        {notebookId ? (
          <Button variant="outline" onClick={() => void navigate(notebookPath.open(notebookId))}>
            Back to the notebook
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
