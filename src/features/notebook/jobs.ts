import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, JOB_STAGES, type Job, type JobStage } from '@/lib/api';
import { homeKeys } from '@/features/home/queries';
import { notebookKeys } from './queries';

/**
 * In-flight generation, and how it survives you navigating away. **FR4 §6.1.**
 *
 * ═══ The decision ════════════════════════════════════════════════════════
 *
 * > **The server is the record of what is running. `listJobs` is the query, and
 * > React Query's cache is the only client-side state.**
 *
 * The plan asks how progress survives navigation and names three options —
 * query cache, a provider, or polling on return. It is the query cache, and the
 * argument against the other two is the same argument:
 *
 * 1. **A provider holding in-flight job ids is a second source of truth**, and
 *    it is the one that is wrong after a reload. A user who starts a two-minute
 *    generation and closes the tab has a job running on a server; a provider
 *    that lost its `useState` says nothing is running. The contract already
 *    anticipated this — `listJobs` is documented as "in-flight and recently
 *    finished jobs, **so a reload can rejoin one**". Building a provider means
 *    ignoring the method written for the purpose.
 * 2. **"Polling on return" is what this is**, done in the one place that
 *    already knows how: a query that polls while anything is running and stops
 *    when nothing is. The difference the cache makes is that returning to the
 *    notebook renders the job immediately and corrects it a moment later,
 *    rather than showing nothing until the first fetch lands.
 *
 * The consequence worth stating plainly, because it is a real limit: **progress
 * is visible on the notebook the job belongs to, not globally.** Jobs are
 * notebook-scoped in the contract — `listJobs(notebookId)` — so a user watching
 * notebook A is not shown a toast about notebook B's deck finishing. Doing that
 * needs a cross-notebook job feed, which the contract deliberately does not
 * have (FR0's rule: `getGlobalSummary` is the *one* cross-notebook method, and
 * nothing on it may become a CTA). Recorded rather than worked around.
 *
 * ── Why polling at all ───────────────────────────────────────────────────
 *
 * The fake computes a job's state from wall-clock time when asked, precisely
 * because that is how the real API behaves: a client polls, a server reports
 * where it got to. Nothing is pushed. FR7 may add SSE; until it does, a poll is
 * not a shortcut, it is the transport.
 */

/** Terminal jobs never change again. The whole basis of when to stop asking. */
export function isTerminal(job: Job): boolean {
  return job.status === 'succeeded' || job.status === 'failed';
}

/**
 * Every job this notebook knows about, polled while any is running.
 *
 * **One query for every job, not one per job.** Five generations in flight is
 * one request per interval, and the list is what a surface showing several at
 * once needs anyway. Per-job `getJob` queries would be five polls to render one
 * panel, and each would have to be created and torn down as jobs start and
 * finish — bookkeeping this avoids entirely.
 */
export function useJobs(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.jobs(notebookId),
    queryFn: () => api.listJobs(notebookId),
    /*
     * A fixed interval, not the backoff the old `useJobProgress` used.
     *
     * That hook backed off from 1s to 8s because it polled one job for the
     * whole of a long ingest. This polls a *list*, and the list's contents
     * change as jobs start: a user who begins a second generation while the
     * first is grinding would wait up to eight seconds to see it appear. A
     * steady 1.5s costs a request only while something is actually running, and
     * stops dead when nothing is — which is the property that matters for cost,
     * not the interval's shape.
     */
    refetchInterval: query =>
      (query.state.data ?? []).some(job => !isTerminal(job)) ? 1500 : false,
    /*
     * Keep polling in a background tab. A user who starts a generation and
     * switches away comes back to a finished artifact rather than to a panel
     * that froze the moment the tab lost focus.
     */
    refetchIntervalInBackground: true,
  });
}

/** Jobs still running, newest first — what a progress surface renders. */
export function runningJobs(jobs: Job[] | undefined): Job[] {
  return (jobs ?? [])
    .filter(job => !isTerminal(job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * How far through a job is, as a percentage — **or `null` when it is not known**.
 *
 * The null is the whole point, and FR0's drift log is explicit about it: a job
 * can fail, or simply not have started, with `unitsTotal` still 0. Returning 0
 * there would draw an empty determinate bar and claim the size of the work is
 * known; null draws a breathing indeterminate one and claims only that we are
 * working. `GeneratingState` and `Progress` both take `number | null` for this
 * reason — passing 0 typechecks and lies.
 *
 * Note what this deliberately does **not** do: interpolate between stages. A
 * percentage derived from which stage we are in is a number computed from a
 * label, and it moves whether or not any work happened. Only `unitsCompleted`
 * against `unitsTotal` is a real measurement, so it is the only thing measured.
 */
export function jobPercent(job: Job): number | null {
  if (job.unitsTotal <= 0) return null;
  return Math.min(100, (job.unitsCompleted / job.unitsTotal) * 100);
}

/**
 * Invalidate everything a finished job could have changed.
 *
 * A job that succeeds writes an artifact and its contents and moves the
 * notebook's roll-up counts; one that adds a source changes the source list.
 * Rather than work out which, all three are refetched — they are cheap, and
 * missing one leaves a stale screen.
 *
 * **Deliberately not `notebookKeys.all`.** That key is a prefix of the jobs key,
 * so invalidating it would refetch the very query that observed the completion —
 * an extra round trip per finished job, for an answer already in hand. The three
 * named here are exactly the ones a job can change.
 */
export async function invalidateForFinishedJob(
  queryClient: QueryClient,
  notebookId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) }),
    queryClient.invalidateQueries({ queryKey: notebookKeys.sources(notebookId) }),
    queryClient.invalidateQueries({ queryKey: notebookKeys.artifacts(notebookId) }),
    /*
     * FR6's overview reads five aggregates over this notebook's cards and
     * attempts, and a finished generation changes all of them — a new deck
     * moves the forecast, the card-state mix and every topic's mastery. One
     * prefix invalidation covers them; the overview does not poll.
     */
    queryClient.invalidateQueries({ queryKey: notebookKeys.aggregates(notebookId) }),
    // Home shows the same roll-up. A notebook card still claiming the old
    // count after a deck lands is the drift computed readiness exists to stop.
    queryClient.invalidateQueries({ queryKey: homeKeys.notebooks }),
  ]);
}

