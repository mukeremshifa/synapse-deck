import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDaysIcon, PlayIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import {
  useCardStates,
  useDueForecast,
  useRetention,
  useReviewHistory,
} from '@/lib/queries';
import { Heatmap } from './Heatmap';
import { RetentionCard } from './RetentionCard';
import { StateDistribution } from './StateDistribution';
import { StreakCard } from './StreakCard';

/**
 * Assembly, and the one place that decides what an account with no history sees.
 *
 * Every figure below is derived from `reviews` and `cards` (SPEC §13 (4)) — no
 * goals, no XP, no badges. A new account has none of that data, and five empty
 * charts is a worse first impression than one sentence pointing at the practice
 * button, so that is what it gets.
 *
 * **The page is three tiers, not five equal boxes (P6).** Streak and retention
 * answer "is any of this working", so they lead. The heatmap is the evidence
 * behind the streak and sits under it at full width. The forecast and the state
 * mix are detail — true, useful, and not what anyone opens this page to find
 * out — so they go last, under a heading that says so. The two figures that
 * used to be cards of their own, reviews this year and due today, are now the
 * headline number of the section they belong to, which is where they were being
 * read from anyway.
 */

/**
 * Recharts is large and this is the only page that needs it. Lazy here keeps it
 * out of the main bundle and gives P4's code-splitting work its first boundary.
 */
const ForecastChart = lazy(() =>
  import('./ForecastChart').then(module => ({ default: module.ForecastChart })),
);

const FORECAST_DAYS = 30;

export function ProgressPage() {
  const history = useReviewHistory();
  const retention = useRetention(90);
  const forecast = useDueForecast(FORECAST_DAYS);
  const cards = useCardStates();

  const loading = history.isPending || cards.isPending;
  const hasReviews = (history.data?.total ?? 0) > 0;
  const hasCards = (cards.data?.distribution.total ?? 0) > 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Progress</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">
          Everything here is counted from your review log. Nothing is estimated.
        </p>
        {/*
         * P9 task 10. Decks, cards and reviews moved to the new backend; this
         * page did not, because porting the aggregate behind it is work Phase F
         * has to do anyway (see the split table in docs/plans/P9-aws-slice.md).
         *
         * So for the duration these charts read the old database while the deck
         * list reads the new one, and they will disagree. One honest sentence
         * where the discrepancy is visible, rather than a banner on every
         * screen: a chart that silently contradicts the deck list reads as a
         * bug and costs more trust than the admission does.
         *
         * **Delete this in Phase F, when the aggregate moves.** It is a
         * statement about a temporary arrangement, not a permanent caveat.
         */}
        <p className="text-muted-foreground/80 mt-2 max-w-prose text-xs">
          These charts still read the pre-migration database, so they show your
          history from before the move and will not match your current decks.
          They reconnect when the rest of the migration finishes.
        </p>
      </header>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !hasReviews ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title="Nothing to show yet"
          description={
            hasCards
              ? 'Rate a card and this page starts filling in — a streak from the first day, retention once there are a few reviews to divide by.'
              : 'Make a deck and rate a card. Progress is measured from your review log, so it starts the moment you do.'
          }
          action={
            hasCards ? (
              <Button asChild>
                <Link to="/practice">
                  <PlayIcon /> Practise now
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/decks">
                  <PlusIcon /> Create a deck
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <StreakCard history={history.data} isPending={history.isPending} />
            <RetentionCard history={retention.data} isPending={retention.isPending} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Review history</CardTitle>
              <CardDescription>
                One cell per study day, which starts at 04:00 in your timezone.
              </CardDescription>
              <CardAction className="text-right">
                <p className="font-mono text-2xl leading-none tabular-nums">
                  {history.data?.total ?? 0}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">this year</p>
              </CardAction>
            </CardHeader>
            <CardContent>
              {history.data && (
                <Heatmap
                  counts={history.data.counts}
                  today={history.data.today}
                  timeZone={history.data.timeZone}
                />
              )}
            </CardContent>
          </Card>

          <section className="space-y-4">
            <h2 className="text-muted-foreground text-xs tracking-wide uppercase">
              Detail
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Due forecast</CardTitle>
                  <CardDescription>
                    The next {FORECAST_DAYS} days. Today includes everything overdue and
                    the new cards still allowed under your daily limit.
                  </CardDescription>
                  <CardAction className="text-right">
                    {forecast.isPending ? (
                      <Skeleton className="h-6 w-10" />
                    ) : (
                      <p className="font-mono text-2xl leading-none tabular-nums">
                        {forecast.data?.buckets[0]?.total ?? 0}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">due today</p>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {forecast.isPending || !forecast.data ? (
                    <Skeleton className="h-[260px] w-full" />
                  ) : (
                    <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
                      <ForecastChart
                        buckets={forecast.data.buckets}
                        timeZone={forecast.data.timeZone}
                      />
                    </Suspense>
                  )}
                </CardContent>
              </Card>

              <StateDistribution
                states={cards.data}
                history={retention.data}
                isPending={cards.isPending}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
