import {
  BookOpenIcon,
  ClipboardCheckIcon,
  LayersIcon,
  ListChecksIcon,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ACTION_LABELS,
  type PlanAction,
  type PlanActionKind,
  type StudyPlan,
} from '@/lib/study-plan';
import { cn } from '@/lib/utils';

/**
 * The generated plan, day by day.
 *
 * ── Every row says why it is there ────────────────────────────────────────
 *
 * `study-plan.ts` requires `because` on every action, and this component renders
 * it rather than hiding it behind a disclosure. That is the design's whole
 * point: a plan whose rows are unexplained is indistinguishable from a plan
 * generated at random, and the user has no way to tell which one they got. The
 * reason is one line of small text under the title — cheap to skip, impossible
 * to miss when you want it.
 *
 * ── Why the actions are not checkboxes wired to anything ──────────────────
 *
 * A checkbox implies persistence. Nothing stores plan completion — there is no
 * table for it and no endpoint — so a checkbox here would forget every tick on
 * reload, which is worse than not offering one. Each action instead **launches
 * the thing it describes**, which is the behaviour that actually advances the
 * loop, and completion is inferred from the work itself rather than self-
 * reported. When a plan is persisted, the checkbox has somewhere to live.
 */

const ACTION_ICON: Record<PlanActionKind, LucideIcon> = {
  review: BookOpenIcon,
  drill: LayersIcon,
  questions: ListChecksIcon,
  'mini-exam': ClipboardCheckIcon,
};

export function PlanActionRow({
  action,
  onStart,
}: {
  action: PlanAction;
  onStart?: (action: PlanAction) => void;
}) {
  const Icon = ACTION_ICON[action.kind];

  return (
    <li className="flex items-start gap-3 py-3">
      <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{action.title}</span>
          <Badge variant="secondary" className="shrink-0">
            {ACTION_LABELS[action.kind]}
          </Badge>
        </div>
        {/* The evidence. See the header — this is not optional detail. */}
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {action.because}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {action.minutes}m
        </span>
        {onStart ? (
          <Button size="sm" variant="outline" onClick={() => onStart(action)}>
            Start
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function StudyPlanView({
  plan,
  onStart,
  className,
}: {
  plan: StudyPlan;
  onStart?: (action: PlanAction) => void;
  className?: string;
}) {
  if (plan.days.length === 0) {
    return (
      <p className="text-muted-foreground text-sm leading-relaxed">
        There is nothing to schedule: no topic is weak on the evidence so far.
        Sit an exam to get a second signal, or keep the review schedule as it is.
      </p>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {plan.days.map(day => (
        <section key={day.day}>
          <div className="flex items-baseline justify-between gap-2 border-b pb-1">
            <h3 className="text-sm font-medium">Day {day.day}</h3>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {day.minutes}m
            </span>
          </div>
          <ul className="divide-y">
            {day.actions.map(action => (
              <PlanActionRow key={action.id} action={action} onStart={onStart} />
            ))}
          </ul>
        </section>
      ))}

      {/*
        Topics the plan skipped, and why. `study-plan.ts` collects these rather
        than dropping them because silence about a topic is ambiguous between
        "you are fine" and "we forgot", and only one of those is reassuring.
      */}
      {plan.ignored.length > 0 ? (
        <section className="border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Left alone on purpose
          </h3>
          <ul className="mt-2 space-y-1.5">
            {plan.ignored.map(entry => (
              <li key={entry.topicName} className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium">{entry.topicName}</span>{' '}
                — {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
