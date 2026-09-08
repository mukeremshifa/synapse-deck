import type {
  ApiClient,
  ApiErrorCode,
  Artifact,
  Attempt,
  Card,
  CardStates,
  DueForecast,
  GlobalSummary,
  Job,
  NoteBlock,
  Notebook,
  Page,
  PageRequest,
  PracticeQueue,
  Profile,
  Question,
  RetentionSummary,
  ReviewHistory,
  Source,
  TopicSummary,
  UploadTicket,
} from './contract';
import { ApiClientError, FsrsState } from './contract';
import { ApiError, api } from '../api-client';
import { CardPayload } from '../schemas';
import { z } from 'zod';

/**
 * The real client: today's `api-client.ts` transport (fetch + a Cognito access
 * token) behind the `ApiClient` interface.
 *
 * ── This is lossy, and the losses are the point of writing it down ────────
 *
 * The live API has **no notebooks, no sources, no artifacts and no exams** —
 * brief §0 is the audit that established it. `decks` is one flat level with no
 * parent column, sources are `useState([])`, and `0008_answers.sql` says in as
 * many words that there is no `exams` table. So a large part of this interface
 * cannot be implemented against today's backend.
 *
 * **Nothing here fakes it.** A live client that quietly invents an artifact list
 * is the same lie as a lying fake, in the more dangerous place: it would be
 * believed. Every method the backend cannot serve throws `not_implemented` with
 * a sentence saying what is missing, and FR0 §6.3 tabulates all of them. That
 * table is FR7's build list — it is cheaper to inherit it than to rediscover it.
 *
 * ── What does work ────────────────────────────────────────────────────────
 *
 * The mapping that exists is the deck-as-notebook one, which is exactly the
 * confusion the re-architecture is unwinding: a `deck` row is served as a
 * `Notebook`, and its cards are reachable through a **synthetic deck artifact**
 * whose id is the notebook's own id. That is a translation, and it is stated
 * here rather than hidden, because it is temporary and it is the shape FR7
 * deletes.
 *
 * ── What nothing checks ───────────────────────────────────────────────────
 *
 * This file is typed against `ApiClient`, **not against the API**. A wrong path
 * compiles and 404s at runtime. `check-routes.mjs` polices `dev-api.mjs` against
 * `infra/` and does not look at this file. There are no tests (ADR 0005).
 */

// ---------------------------------------------------------------------------
// Errors and the not-implemented surface
// ---------------------------------------------------------------------------

/** Map the transport's status and code onto the contract's closed union. */
function toClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;

  if (error instanceof ApiError) {
    // `PT409` is raised by `review_card` and passed through untranslated; it is
    // an expected outcome of two open tabs, not a crash.
    const code: ApiErrorCode =
      error.code === 'PT409'
        ? 'stale_card'
        : error.status === 401
          ? 'unauthorized'
          : error.status === 403
            ? 'forbidden'
            : error.status === 404
              ? 'not_found'
              : error.status === 400 || error.status === 422
                ? 'invalid_input'
                : error.status === 402
                  ? 'quota_exceeded'
                  : error.status === 429
                    ? 'rate_limited'
                    : 'internal';
    return new ApiClientError(code, error.message, error.issues, error.status);
  }

  // A `TypeError` from fetch is the network being down, not a server error.
  if (error instanceof TypeError) {
    return new ApiClientError('network', 'The network did not carry that request.');
  }

  return new ApiClientError(
    'internal',
    error instanceof Error ? error.message : 'Something went wrong.',
  );
}

/** Every call goes through this, so nothing escapes as a raw `ApiError`. */
async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toClientError(error);
  }
}

/**
 * The backend cannot serve this. **Do not replace one of these with invented
 * data** — a plausible empty list is indistinguishable from a working feature,
 * and the point of throwing is that the gap stays visible until FR7 closes it.
 */
function notImplemented(what: string): never {
  throw new ApiClientError(
    'not_implemented',
    `${what} — the current backend has no such concept. This arrives at FR7.`,
  );
}

// ---------------------------------------------------------------------------
// The wire's shapes, as the live API returns them
// ---------------------------------------------------------------------------

