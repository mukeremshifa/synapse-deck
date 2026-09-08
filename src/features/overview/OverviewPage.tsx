import { Link, useParams } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { Page, PageHeader, Section } from '@/components/layout';
import { ErrorState, LoadingCard, LoadingState } from '@/components/states';
import { ReadinessBadge } from '@/components/artifact-bits';
import { useArtifacts, useNotebook, useSources } from '@/features/notebook/queries';
import { useProfile } from '@/features/settings/queries';
import { notebookPath } from '@/lib/notebooks';
import { resolveTimeZone } from '@/lib/day';
import { plural } from '@/lib/format';
import { STATE_MARK_TOKEN } from '@/lib/grade-tokens';
import type { CardStates, RetentionSummary } from '@/lib/api';
import { ArtifactList } from './ArtifactList';
import { Diagnostics } from './Diagnostics';
import { Heatmap } from './Heatmap';
import {
  RETENTION_DAYS,
  useCardStates,
  useDueForecast,
  useRetention,
  useReviewHistory,
  useTopicMastery,
} from './queries';

/**
 * The notebook overview — **one notebook, named by the route.**
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * It looks like the old dashboard and it must not become it. The old one
 * *guessed* which notebook it was about, through the `focus` heuristic FR2
 * deleted; this one is **given** one by the URL. If a notebook selector ever
 * appears at the top of this page, the guess has come back wearing a different
 * hat (FR6 §2) — every read below takes `notebookId` as its first argument,
 * and the contract offers no way to ask any of these questions without one.
 *
 * There is also no global roll-up here. A cross-notebook dashboard is
 * explicitly nowhere in this product: scoping to one notebook is what makes
 * these figures honest, because "this is what you should do next" is a claim
 * about a subject and needs one.
 *
 * ── Eight calls, and that is correct ──────────────────────────────────────
 *
 * An overview wants everything at once, and FR0 §3 names that as the pressure
 * this phase is most likely to break under: if the fake served this page as one
 * magic call, FR7 would inherit an endpoint nobody can build. So it makes the
 * calls a real client would — the notebook, its sources, its artifacts, and
 * five aggregates — each independently cacheable and independently invalidated.
 *
 * **Each is a query a real API can serve cheaply**, and the expensive ones are
 * expensive on the *server*, which is where the reduction belongs: the heatmap
 * is 365 buckets rather than a year of review rows, and topic mastery is a row
 * per topic rather than every card in the notebook. FR6 §8 records which and
 * why.
 *
 * ── Readiness, and why nothing here recomputes it ─────────────────────────
 *
 * Every readiness figure on this page is `Artifact.readiness` or
 * `Notebook.readiness` rendered as received. Home renders the same fields from
 * the same source, so the two cannot disagree — criterion 3 is structural
 * rather than a coincidence maintained by hand. And because neither this page
 * nor home switches on `kind` to produce it, a fifth artifact kind extends the
 * roll-up server-side and appears here and on home without either being edited
 * (criterion 4).
 */
export function OverviewPage() {
  const { notebookId } = useParams<{ notebookId: string }>();

  if (!notebookId) {
    return (
      <Page width="wide">
        <ErrorState
          title="No notebook named"
          detail="This screen is about one notebook and the URL did not name one."
        />
      </Page>
    );
  }

  return <Overview notebookId={notebookId} />;
}

