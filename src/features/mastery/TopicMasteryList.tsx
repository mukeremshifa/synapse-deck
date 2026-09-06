import { AlertTriangleIcon, TrendingUpIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EmptyMeter, Meter, type MeterTone } from '@/components/Meter';
import {
  divergenceKind,
  masteryBand,
  type MasteryBand,
  type TopicMastery,
} from '@/lib/mastery';
import { cn } from '@/lib/utils';

/**
 * The mastery map: every topic, weakest first, with what is known about it.
 *
 * `src/lib/mastery.ts` has computed all of this since it was written and
 * **nothing has ever rendered it.** The two-signal model — FSRS retention and
 * exam accuracy, deliberately not averaged — is the most interesting thing this
 * product knows, and it has been invisible. This component is that model made
 * visible, and it is careful to preserve the distinctions the module went to
 * trouble to keep.
 *
 * Three of those distinctions drive the design:
 *
 * 1. **Unmeasured is not weak.** It gets a dashed track and sorts last, never a
 *    0% bar. The module's own comment calls this the distinction users most
 *    resent getting wrong.
 * 2. **Confidence weakens the claim, it does not change the number.** A topic
 *    resting on two questions shows the same accuracy as one resting on thirty
 *    and says "2 questions" beside it. Rendering them identically is the lie the
 *    module refuses to tell in arithmetic, so the UI must not tell it in pixels.
 * 3. **Divergence is surfaced, not buried.** A `fragile` topic — recalled when
 *    prompted, lost under time — is the single most actionable finding available
 *    and has a remedy no score can imply.
 */

const BAND_TONE: Record<Exclude<MasteryBand, 'unmeasured'>, MeterTone> = {
  weak: 'weak',
  developing: 'developing',
  strong: 'strong',
};

const BAND_LABEL: Record<MasteryBand, string> = {
  unmeasured: 'Not measured',
  weak: 'Weak',
  developing: 'Developing',
  strong: 'Strong',
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The evidence line: what the number rests on.
 *
 * Both signals are named separately even when they agree, because "82% recall
 * over 24 cards / 7 of 8 questions" is a claim a user can check, while a bare
 * "82%" is one they must take on faith.
 */
function Evidence({ mastery }: { mastery: TopicMastery }) {
  const parts: string[] = [];

  if (mastery.retention) {
    parts.push(
      `${percent(mastery.retention.recall)} recall over ${mastery.retention.cards} ${mastery.retention.cards === 1 ? 'card' : 'cards'}`,
    );
  }
  if (mastery.exam) {
    parts.push(`${mastery.exam.correct}/${mastery.exam.answered} in exams`);
  }
  if (mastery.retention && mastery.retention.newCards > 0) {
    parts.push(`${mastery.retention.newCards} not yet seen`);
  }

  if (parts.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No reviews and no exam questions have touched this yet.
      </p>
    );
  }

  return <p className="text-muted-foreground text-xs">{parts.join(' · ')}</p>;
}

/**
 * The divergence callout. Rendered only above `DIVERGENCE_THRESHOLD`, because
 * `mastery.ts` is right that flagging noise trains people to ignore the flag.
 */
function Divergence({ mastery }: { mastery: TopicMastery }) {
  const kind = divergenceKind(mastery);
  if (kind === 'none') return null;

  const fragile = kind === 'fragile';
  const Icon = fragile ? AlertTriangleIcon : TrendingUpIcon;

  return (
    <p
      className={cn(
        'mt-2 flex items-start gap-1.5 text-xs leading-relaxed',
        fragile ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {fragile ? (
          <>
            <span className="font-medium">Fragile.</span> You recall this when
            prompted but lose it under exam conditions — more questions will help
            here, more flashcards will not.
          </>
        ) : (
          <>
            <span className="font-medium">Ahead of schedule.</span> Exams are going
            better than the review schedule predicts. The cards can be advanced.
          </>
        )}
      </span>
    </p>
  );
}

export function TopicMasteryRow({
  mastery,
  action,
}: {
  mastery: TopicMastery;
  /** Optional per-topic affordance, e.g. "Practise this". */
  action?: React.ReactNode;
}) {
  const band = masteryBand(mastery);
  const measured = band !== 'unmeasured' && mastery.score !== null;

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">
          {mastery.topicName}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {measured ? (
            <span className="font-mono text-sm tabular-nums">
              {percent(mastery.score ?? 0)}
            </span>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {BAND_LABEL.unmeasured}
            </Badge>
          )}
          {action}
        </span>
      </div>

      <div className="mt-2">
        {measured ? (
          <Meter
            value={mastery.score ?? 0}
            tone={BAND_TONE[band as Exclude<MasteryBand, 'unmeasured'>]}
            label={`${mastery.topicName}: ${BAND_LABEL[band]}`}
          />
        ) : (
          <EmptyMeter label={`${mastery.topicName}: not measured`} />
        )}
      </div>

      <div className="mt-2">
        <Evidence mastery={mastery} />
        <Divergence mastery={mastery} />
      </div>
    </li>
  );
}

export function TopicMasteryList({
  topics,
  className,
}: {
  topics: readonly TopicMastery[];
  className?: string;
}) {
  return (
    <ul className={cn('divide-y', className)}>
      {topics.map(mastery => (
        <TopicMasteryRow
          key={mastery.topicId ?? mastery.topicName}
          mastery={mastery}
        />
      ))}
    </ul>
  );
}
