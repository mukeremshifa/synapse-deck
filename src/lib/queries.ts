import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from './api-client';
import { supabase } from './supabase';
import { CardPayload, DeckInput, Grade, ProfileSettings, type CardKind } from './schemas';
import { applyGrade, type SchedulePreview } from './fsrs';
import {
  GENERATION_QUOTA,
  monthWindow,
  quotaCountFilter,
  remainingGenerations,
} from './quota';
import {
  addStudyDays,
  detectTimeZone,
  resolveTimeZone,
  startOfStudyDay,
  studyDayKey,
  studyDayStart,
} from './day';
import { buildQueue, remainingNewAllowance } from './queue';
import {
  countable,
  forecast,
  HEATMAP_DAYS,
  memoryStrength,
  stateDistribution,
  type CountedReviews,
  type ForecastDay,
  type MemoryStrength,
  type StateDistribution,
} from './progress';
import type { Database } from '@/types/database';

/**
 * Every read and write the app performs, as TanStack Query hooks.
 *
 * ── Two backends, for one phase ───────────────────────────────────────────
 *
 * P9 moved decks, cards, reviews, the practice queue and the profile onto the
 * AWS API (`api-client.ts` → API Gateway → Lambda → RDS). `/progress` and card
 * generation still read Supabase directly, because Phase B rewrites generation
 * anyway and porting the progress aggregate is work Phase F has to do — doing
 * either now would mean building it twice. See the split table in
 * docs/plans/P9-aws-slice.md.
 *
 * Both are visible in this file on purpose: which hook talks to which backend
 * is a fact worth being able to read, and hiding it behind a common wrapper is
 * how a two-backend phase quietly becomes permanent.
 *
 * ── What did not change, deliberately ─────────────────────────────────────
 *
 * **The hooks' signatures and `queryKeys` are untouched.** That is what kept
 * this from becoming a frontend rewrite: not one component changed. What
 * changed is the body of each hook — `supabase.from(…)` became an `api` call.
 *
 * Two rules still hold throughout:
 *   - Validate with the shared Zod schemas *before* the network call, so bad
 *     data fails locally with a field-level message instead of as a 400. The
 *     server validates too, with the same schemas; that is not duplication,
 *     because the client is not a security boundary.
 *   - **Never send a user id.** It comes from the verified token, server-side.
 *     `currentUserId()` used to live here and was deleted rather than ported:
 *     its doc comment promised "RLS will not accept any other", a guarantee
 *     that no longer exists, and a function that looks like it scopes queries
 *     is worse than none (ADR 0008).
 */

export type CardRow = Database['public']['Tables']['cards']['Row'];
export type DeckRow = Database['public']['Tables']['decks']['Row'];
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/** Query keys, as SPEC §8.3. Deck-scoped data nests under `['deck', id]` so one
 *  invalidation covers the deck and its cards. */
export const queryKeys = {
  decks: ['decks'] as const,
  deck: (deckId: string) => ['deck', deckId] as const,
  deckCards: (deckId: string) => ['deck', deckId, 'cards'] as const,
  queue: (deckId?: string) => ['queue', deckId ?? 'all'] as const,
  profile: ['profile'] as const,
  /** Drafts waiting at the review gate, and only those. */
  deckDrafts: (deckId: string) => ['deck', deckId, 'drafts'] as const,
  quota: ['quota'] as const,
  /** Everything /progress reads, so one `['stats']` invalidation covers it. */
  statsHistory: (days: number) => ['stats', 'history', days] as const,
  statsForecast: (days: number) => ['stats', 'forecast', days] as const,
  statsRetention: (days: number) => ['stats', 'retention', days] as const,
  statsCards: ['stats', 'cards'] as const,
};

/**
 * Error codes raised by services/api/migrations/0002_review_card.sql, passed
 * through by the API rather than translated.
 *
 * A stale rating is an expected outcome, not a crash: it means the card was
 * already rated somewhere else. The codes are unchanged from the Supabase
 * originals — what changed is that `services/api/src/lib/http.ts` now maps them
 * to status codes explicitly, where PostgREST used to do it automatically.
 */
