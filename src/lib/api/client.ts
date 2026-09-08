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
  QuotaUsage,
  RetentionSummary,
  ReviewHistory,
  Source,
  TopicMasteryReport,
  TopicSummary,
  UploadTicket,
} from './contract';
import { ApiClientError } from './contract';
import { ApiError, api } from '../api-client';

/**
 * The real client: `api-client.ts`'s transport (fetch + a Cognito access token)
 * behind the `ApiClient` interface.
 *
 * ── What changed at FR7 ───────────────────────────────────────────────────
 *
 * **This file used to be mostly apologies.** Before FR7 the live API had no
 * notebooks, no sources, no artifacts and no exams: `decks` was one flat level
 * with no parent, sources were `useState([])`, and `0008_answers.sql` said in
 * as many words that there was no `exams` table. Twenty-two of the contract's
 * forty-three methods threw `not_implemented` with a sentence naming what was
 * missing, and that list was FR7's build list.
 *
 * FR7 built it. The API now serves the contract's nouns directly, so the
 * translation layer this file used to carry — a `deck` row served as a
 * `Notebook`, cards reached through a *synthetic* deck artifact whose id was
 * the notebook's own — is gone rather than patched. **Nothing here throws
 * `not_implemented` any more.**
 *
 * What remains is transport plus paths. The server returns the contract's
 * shapes as the contract declares them, which is deliberate: a mapping layer on
 * both sides of the wire is two places for the same shape to drift, and the
 * server is the side that can be checked against the database.
 *
 * ── What nothing checks ───────────────────────────────────────────────────
 *
 * This file is typed against `ApiClient`, **not against the API**. A wrong path
 * compiles and 404s at runtime. `check-routes.mjs` polices `dev-api.mjs`
 * against `infra/lib/api-stack.ts` and does not look at this file. There are no
 * tests (ADR 0005). The paths below and the two route tables are kept in step
 * by reading, and that is the honest state of it.
 */

// ---------------------------------------------------------------------------
// Errors
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
              : error.status === 409
                ? 'stale_card'
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
 * Turn a `PageRequest` into a query string.
 *
 * The cursor is opaque — base64url of a keyset, though this side neither knows
 * nor cares — so it is passed straight back rather than interpreted.
 */
