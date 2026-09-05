import { AlertTriangleIcon, TrendingUpIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  divergenceKind,
  masteryBand,
  type MasteryBand,
  type TopicMastery,
} from '@/lib/mastery';
import { cn } from '@/lib/utils';

/**
 * The mastery map: where you stand per topic, and where the two signals disagree.
 *
 * **The disagreement is the feature.** A bar chart of per-topic scores is
 * something any quiz app ships. What this shows is that FSRS thinks a topic is
 * well-retained *and* the exam says it failed under time — which is not a
 * contradiction to be averaged away but the single most useful thing the
 * product knows about someone (brief section 7, question 10). It is also the
 * moment worth pointing at in a demo, because it is the one an observer cannot
 * get anywhere else.
 *
 * Every number here is reported with its denominator. A topic scored from one
 * exam question and a topic scored from forty reviews must not look alike, and
 * the confidence bar is what keeps them apart.
 */
export function MasteryMap({ topics }: { topics: readonly TopicMastery[] }) {
  if (topics.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-sm">
            No topics yet. Mastery appears once cards carry topics and you have sat
            an exam.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {topics.map(topic => (
        <TopicRow key={topic.topicId ?? topic.topicName} topic={topic} />
      ))}
    </div>
  );
}

function TopicRow({ topic }: { topic: TopicMastery }) {
  const band = masteryBand(topic);
  const divergence = divergenceKind(topic);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{topic.topicName}</h3>
            <BandBadge band={band} />
          </div>
          {topic.score !== null && (
            <span className="font-mono text-lg tabular-nums">
              {Math.round(topic.score * 100)}%
            </span>
          )}
        </div>

        {/*
          The two signals shown side by side rather than as one merged bar. The
          merged number is in the corner above; these are what it was made from,
          and a user who wants to argue with the score needs to see them.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <SignalBar
            label="Recall"
            hint="Predicted by your review schedule"
            value={topic.retention?.recall ?? null}
            detail={
              topic.retention
                ? `${topic.retention.cards} card${topic.retention.cards === 1 ? '' : 's'}`
                : 'No reviews yet'
            }
          />
          <SignalBar
            label="Under exam"
            hint="Answered correctly under time"
            value={topic.exam?.accuracy ?? null}
            detail={
              topic.exam
                ? `${topic.exam.correct}/${topic.exam.answered} correct`
                : 'Not examined yet'
            }
          />
        </div>

        {divergence !== 'none' && <DivergenceNote kind={divergence} topic={topic} />}

        {/*
          Confidence last and quiet. It qualifies everything above it, but a
          user reads the score first and should not have to wade past a caveat
          to reach it.
        */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Confidence</span>
          <div className="bg-muted h-1 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-muted-foreground/60 h-full rounded-full"
              style={{ width: `${topic.confidence * 100}%` }}
            />
          </div>
          {topic.retention && topic.retention.newCards > 0 && (
            <span className="text-muted-foreground text-xs">
              {topic.retention.newCards} unseen
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalBar({
  label,
  hint,
  value,
  detail,
}: {
  label: string;
  hint: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium" title={hint}>
          {label}
        </span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {value === null ? '—' : `${Math.round(value * 100)}%`}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        {/*
          A missing signal draws nothing rather than an empty bar at zero. An
          empty bar reads as "you scored nothing", which is the opposite of
          "we have not measured this".
        */}
        {value !== null && (
          <div
            className="bg-foreground h-full rounded-full transition-[width] duration-500"
            style={{ width: `${value * 100}%` }}
          />
        )}
      </div>
      <p className="text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

function DivergenceNote({
  kind,
  topic,
}: {
  kind: 'fragile' | 'underrated';
  topic: TopicMastery;
}) {
  const gap = Math.abs(Math.round((topic.divergence ?? 0) * 100));

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        kind === 'fragile'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-dashed',
      )}
    >
      {kind === 'fragile' ? (
        <AlertTriangleIcon className="text-destructive mt-0.5 size-3.5 shrink-0" aria-hidden />
      ) : (
        <TrendingUpIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <p className="flex-1">
        {kind === 'fragile' ? (
          <>
            <span className="font-medium">Fragile under time.</span> You recall this
            when prompted but lost{' '}
            <span className="font-mono tabular-nums">{gap}</span> points of it under
            exam conditions — more flashcard review will not fix that. Sit more
            questions on it instead.
          </>
        ) : (
          <>
            <span className="font-medium">Better than scheduled.</span> The exam went{' '}
            <span className="font-mono tabular-nums">{gap}</span> points better than
            your review schedule predicts. These cards are probably due more often
            than they need to be.
          </>
        )}
      </p>
    </div>
  );
}

const BAND_LABEL: Record<MasteryBand, string> = {
  unmeasured: 'Unmeasured',
  weak: 'Weak',
  developing: 'Developing',
  strong: 'Strong',
};

function BandBadge({ band }: { band: MasteryBand }) {
  return (
    <Badge
      variant={
        band === 'weak' ? 'destructive' : band === 'strong' ? 'default' : 'outline'
      }
      // Unmeasured is deliberately the quietest thing on the row: it is not a
      // grade, and styling it like one invites reading it as a bad grade.
      className={cn(band === 'unmeasured' && 'text-muted-foreground border-dashed')}
    >
      {BAND_LABEL[band]}
    </Badge>
  );
}