export const RPC_ERROR = {
  staleCard: 'PT409',
  notFound: 'PT404',
} as const;

export function isStaleCardError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === RPC_ERROR.staleCard;
}

/**
 * How many due cards one queue fetch pulls. A session is not a spreadsheet;
 * beyond a few hundred cards the number stops being actionable, and the next
 * fetch picks up whatever is left. Reviews are never *dropped* by this — they
 * are still due, and still first in line.
 *
 * The server applies the same limit (`QUEUE_FETCH_LIMIT` in the reviews
 * handler); this copy is what the client reasons about, not what enforces it.
 */
export const QUEUE_FETCH_LIMIT = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PostgrestResult<T> = { data: T | null; error: { message: string } | null };

/** Throw supabase-js errors so TanStack Query sees a rejected promise. */
function unwrap<T>(result: PostgrestResult<T>): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error('The server returned no row.');
  return result.data;
}

/**
 * A card's content, validated.
 *
 * Card payloads are untrusted (§10): generated by an LLM in P2, and stored as
 * free-form jsonb. Anything that fails the schema is surfaced as a broken card
 * the user can edit or delete, never rendered on a guess.
 */
export function parseCardPayload(row: Pick<CardRow, 'payload'>): CardPayload | null {
  const parsed = CardPayload.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    // The API creates the row on first authenticated request — there is no
    // `handle_new_user` trigger any more, because `auth.users` does not exist
    // in RDS. So this never returns null for a signed-in user, where the
    // Supabase version could. The type keeps `| null` so no component changes.
    // `tz` seeds the row's timezone the first time it is created, and is
    // ignored on every later request. The Supabase signup screen used to pass
    // this through user metadata into the `handle_new_user` trigger; there is
    // no trigger any more, so without it every new account would start on UTC
    // and quietly get the wrong day boundary (SPEC §6).
    queryFn: (): Promise<ProfileRow | null> =>
      api.get<ProfileRow>(`/profile?tz=${encodeURIComponent(detectTimeZone())}`),
    // The timezone here decides every day boundary; a stale copy shifts the
    // new-card cap. Cheap row, so just keep it fresh.
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileSettings) =>
      api.patch<ProfileRow>('/profile', ProfileSettings.parse(input)),
    onSuccess: profile => {
      queryClient.setQueryData(queryKeys.profile, profile);
      // The day boundary and the cap both moved; every queue is now suspect.
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export type DeckWithCounts = DeckRow & {
  cardCount: number;
  dueCount: number;
  newCount: number;
};

/**
 * Decks with their card, due and new counts.
 *
 * The counts are now computed in Postgres and arrive with the decks. The
 * Supabase version fetched every card and bucketed them here, because counting
 * per deck would otherwise have been three more round trips — a shape that only
 * made sense while the client *was* the API. One request either way; far less
 * crossing the wire.
 */
export function useDecks() {
  return useQuery({
    queryKey: queryKeys.decks,
    queryFn: () => api.get<DeckWithCounts[]>('/decks'),
  });
}

export function useDeck(deckId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deck(deckId ?? ''),
    enabled: Boolean(deckId),
    queryFn: () => api.get<DeckRow>(`/decks/${deckId!}`),
  });
}

export function useCreateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeckInput) => api.post<DeckRow>('/decks', DeckInput.parse(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
  });
}

