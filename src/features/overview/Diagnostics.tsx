import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InfoIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/states';
import { TopicMasteryList } from '@/features/mastery/TopicMasteryList';
import { StudyPlanView } from '@/features/plan/StudyPlanView';
import type { Artifact, TopicMasteryReport } from '@/lib/api';
import { studyDayKey } from '@/lib/day';
import { notebookPath } from '@/lib/notebooks';
import { plural } from '@/lib/format';
import {
  buildStudyPlan,
  diagnosisFor,
  examSchedule,
  planFit,
  PLAN_DEFAULTS,
  PLAN_LIMITS,
  type PlanAction,
} from '@/lib/study-plan';

/**
 * Topic mastery and the plan it produces — `mastery.ts` and `study-plan.ts`
 * re-pointed, **notebook-scoped**.
 *
 * This is the old `DiagnosticPage` rebuilt against the contract, and it is the
 * screen the brief calls the product's most demoable moment: where a result
 * stops being a score and becomes a set of scheduled actions.
 *
 * ── The scope is the fix ──────────────────────────────────────────────────
 *
 * Topics are notebook-scoped (brief §1.2(5)). The live app reconciled them per
 * *user*, so a two-notebook account weighted one subject by another subject's
 * topics — the bug DS4 fixed at the SQL level, and which the contract now fixes
 * structurally: `getTopicMastery` takes a `notebookId` and there is no way to
 * ask it anything else. Reconciliation stays by-name (ADR 0009); what changed
 * is the scope it runs in.
 *
 * ── What re-pointing changed ──────────────────────────────────────────────
 *
 * The old page fetched every card and every answer and called `topicMastery` in
 * the browser. It cannot now: cards are listable only per deck. So the model
 * runs server-side over the same `mastery.ts` (see `TopicMasteryReport`), and
 * this screen renders the result. `masteryBand`, `divergenceKind` and the whole
 * of `study-plan.ts` still run here — they are presentation and product policy
 * over the report, and a server that baked the thresholds in would make a
 * product decision undeployable.
 *
 * **Nothing `mastery.ts` or `study-plan.ts` expresses was lost.** Brief §1.4
 * said the pure modules keep their place, and both do: `TopicMasteryEntry`
 * matches `TopicMastery` field for field, so `buildStudyPlan` consumes the
 * report directly.
 */