/**
 * A stage as a sentence, in the second person.
 *
 * **Every one of these maps onto a stage the contract's `JobStage` defines**,
 * which in turn maps onto a field the job reports. That is the discipline
 * carried forward from `PipelineStages` and stated in the contract itself:
 *
 * > Do not add a stage the pipeline could not report.
 *
 * It would read better with "Identifying topics" between splitting and
 * generating. There is no field behind it, so it would be a label on a timer —
 * a progress bar that lies slowly. When the pipeline grows a step it grows a
 * field, the field gets a `JobStage`, and the sentence follows.
 */
export function stageSentence(job: Job): string {
  if (job.status === 'failed') return 'Generation failed';
  switch (job.stage) {
    case 'queued':
      return job.kind === 'add-source' ? 'Queued for processing' : 'Queued';
    case 'extracting':
      return 'Reading your sources';
    case 'splitting':
      return 'Splitting into sections';
    case 'generating':
      return job.kind === 'add-source' ? 'Indexing the text' : 'Writing with the model';
    case 'saving':
      return 'Saving';
    case 'done':
      return job.status === 'succeeded' ? 'Done' : 'Finished';
  }
}

/** Where a stage sits in the run, for a list that marks what is behind and ahead. */
export type StageState = 'waiting' | 'active' | 'done' | 'failed';

/**
 * The stage list for one job.
 *
 * A failure marks **the stage that was running**, not every stage — reddening
 * the whole list implies the earlier work never happened, and it did. That is
 * `PipelineStages`' rule and it survives the rewrite unchanged.
 *
 * `done` is omitted from the list: it is the absence of a running stage rather
 * than a step, and a permanent grey "Done" row under a finished job is noise.
 */
export function stageStates(job: Job): { stage: JobStage; state: StageState }[] {
  const order: JobStage[] = JOB_STAGES.filter(stage => stage !== 'done');
  // `indexOf` on the narrowed list: a job at `done` is not in it, which is
  // exactly what `finished` below tests for, so -1 is a meaningful answer.
  const currentIndex = order.indexOf(job.stage);
  const finished = job.status === 'succeeded' || job.stage === 'done';

  return order.map((stage, index) => {
    if (finished) return { stage, state: 'done' };
    /*
     * A job that failed before any stage reported has `stage: 'queued'`, so the
     * failure lands on "Queued" — which is the honest rendering, because
     * nothing after it ran. That is the case FR0's drift row names, and it is
     * why the failure is pinned to `currentIndex` rather than to "the first
     * incomplete stage".
     */
    if (job.status === 'failed') {
      if (index === currentIndex) return { stage, state: 'failed' };
      return { stage, state: index < currentIndex ? 'done' : 'waiting' };
    }
    if (index < currentIndex) return { stage, state: 'done' };
    if (index === currentIndex) return { stage, state: 'active' };
    return { stage, state: 'waiting' };
  });
}

/** The label for a stage in the list. Short, because the sentence is elsewhere. */
export const STAGE_LABELS: Record<JobStage, string> = {
  queued: 'Queued',
  extracting: 'Reading sources',
  splitting: 'Splitting into sections',
  generating: 'Generating',
  saving: 'Saving',
  done: 'Done',
};

/**
 * What the units counter reads as, or null while the total is unknown.
 *
 * Split out because two surfaces show it and the "unknown" case is the one that
 * renders as `0/0` if each writes its own.
 */
export function unitsLabel(job: Job): string | null {
  if (job.unitsTotal <= 0) return null;
  return `${String(job.unitsCompleted)} of ${String(job.unitsTotal)} sections`;
}

/**
 * This notebook's jobs, plus the one side effect a poll must have: **when a job
 * finishes, everything it touched is refetched.**
 *
 * ── Why the transition is detected here rather than in the query ─────────
 *
 * `listJobs` returning a succeeded job does not, by itself, update the artifact
 * list — those are different queries. Something has to notice the moment a job
 * crosses into terminal and invalidate. Doing it on *every* poll would refetch
 * the notebook every 1.5 seconds; doing it on a `useEffect` over the ids that
 * have newly finished does it once each.
 *
 * The ref holds ids already accounted for, so a job that stays terminal in the
 * list (the contract says recently finished ones are returned) is not
 * re-invalidated on every subsequent poll.
 */
export function useNotebookJobs(notebookId: string) {
  const query = useJobs(notebookId);
  const queryClient = useQueryClient();
  const settled = useRef<Set<string>>(new Set());

  // A different notebook is a different set of jobs; carrying the ids over
  // would suppress the first invalidation on the notebook just opened.
  useEffect(() => {
    settled.current = new Set();
  }, [notebookId]);

  const jobs = query.data;
  useEffect(() => {
    if (!jobs) return;
    const newlyFinished = jobs.filter(
      job => isTerminal(job) && !settled.current.has(job.id),
    );
    if (newlyFinished.length === 0) return;
    for (const job of newlyFinished) settled.current.add(job.id);
    void invalidateForFinishedJob(queryClient, notebookId);
  }, [jobs, queryClient, notebookId]);

  return query;
}