export function useUpdateDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, ...input }: DeckInput & { deckId: string }) =>
      api.patch<DeckRow>(`/decks/${deckId}`, DeckInput.parse(input)),
    onSuccess: deck => {
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    // Cards cascade with the deck (§5.3 references ... on delete cascade), so
    // this is genuinely destructive — the caller must confirm first (§10).
    mutationFn: async (deckId: string) => {
      await api.delete<{ id: string }>(`/decks/${deckId}`);
      return deckId;
    },
    onSuccess: deckId => {
      queryClient.removeQueries({ queryKey: queryKeys.deck(deckId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function useCards(deckId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deckCards(deckId ?? ''),
    enabled: Boolean(deckId),
    queryFn: () => api.get<CardRow[]>(`/decks/${deckId!}/cards`),
  });
}

export type CreateCardInput = {
  deckId: string;
  payload: CardPayload;
  sourceExcerpt?: string | null;
};

export function useCreateCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ deckId, payload, sourceExcerpt }: CreateCardInput) => {
      const content = CardPayload.parse(payload);
      // The server assigns fresh-card scheduling; a manually added card enters
      // the `new` queue (SPEC §4.1 step 6). The client no longer sends it,
      // which is one fewer thing a request body can lie about.
      const cards = await api.post<CardRow[]>(`/decks/${deckId}/cards`, {
        payloads: [content],
        sourceExcerpt: sourceExcerpt ?? null,
      });
      const card = cards[0];
      if (!card) throw new Error('The server returned no card.');
      return card;
    },
    onSuccess: card => invalidateCardCaches(queryClient, card.deck_id),
  });
}

/** Create several cards at once — what a multi-group cloze paste turns into. */
export function useCreateCards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      payloads,
      sourceExcerpt,
    }: {
      deckId: string;
      payloads: CardPayload[];
      sourceExcerpt?: string | null;
    }) =>
      api.post<CardRow[]>(`/decks/${deckId}/cards`, {
        payloads: payloads.map(payload => CardPayload.parse(payload)),
        sourceExcerpt: sourceExcerpt ?? null,
      }),
    onSuccess: (_cards, variables) => invalidateCardCaches(queryClient, variables.deckId),
  });
}

export function useUpdateCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardId,
      deckId: _deckId,
      payload,
    }: {
      cardId: string;
      deckId: string;
      payload: CardPayload;
    }) =>
      // Content only. Editing a card must never disturb its schedule — that is
      // the point of keeping content and scheduling in separate columns (§5.3).
      api.patch<CardRow>(`/cards/${cardId}`, CardPayload.parse(payload)),
    onSuccess: card => invalidateCardCaches(queryClient, card.deck_id),
  });
}

/** Suspend or restore a card: out of the queue without losing its history. */
export function useSetCardStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardIds,
      status,
      deckId: _deckId,
    }: {
      cardIds: string[];
      status: 'active' | 'suspended';
      deckId: string;
    }) => api.post<{ ids: string[] }>('/cards/status', { cardIds, status }),
    onSuccess: (_rows, variables) => invalidateCardCaches(queryClient, variables.deckId),
  });
}

export function useDeleteCards() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardIds, deckId: _deckId }: { cardIds: string[]; deckId: string }) =>
      api.post<{ ids: string[] }>('/cards/delete', { cardIds }),
    onSuccess: (_rows, variables) => invalidateCardCaches(queryClient, variables.deckId),
  });
}

function invalidateCardCaches(queryClient: QueryClient, deckId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
  void queryClient.invalidateQueries({ queryKey: ['queue'] });
}

// ---------------------------------------------------------------------------
// Practice queue
// ---------------------------------------------------------------------------

export type PracticeQueue = {
  cards: CardRow[];
  /** Cards not in this session because the daily cap is used up. */
  heldBackNew: number;
  newAllowanceLeft: number;
  /** Soonest due time among cards that are not due yet — the empty state. */
  nextDueAt: string | null;
  fetchedAt: string;
};

/** What `GET /queue` returns: the reads, not the policy. */
type QueueResponse = {
  due: CardRow[];
  fresh: CardRow[];
  introducedToday: number;
  nextDueAt: string | null;
  dailyNewLimit: number;
  fetchedAt: string;
};

/**
 * The session's queue, assembled once.
 *
 * The four reads that used to be four parallel supabase-js calls are now one
 * request — which on a VPC Lambda is most of the latency budget.
 *
 * **`buildQueue` still runs here, not on the server**, and that is deliberate:
 * the same §6 policy drives this queue, the dashboard's "new available" figure
 * and the forecast's day 0, so a second implementation server-side is how those
 * three start disagreeing about what today's allowance is. The server fetches;
 * the client decides.
 *
 * It no longer waits for `useProfile`: the server reads the profile itself, so
 * the timezone that decides where "today" starts is applied where the counting
 * happens rather than guessed here.
 */
