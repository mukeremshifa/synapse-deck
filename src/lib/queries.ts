import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from './api-client';
import {
  AttemptSubmission,
  CardPayload,
  DeckInput,
  Grade,
  ProfileSettings,
  type CardKind,
} from './schemas';
import { applyGrade, type SchedulePreview } from './fsrs';
import { detectTimeZone } from './day';
import { buildQueue, remainingNewAllowance } from './queue';
import type {
  CountedReviews,
  ForecastDay,
  MemoryStrength,
  StateDistribution,
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
  /**
   * The user's topics with their card counts. DS3 task 2, scoped to a notebook
   * by DS4 task 1.
   *
   * **The scope is in the key, and has to be.** Without `deckId` here, two
   * notebooks share one cache entry and the second renders the first's topics —
   * the same bug DS4 set out to fix, moved from the server into the client,
   * where it would be intermittent rather than constant and so harder to see.
   */
  topics: (deckId?: string) => ['topics', deckId ?? 'all'] as const,
  /** Exam answers — the mastery model's second signal. DS3 task 5. */
  answers: (days: number) => ['answers', days] as const,
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
// Topics
// ---------------------------------------------------------------------------

/**
 * A topic and how much of the user's material sits under it.
 *
 * Mirrors `TopicWithCounts` in `services/api/src/data/topics.ts`. Declared here
 * rather than imported from the generated `database.ts` for the same reason
 * `DeckWithCounts` is: that file is generated from the *Supabase* project,
 * which never received migration 0004, so it knows nothing about topics at all.
 * The two shapes are kept in step by hand until the generator points at RDS.
 */
export type TopicWithCounts = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  /** Active cards filed under this topic. */
  cardCount: number;
  /** Of those, how many have been reviewed at least once. */
  reviewedCount: number;
};

export type TopicsResponse = {
  topics: TopicWithCounts[];
  /**
   * Active cards carrying no topic at all.
   *
   * Not a topic and not an error: `cards.topic_id` is nullable by design
   * (migration 0004). The blueprint shows these as an "Unfiled" row rather than
   * dropping them, because weights computed over only the topiced cards would
   * claim to describe all of the user's material while describing a subset.
   */
  unfiledCards: number;
};

/**
 * The user's topics. **The read that DS3 existed to build.**
 *
 * `topics` has been written at the review gate since P10 and, until this hook,
 * was never read by anything — every topic the app displayed came from a
 * fixture's inline label.
 *
 * **Pass `deckId` on any screen that speaks about one notebook.** Omitting it
 * returns every topic the user owns, which is right for a global view and wrong
 * for a blueprint: DS3 shipped it unscoped, so a two-notebook account weighted
 * one subject's exam by another subject's topics (DS4 §0).
 */
export function useTopics(deckId?: string) {
  return useQuery({
    queryKey: queryKeys.topics(deckId),
    queryFn: () =>
      api.get<TopicsResponse>(
        deckId === undefined ? '/topics' : `/topics?deckId=${encodeURIComponent(deckId)}`,
      ),
  });
}

// ---------------------------------------------------------------------------
// Exam answers
// ---------------------------------------------------------------------------

/** One recorded answer, as `GET /exams/answers` returns it. Mirrors `AnswerRow`. */
export type AnswerRow = {
  id: string;
  user_id: string;
  attempt_id: string;
  question_text: string;
  card_id: string | null;
  topic_id: string | null;
  topic_name: string | null;
  correct: boolean;
  selected_option: number | null;
  elapsed_ms: number | null;
  answered_at: string;
};

export type AnswersResponse = {
  answers: AnswerRow[];
  /**
   * Every answer the user has, ignoring the window.
   *
   * The diagnostic needs it to tell "you have never sat an exam" from "your
   * last one predates this window" — the same absence on screen, but only the
   * first should tell the user to go and sit one.
   */
  total: number;
  windowDays: number;
};

/** How far back the diagnostic reads exam history. The server caps it at 365. */
export const ANSWER_WINDOW_DAYS = 180;

export function useAnswers(days: number = ANSWER_WINDOW_DAYS) {
  return useQuery({
    queryKey: queryKeys.answers(days),
    queryFn: () => api.get<AnswersResponse>(`/exams/answers?days=${days}`),
  });
}

