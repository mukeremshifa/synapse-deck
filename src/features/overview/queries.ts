import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { notebookKeys } from '@/features/notebook/queries';

/**
 * The overview's reads — **the last screen onto the contract.**
 *
 * With these, `@/lib/api` serves every surface in the app and the two-stack
 * seam FR2 opened is closed. `src/lib/queries.ts` dies with `useProfile`, which
 * this module re-points below.
 *
 * ── Five calls, not one ───────────────────────────────────────────────────
 *
 * An overview wants everything at once, and that is precisely the pressure
 * FR0 §3(1) exists to resist: a fake that served this page as one magic call
 * would hand FR7 an endpoint nobody can build. So the page makes the calls a
 * real client would — the notebook, its sources, its artifacts, and the
 * aggregates it needs — and they are separate because they are separately
 * cacheable, separately invalidated and separately expensive.
 *
 * Every one of them is notebook-scoped. There is no cross-notebook read on
 * this screen, which is what makes it honest where the old dashboard was not.
 *
 * ── Keys live in `notebookKeys` ───────────────────────────────────────────
 *
 * Not in a key factory of this module's own. These are answers about a
 * notebook, and FR4's job watcher already invalidates by that prefix when a
 * generation finishes — so the overview refreshes itself and does not add the
 * third polling mechanism that drift row warns against.
 */

/** How much history the heatmap asks for. A year, as `progress.ts` renders. */
export const HISTORY_DAYS = 365;

/**
 * How far ahead the forecast looks.
 *
 * Fourteen rather than a month: beyond a fortnight a forecast is dominated by
 * cards whose intervals will have been rescheduled several times before the day
 * arrives, so the later bars describe a schedule that will not happen.
 */
export const FORECAST_DAYS = 14;

/** The retention window. Ninety days is what `RetentionSummary` was sized for. */
export const RETENTION_DAYS = 90;

/**
 * Review counts per study day, for the heatmap.
 *
 * **Already bucketed by the server**, which is the whole point: a serious
 * user's year is tens of thousands of review rows and this returns at most 365.
 * The day boundary depends on the user's timezone, so the server applies it
 * from the profile rather than trusting a zone from here.
 */
export function useReviewHistory(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.aggregate(notebookId, `history:${String(HISTORY_DAYS)}`),
    queryFn: () => api.getReviewHistory(notebookId, HISTORY_DAYS),
  });
}

/** What the next fortnight costs, in due cards and today's new allowance. */
export function useDueForecast(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.aggregate(notebookId, `forecast:${String(FORECAST_DAYS)}`),
    queryFn: () => api.getDueForecast(notebookId, FORECAST_DAYS),
  });
}

/** The card-state mix, and the mean stability and difficulty behind it. */
export function useCardStates(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.aggregate(notebookId, 'card-states'),
    queryFn: () => api.getCardStates(notebookId),
  });
}

/** How often a card was recalled when it came up, over 90 days. */
export function useRetention(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.aggregate(notebookId, `retention:${String(RETENTION_DAYS)}`),
    queryFn: () => api.getRetention(notebookId, RETENTION_DAYS),
  });
}

/**
 * Topic mastery — the diagnostic's data, and FR6's one contract addition.
 *
 * Aggregated server-side because the retention half needs every active card in
 * the notebook grouped by topic, and cards are listable only one deck at a
 * time. See `TopicMasteryReport` in `contract.ts` for the full argument.
 */
export function useTopicMastery(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.aggregate(notebookId, 'topic-mastery'),
    queryFn: () => api.getTopicMastery(notebookId),
  });
}