export function usePracticeQueue(deckId?: string) {
  return useQuery({
    queryKey: queryKeys.queue(deckId),
    // A queue is a snapshot of a session. Refetching under the user mid-session
    // reorders the cards they are looking at.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<PracticeQueue> => {
      const response = await api.get<QueueResponse>(
        deckId ? `/queue?deckId=${encodeURIComponent(deckId)}` : '/queue',
      );

      const allowance = remainingNewAllowance(
        response.dailyNewLimit,
        response.introducedToday,
      );

      return {
        cards: buildQueue({
          due: response.due,
          fresh: response.fresh,
          dailyNewLimit: response.dailyNewLimit,
          introducedToday: response.introducedToday,
        }),
        heldBackNew: Math.max(0, response.fresh.length - allowance),
        newAllowanceLeft: allowance,
        nextDueAt: response.nextDueAt,
        fetchedAt: response.fetchedAt,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Rating and undo
// ---------------------------------------------------------------------------

export type ReviewCardInput = {
  card: CardRow;
  grade: Grade;
  durationMs?: number | null;
  /** The preview the user was shown, so the committed interval is that one. */
  preview?: SchedulePreview;
  deckId?: string;
};

/**
 * Rate a card.
 *
 * Optimistic by design (SPEC §8.3): the caller advances to the next card the
 * moment the button is pressed and this mutation catches up behind it. Practice
 * that waits a round trip per card is practice nobody does. On failure the
 * caller rolls back and toasts — and one failure in particular is expected
 * rather than exceptional, `isStaleCardError`, which means another tab already
 * rated this card.
 *
 * `applyGrade` still runs on the client and the result is sent as `next`. The
 * database validates the shape key by key and rejects anything else, which is
 * the same arrangement the Supabase RPC had — the difference is that
 * `review_card` now also filters every statement by the caller's id, because
 * RLS is no longer behind it (ADR 0008).
 */
export function useReviewCard() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  return useMutation({
    mutationFn: async ({ card, grade, durationMs, preview }: ReviewCardInput) => {
      const { next } = applyGrade(card, grade, new Date(), {
        durationMs: durationMs ?? null,
        preview,
        params: (profile?.fsrs_params as Record<string, never> | null) ?? null,
      });

      return api.post<CardRow>('/reviews', {
        cardId: card.id,
        rating: grade,
        // Null is a real value here — the card may have been rated before any
        // timer started, and `reviews.duration_ms` is nullable for exactly that.
        durationMs: durationMs ?? null,
        // The optimistic-concurrency token, sent back byte for byte. The API
        // hands timestamps through as the strings Postgres produced rather than
        // as Date objects, so a re-formatted value can never fail to match.
        expectedUpdatedAt: card.updated_at,
        next,
      });
    },

    onMutate: async ({ card, deckId }) => {
      const key = queryKeys.queue(deckId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PracticeQueue>(key);
      // Drop the card from the cached queue so a remount does not re-serve it.
      if (previous) {
        queryClient.setQueryData<PracticeQueue>(key, {
          ...previous,
          cards: previous.cards.filter(queued => queued.id !== card.id),
        });
      }
      return { previous, key };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },

    onSuccess: card => {
      // Deliberately not invalidating the active queue: refetching mid-session
      // would reshuffle the cards the user is part-way through.
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckCards(card.deck_id) });
      // Every /progress figure is derived from the row this just wrote.
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

/**
 * Undo the last rating on a card (SPEC §4.2).
 *
 * Not optimistic: undo is the recovery path, and a recovery path that lies about
 * having worked is worse than one that takes 200ms.
 */
export function useUndoLastReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId }: { cardId: string; deckId?: string }) =>
      api.post<CardRow>('/reviews/undo', { cardId }),
    onSuccess: card => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckCards(card.deck_id) });
      // The tombstoned rating drops out of every metric; today's heatmap cell
      // has to go down by one straight away or undo looks like it did nothing.
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type DueSummary = {
  dueNow: number;
  newAvailable: number;
  reviewedToday: number;
  nextDueAt: string | null;
};

type DueSummaryResponse = DueSummary & { dailyNewLimit: number };

/** The handful of numbers the dashboard shows. P3 owns anything more. */
export function useDueSummary() {
  return useQuery({
    queryKey: ['queue', 'summary'],
    queryFn: async (): Promise<DueSummary> => {
      const response = await api.get<DueSummaryResponse>('/summary');
      return {
        dueNow: response.dueNow,
        // The cap is applied here for the same reason `buildQueue` is: it is
        // the §6 policy, and it lives in one place.
        newAvailable: Math.min(
          response.newAvailable,
          remainingNewAllowance(response.dailyNewLimit, 0),
        ),
        reviewedToday: response.reviewedToday,
        nextDueAt: response.nextDueAt,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Generation: drafts, the review gate, and quota
//
// The cards themselves are written by the Edge Function, not from here
// (SPEC §7.1) — it holds the caller's JWT and inserts under the same policies.
// What the client owns is everything after: reading the drafts back, accepting
// or rejecting them, and showing how much of the monthly allowance is left.
// ---------------------------------------------------------------------------

/**
 * The drafts a generation left behind, oldest first — the review gate's queue.
 *
 * ── Disabled at P10, deliberately and visibly ─────────────────────────────
 *
 * Migration 0003 removed `'draft'` from `card_status`: drafts now live in
 * DynamoDB until they are accepted, so `/decks/{id}/cards?status=draft` has
 * nothing to return and the API now rejects that parameter outright rather than
 * pretending to honour it.
 *
 * The replacement is the job's own drafts, and that endpoint arrives with the
 * pipeline in **P10 task 5**. Until then this returns an empty list rather than
 * calling an endpoint that would 400 — the review gate renders its empty state
 * instead of an error, which is the truthful thing for a gate that has no
 * drafts to show.
 *
 * This is a seam left open on purpose, not an oversight: task 5 repoints the
 * `queryFn` at the job and everything above it keeps working unchanged.
 */
export function useDraftCards(deckId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deckDrafts(deckId ?? ''),
    enabled: Boolean(deckId),
    queryFn: (): Promise<CardRow[]> => Promise.resolve([]),
    // A generation may still be streaming into this deck; a stale list here is
    // the difference between "resume where you left off" and "half your cards
    // are missing".
    staleTime: 0,
  });
}

/**
 * Accept drafts: `draft` → `active`, and nothing else.
 *
 * An update, not an insert — the rows already exist, written as they streamed
 * in — and it deliberately leaves the scheduling columns alone. The card was
 * created with fresh-card state, so accepting it drops it straight into the
 * `new` queue where P1's practice loop finds it, with no change to fsrs.ts or
 * `review_card` (SPEC §4.1 step 6).
 */
export function useAcceptDrafts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardIds, deckId: _deckId }: { cardIds: string[]; deckId: string }) =>
      api.post<{ ids: string[] }>('/cards/accept', { cardIds }),
    onSuccess: (_rows, variables) => invalidateCardCaches(queryClient, variables.deckId),
  });
}