/**
 * Record a finished attempt. One request for the whole sitting.
 *
 * Invalidates the answers so the diagnostic reflects the exam the user has just
 * sat — the results screen links straight to it, and arriving at a diagnostic
 * that has not noticed the exam is the bug this line prevents.
 */
export function useRecordAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (submission: AttemptSubmission) =>
      api.post<{ recorded: number; attemptId: string }>(
        '/exams/answers',
        AttemptSubmission.parse(submission),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['answers'] }),
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * A card as the API returns it.
 *
 * `CardRow` comes from `src/types/database.ts`, generated against the Supabase
 * project — which never received migration 0004 and so has no `topic_id`. The
 * RDS `cards` table does, `data/cards.ts` selects `*`, and the diagnostic needs
 * it to group a user's own cards by topic. Widened here, beside
 * `DeckWithCounts`, rather than hand-edited into a generated file.
 */
export type CardRowWithTopic = CardRow & { topic_id: string | null };

export function useCards(deckId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deckCards(deckId ?? ''),
    enabled: Boolean(deckId),
    queryFn: () => api.get<CardRowWithTopic[]>(`/decks/${deckId!}/cards`),
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

/*
 * ── The review gate's hooks are gone (FR4) ───────────────────────────────
 *
 * `useDraftCards`, `useAcceptDrafts` and `useFinishReviewGate` were deleted
 * with `/create/*` and `ReviewGatePage`. They had no callers left, and they
 * could not gain one: **the FR0 contract has no draft concept.** `Card.status`
 * is `active | suspended`, there is no `deck_status`, and nothing in
 * `ApiClient` accepts or rejects a generated card.
 *
 * That was a deliberate simplification at FR0, not an omission, and FR4
 * recorded it rather than quietly restoring the old shape: what survives is the
 * part the contract *can* express — a completion surface that reports partial
 * failure from `Job.truncated` and `unitsFailed`. Card-by-card triage needs a
 * contract change and belongs to whichever phase decides to make it.
 */

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
 * **Units, not generations, since P10 task 8.** One unit is one chunk is one
 * model call, so a pasted passage costs 1 and a 40-chunk document costs 40. The
 * numbers this returns are therefore an order of magnitude larger than they
 * were, and `limit` is 300 rather than 30.
 *
 * **Moved off Supabase.** `generations` now lives on RDS and the count comes
 * from `GET /quota`, which is the split table's own schedule (`generations` +
 * quota → Phase B). The arithmetic is no longer done here at all: it is a
 * `sum(units)` in Postgres, because the client can no longer see the rows.
 *
 * Advisory, as it always was: this reports and `POST /jobs` refuses. Both read
 * their thresholds from `src/lib/quota.ts`, so the number shown here and the
 * number that refuses cannot disagree. Showing it is what stops the refusal
 * being a surprise at submit time.
 */
export function useQuotaUsage() {
  return useQuery({
    queryKey: queryKeys.quota,
    queryFn: (): Promise<QuotaUsage> => api.get<QuotaUsage>('/quota'),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Progress
//
// ── The four Supabase stats hooks were removed at FR0 ─────────────────────
//
// `useReviewHistory`, `useDueForecast`, `useCardStates` and `useRetention` were
// the last four readers of `supabase-js`, and the brief (§2.3) removes Supabase
// here: carrying a second backend into a re-architecture is how "two backends,
// for one phase" becomes permanent.
//
// **FR0's plan expected them to feed `/progress`. That route does not exist** —
// it was removed before this phase, so three of the four hooks had no consumer
// at all and the fourth, `useReviewHistory`, was read by `DashboardPage` for one
// number: the streak. See FR-DRIFT-LOG.md.
//
// So the plan's two options collapsed. Re-pointing four hooks at the contract to
// serve zero screens would be dead code with a new backend behind it; deleting
// them loses nothing, because the aggregates they computed now live on
// `ApiClient` as `getReviewHistory`, `getDueForecast`, `getCardStates` and
// `getRetention` — notebook-scoped, which is what FR6's overview needs and what
// a global `/progress` could never be.
//
// `DashboardPage`'s streak is re-pointed at `getGlobalSummary().streakDays`,
// which is the same number computed the same way, and is the one aggregate the
// contract deliberately keeps un-scoped (§3.5's global strip).
//
// The re-exported types below are kept because components still name them.
// ---------------------------------------------------------------------------

export type { CountedReviews, ForecastDay, MemoryStrength, StateDistribution };

export type { CardKind };
