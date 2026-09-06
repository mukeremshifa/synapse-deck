import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  FlameIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Meter } from '@/components/Meter';
import { plural } from '@/lib/format';
import { toNotebook, notebookPath, type Notebook } from '@/lib/notebooks';
import { streaks } from '@/lib/progress';
import { useDecks, useDueSummary, useReviewHistory } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * The front door: what to do now, how it is going, and where to go next.
 *
 * ── Why a dashboard came back, having been deleted at P11 ─────────────────
 *
 * P11 removed `DashboardPage` because it and the deck list had drifted into two
 * views of the same thing — both showed decks with due counts and a practise
 * button, and one of them was redundant. That reasoning was right about *those*
 * two screens and does not survive the product growing a second half.
 *
 * A notebook list answers "which of my notebooks?". It cannot answer "what
 * should I do right now?", because the answer now spans notebooks and spans both
 * halves of the loop — a due queue in one notebook, a weak topic in another, an
 * exam worth sitting in a third. That question is what this screen is for, and
 * it is the one a student actually opens the app with.
 *
 * The distinction that keeps the two from drifting again: **the list is an
 * index, this is a prompt.** Nothing here is a complete enumeration of anything.
 * If it starts growing a filter or a search box, it has become the list and one
 * of them should go.
 *
 * ── What is real on this screen ───────────────────────────────────────────
 *
 * The due counts, the streak, and the notebooks are real — `useDueSummary`,
 * `useReviewHistory` and `useDecks` all hit the API. **Exam readiness is not on
 * this screen at all**, though the reference design puts it here, because
 * readiness needs exam attempts stored against topics and there are none. A
 * confident "74% ready" derived from nothing is exactly the sort of number a
 * student would plan around, and it would be fiction.
 */
export function DashboardPage() {
  const decks = useDecks();
  const summary = useDueSummary();
  const history = useReviewHistory(90);

  const notebooks = useMemo(() => (decks.data ?? []).map(toNotebook), [decks.data]);

  /** Where "continue studying" goes: the notebook with the most waiting. */
  const focus = useMemo<Notebook | null>(() => {
    const ready = notebooks
      .map(notebook => ({
        notebook,
        waiting: notebook.dueCount + notebook.newCount,
      }))
      .filter(entry => entry.waiting > 0)
      .sort((a, b) => b.waiting - a.waiting);
    return ready[0]?.notebook ?? notebooks[0] ?? null;
  }, [notebooks]);

  const streak = useMemo(() => {
    if (!history.data) return null;
    return streaks([...history.data.counts.keys()], history.data.today);
  }, [history.data]);

  const dueNow = summary.data ? summary.data.dueNow + summary.data.newAvailable : null;
  const loading = decks.isPending;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">{greeting()}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {dueNow === null
            ? 'Getting your queue.'
            : dueNow > 0
              ? `${plural(dueNow, 'card')} ready to review.`
              : 'Nothing is due. This is what being on top of it looks like.'}
        </p>
      </header>

      {/* ── The one action ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {focus && (dueNow ?? 0) > 0 ? (
          <Button asChild size="lg">
            <Link to={notebookPath.practice(focus.id)}>
              <PlayIcon aria-hidden /> Continue studying
            </Link>
          </Button>
        ) : null}
        <Button asChild variant={(dueNow ?? 0) > 0 ? 'outline' : 'default'} size="lg">
          <Link to="/create/text">
            <SparklesIcon aria-hidden /> Add material
          </Link>
        </Button>
      </div>

      {/* ── Three numbers, and only ones that are real ───────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Ready now"
          value={dueNow === null ? null : String(dueNow)}
          detail={
            summary.data
              ? `${summary.data.dueNow} due · ${summary.data.newAvailable} new`
              : undefined
          }
        />
        <StatCard
          label="Reviewed today"
          value={summary.data ? String(summary.data.reviewedToday) : null}
          detail={
            summary.data && summary.data.reviewedToday > 0
              ? 'Keeps the streak alive'
              : 'Nothing yet today'
          }
        />
        <StatCard
          label="Streak"
          icon={<FlameIcon className="size-4" aria-hidden />}
          value={streak ? plural(streak.current, 'day') : null}
          detail={streak ? `Best: ${plural(streak.longest, 'day')}` : undefined}
        />
      </div>

      {/* ── Notebooks, as a prompt rather than an index ──────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Pick up where you left off</h2>
          <Link
            to={notebookPath.list()}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md text-xs outline-none focus-visible:ring-2"
          >
            All notebooks
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : notebooks.length === 0 ? (
          <EmptyState
            icon={<PlusIcon />}
            title="Nothing here yet"
            description="Add some material and the app will turn it into cards you can actually be drilled on."
            action={
              <Button asChild>
                <Link to="/create/text">Add material</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {notebooks.slice(0, 4).map(notebook => (
              <NotebookTile key={notebook.id} notebook={notebook} />
            ))}
          </div>
        )}
      </section>

      {/* ── The other half of the loop ───────────────────────────────────── */}
      {notebooks.length > 0 && focus ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">The other half</h2>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">
                  Reviewing tells you what you can recall. An exam tells you what
                  you can do with it under time — and where those two disagree is
                  where the next session should go.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to={notebookPath.blueprint(focus.id)}>
                    <ClipboardCheckIcon aria-hidden /> Exam blueprint
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={notebookPath.diagnostic(focus.id)}>
                    Diagnostic <ArrowRightIcon aria-hidden />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A single number. `null` means loading — deliberately distinct from `'0'`,
 * because a zero that turns into eighteen has already told the user they were
 * finished. `NotebookPage` makes the same argument about its counts.
 */
function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | null;
  detail?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          {icon}
          {label}
        </p>
        {value === null ? (
          <Skeleton className="mt-2 h-8 w-20" />
        ) : (
          <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
        )}
        {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function NotebookTile({ notebook }: { notebook: Notebook }) {
  const waiting = notebook.dueCount + notebook.newCount;
  const progress =
    notebook.cardCount > 0 ? 1 - waiting / Math.max(notebook.cardCount, waiting) : 0;

  return (
    <Link
      to={notebookPath.open(notebook.id)}
      className={cn(
        'bg-card hover:border-foreground/20 focus-visible:ring-ring block rounded-xl border p-4 transition-colors outline-none focus-visible:ring-2',
      )}
    >
      <p className="truncate text-sm font-medium">{notebook.title}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {notebook.cardCount > 0
          ? `${plural(notebook.cardCount, 'card')} · ${waiting} ready`
          : 'No cards yet'}
      </p>
      {notebook.cardCount > 0 ? (
        <Meter
          className="mt-3"
          value={progress}
          tone={waiting > 0 ? 'neutral' : 'accent'}
          label={`${notebook.title}: ${waiting} of ${notebook.cardCount} waiting`}
        />
      ) : null}
    </Link>
  );
}

/**
 * Time-of-day greeting, from the browser's own clock.
 *
 * Not from `profile.timezone`: this is a pleasantry, and a user who has their
 * profile set to another zone still wants it to say "evening" when it is dark
 * outside their window. Anything that affects scheduling uses the profile zone;
 * this does not affect scheduling.
 */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
