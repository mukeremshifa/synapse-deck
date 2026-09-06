/**
 * Polling a generation job. What replaces the SSE stream on the client.
 * P10 task 5.
 *
 * ── Why the interval backs off ────────────────────────────────────────────
 *
 * A job takes tens of seconds. Polling every 500 ms for the whole of it is
 * dozens of requests that mostly return the same thing — a cost and a rate
 * limit for no extra information.
 *
 * But the *first* few seconds are where the interesting transitions happen
 * (pending → running, the first chunks landing), and that is also when the user
 * is watching most closely. So the interval starts short and grows: responsive
 * when something is changing, cheap once the job has settled into a long grind.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CardPayload } from '@/lib/schemas';

export interface JobProgress {
  jobId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  deckId: string | null;
  chunkCount: number;
  chunksCompleted: number;
  /** Null when the chunk records were not read — not zero. See the API's `summarise`. */
  chunksSucceeded: number | null;
  chunksFailed: number | null;
  truncated: boolean;
  error: string | null;
  cards: CardPayload[];
  /** Which providers wrote these cards. Contains `"stub"` for placeholder content. */
  providers: string[];
}

const FIRST_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 8000;
const BACKOFF_RATE = 1.5;

/** A job in one of these states will not change again; stop asking. */
function isTerminal(status: JobProgress['status'] | undefined): boolean {
  return status === 'succeeded' || status === 'failed';
}

export function useJobProgress(jobId: string | undefined) {
  // Held in a ref rather than state: changing it must not itself trigger a
  // render, or every poll would re-render the page twice.
  const intervalRef = useRef(FIRST_INTERVAL_MS);
  const [, force] = useState(0);

  // A new job restarts the backoff. Without this, starting a second generation
  // in the same session would begin polling at the 8-second ceiling the
  // previous job had backed off to.
  useEffect(() => {
    intervalRef.current = FIRST_INTERVAL_MS;
    force((n) => n + 1);
  }, [jobId]);

  const query = useQuery({
    queryKey: ['job', jobId],
    enabled: Boolean(jobId),
    queryFn: () => api.get<JobProgress>(`/jobs/${jobId!}`),
    // Always refetched: a job's whole purpose is that it changes.
    staleTime: 0,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (isTerminal(status)) return false;
      const next = intervalRef.current;
      intervalRef.current = Math.min(next * BACKOFF_RATE, MAX_INTERVAL_MS);
      return next;
    },
    // A single failed poll is not a failed job -- a dropped request mid-flight
    // is ordinary. Retry a few times before surfacing an error.
    retry: 3,
  });

  const data = query.data;

  return {
    job: data,
    isLoading: query.isLoading,
    error: query.error,
    /** True once the job will not change again, whether it worked or not. */
    isFinished: isTerminal(data?.status),
    /**
     * 0-100. Derived rather than reported, because the server knows chunk
     * counts and the client is the one that has to render a bar.
     *
     * Guarded against `chunkCount === 0`, which is the real state between a job
     * being created and the splitter finishing -- without the guard that window
     * renders as NaN%.
     */
    percent:
      data === undefined || data.chunkCount === 0
        ? 0
        : Math.round((data.chunksCompleted / data.chunkCount) * 100),
  };
}


/**
 * The job that produced a given deck, for the review gate. P10 task 6.
 *
 * The gate knows a deck id and needs to say what did *not* make it in. A deck
 * cannot carry that: the sections that failed left no rows behind, so the only
 * record of the gap is the job.
 *
 * Returns `null` — not an error — for a deck with no job, which is the ordinary
 * case for every hand-made deck.
 */
export function useDeckJob(deckId: string | undefined) {
  return useQuery({
    queryKey: ['job', 'deck', deckId],
    enabled: Boolean(deckId),
    queryFn: () => api.get<JobProgress | null>(`/jobs?deckId=${encodeURIComponent(deckId!)}`),
    // A finished job does not change. This is read once when the gate opens
    // rather than polled.
    staleTime: 60_000,
  });
}