/**
 * Close the gate: the deck becomes an ordinary deck, and the audit row learns
 * how many of its cards survived.
 *
 * `cards_accepted` is counted from the cards rather than tallied in the UI, so
 * resuming an abandoned gate later corrects the number instead of double
 * counting it. SPEC §13 (2) measures the product on this figure — "fewer than
 * 20% rejected" — which is only worth measuring if it reflects the deck.
 */
export function useFinishReviewGate() {
  const queryClient = useQueryClient();
  return useMutation({
    // Three statements became one call. They now run in a single transaction
    // server-side (`finishReviewGate` in services/api/src/data/decks.ts), which
    // the client could not do: a deck that flipped to `active` while its
    // generation row went unstamped was a real, if harmless, way for the two to
    // disagree.
    mutationFn: ({ deckId }: { deckId: string }) =>
      api.post<DeckRow>(`/decks/${deckId}/finish-gate`),
    onSuccess: deck => {
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      invalidateCardCaches(queryClient, deck.id);
    },
  });
}

export type QuotaUsage = {
  used: number;
  remaining: number;
  limit: number;
  /** When the allowance resets — the 1st of next month, UTC. */
  resetsAt: string;
};

/**
 * How much of the monthly allowance is gone (SPEC §4.1 step 3).
 *
 * Advisory: the Edge Function counts the same rows with the same filter and is
 * the only thing that can actually refuse. Showing the number here is what stops
 * the refusal being a surprise at submit time.
 */