function pageQuery(page: PageRequest | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (page?.limit !== undefined) params.set('limit', String(page.limit));
  if (page?.cursor) params.set('cursor', page.cursor);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

const path = {
  notebook: (id: string) => `/notebooks/${encodeURIComponent(id)}`,
  artifact: (notebookId: string, artifactId: string) =>
    `/notebooks/${encodeURIComponent(notebookId)}/artifacts/${encodeURIComponent(artifactId)}`,
};

export const liveClient: ApiClient = {
  // ── Profile ──────────────────────────────────────────────────────────────

  getProfile: tz =>
    call(async () => await api.get<Profile>(`/profile?tz=${encodeURIComponent(tz)}`)),

  updateProfile: input => call(async () => await api.patch<Profile>('/profile', input)),

  getQuota: () => call(async () => await api.get<QuotaUsage>('/quota')),

  getGlobalSummary: () => call(async () => await api.get<GlobalSummary>('/summary')),

  // ── Notebooks ────────────────────────────────────────────────────────────

  listNotebooks: page =>
    call(async () => await api.get<Page<Notebook>>(`/notebooks${pageQuery(page)}`)),

  getNotebook: notebookId =>
    call(async () => await api.get<Notebook>(path.notebook(notebookId))),

  createNotebook: input =>
    call(
      async () =>
        await api.post<Notebook>('/notebooks', {
          title: input.title,
          description: input.description ?? null,
        }),
    ),

  updateNotebook: (notebookId, input) =>
    call(async () => await api.patch<Notebook>(path.notebook(notebookId), input)),

  deleteNotebook: notebookId =>
    call(async () => {
      await api.delete<void>(path.notebook(notebookId));
    }),

  // ── Sources ──────────────────────────────────────────────────────────────

  listSources: (notebookId, page) =>
    call(
      async () =>
        await api.get<Page<Source>>(
          `${path.notebook(notebookId)}/sources${pageQuery(page)}`,
        ),
    ),

  getSource: (notebookId, sourceId) =>
    call(
      async () =>
        await api.get<Source>(
          `${path.notebook(notebookId)}/sources/${encodeURIComponent(sourceId)}`,
        ),
    ),

  /**
   * Adding a source is a **job**, not a create.
   *
   * Reading a document — fetching it, extracting text, splitting and embedding
   * it — takes seconds to minutes, so the server returns the job immediately
   * and the source row appears in `listSources` as `processing` while it runs.
   * That is why `Source` has a `status` at all.
   */
  addSource: (notebookId, input) =>
    call(
      async () =>
        await api.post<Job>(`${path.notebook(notebookId)}/jobs`, {
          type: 'add-source',
          input,
        }),
    ),

  deleteSource: (notebookId, sourceId) =>
    call(async () => {
      // Artifacts made from it survive, with a dangling id and an intact
      // snapshot (brief §1.2(7)).
      await api.delete<void>(
        `${path.notebook(notebookId)}/sources/${encodeURIComponent(sourceId)}`,
      );
    }),

  requestUpload: (_notebookId, input) =>
    call(
      async () =>
        await api.post<UploadTicket>('/uploads', {
          filename: input.filename,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        }),
    ),

  // ── Topics ───────────────────────────────────────────────────────────────

  /**
   * Notebook-scoped, which is the fix for the live cross-notebook bug: topics
   * were reconciled per *user*, so two notebooks studying the same subject
   * shared one topic row and their mastery numbers contaminated each other.
   * Migration 0010 added `topics.notebook_id`; this reads it.
   */
  listTopics: notebookId =>
    call(async () => await api.get<TopicSummary>(`${path.notebook(notebookId)}/topics`)),

  // ── Artifacts ────────────────────────────────────────────────────────────

  listArtifacts: (notebookId, filter) =>
    call(
      async () =>
        await api.get<Page<Artifact>>(
          `${path.notebook(notebookId)}/artifacts${pageQuery(filter, {
            kind: filter?.kind ?? '',
          })}`,
        ),
    ),

  getArtifact: (notebookId, artifactId) =>
    call(async () => await api.get<Artifact>(path.artifact(notebookId, artifactId))),

  /** Generation is work, so this returns a `Job` (brief §2.2, FR0 §3(2)). */
  createArtifact: (notebookId, input) =>
    call(
      async () =>
        await api.post<Job>(`${path.notebook(notebookId)}/jobs`, {
          type: 'create-artifact',
          input,
        }),
    ),

  updateArtifact: (notebookId, artifactId, input) =>
    call(
      async () =>
        await api.patch<Artifact>(path.artifact(notebookId, artifactId), input),
    ),

  deleteArtifact: (notebookId, artifactId) =>
    call(async () => {
      await api.delete<void>(path.artifact(notebookId, artifactId));
    }),

  // ── Cards (a deck artifact's contents) ───────────────────────────────────

  listCards: (notebookId, artifactId, page) =>
    call(
      async () =>
        await api.get<Page<Card>>(
          `${path.artifact(notebookId, artifactId)}/cards${pageQuery(page)}`,
        ),
    ),

  updateCard: (_notebookId, cardId, input) =>
    call(
      async () =>
        await api.patch<Card>(`/cards/${encodeURIComponent(cardId)}`, input.payload),
    ),

  setCardStatus: (_notebookId, cardIds, status) =>
    call(async () => await api.post<{ ids: string[] }>('/cards/status', { cardIds, status })),

  deleteCards: (_notebookId, cardIds) =>
    call(async () => await api.post<{ ids: string[] }>('/cards/delete', { cardIds })),

  // ── Practice ─────────────────────────────────────────────────────────────

  /**
   * **The reads, not the policy.** The server returns every due and every new
   * card plus `introducedToday` and `dailyNewLimit`; `buildQueue` and the daily
   * cap stay client-side, because one policy drives this queue, home's "new
   * available" figure and the forecast's day 0.
   */
  getPracticeQueue: (notebookId, artifactId) =>
    call(
      async () =>
        await api.get<PracticeQueue>(
          `${path.notebook(notebookId)}/queue${pageQuery(undefined, {
            artifactId: artifactId ?? '',
          })}`,
        ),
    ),

  reviewCard: (_notebookId, input) =>
    call(
      async () =>
        await api.post<Card>('/reviews', {
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
    ),

  undoReview: (_notebookId, cardId) =>
    call(async () => await api.post<Card>('/reviews/undo', { cardId })),

  // ── Questions and attempts ───────────────────────────────────────────────

  listQuestions: (notebookId, artifactId) =>
    call(
      async () =>
        await api.get<Question[]>(`${path.artifact(notebookId, artifactId)}/questions`),
    ),

  /**
   * Start a sitting, or resume the one already in progress.
   *
   * The server returns the live in-progress attempt rather than creating a
   * second one, which is what makes a reloaded quiz resumable and stops a
   * double-clicked "Start" producing two papers.
   */
  startAttempt: (notebookId, artifactId) =>
    call(
      async () =>
        await api.post<Attempt>(`${path.artifact(notebookId, artifactId)}/attempts`, {}),
    ),

  saveAttemptProgress: (notebookId, attemptId, answers) =>
    call(
      async () =>
        await api.patch<Attempt>(
          `${path.notebook(notebookId)}/attempts/${encodeURIComponent(attemptId)}`,
          { answers },
        ),
    ),

  /**
   * Submit and score.
   *
   * **The score is computed server-side**, and so is each answer's `correct`.
   * A score that arrived in the request body would be a number the candidate
   * could choose.
   */
  submitAttempt: (notebookId, attemptId, input) =>
    call(
      async () =>
        await api.post<Attempt>(
          `${path.notebook(notebookId)}/attempts/${encodeURIComponent(attemptId)}`,
          input,
        ),
    ),

  getAttempt: (notebookId, attemptId) =>
    call(
      async () =>
        await api.get<Attempt>(
          `${path.notebook(notebookId)}/attempts/${encodeURIComponent(attemptId)}`,
        ),
    ),

  listAttempts: (notebookId, filter) =>
    call(
      async () =>
        await api.get<Page<Attempt>>(
          `${path.notebook(notebookId)}/attempts${pageQuery(filter, {
            artifactId: filter?.artifactId ?? '',
          })}`,
        ),
    ),

  // ── Notes ────────────────────────────────────────────────────────────────

  listNoteBlocks: (notebookId, artifactId) =>
    call(
      async () =>
        await api.get<NoteBlock[]>(`${path.artifact(notebookId, artifactId)}/blocks`),
    ),

  /**
   * Monotonic: a block once read stays read, and the server enforces it.
   *
   * **Indexes, not ids.** `NoteBlock` is a discriminated union with no id
   * field — the contract identifies a block by its position in the array
   * `listNoteBlocks` returned, which is stable because blocks are written once
   * at generation and never reordered.
   *
   * Returns the whole `Artifact` so the reader's readiness updates from one
   * response rather than a second fetch.
   */
  markBlocksRead: (notebookId, artifactId, blockIndexes) =>
    call(
      async () =>
        await api.post<Artifact>(`${path.artifact(notebookId, artifactId)}/blocks`, {
          blockIndexes,
        }),
    ),

  // ── Chat ─────────────────────────────────────────────────────────────────

  /**
   * `POST /decks/:id/ask` — still the deck-shaped path.
   *
   * **Not renamed at FR7, deliberately.** Grounded chat retrieves over
   * `chunk_embeddings`, which is keyed by the pre-FR7 deck model and was not
   * part of this phase's rewrite. Renaming the route without re-parenting the
   * chunks would be a cosmetic change that made the wire lie about what it
   * reaches. Brief §6.4 leaves chat organisation deliberately open, and this is
   * the honest state of it until that is decided.
   */
  ask: (notebookId, input) =>
    call(async () => {
      const wire = await api.post<{
        answer: string | null;
        citations: { chunkId: string; deckId: string; marker: number; excerpt: string }[];
      }>(`/decks/${encodeURIComponent(notebookId)}/ask`, { question: input.question });
      return {
        id: `ask-${Date.now()}`,
        question: input.question,
        answer: wire.answer,
        citations: wire.citations.map(citation => ({
          sourceId: citation.chunkId,
          sourceTitle: 'Source passage',
          marker: citation.marker,
          excerpt: citation.excerpt,
        })),
      };
    }),

  // ── Jobs ─────────────────────────────────────────────────────────────────

  getJob: (notebookId, jobId) =>
    call(
      async () =>
        await api.get<Job>(
          `${path.notebook(notebookId)}/jobs/${encodeURIComponent(jobId)}`,
        ),
    ),

  listJobs: notebookId =>
    call(async () => await api.get<Job[]>(`${path.notebook(notebookId)}/jobs`)),

  // ── Aggregates ───────────────────────────────────────────────────────────
  //
  // All five reduced server-side. `getReviewHistory` takes ~70,000 review rows
  // to ≤365 day counts; `getRetention` takes thousands to one object;
  // `getTopicMastery` reads every active card in the notebook and returns one
  // row per topic. A client cannot produce those without fetching data no API
  // should ship — FR6 §6.3 has the counts.

  getReviewHistory: (notebookId, days) =>
    call(
      async () =>
        await api.get<ReviewHistory>(
          `${path.notebook(notebookId)}/stats/history?days=${days}`,
        ),
    ),

  getDueForecast: (notebookId, days) =>
    call(
      async () =>
        await api.get<DueForecast>(
          `${path.notebook(notebookId)}/stats/forecast?days=${days}`,
        ),
    ),

  getCardStates: notebookId =>
    call(
      async () => await api.get<CardStates>(`${path.notebook(notebookId)}/stats/states`),
    ),

  getRetention: (notebookId, days) =>
    call(
      async () =>
        await api.get<RetentionSummary>(
          `${path.notebook(notebookId)}/stats/retention?days=${days}`,
        ),
    ),

  getTopicMastery: notebookId =>
    call(
      async () =>
        await api.get<TopicMasteryReport>(
          `${path.notebook(notebookId)}/stats/mastery`,
        ),
    ),
};

export type {
  Artifact,
  Attempt,
  CardStates,
  DueForecast,
  NoteBlock,
  Question,
  RetentionSummary,
  ReviewHistory,
  Source,
};
