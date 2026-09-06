import { Link } from 'react-router-dom';
import { CheckCircle2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationWords, plural } from '@/lib/format';
import { GRADES, GRADE_LABELS } from '@/lib/fsrs';
import { GRADE_TOKEN } from '@/lib/grade-tokens';
import type { Grade } from '@/lib/schemas';

/**
 * What just happened, and when to come back. Shown when the queue runs out —
 * which, in a working SRS, is most sessions.
 *
 * The tally is coloured by the grade ramp rather than left plain, because this
 * is the one screen where the four ratings are compared against each other. The
 * accent appearing on Easy here is the ramp doing its job, not a second accent
 * competing with the badge above it (P6).
 */
export function SessionSummary({
  reviewed,
  ratings,
  nextDueAt,
  heldBackNew,
  onPracticeMore,
}: {
  reviewed: number;
  ratings: Record<Grade, number>;
  nextDueAt: string | null;
  heldBackNew: number;
  onPracticeMore?: () => void;
}) {
  const now = new Date();
  const nextDue = nextDueAt ? new Date(nextDueAt) : null;

  return (
    <Card className="mx-auto max-w-lg py-8">
      <CardHeader className="items-center text-center">
        <span className="bg-primary text-primary-foreground mx-auto flex size-11 items-center justify-center rounded-full">
          <CheckCircle2Icon className="size-6" aria-hidden />
        </span>
        <CardTitle className="mt-1 font-serif text-2xl font-normal">
          {reviewed === 0 ? 'Nothing to review' : `${plural(reviewed, 'card')} reviewed`}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {reviewed > 0 && (
          <dl className="grid grid-cols-4 gap-2 text-center">
            {GRADES.map(grade => (
              <div key={grade} className="bg-muted/50 rounded-lg py-3">
                <dt className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: GRADE_TOKEN[grade] }}
                  />
                  {GRADE_LABELS[grade]}
                </dt>
                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {ratings[grade] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="text-muted-foreground space-y-1 text-center text-sm">
          {nextDue ? (
            <p>
              Next card due in{' '}
              <span className="text-foreground font-mono">
                {formatDurationWords(nextDue.getTime() - now.getTime())}
              </span>
              .
            </p>
          ) : (
            <p>No cards scheduled yet. Add some and they will appear here.</p>
          )}
          {heldBackNew > 0 && (
            <p>
              {plural(heldBackNew, 'new card')} held back by today&rsquo;s limit — they
              start tomorrow, or raise the limit in{' '}
              <Link to="/settings" className="underline underline-offset-4">
                settings
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex justify-center gap-2">
          {onPracticeMore && (
            <Button variant="outline" onClick={onPracticeMore}>
              Check for more
            </Button>
          )}
          <Button variant="secondary" asChild>
            <Link to="/notebooks">Back to notebooks</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
