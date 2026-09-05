import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlameIcon, LayersIcon, PlayIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { formatDurationWords, plural } from '@/lib/format';
import { streaks } from '@/lib/progress';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDecks, useDueSummary, useProfile, useReviewHistory } from '@/lib/queries';

/**
 * Deliberately thin: four true numbers and a button. The charts live on
 * `/progress`, and a dashboard full of them is a worse first screen than one
 * that answers "what do I do now".
 *
 * The streak is here because it is the number that brings someone back
 * tomorrow. It shares `useReviewHistory`'s cache with /progress, so navigating
 * between the two costs nothing.
 *
 * **P9: the streak reads the pre-migration database and the other three figures
 * do not.** `useReviewHistory` is one of the four hooks still pointed at
 * Supabase (the split table in docs/plans/P9-aws-slice.md); due, new and decks
 * all come from the new API. So the streak can disagree with them for the
 * duration, and Phase F is what ends that.
 *
 * The explanatory sentence lives on /progress, not here — P9 task 10 asks for
 * one honest line where the discrepancy is actually visible, not a caveat on
 * every screen. A single stale number among four is a much smaller lie than
 * five charts, and this comment is here so the next reader knows it is a known
 * one rather than a bug.
 *
 * P6: these four figures carry more typographic weight than anything else in
 * the product, because this is the screen that opens after sign-in and four
 * numbers are the entire message. Display-size mono digits, and a label above
 * them small enough that the number is what the eye lands on. The accent is
 * spent once, on the practise button — never on a figure, which would make one
 * of the four look like the answer when the answer is whichever is non-zero.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const summary = useDueSummary();
  const decks = useDecks();
  const history = useReviewHistory();

  const streak = useMemo(
    () =>
      history.data ? streaks([...history.data.counts.keys()], history.data.today) : null,
    [history.data],
  );

  const name = profile?.display_name?.trim() || user?.email?.split('@')[0] || 'there';
  const ready = (summary.data?.dueNow ?? 0) + (summary.data?.newAvailable ?? 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Hello, {name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.isPending
            ? 'Checking what is due…'
            : ready > 0
              ? `${plural(ready, 'card')} ready to practise.`
              : 'Nothing due right now.'}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due now" value={summary.data?.dueNow} loading={summary.isPending} />
        <Stat
          label="New available"
          value={summary.data?.newAvailable}
          loading={summary.isPending}
        />
        <Stat
          label="Reviewed today"
          value={summary.data?.reviewedToday}
          loading={summary.isPending}
        />
        <Stat
          label="Streak"
          value={streak?.current}
          loading={history.isPending}
          icon={<FlameIcon className="size-4" aria-hidden />}
          suffix={streak ? (streak.current === 1 ? 'day' : 'days') : undefined}
          href="/progress"
        />
      </section>

      <section>
        {ready > 0 ? (
          <Button size="lg" asChild>
            <Link to="/practice">
              <PlayIcon /> Practise {ready} {ready === 1 ? 'card' : 'cards'}
            </Link>
          </Button>
        ) : summary.data?.nextDueAt ? (
          <p className="text-muted-foreground text-sm">
            Next card due in{' '}
            <span className="text-foreground font-mono">
              {formatDurationWords(
                new Date(summary.data.nextDueAt).getTime() - Date.now(),
              )}
            </span>
            .
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs tracking-wide uppercase">
            Recent decks
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/decks">All decks</Link>
          </Button>
        </div>

        {decks.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : !decks.data || decks.data.length === 0 ? (
          <EmptyState
            icon={<LayersIcon />}
            title="Nothing here yet"
            description="Make a deck, add a few cards, and the schedule starts working from the first review."
            action={
              <Button asChild>
                <Link to="/decks">
                  <PlusIcon /> Create a deck
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {decks.data.slice(0, 4).map(deck => (
              <li key={deck.id}>
                <Card className="hover:border-foreground/25 h-full py-4 transition-colors">
                  <CardContent>
                    <Link
                      to={`/decks/${deck.id}`}
                      className="focus-visible:ring-ring rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                    >
                      {deck.title}
                    </Link>
                    <p className="text-muted-foreground mt-1 text-sm">
                      <span className="font-mono tabular-nums">{deck.cardCount}</span>{' '}
                      {deck.cardCount === 1 ? 'card' : 'cards'}
                      {deck.dueCount + deck.newCount > 0 && (
                        <>
                          {' · '}
                          <span className="text-foreground font-mono tabular-nums">
                            {deck.dueCount + deck.newCount}
                          </span>{' '}
                          ready
                        </>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  icon,
  suffix,
  href,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon?: React.ReactNode;
  suffix?: string;
  href?: string;
}) {
  const body = (
    <Card className="group-hover:border-foreground/25 h-full gap-3 py-5 transition-colors">
      <CardContent>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs tracking-wide uppercase">
          {icon}
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-3 h-10 w-16" />
        ) : (
          <p className="mt-3 font-mono text-4xl leading-none tabular-nums">
            {value ?? 0}
            {suffix && (
              <span className="text-muted-foreground ml-2 font-sans text-base">
                {suffix}
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      to={href}
      className="focus-visible:ring-ring group rounded-lg focus-visible:ring-2 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
