import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Home's reads — **the first consumer of the FR0 contract.**
 *
 * ── Why this is not in `src/lib/queries.ts` ───────────────────────────────
 *
 * That file is the *old* stack: TanStack hooks over `api-client.ts`, shaped
 * around decks, serving every screen the app has today. FR0 built the contract
 * and the fake beside it without re-pointing a single consumer, so at the start
 * of FR2 nothing imported `@/lib/api` at all.
 *
 * Home is the first screen to, and it cannot use the old stack: criterion 4
 * wants readiness from the contract's roll-up (brief §1.3), and `queries.ts`
 * has no such concept — it has card counts, which is the signal the
 * re-architecture exists to replace.
 *
 * Putting these hooks beside the screen rather than into `queries.ts` keeps the
 * two stacks legible as two, which is the same argument `queries.ts` itself
 * makes about the two backends it spans: hiding a transitional split behind a
 * common wrapper is how it quietly becomes permanent. **`queries.ts` dies when
 * FR3, FR5 and FR6 have re-pointed their screens** — not before, and not by
 * being extended here in the meantime.
 *
 * ── Keys ─────────────────────────────────────────────────────────────────
 *
 * Namespaced under `['api']` so they cannot collide with the old stack's keys
 * while both exist. An invalidation of one is not an invalidation of the other,
 * which during FR2–FR6 is the correct behaviour: they are different caches of
 * different shapes over different backends.
 */
export const homeKeys = {
  notebooks: ['api', 'notebooks'] as const,
  globalSummary: ['api', 'global-summary'] as const,
};

/**
 * Every notebook, for the home grid.
 *
 * **Reads `.items`** — the contract is paginated (FR0's drift row), and a
 * screen written against an array would compile today and silently truncate
 * the day a second page exists. Home does not page yet: the first page is the
 * grid, and pagination is a real screen decision that belongs with a real
 * scroll, not a speculative "Load more" nobody has seen.
 */
export function useNotebooks() {
  return useQuery({
    queryKey: homeKeys.notebooks,
    queryFn: () => api.listNotebooks(),
    select: page => page.items,
  });
}

/**
 * The global strip: due now, new, reviewed today, streak.
 *
 * **Nothing derived from this may become a CTA** — the contract's own doc
 * comment on `GlobalSummary` says so and FR0 put it in the drift log. A button
 * hung off `dueNow` would have to choose a notebook, and choosing one is the
 * `focus` guess this phase deletes. It is a fact about the user, not a claim
 * about a notebook.
 *
 * In `live` mode `streakDays` is 0: the AWS `/summary` route has no streak and
 * adding one is FR7's work.
 */
export function useGlobalSummary() {
  return useQuery({
    queryKey: homeKeys.globalSummary,
    queryFn: () => api.getGlobalSummary(),
  });
}