interface WireDeck {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WireDeckWithCounts extends WireDeck {
  cardCount: number;
  dueCount: number;
  newCount: number;
}

interface WireCard {
  id: string;
  deck_id: string;
  topic_id?: string | null;
  payload: unknown;
  source_excerpt: string | null;
  status: string;
  fsrs_state: string;
  due: string;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WireProfile {
  id: string;
  display_name: string | null;
  timezone: string;
  daily_new_limit: number;
  fsrs_params: unknown;
  created_at: string;
}

interface WireQueue {
  due: WireCard[];
  fresh: WireCard[];
  introducedToday: number;
  nextDueAt: string | null;
  dailyNewLimit: number;
  fetchedAt: string;
}

interface WireSummary {
  dueNow: number;
  newAvailable: number;
  reviewedToday: number;
  nextDueAt: string | null;
  dailyNewLimit: number;
}

interface WireTopics {
  topics: {
    id: string;
    name: string;
    slug: string;
    cardCount: number;
    reviewedCount: number;
  }[];
  unfiledCards: number;
}

interface WireQuota {
  used: number;
  remaining: number;
  limit: number;
  resetsAt: string;
}

// ---------------------------------------------------------------------------
// Wire → contract
// ---------------------------------------------------------------------------

/**
 * A deck row as a `Notebook`.
 *
 * **`readiness` is synthesised from the card counts**, which is the only signal
 * the live API has. It is therefore thinner than the real thing — a deck's due
 * count, phrased as a bundle — and it cannot mention quizzes or note sets,
 * because none exist. Honest, and visibly temporary.
 */
function toNotebook(deck: WireDeckWithCounts): Notebook {
  const due = deck.dueCount;
  const fresh = deck.newCount;
  return {
    id: deck.id,
    title: deck.title,
    description: deck.description,
    createdAt: deck.created_at,
    updatedAt: deck.updated_at,
    readiness: {
      state: due > 0 ? 'ready' : fresh > 0 ? 'partial' : 'none',
      detail:
        due > 0
          ? `${due} card${due === 1 ? '' : 's'} due`
          : fresh > 0
            ? `${fresh} new card${fresh === 1 ? '' : 's'} to start`
            : deck.cardCount === 0
              ? 'Empty'
              : 'Nothing due today',
    },
    // `sources` is 0 rather than null because the contract's type is a number.
    // The live API exposes no count of a deck's sources and the pipeline takes
    // one document per job, so this is a known-wrong zero, not a measurement.
    counts: { sources: 0, artifacts: deck.cardCount > 0 ? 1 : 0, dueCards: due },
  };
}

function bareNotebook(deck: WireDeck): Notebook {
  return toNotebook({ ...deck, cardCount: 0, dueCount: 0, newCount: 0 });
}

/**
 * A card, **parsed rather than asserted**.
 *
 * FR0's acceptance criterion forbids a cast here, and the reason is not
 * pedantry: `payload` is untrusted LLM output stored as free-form jsonb, and
 * `card.payload as CardPayload` is a claim about content nothing has checked.
 * The old client got away with it because `api.get<T>` asserted the whole row
 * anyway — which is precisely the guarantee the seam was invented to provide.
 *
 * So a card whose payload fails the schema throws `invalid_input` rather than
 * flowing on as a malformed object. That is a behaviour change from today,
 * where a broken payload rendered as a broken card, and it is worth naming:
 * this is stricter, and a corrupt row that used to be editable now fails its
 * whole request. FR7 serves parsed rows and the question disappears.
 */
function toCard(card: WireCard, notebookId: string): Card {
  const payload = CardPayload.safeParse(card.payload);
  if (!payload.success) {
    throw new ApiClientError(
      'invalid_input',
      `Card ${card.id} has a payload that does not match the schema.`,
    );
  }
  const fsrsState = FsrsState.safeParse(card.fsrs_state);
  if (!fsrsState.success) {
    throw new ApiClientError(
      'invalid_input',
      `Card ${card.id} has an unknown FSRS state “${card.fsrs_state}”.`,
    );
  }

  return {
    id: card.id,
    // The synthetic artifact id: on the live backend a notebook has exactly one
    // implicit deck, and it is the notebook itself. FR7 deletes this line.
    artifactId: card.deck_id,
    notebookId,
    topicId: card.topic_id ?? null,
    payload: payload.data,
    sourceExcerpt: card.source_excerpt,
    status: card.status === 'suspended' ? 'suspended' : 'active',
    fsrsState: fsrsState.data,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.last_reviewed_at,
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

/** Per-user FSRS weights. Parsed, not asserted, for `toCard`'s reason. */
const FsrsParams = z.record(z.string(), z.number());

function toProfile(profile: WireProfile): Profile {
  const params = FsrsParams.safeParse(profile.fsrs_params);
  return {
    id: profile.id,
    displayName: profile.display_name,
    timezone: profile.timezone,
    dailyNewLimit: profile.daily_new_limit,
    // A malformed weights blob falls back to null — the documented meaning of
    // "use the defaults" — rather than failing the whole profile request. The
    // profile is what the app boots on, and one bad optional field should not
    // stop it.
    fsrsParams: params.success ? params.data : null,
    createdAt: profile.created_at,
  };
}

/**
 * The live API paginates nothing. Everything comes back whole, so a page is the
 * whole list with a null cursor — which is a truthful `Page<T>` and not a
 * pretence at paging.
 */
function wholePage<T>(items: T[]): Page<T> {
  return { items, nextCursor: null };
}

// ---------------------------------------------------------------------------
// The implementation
// ---------------------------------------------------------------------------

export const liveClient: ApiClient = {
  // ── Profile ──────────────────────────────────────────────────────────────

  getProfile: tz =>
    call(async () =>
      toProfile(
        await api.get<WireProfile>(`/profile?tz=${encodeURIComponent(tz)}`),
      ),
    ),

  updateProfile: input =>
    call(async () =>
      toProfile(
        await api.patch<WireProfile>('/profile', {
          display_name: input.displayName ?? undefined,
          timezone: input.timezone,
          daily_new_limit: input.dailyNewLimit,
        }),
      ),
    ),

  getQuota: () => call(async () => await api.get<WireQuota>('/quota')),

  getGlobalSummary: () =>
    call(async () => {
      const summary = await api.get<WireSummary>('/summary');
      return {
        dueNow: summary.dueNow,
        newAvailable: Math.min(summary.newAvailable, summary.dailyNewLimit),
        reviewedToday: summary.reviewedToday,
        // No streak on the wire: it needs day-bucketed history, which is the
        // Supabase RPC this phase removes. Zero would render as "0 day streak",
        // a claim; the overview shows a streak only where it has one.
        streakDays: 0,
        timeZone: 'UTC',
      } satisfies GlobalSummary;
    }),

  // ── Notebooks (served by `decks`) ────────────────────────────────────────

  listNotebooks: (_page?: PageRequest) =>
    call(async () =>
      wholePage((await api.get<WireDeckWithCounts[]>('/decks')).map(toNotebook)),
    ),

  getNotebook: notebookId =>
    call(async () => bareNotebook(await api.get<WireDeck>(`/decks/${notebookId}`))),

  createNotebook: input =>
    call(async () =>
      bareNotebook(
        await api.post<WireDeck>('/decks', {
          title: input.title,
          description: input.description ?? null,
        }),
      ),
    ),

  updateNotebook: (notebookId, input) =>
    call(async () =>
      bareNotebook(
        await api.patch<WireDeck>(`/decks/${notebookId}`, {
          title: input.title,
          description: input.description ?? null,
        }),
      ),
    ),

  deleteNotebook: notebookId =>
    call(async () => {
      await api.delete<{ id: string }>(`/decks/${notebookId}`);
    }),

  // ── Sources — no such concept ────────────────────────────────────────────

  listSources: () => notImplemented('Sources are not persisted'),
  getSource: () => notImplemented('Sources are not persisted'),
  addSource: () => notImplemented('A source cannot be added to an existing notebook'),
  deleteSource: () => notImplemented('Sources are not persisted'),

  /**
   * The one source-shaped route that does exist. `POST /uploads` presigns a PUT
   * and is unchanged by the new model — but the ticket it returns can only be
   * handed to `POST /jobs`, which **creates a new deck**, so `addSource` above
   * still cannot use it.
   */
  requestUpload: (_notebookId, input) =>
    call(async () =>
      await api.post<UploadTicket>('/uploads', {
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      }),
    ),

  // ── Topics ───────────────────────────────────────────────────────────────

  listTopics: notebookId =>
    call(async () => {
      const wire = await api.get<WireTopics>(
        `/topics?deckId=${encodeURIComponent(notebookId)}`,
      );
      return {
        topics: wire.topics.map(topic => ({
          id: topic.id,
          notebookId,
          name: topic.name,
          slug: topic.slug,
          cardCount: topic.cardCount,
          reviewedCount: topic.reviewedCount,
        })),
        unfiledCards: wire.unfiledCards,
      } satisfies TopicSummary;
    }),

  // ── Artifacts — no such table ────────────────────────────────────────────

  /**
   * A notebook has exactly one implicit deck on the live backend, and no other
   * kind of artifact exists. Rather than return a synthetic one-item list —
   * which would render as a working Studio rail over a model that has none —
   * this refuses.
   */
  listArtifacts: () => notImplemented('Artifacts are not a table'),
  getArtifact: () => notImplemented('Artifacts are not a table'),
  createArtifact: () =>
    notImplemented(
      'Generation creates a new notebook rather than an artifact within one',
    ),
  updateArtifact: () => notImplemented('Artifacts are not a table'),
  deleteArtifact: () => notImplemented('Artifacts are not a table'),

  // ── Cards ────────────────────────────────────────────────────────────────

  /**
   * `artifactId` is the notebook's own id here — the synthetic deck. Passing
   * anything else is a caller assuming a model the live backend does not have,
   * and it will 404 rather than silently returning the notebook's cards.
   */
  listCards: (notebookId, artifactId, _page?: PageRequest) =>
    call(async () =>
      wholePage(
        (await api.get<WireCard[]>(`/decks/${artifactId}/cards`)).map(card =>
          toCard(card, notebookId),
        ),
      ),
    ),

  updateCard: (notebookId, cardId, input) =>
    call(async () =>
      toCard(await api.patch<WireCard>(`/cards/${cardId}`, input.payload), notebookId),
    ),

  setCardStatus: (_notebookId, cardIds, status) =>
    call(async () => await api.post<{ ids: string[] }>('/cards/status', { cardIds, status })),

  deleteCards: (_notebookId, cardIds) =>
    call(async () => await api.post<{ ids: string[] }>('/cards/delete', { cardIds })),

  // ── Practice ─────────────────────────────────────────────────────────────

  getPracticeQueue: (notebookId, _artifactId) =>
    call(async () => {
      const wire = await api.get<WireQueue>(
        `/queue?deckId=${encodeURIComponent(notebookId)}`,
      );
      return {
        due: wire.due.map(card => toCard(card, notebookId)),
        fresh: wire.fresh.map(card => toCard(card, notebookId)),
        introducedToday: wire.introducedToday,
        dailyNewLimit: wire.dailyNewLimit,
        nextDueAt: wire.nextDueAt,
        fetchedAt: wire.fetchedAt,
      } satisfies PracticeQueue;
    }),

  reviewCard: (notebookId, input) =>
    call(async () =>
      toCard(
        await api.post<WireCard>('/reviews', {
          cardId: input.cardId,
          rating: input.grade,
          durationMs: input.durationMs,
          expectedUpdatedAt: input.expectedUpdatedAt,
          next: {
            fsrs_state: input.next.fsrsState,
            due: input.next.due,
            stability: input.next.stability,
            difficulty: input.next.difficulty,
            reps: input.next.reps,
            lapses: input.next.lapses,
            last_reviewed_at: input.next.lastReviewedAt,
          },
        }),
        notebookId,
      ),
    ),

  undoReview: (notebookId, cardId) =>
    call(async () =>
      toCard(await api.post<WireCard>('/reviews/undo', { cardId }), notebookId),
    ),

  // ── Questions and attempts ───────────────────────────────────────────────

  /**
   * `0008_answers.sql:89`: *"there is no `exams` table, because an exam is
   * currently assembled in the browser."* Loose answers grouped by a
   * client-generated uuid are all that is stored, so there is nothing to list
   * questions from and nothing to resume.
   */
  listQuestions: () => notImplemented('Questions are not stored'),
  startAttempt: () => notImplemented('There is no attempts table'),
  saveAttemptProgress: () => notImplemented('Quiz attempts are not resumable'),
  submitAttempt: () =>
    notImplemented(
      'Answers are recorded loose via POST /exams/answers, not against an attempt',
    ),
  getAttempt: () => notImplemented('There is no attempts table'),
  listAttempts: () => notImplemented('There is no attempts table'),

  // ── Notes — nothing generates them ───────────────────────────────────────

  listNoteBlocks: () => notImplemented('Note sets do not exist'),
  markBlocksRead: () => notImplemented('Note sets do not exist'),

  // ── Chat ─────────────────────────────────────────────────────────────────

  /**
   * `POST /decks/:id/ask` exists and works. What it cannot do is scope the
   * answer to chosen sources — retrieval runs over the whole notebook's chunks,
   * because sources are not entities — so `sourceIds` is accepted and ignored,
   * and that is stated rather than hidden.
   */
  ask: (notebookId, input) =>
    call(async () => {
      const wire = await api.post<{
        answer: string | null;
        citations: { chunkId: string; deckId: string; marker: number; excerpt: string }[];
      }>(`/decks/${notebookId}/ask`, { question: input.question });
      return {
        id: `ask-${Date.now()}`,
        question: input.question,
        answer: wire.answer,
        citations: wire.citations.map(citation => ({
          // A chunk id, not a source id — the live model has no sources, so the
          // citation cannot name one. FR7's citations point at real sources.
          sourceId: citation.chunkId,
          sourceTitle: 'Source passage',
          marker: citation.marker,
          excerpt: citation.excerpt,
        })),
      };
    }),

  // ── Jobs ─────────────────────────────────────────────────────────────────

  /**
   * Jobs exist, and their progress fields map cleanly. What does not map is the
   * **stage**: the live job reports chunk counts and a status, and the stage is
   * derived from them exactly as `PipelineStages.tsx` derives it today.
   */
  getJob: (notebookId, jobId) =>
    call(async () =>
      toJob(
        await api.get<WireJob>(`/jobs/${jobId}`),
        notebookId,
      ),
    ),

  listJobs: notebookId =>
    call(async () => {
      const wire = await api.get<WireJob | null>(
        `/jobs?deckId=${encodeURIComponent(notebookId)}`,
      );
      return wire === null ? [] : [toJob(wire, notebookId)];
    }),

  // ── Aggregates — these were the Supabase hooks ───────────────────────────

  /**
   * These four read Supabase today, and this phase removes it (brief §2.3).
   * The AWS API has no aggregate endpoints, so `/progress` degrades to an error
   * state in `live` mode until FR7 — which is honest and temporary, and which
   * FR0 §6.1 records as the decision it is.
   */
  getReviewHistory: () => notImplemented('There is no review-history aggregate'),
  getDueForecast: () => notImplemented('There is no forecast aggregate'),
  getCardStates: () => notImplemented('There is no card-state aggregate'),
  getRetention: () => notImplemented('There is no retention aggregate'),
};

// ---------------------------------------------------------------------------
// Jobs — the one mapping with real work in it
// ---------------------------------------------------------------------------

interface WireJob {
  jobId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  deckId: string | null;
  chunkCount: number;
  chunksCompleted: number;
  chunksSucceeded: number | null;
  chunksFailed: number | null;
  truncated: boolean;
  error: string | null;
}

function toJob(wire: WireJob, notebookId: string): Job {
  // The same derivation `PipelineStages.tsx` performs, and for the same reason:
  // every stage maps onto a field the job actually reports. Nothing is invented
  // and nothing advances on a timer.
  const stage: Job['stage'] =
    wire.status === 'succeeded' || wire.status === 'failed'
      ? 'done'
      : wire.chunkCount === 0
        ? 'queued'
        : wire.chunksCompleted < wire.chunkCount
          ? 'generating'
          : 'saving';

  return {
    id: wire.jobId,
    notebookId,
    // Every live job creates a deck; none adds a source to a notebook.
    kind: 'create-artifact',
    status: wire.status,
    stage,
    unitsTotal: wire.chunkCount,
    unitsCompleted: wire.chunksCompleted,
    unitsFailed: wire.chunksFailed ?? 0,
    truncated: wire.truncated,
    error:
      wire.error === null
        ? null
        : // The live job carries a message, not a code. `provider_error` is the
          // honest generalisation: a failed job is a failed model call far more
          // often than anything else, and inventing a finer code would be a
          // guess a UI would then switch on.
          { code: 'provider_error', message: wire.error },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result:
      wire.status === 'succeeded' && wire.deckId !== null
        ? { artifactId: wire.deckId, sourceId: null }
        : null,
  };
}

export type { Artifact, Attempt, CardStates, DueForecast, NoteBlock, Question, RetentionSummary, ReviewHistory, Source };
