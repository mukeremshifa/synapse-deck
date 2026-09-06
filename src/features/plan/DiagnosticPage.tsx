import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangleIcon, InfoIcon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveTimeZone, studyDayKey } from '@/lib/day';
import { topicMastery } from '@/lib/mastery';
import { notebookPath } from '@/lib/notebooks';
import { useProfile } from '@/lib/queries';
import {
  buildStudyPlan,
  diagnosisFor,
  examSchedule,
  planFit,
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
 * The exam date and minutes-per-day are the two inputs the product genuinely
 * cannot infer. Everything else the plan needs — which topics are weak, in what
 * way, and what to do about each — comes from evidence. Asking for the two
 * unknowable things and deriving the rest is the correct division; asking the
 * user to pick topics as well would be handing back the work they came here for.
 *
 * ── The date, not the day count, is the real input ────────────────────────
 *
 * "How many days" is a question a student has to do arithmetic to answer, and
 * the arithmetic is the app's job. So the date drives the plan and the day count
 * becomes derived — shown, but disabled, so the causal link stays visible. The
 * day count survives as an input for the case with no exam scheduled at all,
 * which is a real way to use this screen and not a degenerate one.
 *
 * The two facts a deadline adds that a day count cannot are surfaced rather than
 * absorbed: an exam already past, and a plan that does not fit in the time left.
 * `planFit` exists so the second one is arithmetic rather than an impression.
 */
export function DiagnosticPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();

  const { data: profile } = useProfile();
  const timeZone = resolveTimeZone(profile?.timezone);

  /**
   * The exam date, empty until the student supplies one.
   *
   * Empty is the honest default. The product cannot guess when an exam is, and
   * pre-filling a plausible date would put a number on the screen that the user
   * did not choose and might not notice — which is the worst of both, since the
   * whole plan hangs off it.
   */
  const [examDate, setExamDate] = useState('');
  const [minutesPerDay, setMinutesPerDay] = useState(PLAN_DEFAULTS.minutesPerDay);
  /** Used only while no exam date is set. Once there is one, the date decides. */
  const [fallbackDays, setFallbackDays] = useState(PLAN_DEFAULTS.days);

  const schedule = useMemo(
    () => (examDate ? examSchedule(examDate, timeZone) : null),
    [examDate, timeZone],
  );
  // A date in the past cannot drive a plan, so the manual figure stands and the
  // banner below explains why rather than letting the control silently do nothing.
  const days = schedule && !schedule.passed ? schedule.days : fallbackDays;

  const topics = useMemo(
    () => topicMastery(sampleMasteryCards, sampleMasteryAnswers),
    [],
  );
  const diagnosis = useMemo(() => diagnosisFor(topics), [topics]);
  const plan = useMemo(
    () => buildStudyPlan(topics, { days, minutesPerDay }),
    [topics, days, minutesPerDay],
  );
  const fit = useMemo(
    () => planFit(plan, { days, minutesPerDay }),
    [plan, days, minutesPerDay],
  );
  const todayKey = useMemo(() => studyDayKey(new Date(), timeZone), [timeZone]);

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
              {schedule && !schedule.passed
                ? ` Your exam is ${countdown(schedule.daysUntil)}.`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-exam-date" className="text-xs">
                Exam date
              </Label>
              <Input
                id="plan-exam-date"
                type="date"
                min={todayKey}
                value={examDate}
                onChange={event => setExamDate(event.target.value)}
                className="h-9 font-mono tabular-nums"
              />
            </div>

            {/*
              The day count is an input only while there is no exam date. Once
              there is one it becomes derived, and showing it as a disabled field
              rather than hiding it keeps the connection visible: the student can
              see that moving the date moved the plan.
            */}
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
                disabled={schedule !== null && !schedule.passed}
                onChange={event =>
                  setFallbackDays(
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

        {/*
          The two things a deadline can tell you that a day count cannot: the
          exam has passed, or the work does not fit. Both are surfaced rather
          than absorbed — see `planFit` in `study-plan.ts` for why truncating
          silently would hide exactly the fact the student needs most.
        */}
        {schedule?.passed ? (
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
            <InfoIcon
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              That date has passed, so the plan below is running on the day count
              instead. Set a future date, or use the days field directly.
            </p>
          </div>
        ) : null}

        {schedule?.beyondHorizon ? (
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
            <InfoIcon
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              That is {schedule.daysUntil} days out. The plan covers the{' '}
              {PLAN_LIMITS.maxDays}-day run-up — further ahead than that, the
              schedule you already have is the better guide.
            </p>
          </div>
        ) : null}

        {!fit.fits ? (
          <div className="border-grade-again/40 bg-grade-again/5 flex items-start gap-2 rounded-lg border p-3">
            <AlertTriangleIcon
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              This is about {plan.minutes} minutes of work and you have{' '}
              {fit.capacity} — roughly {fit.over} minutes more than fits. Add
              time per day, or accept that the lowest-priority topics below will
              not get done.
            </p>
          </div>
        ) : null}

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

/**
 * "in 5 days" / "tomorrow" / "today".
 *
 * Words rather than a bare number because the small cases are the ones that
 * carry urgency, and "your exam is 1 days" reads like a bug at the moment the
 * student most needs to trust the screen.
 */
function countdown(daysUntil: number): string {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
