import { Link } from 'react-router-dom';
import { LibraryIcon, PlusIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Page, PageHeader, Section } from '@/components/layout';
import { EmptyState, ErrorState, LoadingCard } from '@/components/states';
import type { Notebook, Readiness } from '@/lib/api';
import { plural } from '@/lib/format';
import { useModal } from '@/app/modals';
import { NewNotebookModal } from './NewNotebookModal';
import { useGlobalSummary, useNotebooks } from './queries';

/**
 * Home. One front door, brief §3.5.
 *
 * ── What this replaces, and the rule that made it necessary ───────────────
 *
 * `DashboardPage` and `NotebookListPage`, which were two views of the same
 * data behind two nav items. The dashboard's own doc comment argued they were
 * different — "the list is an index, this is a prompt" — and that argument was
 * coherent right up to the point where the prompt had to *pick a notebook to
 * prompt about*. It picked the one with the most cards due, never named it on
 * screen, and let it change as counts shifted. That is the `focus` guess, and
 * deleting it is what this phase is for (brief §3.5, plan §3).
 *
 * So the shape of this screen is a direct consequence of one rule:
 *
 * > **Every action either names its notebook or lives on a notebook card.**
 *
 * There is no "Continue studying" button here, and its absence is the feature.
 * A global button has to choose, and choosing is the bug. The user chooses,
 * from a grid where every card says what is waiting in it.
 *
 * ── The strip is facts, not actions ──────────────────────────────────────
 *
 * `getGlobalSummary` is the one cross-notebook method in the contract, and its
 * doc comment carries the constraint: **nothing on it may become a CTA.** "You
 * reviewed 40 cards today" is a fact about the user; "practice this" is a claim
 * about a notebook and needs a subject. So the strip renders four numbers and
 * hangs no button off any of them. If a later session adds one, it has
 * re-invented `focus` with extra steps.
 *
 * ── Readiness comes from the server ──────────────────────────────────────
 *
 * `notebook.readiness.detail` is rendered as text, exactly as received — "2
 * decks · 1 quiz ready". It is **not** recomputed here from `counts`, which is
 * the card-count model brief §1.3 replaces. A new artifact kind changes that
 * sentence without this file being touched, which is the property the old
 * dashboard lacked.
 */