export function useQuotaUsage() {
  return useQuery({
    queryKey: queryKeys.quota,
    queryFn: async (): Promise<QuotaUsage> => {
      const now = new Date();
      const month = monthWindow(now);
      const result = await supabase
        .from('generations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', month.start.toISOString())
        .lt('created_at', month.end.toISOString())
        .or(quotaCountFilter(now));
      if (result.error) throw result.error;

      const used = result.count ?? 0;
      return {
        used,
        remaining: remainingGenerations(used),
        limit: GENERATION_QUOTA.monthlyGenerations,
        resetsAt: month.end.toISOString(),
      };
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Progress (SPEC §4.4)
//
// Four reads, keyed under `['stats', …]` per §8.3 so one invalidation after a
// rating refreshes the whole page. Three of them wait for `useProfile` the way
// `usePracticeQueue` does: the timezone decides where every day starts, and
// guessing UTC produces a heatmap that is subtly wrong for most of the world.
//
// `staleTime` is a minute throughout. This is a dashboard, not a session — it
// should reflect the last review without refetching on every focus change.
// ---------------------------------------------------------------------------

const STATS_STALE_TIME = 60_000;

export type ReviewDayCount =
  Database['public']['Functions']['review_day_counts']['Returns'][number];

export type ReviewHistory = {
  timeZone: string;
  /** The study day the client is in — the heatmap's last cell. */
  today: string;
  rows: ReviewDayCount[];
  /** Reviews per study day, the shape `heatmapGrid` and `streaks` want. */
  counts: Map<string, number>;
  total: number;
};

/**
 * A year of daily counts, aggregated in Postgres.
 *
 * The aggregate is the point of P3's migration: a serious user's year is
 * ~70,000 review rows and this returns at most 365 of them. See
 * supabase/migrations/20260812210000_progress_stats.sql for why the day bucket
 * is written the way it is.
 */
export function useReviewHistory(days: number = HEATMAP_DAYS) {
  const { data: profile } = useProfile();

  return useQuery({
    queryKey: queryKeys.statsHistory(days),
    enabled: profile !== undefined,
    staleTime: STATS_STALE_TIME,
    queryFn: async (): Promise<ReviewHistory> => {
      const timeZone = resolveTimeZone(profile?.timezone);
      const today = studyDayKey(new Date(), timeZone);
      const from = studyDayStart(addStudyDays(today, -(days - 1)), timeZone);

      const rows = unwrap(
        await supabase.rpc('review_day_counts', {
          p_timezone: timeZone,
          p_from: from.toISOString(),
        }),
      );

      let total = 0;
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.day, row.reviews);
        total += row.reviews;
      }
      return { timeZone, today, rows, counts, total };
    },
  });
}

export type DueForecast = {
  timeZone: string;
  takenAt: string;
  buckets: ForecastDay[];
};

/**
 * What the next `days` study days cost.
 *
 * Bucketed on the client rather than in SQL: `cards` is small next to `reviews`
 * — this fetches only active, non-new cards inside the horizon — and one fewer
 * function is one fewer thing to close to `anon`.
 *
 * Day 0 has to equal what `/practice` would serve this minute, so it carries the
 * overdue cards *and* today's remaining new-card allowance, counted by the same
 * §6 policy the queue uses.
 */
export function useDueForecast(days = 30) {
  const { data: profile } = useProfile();

  return useQuery({
    queryKey: queryKeys.statsForecast(days),
    enabled: profile !== undefined,
    staleTime: STATS_STALE_TIME,
    queryFn: async (): Promise<DueForecast> => {
      const now = new Date();
      const timeZone = resolveTimeZone(profile?.timezone);
      const dailyNewLimit = profile?.daily_new_limit ?? 20;
      const horizon = studyDayStart(
        addStudyDays(studyDayKey(now, timeZone), days),
        timeZone,
      );

      const [scheduled, fresh, introduced] = await Promise.all([
        supabase
          .from('cards')
          .select('due, fsrs_state')
          .eq('status', 'active')
          // A new card's `due` is its creation time; new cards are counted
          // through the daily cap below, never through the schedule.
          .neq('fsrs_state', 'new')
          .lt('due', horizon.toISOString()),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .eq('fsrs_state', 'new'),
        supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('state_before', 'new')
          .is('undone_at', null)
          .gte('reviewed_at', startOfStudyDay(now, timeZone).toISOString()),
      ]);

      if (scheduled.error) throw scheduled.error;
      if (fresh.error) throw fresh.error;
      if (introduced.error) throw introduced.error;

      const newToday = Math.min(
        fresh.count ?? 0,
        remainingNewAllowance(dailyNewLimit, introduced.count ?? 0),
      );

      return {
        timeZone,
        takenAt: now.toISOString(),
        buckets: forecast(scheduled.data, now, days, { timeZone, newToday }),
      };
    },
  });
}

export type CardStates = {
  distribution: StateDistribution;
  strength: MemoryStrength;
};

/**
 * The card-state mix, and the mean stability and difficulty behind it.
 *
 * Not gated on the profile: nothing here is bucketed by day, so there is no
 * timezone to get wrong, and waiting on a query it does not use would only make
 * the page slower. Stability and difficulty have to come back as values rather
 * than counts — a mean cannot be made from `head: true` — and this is the same
 * fetch shape `useDecks` already performs over the card table.
 */
export function useCardStates() {
  return useQuery({
    queryKey: queryKeys.statsCards,
    staleTime: STATS_STALE_TIME,
    queryFn: async (): Promise<CardStates> => {
      const rows = unwrap(
        await supabase
          .from('cards')
          .select('fsrs_state, stability, difficulty')
          .eq('status', 'active'),
      );
      return { distribution: stateDistribution(rows), strength: memoryStrength(rows) };
    },
  });
}

export type RetentionHistory = {
  timeZone: string;
  today: string;
  from: Date;
  to: Date;
  /** Undone ratings already dropped — twice, and deliberately. */
  reviews: CountedReviews;
};

/**
 * Reviews inside the widest retention window, fetched once.
 *
 * One request rather than three: 7, 30 and 90 days are nested, so the caller
 * slices this with `retention()` rather than asking the server the same question
 * at three lengths. Six columns, because row count is the cost here — a heavy
 * user's 90 days is thousands of rows, and `select *` would drag the whole FSRS
 * snapshot along with each one.
 *
 * `undone_at` is filtered server-side *and* selected, so `countable` has
 * something real to filter and the exclusion is provable rather than assumed.
 */
export function useRetention(days = 90) {
  const { data: profile } = useProfile();

  return useQuery({
    queryKey: queryKeys.statsRetention(days),
    enabled: profile !== undefined,
    staleTime: STATS_STALE_TIME,
    queryFn: async (): Promise<RetentionHistory> => {
      const now = new Date();
      const timeZone = resolveTimeZone(profile?.timezone);
      const today = studyDayKey(now, timeZone);
      const from = studyDayStart(addStudyDays(today, -(days - 1)), timeZone);

      const rows = unwrap(
        await supabase
          .from('reviews')
          .select(
            'rating, state_before, reviewed_at, undone_at, stability_after, difficulty_after',
          )
          .is('undone_at', null)
          .gte('reviewed_at', from.toISOString())
          .order('reviewed_at', { ascending: true }),
      );

      return { timeZone, today, from, to: now, reviews: countable(rows) };
    },
  });
}

export type { CardKind };