export function Diagnostics({
  notebookId,
  report,
  artifacts,
  timeZone,
}: {
  notebookId: string;
  report: TopicMasteryReport;
  /** Ready artifacts only — what a plan action can actually be pointed at. */
  artifacts: readonly Artifact[];
  timeZone: string;
}) {
  const navigate = useNavigate();

  /**
   * The exam date, empty until the student supplies one.
   *
   * Empty is the honest default. The product cannot guess when an exam is, and
   * pre-filling a plausible date puts a number on screen the user did not
   * choose and might not notice — which is the worst of both, since the whole
   * plan hangs off it.
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
  // banner explains why rather than letting the control silently do nothing.
  const days = schedule && !schedule.passed ? schedule.days : fallbackDays;

  const topics = report.topics;
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
   * Which deck drills a topic, and which exam tests it.
   *
   * **This is what the overview has that no other screen does** (FR2's drift
   * row): the diagnostic's "drill" and "mini-exam" actions used to navigate to
   * *the* practice and *the* exam of a notebook with nothing named, which only
   * typechecked while a notebook had one implicit deck. FR2 removed that
   * navigation and left the actions saying what they needed — the artifact
   * list. This screen has it.
   *
   * The mapping is deliberately coarse: an artifact is not filed under a topic,
   * because a deck generated from three sources covers many. So a drill opens
   * the deck with the most due and a mini-exam opens an exam, and the runner
   * scopes itself from there. Claiming a per-topic deck the model does not have
   * would be inventing a relationship to make a button look smarter.
   */
  const start = (action: PlanAction) => {
    const decks = artifacts.filter(artifact => artifact.kind === 'deck');
    const exams = artifacts.filter(artifact => artifact.kind === 'exam');

    if (action.kind === 'drill') {
      // The deck with the most due, so the button lands on work to do rather
      // than on an empty queue.
      const deck = [...decks].sort((a, b) => dueOf(b) - dueOf(a))[0];
      if (!deck) {
        toast('No deck to drill', {
          description: `${action.topicName} has no deck in this notebook yet. Generate one from the notebook's sources.`,
        });
        return;
      }
      void navigate(notebookPath.practice(notebookId, deck.id));
      return;
    }

    if (action.kind === 'mini-exam') {
      const exam = exams[0];
      if (!exam) {
        toast('No exam to sit', {
          description: `Sitting one needs an exam in this notebook. Generate one and its blueprint will weight ${action.topicName} by the cards you have.`,
        });
        return;
      }
      void navigate(notebookPath.exam(notebookId, exam.id));
      return;
    }

    /*
     * `review` and `questions` still have no destination, and they say so
     * rather than landing somewhere approximate. There is no source-reader
     * route and no topic-scoped question generator; a button that lands
     * somewhere unrelated is worse than one that explains itself.
     */
    toast(`${action.topicName}: not wired up yet`, {
      description:
        action.kind === 'review'
          ? 'Reading a source in place needs the source viewer, which is not built.'
          : 'Topic-scoped question generation needs the exam generator behind the blueprint.',
    });
  };

  if (topics.length === 0) {
    return (
      <EmptyState
        title="Nothing to diagnose yet"
        description="This reads your own review history and exam attempts in this notebook. Generate a deck, study a few cards, and the mastery map fills in as evidence accumulates."
      />
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      {/*
        The honesty banner. "Your reviews say this" and "your reviews and exams
        together say this" are different claims, and a user who has never sat an
        exam must not be reading the first under a heading promising the second.
      */}
      <div className="flex items-start gap-tight rounded-lg border border-dashed p-snug">
        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-xs leading-relaxed">
          {report.answersConsidered > 0 ? (
            <>
              Computed from your own {plural(report.cardsConsidered, 'card')} and{' '}
              {plural(report.answersConsidered, 'exam answer')} in this notebook.
            </>
          ) : report.unattributedAnswers > 0 ? (
            <>
              Retention below is computed from your own{' '}
              {plural(report.cardsConsidered, 'card')}. You have answered{' '}
              {plural(report.unattributedAnswers, 'exam question')} whose topics
              are not recorded, so they cannot name a weakness — they are counted
              but not attributed.
            </>
          ) : (
            <>
              Computed from your own {plural(report.cardsConsidered, 'card')} in
              this notebook. You have not sat an exam here, so this is the
              retention half of the model only.
            </>
          )}
        </p>
      </div>

      {diagnosis && <p className="text-sm leading-relaxed">{diagnosis}</p>}

      <TopicMasteryList topics={topics} />

      {/* ── The plan ─────────────────────────────────────────────────── */}

      <div className="flex flex-wrap items-end gap-base">
        <div className="flex flex-col gap-hairline">
          <Label htmlFor="exam-date">Exam date</Label>
          <Input
            id="exam-date"
            type="date"
            value={examDate}
            min={todayKey}
            onChange={event => setExamDate(event.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex flex-col gap-hairline">
          <Label htmlFor="plan-days">Days</Label>
          <Input
            id="plan-days"
            type="number"
            min={PLAN_LIMITS.minDays}
            max={PLAN_LIMITS.maxDays}
            value={days}
            // Derived once there is a date: the arithmetic from "my exam is on
            // the 14th" to "that is nine days" is the app's job, and disabling
            // rather than hiding the field keeps the causal link visible.
            disabled={schedule !== null && !schedule.passed}
            onChange={event => setFallbackDays(Number(event.target.value))}
            className="w-24"
          />
        </div>
        <div className="flex flex-col gap-hairline">
          <Label htmlFor="plan-minutes">Minutes a day</Label>
          <Input
            id="plan-minutes"
            type="number"
            min={PLAN_LIMITS.minMinutes}
            max={PLAN_LIMITS.maxMinutes}
            value={minutesPerDay}
            onChange={event => setMinutesPerDay(Number(event.target.value))}
            className="w-28"
          />
        </div>
      </div>

      {schedule?.passed && (
        <p className="text-sm text-(--color-grade-hard-mark)">
          That date has passed, so the plan below is using the day count instead.
        </p>
      )}
      {!fit.fits && (
        <p className="text-muted-foreground text-sm">
          This plan is about {plural(fit.over, 'minute')} more than the{' '}
          {plural(fit.capacity, 'minute')} you have given it. The days below are
          filled in priority order, so what spills past the end is what mattered
          least.
        </p>
      )}

      <StudyPlanView
        plan={plan}
        onStart={start}
        hasSatExam={report.answersConsidered + report.unattributedAnswers > 0}
      />
    </div>
  );
}

function dueOf(artifact: Artifact): number {
  return artifact.payload.kind === 'deck' ? artifact.payload.dueCount : 0;
}