export function HomePage() {
  const notebooks = useNotebooks();
  const summary = useGlobalSummary();
  const { openModal } = useModal();

  return (
    <Page>
      <PageHeader
        title={greeting()}
        description="Your notebooks, and what each of them is holding for you."
        actions={
          <Button onClick={() => openModal('new-notebook')}>
            <PlusIcon aria-hidden /> New notebook
          </Button>
        }
      />

      {/* ── The global strip: four facts, no actions ─────────────────────── */}
      <GlobalStrip
        summary={summary.data ?? null}
        loading={summary.isPending}
        failed={summary.isError}
      />

      <Section
        title="Notebooks"
        description="Everything belongs to exactly one of these."
      >
        {notebooks.isPending ? (
          <div className="grid gap-gutter sm:grid-cols-2 lg:grid-cols-3">
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </div>
        ) : notebooks.isError ? (
          <ErrorState
            title="Could not load your notebooks"
            detail={errorMessage(notebooks.error)}
            onRetry={() => void notebooks.refetch()}
          />
        ) : (notebooks.data ?? []).length === 0 ? (
          <EmptyState
            icon={<LibraryIcon />}
            title="No notebooks yet"
            description="A notebook holds your sources and everything generated from them — cards, quizzes, notes, exams. Make one and add something to it."
            action={
              <Button onClick={() => openModal('new-notebook')}>
                <PlusIcon aria-hidden /> New notebook
              </Button>
            }
          />
        ) : (
          // `items-stretch` + `h-full` on the `li`: without both, a row's cards
          // take their own content height and the grid looks ragged. Observed
          // at 1280px — "Statistics" (no description) sat two-thirds the height
          // of "Pharmacology" beside it.
          <ul className="grid list-none items-stretch gap-gutter p-0 sm:grid-cols-2 lg:grid-cols-3">
            {(notebooks.data ?? []).map(notebook => (
              <li key={notebook.id} className="h-full">
                <NotebookCard notebook={notebook} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <NewNotebookModal />
    </Page>
  );
}

/* ── The strip ────────────────────────────────────────────────────────── */

/**
 * Four global numbers. Renders even while loading, because the strip's *shape*
 * is stable and only its values are pending — swapping the whole strip for a
 * skeleton would make the page jump on every visit.
 *
 * A failed summary hides the strip rather than showing an error: it is
 * supporting information, and a red box where four numbers should be would
 * make a background failure look like the screen's subject. The notebooks
 * below are the screen, and they load independently.
 */
function GlobalStrip({
  summary,
  loading,
  failed,
}: {
  summary: { dueNow: number; newAvailable: number; reviewedToday: number; streakDays: number } | null;
  loading: boolean;
  failed: boolean;
}) {
  if (failed) return null;

  const value = (n: number | undefined) => (loading || n === undefined ? null : n);

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-gutter p-gutter sm:grid-cols-4">
        <Stat label="Due now" value={value(summary?.dueNow)} />
        <Stat label="New today" value={value(summary?.newAvailable)} />
        <Stat label="Reviewed today" value={value(summary?.reviewedToday)} />
        <Stat
          label="Streak"
          value={value(summary?.streakDays)}
          unit={summary && summary.streakDays === 1 ? 'day' : 'days'}
        />
      </CardContent>
    </Card>
  );
}

/**
 * One number.
 *
 * `null` is loading and renders a dash rather than a `0`. A zero that becomes
 * eighteen has already told the user they were finished — the same argument the
 * old dashboard's `StatCard` made, kept.
 */
function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-hairline font-mono text-2xl tabular-nums">
        {value === null ? (
          <span className="text-muted-foreground" aria-label="Loading">
            —
          </span>
        ) : (
          value
        )}
        {value !== null && unit ? (
          <span className="text-muted-foreground ml-hairline text-sm">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

/* ── A notebook ───────────────────────────────────────────────────────── */

/**
 * The whole card is the link, and the only action on it opens *this* notebook.
 *
 * That is the §3.5 rule made physical: there is nowhere on this screen to click
 * that does not name the notebook it is about.
 */
function NotebookCard({ notebook }: { notebook: Notebook }) {
  const { counts, readiness } = notebook;

  return (
    <Link
      to={`/notebooks/${notebook.id}`}
      className="bg-card hover:border-border-strong focus-visible:ring-ring flex h-full flex-col rounded-xl border p-base transition-colors outline-none focus-visible:ring-2"
    >
      <div className="flex items-start justify-between gap-tight">
        <p className="min-w-0 flex-1 font-medium break-words">{notebook.title}</p>
        <ReadinessBadge readiness={readiness} />
      </div>

      {notebook.description ? (
        <p className="text-muted-foreground mt-tight line-clamp-2 text-sm">
          {notebook.description}
        </p>
      ) : null}

      {/*
        The roll-up sentence, straight from the contract. Rendered as text — it
        is server-computed prose and, like everything else on a screen in this
        app, never markup.
      */}
      <p className="mt-snug text-sm">{readiness.detail}</p>

      <p className="text-muted-foreground mt-auto pt-snug font-mono text-xs">
        {plural(counts.sources, 'source')} ·{' '}
        {plural(counts.artifacts, 'artifact')}
        {counts.dueCards > 0 ? ` · ${counts.dueCards} due` : ''}
      </p>
    </Link>
  );
}

/**
 * `ready` / `partial` / `none`, as a badge.
 *
 * `none` deliberately draws nothing: an empty notebook is a normal state, not a
 * warning, and a grid of four grey "none" chips reads as four problems.
 */
function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  if (readiness.state === 'none') return null;
  return (
    <Badge variant={readiness.state === 'ready' ? 'default' : 'secondary'}>
      {readiness.state === 'ready' ? 'Ready' : 'In progress'}
    </Badge>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Time-of-day greeting, from the browser's own clock rather than
 * `profile.timezone`.
 *
 * A user whose profile is set to another zone still wants it to say "evening"
 * when it is dark outside their window. Anything that affects *scheduling* uses
 * the profile zone; a pleasantry does not.
 */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
