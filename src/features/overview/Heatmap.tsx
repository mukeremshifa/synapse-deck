import { useMemo } from 'react';

import type { ReviewHistory } from '@/lib/api';
import { heatmapGrid, streaks, type HeatmapLevel } from '@/lib/progress';
import { plural } from '@/lib/format';

/**
 * The review heatmap, **notebook-scoped** — `progress.ts` re-pointed.
 *
 * ── What re-pointing actually changed ─────────────────────────────────────
 *
 * `progress.ts` used to be handed raw review rows and reduce them itself:
 * `dayCounts(countable(rows), timeZone)` fetched every review inside the window
 * and bucketed them in the browser. It no longer sees a review row at all. The
 * server returns `ReviewHistory` — one bucket per study day, at most 365 of
 * them — and `heatmapGrid` lays those buckets out.
 *
 * **That is the point, and it is FR6's task-4 decision.** A serious user's year
 * is tens of thousands of review rows and the aggregate is 365; the old
 * implementation aggregated in Postgres (`review_day_counts`) for exactly that
 * reason, and the contract's `getReviewHistory` is that view's replacement. A
 * fake that happily reduced fixture rows in memory would have handed FR7 an
 * endpoint that ships 70,000 rows to the browser.
 *
 * So what survives of `progress.ts` here is the *layout* — weeks into columns,
 * counts into intensity levels — which is presentation and belongs client-side.
 * The reduction moved. `dayCounts`, `countable` and `ReviewLogEntry` have no
 * caller on this screen, because there are no rows to count.
 *
 * `undoneAt` tombstones (FR5) are excluded by the server, not here: the fake's
 * `countableReviews` filters them before bucketing, so an undone rating never
 * reaches a bucket. A client filtering them would need the rows.
 */
export function Heatmap({ history }: { history: ReviewHistory }) {
  const grid = useMemo(() => {
    /*
     * The server's day buckets, as the map `heatmapGrid` reads. Days with no
     * reviews are present in the response with `reviews: 0` — a heatmap built
     * from only the non-zero days has no gaps to draw.
     */
    const counts = new Map(history.days.map(bucket => [bucket.day, bucket.reviews]));
    return heatmapGrid(counts, history.today, history.days.length);
  }, [history]);

  const streak = useMemo(
    () =>
      streaks(
        history.days.filter(bucket => bucket.reviews > 0).map(bucket => bucket.day),
        history.today,
      ),
    [history],
  );

  if (history.total === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No reviews in this notebook yet. Practise a deck and the year fills in
        from the right.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-snug">
      <div className="flex flex-wrap gap-x-gutter gap-y-hairline text-sm">
        <Figure label="Reviews" value={String(history.total)} />
        <Figure label="Active days" value={String(grid.activeDays)} />
        <Figure label="Current streak" value={plural(streak.current, 'day')} />
        <Figure label="Longest streak" value={plural(streak.longest, 'day')} />
      </div>

      {/*
        Horizontally scrollable in its own container. A year of columns is wider
        than a phone, and the page body must never scroll sideways.
      */}
      <div className="overflow-x-auto pb-hairline">
        <div className="flex gap-hairline" role="img" aria-label={summaryLabel(history)}>
          {grid.columns.map((column, index) => (
            <div key={index} className="flex flex-col gap-hairline">
              {column.map((cell, row) => (
                <div
                  key={row}
                  className="size-2.5 rounded-[2px]"
                  style={{
                    backgroundColor:
                      cell.day === null ? 'transparent' : LEVEL_COLOR[cell.level],
                  }}
                  // The whole grid carries one label above; per-cell titles are
                  // the hover detail and deliberately not in the a11y tree
                  // twice, which would read 365 cells one at a time.
                  title={
                    cell.day === null
                      ? undefined
                      : `${cell.day}: ${plural(cell.count, 'review')}`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Busiest day {plural(grid.busiest, 'review')}. Shading is relative to your
        own history, so the scale means the same thing at fifteen reviews a day
        as at three hundred.
      </p>
    </div>
  );
}

/**
 * Level 0 is the empty cell and must still read as a cell, so it is the muted
 * field rather than the page background. Levels 1–4 walk the "good" ramp's
 * **mark** token — this is a painted square, not ink on paper (FR1's drift row:
 * choosing the field ramp here renders an invisible 1.21:1 tile).
 */
const LEVEL_COLOR: Record<HeatmapLevel, string> = {
  0: 'var(--color-muted)',
  1: 'color-mix(in oklab, var(--color-grade-good-mark) 30%, var(--color-muted))',
  2: 'color-mix(in oklab, var(--color-grade-good-mark) 55%, var(--color-muted))',
  3: 'color-mix(in oklab, var(--color-grade-good-mark) 78%, var(--color-muted))',
  4: 'var(--color-grade-good-mark)',
};

function summaryLabel(history: ReviewHistory): string {
  return `Review heatmap: ${plural(history.total, 'review')} over the last ${plural(history.days.length, 'day')}, ending ${history.today}.`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted-foreground">{label} </span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}