function Overview({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId);
  const sources = useSources(notebookId);
  const artifacts = useArtifacts(notebookId);
  const profile = useProfile();

  const history = useReviewHistory(notebookId);
  const forecast = useDueForecast(notebookId);
  const cardStates = useCardStates(notebookId);
  const retention = useRetention(notebookId);
  const mastery = useTopicMastery(notebookId);

  const timeZone = resolveTimeZone(profile.data?.timezone);

  if (notebook.isPending) {
    return (
      <Page width="wide">
        <LoadingState lines={3} label="Loading this notebook" />
      </Page>
    );
  }

  if (notebook.isError) {
    return (
      <Page width="wide">
        <ErrorState
          title="Could not load this notebook"
          detail={errorMessage(notebook.error)}
          onRetry={() => void notebook.refetch()}
        />
      </Page>
    );
  }

  /*
   * The set of sources that still exist — **for deciding liveness only.**
   *
   * Provenance names come from each artifact's own `sourcesSnapshot`, which is
   * frozen at generation and never dangles. This set only answers "is that name
   * still a source you have?", so a deleted source renders struck through
   * rather than disappearing (brief §1.2(7)). Resolving a snapshot's id against
   * this set and assuming a hit is the bug the fixtures ship a dangling id to
   * catch.
   */
  const liveSourceIds = new Set((sources.data ?? []).map(source => source.id));
  const all = artifacts.data ?? [];
  const ready = all.filter(artifact => artifact.status === 'ready');

  return (
    <Page width="wide">
      <PageHeader
        title={notebook.data.title}
        description={notebook.data.description ?? undefined}
        actions={
          <Link
            to={notebookPath.open(notebookId)}
            className="text-sm underline underline-offset-4"
          >
            Back to the notebook
          </Link>
        }
      />

      {/* ── Readiness, as the server rolled it up ─────────────────────── */}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-base py-snug">
          <ReadinessBadge readiness={notebook.data.readiness} />
          {/*
            Rendered exactly as received — "2 decks · 1 quiz ready". This is the
            same string home shows on this notebook's card, from the same field.
            Practice means "work this bundle", not "drill N cards".
          */}
          <p className="text-sm font-medium">{notebook.data.readiness.detail}</p>
          <p className="text-muted-foreground text-sm">
            {plural(notebook.data.counts.sources, 'source')} ·{' '}
            {plural(notebook.data.counts.artifacts, 'artifact')}
          </p>
        </CardContent>
      </Card>

      {/* ── Task 1: everything this notebook has produced ─────────────── */}

      <Section>
        {artifacts.isPending ? (
          <LoadingCard />
        ) : artifacts.isError ? (
          <ErrorState
            title="Could not load this notebook's artifacts"
            detail={errorMessage(artifacts.error)}
            onRetry={() => void artifacts.refetch()}
          />
        ) : (
          <ArtifactList
            notebookId={notebookId}
            artifacts={all}
            liveSourceIds={liveSourceIds}
          />
        )}
      </Section>

      {/* ── Task 3 and 5: the diagnostic and the plan ─────────────────── */}

      <Section title="Diagnostic" description="What your own evidence says, topic by topic.">
        {mastery.isPending ? (
          <LoadingCard />
        ) : mastery.isError ? (
          <ErrorState
            title="Could not load topic mastery"
            detail={errorMessage(mastery.error)}
            onRetry={() => void mastery.refetch()}
          />
        ) : (
          <Diagnostics
            notebookId={notebookId}
            report={mastery.data}
            artifacts={ready}
            timeZone={timeZone}
          />
        )}
      </Section>

      {/* ── Task 4: the heatmap, and the memory figures beside it ─────── */}

      <Section
        title="Review history"
        description="Every review you have logged in this notebook, by day."
      >
        {history.isPending ? (
          <LoadingCard />
        ) : history.isError ? (
          <ErrorState
            title="Could not load your review history"
            detail={errorMessage(history.error)}
            onRetry={() => void history.refetch()}
          />
        ) : (
          <Heatmap history={history.data} />
        )}
      </Section>

      <Section title="Memory" description="What this notebook's cards look like right now.">
        <div className="grid gap-gutter md:grid-cols-2">
          <Card>
            <CardContent className="py-snug">
              {cardStates.isPending ? (
                <LoadingState lines={3} label="Loading card states" />
              ) : cardStates.isError ? (
                <ErrorState
                  title="Could not load card states"
                  detail={errorMessage(cardStates.error)}
                  onRetry={() => void cardStates.refetch()}
                />
              ) : (
                <CardStatesPanel states={cardStates.data} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-snug">
              {retention.isPending ? (
                <LoadingState lines={3} label="Loading retention" />
              ) : retention.isError ? (
                <ErrorState
                  title="Could not load retention"
                  detail={errorMessage(retention.error)}
                  onRetry={() => void retention.refetch()}
                />
              ) : (
                <RetentionPanel summary={retention.data} />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ── The forecast: what the next fortnight costs ───────────────── */}

      <Section
        title="What is coming"
        description="Due cards over the next fortnight, and today's new-card allowance."
      >
        {forecast.isPending ? (
          <LoadingCard />
        ) : forecast.isError ? (
          <ErrorState
            title="Could not load the forecast"
            detail={errorMessage(forecast.error)}
            onRetry={() => void forecast.refetch()}
          />
        ) : (
          <Forecast days={forecast.data.days} />
        )}
      </Section>
    </Page>
  );
}

/**
 * The card-state mix, and the means behind it.
 *
 * `meanStability` and `meanDifficulty` are nullable, and null is rendered as a
 * dash rather than as zero. **A mean of nothing is not zero** — zero stability
 * is a claim about a card, and printing it for a deck nobody has studied says
 * something false about it.
 */
function CardStatesPanel({ states }: { states: CardStates }) {
  const { counts } = states;
  const total =
    counts.new + counts.learning + counts.review + counts.relearning;

  if (total === 0 && counts.suspended === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No cards in this notebook yet.
      </p>
    );
  }

  const rows = [
    { label: 'New', value: counts.new, token: STATE_MARK_TOKEN.new },
    { label: 'Learning', value: counts.learning, token: STATE_MARK_TOKEN.learning },
    { label: 'Review', value: counts.review, token: STATE_MARK_TOKEN.review },
    {
      label: 'Relearning',
      value: counts.relearning,
      token: STATE_MARK_TOKEN.relearning,
    },
  ];

  return (
    <div className="flex flex-col gap-tight">
      <h3 className="text-sm font-medium">Card states</h3>

      {/* A single stacked bar: the mix at a glance, before the numbers. */}
      <div className="flex h-2 overflow-hidden rounded-full">
        {rows.map(row => (
          <div
            key={row.label}
            style={{
              // Painted, so the mark ramp rather than the field ramp (FR1).
              backgroundColor: row.token,
              width: `${String(total === 0 ? 0 : (row.value / total) * 100)}%`,
            }}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-hairline text-sm">
        {rows.map(row => (
          <li key={row.label} className="flex items-center gap-tight">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.token }}
              aria-hidden
            />
            <span className="text-muted-foreground flex-1">{row.label}</span>
            <span className="tabular-nums">{row.value}</span>
          </li>
        ))}
        {counts.suspended > 0 && (
          <li className="text-muted-foreground flex items-center gap-tight">
            <span className="size-2 shrink-0" aria-hidden />
            <span className="flex-1">Suspended</span>
            <span className="tabular-nums">{counts.suspended}</span>
          </li>
        )}
      </ul>

      <p className="text-muted-foreground text-xs">
        Mean stability {formatMean(states.meanStability, 'd')} · mean difficulty{' '}
        {formatMean(states.meanDifficulty)}
      </p>
    </div>
  );
}

/**
 * Retention: how often a card was recalled when it came up.
 *
 * `overall` is null when nothing came up in the window, and that is **not
 * zero** — zero means every card failed, which is a very different statement
 * from "you have not been asked yet".
 */
function RetentionPanel({ summary }: { summary: RetentionSummary }) {
  return (
    <div className="flex flex-col gap-tight">
      <h3 className="text-sm font-medium">Retention</h3>

      {summary.overall === null ? (
        <p className="text-muted-foreground text-sm">
          No card in this notebook has come up for review in the last{' '}
          {plural(RETENTION_DAYS, 'day')}, so there is nothing to measure yet.
        </p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPercent(summary.overall)}
          </p>
          <p className="text-muted-foreground text-sm">
            {summary.recalled} recalled of {summary.reviewed} reviewed, over{' '}
            {plural(summary.windowDays, 'day')}.
          </p>
          <ul className="mt-hairline flex flex-col gap-hairline text-sm">
            {/*
              Per state, because a low overall figure means different things at
              different states: failing `review` cards is a scheduling problem,
              failing `learning` ones is normal and expected.
            */}
            {(['learning', 'review', 'relearning'] as const).map(state => {
              const value = summary.byState[state];
              if (value === null || value === undefined) return null;
              return (
                <li key={state} className="flex items-center gap-tight">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: STATE_MARK_TOKEN[state] }}
                    aria-hidden
                  />
                  <span className="text-muted-foreground flex-1 capitalize">{state}</span>
                  <span className="tabular-nums">{formatPercent(value)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The next fortnight, as bars.
 *
 * Day 0 carries everything overdue **and** today's remaining new-card
 * allowance, so its bar equals what practice would serve this minute rather
 * than only what happens to fall due today.
 */
function Forecast({
  days,
}: {
  days: readonly { day: string; due: number; fresh: number }[];
}) {
  const peak = Math.max(1, ...days.map(bucket => bucket.due + bucket.fresh));

  if (peak === 1 && days.every(bucket => bucket.due + bucket.fresh === 0)) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing is scheduled in this notebook for the next{' '}
        {plural(days.length, 'day')}.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-hairline">
      <div className="flex items-end gap-tight" style={{ minHeight: '6rem' }}>
        {days.map((bucket, index) => {
          const total = bucket.due + bucket.fresh;
          return (
            <div key={bucket.day} className="flex w-8 shrink-0 flex-col items-center gap-hairline">
              <span className="text-muted-foreground text-xs tabular-nums">
                {total > 0 ? total : ''}
              </span>
              <div
                className="flex w-full flex-col justify-end rounded-t"
                style={{ height: `${String((total / peak) * 64)}px` }}
                title={`${bucket.day}: ${plural(bucket.due, 'due card')}${bucket.fresh > 0 ? `, ${plural(bucket.fresh, 'new card')}` : ''}`}
              >
                {bucket.fresh > 0 && (
                  <div
                    style={{
                      backgroundColor: STATE_MARK_TOKEN.new,
                      height: `${String((bucket.fresh / Math.max(1, total)) * 100)}%`,
                    }}
                  />
                )}
                {bucket.due > 0 && (
                  <div
                    className="flex-1"
                    style={{ backgroundColor: STATE_MARK_TOKEN.review }}
                  />
                )}
              </div>
              <span className="text-muted-foreground text-xs">
                {index === 0 ? 'Today' : bucket.day.slice(8)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/** An em dash for null. See `CardStatesPanel` — a mean of nothing is not zero. */
function formatMean(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
