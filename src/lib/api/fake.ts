import type {
  AddSourceInput,
  ApiClient,
  ApiErrorCode,
  Artifact,
  ArtifactKind,
  AskInput,
  AskResponse,
  Attempt,
  AttemptAnswer,
  Card,
  CardStates,
  CreateArtifactInput,
  CreateNotebookInput,
  DueForecast,
  GlobalSummary,
  Job,
  JobStage,
  NoteBlock,
  Notebook,
  Page,
  PageRequest,
  PracticeQueue,
  Profile,
  Question,
  Readiness,
  RetentionSummary,
  Review,
  ReviewCardInput,
  ReviewHistory,
  Source,
  SubmitAttemptInput,
  TopicSummary,
  UpdateCardInput,
  UpdateNotebookInput,
  UpdateProfileInput,
  UploadRequest,
  UploadTicket,
} from './contract';
import { ApiClientError } from './contract';
import * as fixtures from './fixtures';
import { addStudyDays, resolveTimeZone, startOfStudyDay, studyDayKey } from '../day';
import { GENERATION_QUOTA } from '../quota';

/**
 * An in-memory `ApiClient`. **The default implementation** (`VITE_API_MODE`
 * defaults to `fake`), so `npm run dev` works on a fresh clone with no
 * credentials and no second process.
 *
 * ── The rule this file runs under ─────────────────────────────────────────
 *
 * > **A fake may not have capabilities a real API could not have.**
 *
 * Brief §2.2. It is **unguarded** — a fake that lies typechecks perfectly — so
 * it is a discipline enforced by reading, and this comment is where the reading
 * starts. Three things it forbids, and how each is honoured here:
 *
 * 1. **No pre-joined graphs.** `getNotebook` returns a notebook, not a notebook
 *    with its sources and artifacts nested inside. A screen needing three things
 *    makes three calls, because that is what it will do at FR7.
 * 2. **No synchronous returns for things that are jobs.** `addSource` and
 *    `createArtifact` return a queued `Job` and nothing exists yet; successive
 *    `getJob` calls advance it over wall-clock time.
 * 3. **No ignoring pagination, and no computing across tenants.** Lists page.
 *    Aggregates are notebook-scoped, except `getGlobalSummary`, which the
 *    contract sanctions explicitly.
 *
 * The honest exception is **readiness**, which is computed rather than stored.
 * A real API can compute a roll-up server-side — that is precisely why brief
 * §2.1 rejected `json-server` — so computing it here is legitimate. What would
 * not be legitimate is computing it from data the client could not have.
 *
 * ── Latency and errors are dialable, and that is the point ────────────────
 *
 * `fake.configure({ latencyMs, failNext })`. A fake with only a happy path is
 * `json-server` with extra steps: the generation surface, the quota refusal and
 * the error states are the hardest things to design and the ones a happy path
 * never shows. See `configure` below.
 */

// ---------------------------------------------------------------------------
// Configuration — the knob FR4 depends on entirely
// ---------------------------------------------------------------------------

export interface FakeConfig {
  /**
   * Artificial delay on every call, in milliseconds. Default 250 — slow enough
   * that a missing loading state is visible, fast enough to work in.
   *
   * Set it to 2000 to design skeletons honestly; set it to 0 for a fast loop.
   */
  latencyMs: number;
  /**
   * Fail the **next** call with this code, then clear. One-shot, because that
   * is what "click generate and see the quota error" needs — a permanent
   * failure mode makes the surface unreachable again afterwards.
   */
  failNext: ApiErrorCode | null;
  /**
   * Fail **every** call with this code until cleared. For designing a
   * persistent error surface (an offline banner, a dead-backend state).
   */
  failAlways: ApiErrorCode | null;
  /**
   * How long a generation job takes, end to end, in milliseconds. Default 12s.
   * The stages divide this, so a shorter value speeds up the whole progress
   * surface without changing its shape.
   */
  jobDurationMs: number;
  /**
   * Make the next job fail — at the stage named, or immediately.
   *
   * `'immediately'` is the case worth designing for and the one most likely to
   * be forgotten: a quota refusal happens at submission with `unitsTotal` still
   * 0, so the progress surface must render a job that failed before any stage
   * reported. That is not the same as "no progress yet".
   */
  failNextJob: { at: JobStage | 'immediately'; code: ApiErrorCode } | null;
  /** Make the next job partially fail — some units lost, `truncated: true`. */
  truncateNextJob: boolean;
}

const config: FakeConfig = {
  latencyMs: 250,
  failNext: null,
  failAlways: null,
  jobDurationMs: 12_000,
  failNextJob: null,
  truncateNextJob: false,
};

/**
 * Dial the fake. Partial: what you do not pass is left alone.
 *
 * Exposed on `window.fakeApi` in dev (see `index.ts`) so it can be driven from
 * the console without a rebuild — which is how an error state gets *looked at*
 * rather than reasoned about.
 */
export function configure(next: Partial<FakeConfig>): void {
  Object.assign(config, next);
}

/** Read the current settings — for a dev panel that wants to show them. */
export function currentConfig(): Readonly<FakeConfig> {
  return { ...config };
}

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: 'You are signed out. Sign in and try again.',
  forbidden: 'That belongs to someone else.',
  not_found: 'That does not exist, or it has been deleted.',
  invalid_input: 'The server rejected that as invalid.',
  quota_exceeded: 'You have used this month’s generation allowance.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  input_too_long: 'That source is too long to generate from in one go.',
  refused: 'The model declined to answer that.',
  provider_error: 'The generation provider failed. Try again.',
  stale_card: 'That card was already rated somewhere else.',
  network: 'The network did not carry that request.',
  not_implemented: 'Not implemented.',
  internal: 'Something went wrong.',
};

function fail(code: ApiErrorCode): never {
  throw new ApiClientError(code, ERROR_MESSAGES[code]);
}

/** Every method funnels through here: the latency and the injected failures. */
async function gate<T>(produce: () => T): Promise<T> {
  if (config.latencyMs > 0) {
    await new Promise(resolve => setTimeout(resolve, config.latencyMs));
  }
  if (config.failAlways !== null) fail(config.failAlways);
  if (config.failNext !== null) {
    const code = config.failNext;
    config.failNext = null;
    fail(code);
  }
  return produce();
}

// ---------------------------------------------------------------------------
// The store
//
// Mutable module state, seeded from fixtures. Deliberately not persisted: a
// fake that survives a reload is a fake whose state drifts from its fixtures,
// and "reload to reset" is worth more during design than continuity is.
// ---------------------------------------------------------------------------

interface Store {
  profile: Profile;
  notebooks: Notebook[];
  sources: Source[];
  artifacts: Artifact[];
  cards: Card[];
  reviews: Review[];
  attempts: Attempt[];
  questions: Record<string, Question[]>;
  noteBlocks: Record<string, NoteBlock[]>;
  jobs: Job[];
  /** Units of generation spent this month — what quota counts. */
  unitsUsed: number;
}

function seed(): Store {
  return {
    profile: { ...fixtures.profile },
    notebooks: fixtures.notebooks.map(notebook => ({ ...notebook })),
    sources: fixtures.sources.map(source => ({ ...source })),
    artifacts: fixtures.artifacts.map(artifact => ({ ...artifact })),
    cards: fixtures.cards.map(card => ({ ...card })),
    reviews: fixtures.reviews.map(review => ({ ...review })),
    attempts: fixtures.attempts.map(attempt => ({ ...attempt })),
    questions: structuredClone(fixtures.questions),
    noteBlocks: structuredClone(fixtures.noteBlocks),
    jobs: [],
    unitsUsed: 47,
  };
}

let store = seed();

/** Throw away every runtime change. For a dev panel, and for a reset button. */
export function reset(): void {
  store = seed();
}

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Scoping — the fake's stand-in for `where user_id = $1`
// ---------------------------------------------------------------------------

/**
 * Resolve a notebook or fail with `not_found`.
 *
 * **Every notebook-scoped method calls this first**, and then filters by the
 * resolved id — the fake's equivalent of the server's mandatory
 * `where notebook_id = $1`. A method that took `notebookId` and ignored it
 * would typecheck perfectly and would design screens that work with the wrong
 * scope, which is the exact failure this whole re-architecture is unwinding.
 */
function notebookOr404(notebookId: string): Notebook {
  const found = store.notebooks.find(notebook => notebook.id === notebookId);
  if (!found) fail('not_found');
  return found;
}

function artifactOr404(notebookId: string, artifactId: string): Artifact {
  const found = store.artifacts.find(
    artifact => artifact.id === artifactId && artifact.notebookId === notebookId,
  );
  if (!found) fail('not_found');
  return found;
}

/**
 * One page of a list. The cursor is an offset, encoded so callers cannot
 * meaningfully construct one — the contract says it is opaque, and a fake that
 * makes it obviously an integer invites code that adds one to it.
 */
function paginate<T>(items: T[], page?: PageRequest): Page<T> {
  const limit = Math.min(Math.max(page?.limit ?? 50, 1), 200);
  const offset = page?.cursor ? Number.parseInt(atob(page.cursor), 10) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    items: slice,
    nextCursor: next < items.length ? btoa(String(next)) : null,
  };
}

// ---------------------------------------------------------------------------
// Readiness and counts — computed on every read, as a real API would
// ---------------------------------------------------------------------------

function isDue(card: Card, at: number): boolean {
  return card.status === 'active' && card.fsrsState !== 'new' && Date.parse(card.due) <= at;
}

/** Recompute an artifact's payload counts and its readiness from live state. */
function projectArtifact(artifact: Artifact): Artifact {
  const at = Date.now();

  if (artifact.status !== 'ready') {
    return {
      ...artifact,
      readiness: {
        state: 'none',
        detail: artifact.status === 'generating' ? 'Generating…' : 'Generation failed',
      },
    };
  }

  switch (artifact.payload.kind) {
    case 'deck': {
      const own = store.cards.filter(card => card.artifactId === artifact.id);
      const active = own.filter(card => card.status === 'active');
      const due = active.filter(card => isDue(card, at)).length;
      const fresh = active.filter(card => card.fsrsState === 'new').length;
      return {
        ...artifact,
        readiness: readinessFor(
          due > 0 ? 'ready' : fresh > 0 ? 'partial' : 'none',
          due > 0
            ? `${due} card${due === 1 ? '' : 's'} due`
            : fresh > 0
              ? `${fresh} new card${fresh === 1 ? '' : 's'} to start`
              : own.length === 0
                ? 'No cards'
                : 'Nothing due today',
        ),
        payload: {
          kind: 'deck',
          cardCount: own.length,
          dueCount: due,
          newCount: fresh,
        },
      };
    }
    case 'quiz': {
      const total = store.questions[artifact.id]?.length ?? 0;
      const answered = new Set(
        store.attempts
          .filter(attempt => attempt.artifactId === artifact.id)
          .flatMap(attempt =>
            attempt.answers
              .filter(answer => answer.selectedOption !== null)
              .map(answer => answer.questionId),
          ),
      ).size;
      const unsat = total - answered;
      return {
        ...artifact,
        readiness: readinessFor(
          unsat === total && total > 0 ? 'ready' : unsat > 0 ? 'partial' : 'none',
          total === 0
            ? 'No questions'
            : unsat > 0
              ? `${unsat} of ${total} question${total === 1 ? '' : 's'} unsat`
              : 'All questions sat',
        ),
        payload: { kind: 'quiz', questionCount: total, answeredCount: answered },
      };
    }
    case 'noteset': {
      const blocks = store.noteBlocks[artifact.id]?.length ?? 0;
      const read = Math.min(artifact.payload.readBlockCount, blocks);
      const unread = blocks - read;
      return {
        ...artifact,
        readiness: readinessFor(
          unread === blocks && blocks > 0 ? 'ready' : unread > 0 ? 'partial' : 'none',
          blocks === 0
            ? 'Empty'
            : unread > 0
              ? `${unread} of ${blocks} section${blocks === 1 ? '' : 's'} unread`
              : 'Read',
        ),
        payload: {
          kind: 'noteset',
          origin: artifact.payload.origin,
          blockCount: blocks,
          readBlockCount: read,
        },
      };
    }
    case 'exam': {
      const total = store.questions[artifact.id]?.length ?? 0;
      const sittings = store.attempts.filter(
        attempt => attempt.artifactId === artifact.id && attempt.outcome !== 'in-progress',
      ).length;
      return {
        ...artifact,
        readiness: readinessFor(
          total === 0 ? 'none' : sittings === 0 ? 'ready' : 'partial',
          total === 0
            ? 'No questions'
            : sittings === 0
              ? `${total} questions, never sat`
              : `Sat ${sittings} time${sittings === 1 ? '' : 's'}`,
        ),
        payload: {
          kind: 'exam',
          config: artifact.payload.config,
          blueprint: artifact.payload.blueprint,
          questionCount: total,
          attemptCount: sittings,
        },
      };
    }
  }
}

function readinessFor(state: Readiness['state'], detail: string): Readiness {
  return { state, detail };
}

/** Recompute a notebook's counts and its readiness roll-up. */
function projectNotebook(notebook: Notebook): Notebook {
  const at = Date.now();
  const own = store.artifacts
    .filter(artifact => artifact.notebookId === notebook.id)
    .map(projectArtifact);
  const sourceCount = store.sources.filter(
    source => source.notebookId === notebook.id,
  ).length;
  const dueCards = store.cards.filter(
    card => card.notebookId === notebook.id && isDue(card, at),
  ).length;

  const ready = own.filter(artifact => artifact.readiness.state === 'ready');

  // "2 decks · 1 quiz ready" — the bundle, not a card count (brief §1.3). A new
  // artifact kind extends this without touching the home screen, which is the
  // property the card-count model lacked.
  const byKind = new Map<ArtifactKind, number>();
  for (const artifact of ready) {
    byKind.set(artifact.kind, (byKind.get(artifact.kind) ?? 0) + 1);
  }
  const LABELS: Record<ArtifactKind, [string, string]> = {
    deck: ['deck', 'decks'],
    quiz: ['quiz', 'quizzes'],
    noteset: ['note set', 'note sets'],
    exam: ['exam', 'exams'],
  };
  const parts = [...byKind.entries()].map(([kind, count]) => {
    const [one, many] = LABELS[kind];
    return `${count} ${count === 1 ? one : many}`;
  });

  const state: Readiness['state'] =
    ready.length > 0 ? 'ready' : own.length > 0 ? 'partial' : 'none';

  return {
    ...notebook,
    readiness: {
      state,
      detail:
        parts.length > 0
          ? `${parts.join(' · ')} ready`
          : own.length > 0
            ? 'Nothing ready right now'
            : sourceCount > 0
              ? 'Nothing generated yet'
              : 'Empty',
    },
    counts: { sources: sourceCount, artifacts: own.length, dueCards },
  };
}

// ---------------------------------------------------------------------------
// Jobs — the hard part, and the reason this design was chosen
// ---------------------------------------------------------------------------

/**
 * A job advancing over wall-clock time.
 *
 * **Nothing is scheduled and nothing runs in the background.** The job's state
 * is a pure function of how long ago it started, computed when `getJob` asks.
 * That matters for two reasons: a timer that keeps running after the fake is
 * reset leaks, and — more importantly — the real API works this way too. A
 * client polls and the server reports where it has got to; it is not pushed a
 * sequence of events.
 *
 * The stages divide `jobDurationMs` unevenly, in the proportions the real
 * pipeline spends: extraction and splitting are quick, the per-unit model calls
 * are nearly all of it.
 */
const STAGE_FRACTIONS: { stage: JobStage; through: number }[] = [
  { stage: 'queued', through: 0.05 },
  { stage: 'extracting', through: 0.15 },
  { stage: 'splitting', through: 0.25 },
  { stage: 'generating', through: 0.9 },
  { stage: 'saving', through: 1 },
];

interface PendingJob {
  job: Job;
  startedAtMs: number;
  unitsTotal: number;
  /** Applied to the store the first time the job is observed as finished. */
  commit: (truncated: boolean) => { artifactId: string | null; sourceId: string | null };
  failure: { at: JobStage | 'immediately'; code: ApiErrorCode } | null;
  truncate: boolean;
  committed: boolean;
}

const pending = new Map<string, PendingJob>();

function startJob(
  notebookId: string,
  kind: Job['kind'],
  unitsTotal: number,
  commit: PendingJob['commit'],
): Job {
  const job: Job = {
    id: id('job'),
    notebookId,
    kind,
    status: 'pending',
    stage: 'queued',
    unitsTotal: 0,
    unitsCompleted: 0,
    unitsFailed: 0,
    truncated: false,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    result: null,
  };

  const failure = config.failNextJob;
  config.failNextJob = null;
  const truncate = config.truncateNextJob;
  config.truncateNextJob = false;

  pending.set(job.id, {
    job,
    startedAtMs: Date.now(),
    unitsTotal,
    commit,
    failure,
    truncate,
    committed: false,
  });
  store.jobs.push(job);

  // A job that fails immediately never spends the quota. A job that runs does,
  // at submission, which is when a real pipeline reserves it.
  if (failure?.at !== 'immediately') store.unitsUsed += unitsTotal;

  return advanceJob(job.id);
}

/** Where the job has got to, computed now. Mutates the stored row and returns it. */
function advanceJob(jobId: string): Job {
  const entry = pending.get(jobId);
  const stored = store.jobs.find(job => job.id === jobId);
  if (!entry || !stored) fail('not_found');

  const elapsed = Date.now() - entry.startedAtMs;
  const progress = Math.min(elapsed / config.jobDurationMs, 1);

  const stage =
    STAGE_FRACTIONS.find(({ through }) => progress <= through)?.stage ?? 'saving';

  // Failing immediately: no stage ever reports, `unitsTotal` stays 0. The case
  // a progress surface is most likely to render as "still starting".
  if (entry.failure?.at === 'immediately') {
    Object.assign(stored, {
      status: 'failed',
      stage: 'queued',
      unitsTotal: 0,
      error: { code: entry.failure.code, message: ERROR_MESSAGES[entry.failure.code] },
      updatedAt: nowIso(),
    } satisfies Partial<Job>);
    return { ...stored };
  }

  // `unitsTotal` is unknown until splitting — the same window the real pipeline
  // has, and the one that renders as NaN% without a guard.
  const unitsTotal = progress >= 0.25 ? entry.unitsTotal : 0;
  const generating = Math.max(0, Math.min((progress - 0.25) / 0.65, 1));
  const unitsCompleted = Math.floor(generating * entry.unitsTotal);

  if (entry.failure && stage === entry.failure.at) {
    Object.assign(stored, {
      status: 'failed',
      stage,
      unitsTotal,
      unitsCompleted,
      error: { code: entry.failure.code, message: ERROR_MESSAGES[entry.failure.code] },
      updatedAt: nowIso(),
    } satisfies Partial<Job>);
    return { ...stored };
  }

  if (progress >= 1) {
    const truncated = entry.truncate;
    if (!entry.committed) {
      entry.committed = true;
      stored.result = entry.commit(truncated);
    }
    Object.assign(stored, {
      status: 'succeeded',
      stage: 'done',
      unitsTotal: entry.unitsTotal,
      unitsCompleted: truncated ? entry.unitsTotal - 1 : entry.unitsTotal,
      unitsFailed: truncated ? 1 : 0,
      truncated,
      updatedAt: nowIso(),
    } satisfies Partial<Job>);
    return { ...stored };
  }

  Object.assign(stored, {
    status: progress > 0.05 ? 'running' : 'pending',
    stage,
    unitsTotal,
    unitsCompleted,
    updatedAt: nowIso(),
  } satisfies Partial<Job>);
  return { ...stored };
}

// ---------------------------------------------------------------------------
// Generated content
//
// Placeholder text that SAYS it is placeholder, for the same reason the
// pipeline's `stub` card provider does: content that looks real but is not is
// content someone will screenshot, or study from.
// ---------------------------------------------------------------------------

function generatedCards(artifact: Artifact, count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    id: id('card'),
    artifactId: artifact.id,
    notebookId: artifact.notebookId,
    topicId: null,
    payload: {
      kind: 'basic' as const,
      front: `[fake] Question ${index + 1} generated for “${artifact.title}”`,
      back: '[fake] This card came from the in-memory fake, not from a model.',
    },
    sourceExcerpt: null,
    status: 'active' as const,
    fsrsState: 'new' as const,
    due: nowIso(),
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
}

function generatedQuestions(artifact: Artifact, count: number): Question[] {
  return Array.from({ length: count }, (_, index) => ({
    id: id('q'),
    topicId: null,
    topicName: null,
    payload: {
      kind: 'mcq' as const,
      stem: `[fake] Question ${index + 1} for “${artifact.title}”`,
      options: [
        { text: '[fake] The correct option', correct: true },
        { text: '[fake] A distractor', correct: false },
        { text: '[fake] Another distractor', correct: false },
      ],
      explanation: '[fake] Generated by the in-memory fake.',
    },
  }));
}

function generatedBlocks(artifact: Artifact): NoteBlock[] {
  return [
    { type: 'heading', level: 1, text: artifact.title },
    {
      type: 'paragraph',
      text: '[fake] These notes came from the in-memory fake, not from a model.',
    },
    {
      type: 'list',
      ordered: false,
      items: ['[fake] First point', '[fake] Second point', '[fake] Third point'],
    },
  ];
}

function snapshotOf(notebookId: string, sourceIds: string[]): Artifact['sourcesSnapshot'] {
  return sourceIds.flatMap(sourceId => {
    const source = store.sources.find(
      candidate => candidate.id === sourceId && candidate.notebookId === notebookId,
    );
    return source ? [{ sourceId, title: source.title, kind: source.kind }] : [];
  });
}

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

function countableReviews(notebookId?: string): Review[] {
  return store.reviews.filter(
    review =>
      review.undoneAt === null &&
      (notebookId === undefined || review.notebookId === notebookId),
  );
}

function streakDays(zone: string): number {
  const days = new Set(
    countableReviews().map(review => studyDayKey(new Date(review.reviewedAt), zone)),
  );
  const today = studyDayKey(new Date(), zone);
  // A streak that has not been broken *yet* still counts if today is idle — the
  // day is not over. Starting from yesterday when today is empty is what makes
  // the number stop feeling punitive at breakfast.
  let cursor = days.has(today) ? today : addStudyDays(today, -1);
  let run = 0;
  while (days.has(cursor)) {
    run += 1;
    cursor = addStudyDays(cursor, -1);
  }
  return run;
}

// ---------------------------------------------------------------------------
// The implementation
// ---------------------------------------------------------------------------

export const fakeClient: ApiClient = {
  // ── Profile ──────────────────────────────────────────────────────────────

  getProfile: tz =>
    gate(() => {
      // Seeds the zone only if the row has none — the same "first request wins"
      // rule the real API applies, so a later call cannot silently reset it.
      if (store.profile.timezone === '') store.profile.timezone = tz;
      return { ...store.profile };
    }),

  updateProfile: input =>
    gate(() => {
      const next: UpdateProfileInput = input;
      if (next.displayName !== undefined) store.profile.displayName = next.displayName;
      if (next.timezone !== undefined) store.profile.timezone = next.timezone;
      if (next.dailyNewLimit !== undefined) {
        store.profile.dailyNewLimit = next.dailyNewLimit;
      }
      return { ...store.profile };
    }),

  getQuota: () =>
    gate(() => ({
      used: store.unitsUsed,
      remaining: Math.max(0, GENERATION_QUOTA.monthlyUnits - store.unitsUsed),
      limit: GENERATION_QUOTA.monthlyUnits,
      resetsAt: new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
      ).toISOString(),
    })),

  getGlobalSummary: () =>
    gate(() => {
      const at = Date.now();
      const zone = resolveTimeZone(store.profile.timezone);
      const dayStart = startOfStudyDay(new Date(), zone).getTime();
      const fresh = store.cards.filter(
        card => card.status === 'active' && card.fsrsState === 'new',
      ).length;
      const introduced = countableReviews().filter(
        review =>
          review.stateBefore === 'new' && Date.parse(review.reviewedAt) >= dayStart,
      ).length;
      return {
        dueNow: store.cards.filter(card => isDue(card, at)).length,
        newAvailable: Math.min(
          fresh,
          Math.max(0, store.profile.dailyNewLimit - introduced),
        ),
        reviewedToday: countableReviews().filter(
          review => Date.parse(review.reviewedAt) >= dayStart,
        ).length,
        streakDays: streakDays(zone),
        timeZone: zone,
      } satisfies GlobalSummary;
    }),

  // ── Notebooks ────────────────────────────────────────────────────────────

  listNotebooks: page =>
    gate(() =>
      paginate(
        [...store.notebooks]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(projectNotebook),
        page,
      ),
    ),

  getNotebook: notebookId => gate(() => projectNotebook(notebookOr404(notebookId))),

  createNotebook: input =>
    gate(() => {
      const parsed: CreateNotebookInput = input;
      const notebook: Notebook = {
        id: id('nb'),
        title: parsed.title,
        description: parsed.description ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        readiness: { state: 'none', detail: 'Empty' },
        counts: { sources: 0, artifacts: 0, dueCards: 0 },
      };
      store.notebooks.push(notebook);
      return projectNotebook(notebook);
    }),

  updateNotebook: (notebookId, input) =>
    gate(() => {
      const notebook = notebookOr404(notebookId);
      const next: UpdateNotebookInput = input;
      if (next.title !== undefined) notebook.title = next.title;
      if (next.description !== undefined) notebook.description = next.description ?? null;
      notebook.updatedAt = nowIso();
      return projectNotebook(notebook);
    }),

  deleteNotebook: notebookId =>
    gate(() => {
      notebookOr404(notebookId);
      // Everything belonging to it goes with it (brief §6 q1). Artifacts survive
      // their *sources* being deleted; they do not survive their notebook.
      const artifactIds = new Set(
        store.artifacts
          .filter(artifact => artifact.notebookId === notebookId)
          .map(artifact => artifact.id),
      );
      for (const artifactId of artifactIds) {
        delete store.questions[artifactId];
        delete store.noteBlocks[artifactId];
      }
      store.notebooks = store.notebooks.filter(notebook => notebook.id !== notebookId);
      store.sources = store.sources.filter(source => source.notebookId !== notebookId);
      store.artifacts = store.artifacts.filter(
        artifact => artifact.notebookId !== notebookId,
      );
      store.cards = store.cards.filter(card => card.notebookId !== notebookId);
      store.reviews = store.reviews.filter(review => review.notebookId !== notebookId);
      store.attempts = store.attempts.filter(
        attempt => attempt.notebookId !== notebookId,
      );
    }),

  // ── Sources ──────────────────────────────────────────────────────────────

  listSources: (notebookId, page) =>
    gate(() => {
      notebookOr404(notebookId);
      return paginate(
        store.sources
          .filter(source => source.notebookId === notebookId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        page,
      );
    }),

  getSource: (notebookId, sourceId) =>
    gate(() => {
      notebookOr404(notebookId);
      const source = store.sources.find(
        candidate => candidate.id === sourceId && candidate.notebookId === notebookId,
      );
      if (!source) fail('not_found');
      return { ...source };
    }),

  requestUpload: (notebookId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const request: UploadRequest = input;
      // A real presigned URL the browser could PUT to. The fake has nowhere to
      // put bytes, so `addSource` accepts the key without ever reading it —
      // which is honest: the key is a reference, and the fake has no object
      // store behind it.
      return {
        uploadUrl: `https://fake.invalid/upload/${encodeURIComponent(request.filename)}`,
        objectKey: `uploads/fake/${id('obj')}`,
        expiresInSeconds: 900,
      } satisfies UploadTicket;
    }),

  addSource: (notebookId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const parsed: AddSourceInput = input;
      const title =
        parsed.kind === 'url' ? (parsed.title ?? parsed.url) : parsed.title;

      const source: Source = {
        id: id('src'),
        notebookId,
        kind: parsed.kind,
        title,
        status: 'processing',
        error: null,
        sizeBytes: parsed.kind === 'text' ? parsed.text.length : null,
        createdAt: nowIso(),
        topicNames: [],
      };
      store.sources.push(source);

      // Chunk count scales with the input, the way the real splitter's does.
      const units = parsed.kind === 'text' ? Math.max(1, Math.ceil(parsed.text.length / 4000)) : 6;

      return startJob(notebookId, 'add-source', units, truncated => {
        source.status = 'ready';
        source.topicNames = ['[fake] Extracted topic'];
        if (truncated) {
          source.error = 'Some sections could not be read.';
        }
        return { artifactId: null, sourceId: source.id };
      });
    }),

  deleteSource: (notebookId, sourceId) =>
    gate(() => {
      notebookOr404(notebookId);
      const exists = store.sources.some(
        source => source.id === sourceId && source.notebookId === notebookId,
      );
      if (!exists) fail('not_found');
      // Artifacts are NOT touched (brief §1.2(7)). Their `sourceIds` now dangle
      // and their `sourcesSnapshot` still describes what they were built from.
      // Deliberate, and the reason the fixtures ship one already dangling.
      store.sources = store.sources.filter(source => source.id !== sourceId);
    }),

  // ── Topics ───────────────────────────────────────────────────────────────

  listTopics: notebookId =>
    gate(() => {
      notebookOr404(notebookId);
      const own = store.cards.filter(
        card => card.notebookId === notebookId && card.status === 'active',
      );
      const byTopic = new Map<string, { cards: Card[] }>();
      let unfiled = 0;

      for (const card of own) {
        if (card.topicId === null) {
          unfiled += 1;
          continue;
        }
        const bucket = byTopic.get(card.topicId) ?? { cards: [] };
        bucket.cards.push(card);
        byTopic.set(card.topicId, bucket);
      }

      // Names come from the source metadata, reconciled by name and scoped to
      // this notebook (ADR 0009, brief §1.2(5)). The fake keeps a small lookup
      // rather than deriving one, because the fixtures' topic ids are readable.
      const NAMES: Record<string, string> = {
        'top-pharm-beta': 'Beta-lactams',
        'top-pharm-resist': 'Resistance mechanisms',
        'top-pharm-pk': 'Pharmacokinetics',
        'top-pharm-antifungal': 'Antifungals',
        'top-neuro-brainstem': 'Brainstem',
      };

      return {
        topics: [...byTopic.entries()].map(([topicId, bucket]) => ({
          id: topicId,
          notebookId,
          name: NAMES[topicId] ?? topicId,
          slug: topicId,
          cardCount: bucket.cards.length,
          reviewedCount: bucket.cards.filter(card => card.reps > 0).length,
        })),
        unfiledCards: unfiled,
      } satisfies TopicSummary;
    }),

  // ── Artifacts ────────────────────────────────────────────────────────────

  listArtifacts: (notebookId, filter) =>
    gate(() => {
      notebookOr404(notebookId);
      const kind = filter?.kind;
      return paginate(
        store.artifacts
          .filter(
            artifact =>
              artifact.notebookId === notebookId &&
              (kind === undefined || artifact.kind === kind),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(projectArtifact),
        filter,
      );
    }),

  getArtifact: (notebookId, artifactId) =>
    gate(() => projectArtifact(artifactOr404(notebookId, artifactId))),

  createArtifact: (notebookId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const parsed: CreateArtifactInput = input;

      // No cross-notebook sources (brief §1.2(6)). Rejected rather than
      // silently filtered: a caller that sent a foreign id has a bug, and
      // dropping it quietly generates from less material than was asked for.
      const owned = new Set(
        store.sources
          .filter(source => source.notebookId === notebookId)
          .map(source => source.id),
      );
      if (parsed.sourceIds.some(sourceId => !owned.has(sourceId))) fail('invalid_input');

      const units = Math.max(1, parsed.sourceIds.length * 3);
      if (store.unitsUsed + units > GENERATION_QUOTA.monthlyUnits) fail('quota_exceeded');

      const base = {
        id: id('art'),
        notebookId,
        title: parsed.title,
        sourceIds: [...parsed.sourceIds],
        sourcesSnapshot: snapshotOf(notebookId, parsed.sourceIds),
        status: 'generating' as const,
        readiness: { state: 'none' as const, detail: 'Generating…' },
        createdAt: nowIso(),
      };

      const artifact: Artifact =
        parsed.kind === 'deck'
          ? {
              ...base,
              kind: 'deck',
              payload: { kind: 'deck', cardCount: 0, dueCount: 0, newCount: 0 },
            }
          : parsed.kind === 'quiz'
            ? {
                ...base,
                kind: 'quiz',
                payload: { kind: 'quiz', questionCount: 0, answeredCount: 0 },
              }
            : parsed.kind === 'noteset'
              ? {
                  ...base,
                  kind: 'noteset',
                  payload: {
                    kind: 'noteset',
                    origin: parsed.fromResponseId === undefined ? 'generated' : 'chat',
                    blockCount: 0,
                    readBlockCount: 0,
                  },
                }
              : {
                  ...base,
                  kind: 'exam',
                  payload: {
                    kind: 'exam',
                    config: parsed.config,
                    blueprint: parsed.blueprint ?? {
                      basis: 'card-counts',
                      weights: [
                        {
                          topicId: null,
                          topicName: 'Unfiled',
                          questions: parsed.config.questionCount,
                        },
                      ],
                    },
                    questionCount: 0,
                    attemptCount: 0,
                  },
                };

      store.artifacts.push(artifact);

      return startJob(notebookId, 'create-artifact', units, () => {
        artifact.status = 'ready';
        switch (parsed.kind) {
          case 'deck':
            store.cards.push(...generatedCards(artifact, parsed.cardCount));
            break;
          case 'quiz':
            store.questions[artifact.id] = generatedQuestions(
              artifact,
              parsed.questionCount,
            );
            break;
          case 'exam':
            store.questions[artifact.id] = generatedQuestions(
              artifact,
              parsed.config.questionCount,
            );
            break;
          case 'noteset':
            store.noteBlocks[artifact.id] = generatedBlocks(artifact);
            break;
        }
        return { artifactId: artifact.id, sourceId: null };
      });
    }),

  updateArtifact: (notebookId, artifactId, input) =>
    gate(() => {
      const artifact = artifactOr404(notebookId, artifactId);
      artifact.title = input.title;
      return projectArtifact(artifact);
    }),

  deleteArtifact: (notebookId, artifactId) =>
    gate(() => {
      artifactOr404(notebookId, artifactId);
      store.artifacts = store.artifacts.filter(artifact => artifact.id !== artifactId);
      store.cards = store.cards.filter(card => card.artifactId !== artifactId);
      store.attempts = store.attempts.filter(
        attempt => attempt.artifactId !== artifactId,
      );
      delete store.questions[artifactId];
      delete store.noteBlocks[artifactId];
    }),

  // ── Cards ────────────────────────────────────────────────────────────────

  listCards: (notebookId, artifactId, page) =>
    gate(() => {
      artifactOr404(notebookId, artifactId);
      return paginate(
        store.cards.filter(card => card.artifactId === artifactId),
        page,
      );
    }),

  updateCard: (notebookId, cardId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const card = store.cards.find(
        candidate => candidate.id === cardId && candidate.notebookId === notebookId,
      );
      if (!card) fail('not_found');
      const next: UpdateCardInput = input;
      // Content only. The schedule is untouched, which is the whole reason
      // content and scheduling are separate fields.
      card.payload = next.payload;
      card.updatedAt = nowIso();
      return { ...card };
    }),

  setCardStatus: (notebookId, cardIds, status) =>
    gate(() => {
      notebookOr404(notebookId);
      const ids: string[] = [];
      for (const card of store.cards) {
        if (card.notebookId !== notebookId || !cardIds.includes(card.id)) continue;
        card.status = status;
        card.updatedAt = nowIso();
        ids.push(card.id);
      }
      return { ids };
    }),

  deleteCards: (notebookId, cardIds) =>
    gate(() => {
      notebookOr404(notebookId);
      const doomed = store.cards.filter(
        card => card.notebookId === notebookId && cardIds.includes(card.id),
      );
      const ids = doomed.map(card => card.id);
      store.cards = store.cards.filter(card => !ids.includes(card.id));
      return { ids };
    }),

  // ── Practice ─────────────────────────────────────────────────────────────

  getPracticeQueue: (notebookId, artifactId) =>
    gate(() => {
      notebookOr404(notebookId);
      const at = Date.now();
      const zone = resolveTimeZone(store.profile.timezone);
      const dayStart = startOfStudyDay(new Date(), zone).getTime();

      const scope = store.cards.filter(
        card =>
          card.notebookId === notebookId &&
          card.status === 'active' &&
          (artifactId === undefined || card.artifactId === artifactId),
      );

      const due = scope
        .filter(card => isDue(card, at))
        .sort((a, b) => a.due.localeCompare(b.due));
      const fresh = scope.filter(card => card.fsrsState === 'new');

      const notYet = scope
        .filter(card => card.fsrsState !== 'new' && Date.parse(card.due) > at)
        .sort((a, b) => a.due.localeCompare(b.due));

      return {
        due,
        fresh,
        introducedToday: countableReviews(notebookId).filter(
          review =>
            review.stateBefore === 'new' && Date.parse(review.reviewedAt) >= dayStart,
        ).length,
        dailyNewLimit: store.profile.dailyNewLimit,
        nextDueAt: notYet[0]?.due ?? null,
        fetchedAt: nowIso(),
      } satisfies PracticeQueue;
    }),

  reviewCard: (notebookId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const parsed: ReviewCardInput = input;
      const card = store.cards.find(
        candidate =>
          candidate.id === parsed.cardId && candidate.notebookId === notebookId,
      );
      if (!card) fail('not_found');
      // The optimistic-concurrency check, byte for byte. An expected outcome of
      // two open tabs, not a crash — which is why it has its own code.
      if (card.updatedAt !== parsed.expectedUpdatedAt) fail('stale_card');

      store.reviews.push({
        id: id('rev'),
        cardId: card.id,
        notebookId,
        rating: parsed.grade,
        stateBefore: card.fsrsState,
        stabilityAfter: parsed.next.stability,
        difficultyAfter: parsed.next.difficulty,
        durationMs: parsed.durationMs,
        reviewedAt: nowIso(),
        undoneAt: null,
      });

      Object.assign(card, {
        fsrsState: parsed.next.fsrsState,
        due: parsed.next.due,
        stability: parsed.next.stability,
        difficulty: parsed.next.difficulty,
        reps: parsed.next.reps,
        lapses: parsed.next.lapses,
        lastReviewedAt: parsed.next.lastReviewedAt,
        updatedAt: nowIso(),
      } satisfies Partial<Card>);

      return { ...card };
    }),

  undoReview: (notebookId, cardId) =>
    gate(() => {
      notebookOr404(notebookId);
      const card = store.cards.find(
        candidate => candidate.id === cardId && candidate.notebookId === notebookId,
      );
      if (!card) fail('not_found');

      const last = [...store.reviews]
        .filter(review => review.cardId === cardId && review.undoneAt === null)
        .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];
      if (!last) fail('not_found');

      // Tombstoned, never deleted — the row is the audit trail.
      last.undoneAt = nowIso();
      card.fsrsState = last.stateBefore;
      card.reps = Math.max(0, card.reps - 1);
      card.updatedAt = nowIso();
      return { ...card };
    }),

  // ── Questions and attempts ───────────────────────────────────────────────

  listQuestions: (notebookId, artifactId) =>
    gate(() => {
      artifactOr404(notebookId, artifactId);
      return (store.questions[artifactId] ?? []).map(question => ({ ...question }));
    }),

  startAttempt: (notebookId, artifactId) =>
    gate(() => {
      const artifact = artifactOr404(notebookId, artifactId);
      if (artifact.kind !== 'quiz' && artifact.kind !== 'exam') fail('invalid_input');

      // A quiz is resumable: rejoin the sitting in progress rather than
      // starting a second one beside it (§1.2(3)).
      if (artifact.kind === 'quiz') {
        const open = store.attempts.find(
          attempt =>
            attempt.artifactId === artifactId && attempt.outcome === 'in-progress',
        );
        if (open) return { ...open };
      }

      const attempt: Attempt = {
        id: id('att'),
        notebookId,
        artifactId,
        artifactKind: artifact.kind,
        outcome: 'in-progress',
        startedAt: nowIso(),
        submittedAt: null,
        answers: [],
        score: null,
      };
      store.attempts.push(attempt);
      return { ...attempt };
    }),

  saveAttemptProgress: (notebookId, attemptId, answers) =>
    gate(() => {
      notebookOr404(notebookId);
      const attempt = store.attempts.find(
        candidate => candidate.id === attemptId && candidate.notebookId === notebookId,
      );
      if (!attempt) fail('not_found');
      if (attempt.outcome !== 'in-progress') fail('invalid_input');
      attempt.answers = answers.map((answer: AttemptAnswer) => ({ ...answer }));
      return { ...attempt };
    }),

  submitAttempt: (notebookId, attemptId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const attempt = store.attempts.find(
        candidate => candidate.id === attemptId && candidate.notebookId === notebookId,
      );
      if (!attempt) fail('not_found');
      const parsed: SubmitAttemptInput = input;

      attempt.answers = parsed.answers.map(answer => ({ ...answer }));
      attempt.outcome = parsed.outcome;
      attempt.submittedAt = nowIso();
      const answered = attempt.answers.filter(answer => answer.selectedOption !== null);
      attempt.score =
        answered.length === 0
          ? // Not zero: a sitting where nothing was answered has no score, and a
            // 0% on the results screen would be a claim about performance.
            null
          : answered.filter(answer => answer.correct).length / answered.length;
      return { ...attempt };
    }),

  getAttempt: (notebookId, attemptId) =>
    gate(() => {
      notebookOr404(notebookId);
      const attempt = store.attempts.find(
        candidate => candidate.id === attemptId && candidate.notebookId === notebookId,
      );
      if (!attempt) fail('not_found');
      return { ...attempt };
    }),

  listAttempts: (notebookId, filter) =>
    gate(() => {
      notebookOr404(notebookId);
      const artifactId = filter?.artifactId;
      return paginate(
        store.attempts
          .filter(
            attempt =>
              attempt.notebookId === notebookId &&
              (artifactId === undefined || attempt.artifactId === artifactId),
          )
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        filter,
      );
    }),

  // ── Notes ────────────────────────────────────────────────────────────────

  listNoteBlocks: (notebookId, artifactId) =>
    gate(() => {
      artifactOr404(notebookId, artifactId);
      return (store.noteBlocks[artifactId] ?? []).map(block => ({ ...block }));
    }),

  markBlocksRead: (notebookId, artifactId, blockIndexes) =>
    gate(() => {
      const artifact = artifactOr404(notebookId, artifactId);
      if (artifact.payload.kind !== 'noteset') fail('invalid_input');
      const total = store.noteBlocks[artifactId]?.length ?? 0;
      const read = Math.min(
        total,
        Math.max(artifact.payload.readBlockCount, blockIndexes.length),
      );
      artifact.payload = { ...artifact.payload, readBlockCount: read };
      return projectArtifact(artifact);
    }),

  // ── Chat ─────────────────────────────────────────────────────────────────

  ask: (notebookId, input) =>
    gate(() => {
      notebookOr404(notebookId);
      const parsed: AskInput = input;
      const ready = store.sources.filter(
        source => source.notebookId === notebookId && source.status === 'ready',
      );
      const grounding =
        parsed.sourceIds.length === 0
          ? ready
          : ready.filter(source => parsed.sourceIds.includes(source.id));

      // No sources means no grounded answer, and `answer: null` is a SUCCESS
      // (the sources do not cover it) rather than an error. A fake that returned
      // prose here would design away the empty state entirely.
      if (grounding.length === 0) {
        return {
          id: id('ask'),
          question: parsed.question,
          answer: null,
          citations: [],
        } satisfies AskResponse;
      }

      return {
        id: id('ask'),
        question: parsed.question,
        answer:
          '[fake] This answer came from the in-memory fake, not from a model. ' +
          `It would be grounded in ${grounding.length} source` +
          `${grounding.length === 1 ? '' : 's'} [1].`,
        citations: grounding.slice(0, 3).map((source, index) => ({
          sourceId: source.id,
          sourceTitle: source.title,
          marker: index + 1,
          excerpt: '[fake] The passage the answer would have drawn on.',
        })),
      } satisfies AskResponse;
    }),

  // ── Jobs ─────────────────────────────────────────────────────────────────

  getJob: (notebookId, jobId) =>
    gate(() => {
      notebookOr404(notebookId);
      const stored = store.jobs.find(
        job => job.id === jobId && job.notebookId === notebookId,
      );
      if (!stored) fail('not_found');
      return advanceJob(jobId);
    }),

  listJobs: notebookId =>
    gate(() => {
      notebookOr404(notebookId);
      return store.jobs
        .filter(job => job.notebookId === notebookId)
        .map(job => advanceJob(job.id));
    }),

  // ── Aggregates ───────────────────────────────────────────────────────────

  getReviewHistory: (notebookId, days) =>
    gate(() => {
      notebookOr404(notebookId);
      const zone = resolveTimeZone(store.profile.timezone);
      const today = studyDayKey(new Date(), zone);
      const counts = new Map<string, number>();

      for (const review of countableReviews(notebookId)) {
        const day = studyDayKey(new Date(review.reviewedAt), zone);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }

      const buckets: ReviewHistory['days'] = [];
      let total = 0;
      for (let offset = days - 1; offset >= 0; offset--) {
        const day = addStudyDays(today, -offset);
        const reviews = counts.get(day) ?? 0;
        total += reviews;
        // Every day in the window is emitted, including empty ones — a heatmap
        // built from only the non-zero days has no gaps to render.
        buckets.push({ day, reviews });
      }

      return { timeZone: zone, today, days: buckets, total } satisfies ReviewHistory;
    }),

  getDueForecast: (notebookId, days) =>
    gate(() => {
      notebookOr404(notebookId);
      const zone = resolveTimeZone(store.profile.timezone);
      const today = studyDayKey(new Date(), zone);
      const at = Date.now();
      const dayStart = startOfStudyDay(new Date(), zone).getTime();

      const scope = store.cards.filter(
        card => card.notebookId === notebookId && card.status === 'active',
      );
      const introduced = countableReviews(notebookId).filter(
        review =>
          review.stateBefore === 'new' && Date.parse(review.reviewedAt) >= dayStart,
      ).length;
      const freshToday = Math.min(
        scope.filter(card => card.fsrsState === 'new').length,
        Math.max(0, store.profile.dailyNewLimit - introduced),
      );

      const buckets: DueForecast['days'] = [];
      for (let offset = 0; offset < days; offset++) {
        const day = addStudyDays(today, offset);
        const due = scope.filter(card => {
          if (card.fsrsState === 'new') return false;
          const dueAt = Date.parse(card.due);
          // Day 0 carries everything overdue, so it equals what practice would
          // serve this minute rather than only what falls due today.
          return offset === 0
            ? dueAt <= at || studyDayKey(new Date(card.due), zone) === day
            : studyDayKey(new Date(card.due), zone) === day;
        }).length;
        buckets.push({ day, due, fresh: offset === 0 ? freshToday : 0 });
      }

      return { timeZone: zone, takenAt: nowIso(), days: buckets } satisfies DueForecast;
    }),

  getCardStates: notebookId =>
    gate(() => {
      notebookOr404(notebookId);
      const scope = store.cards.filter(card => card.notebookId === notebookId);
      const active = scope.filter(card => card.status === 'active');
      const withStability = active.filter(
        (card): card is Card & { stability: number } => card.stability !== null,
      );
      const withDifficulty = active.filter(
        (card): card is Card & { difficulty: number } => card.difficulty !== null,
      );

      const mean = (values: number[]): number | null =>
        values.length === 0
          ? // A mean of nothing is null, not zero. Zero stability is a claim.
            null
          : values.reduce((sum, value) => sum + value, 0) / values.length;

      return {
        counts: {
          new: active.filter(card => card.fsrsState === 'new').length,
          learning: active.filter(card => card.fsrsState === 'learning').length,
          review: active.filter(card => card.fsrsState === 'review').length,
          relearning: active.filter(card => card.fsrsState === 'relearning').length,
          suspended: scope.filter(card => card.status === 'suspended').length,
        },
        meanStability: mean(withStability.map(card => card.stability)),
        meanDifficulty: mean(withDifficulty.map(card => card.difficulty)),
      } satisfies CardStates;
    }),

  getRetention: (notebookId, days) =>
    gate(() => {
      notebookOr404(notebookId);
      const from = Date.now() - days * 86_400_000;
      // A review of a new card is the card being introduced, not recalled —
      // counting it would inflate retention with every first sighting.
      const window = countableReviews(notebookId).filter(
        review =>
          Date.parse(review.reviewedAt) >= from && review.stateBefore !== 'new',
      );

      const rate = (rows: Review[]): number | null =>
        rows.length === 0 ? null : rows.filter(row => row.rating >= 2).length / rows.length;

      const byState: RetentionSummary['byState'] = {
        new: null,
        learning: rate(window.filter(review => review.stateBefore === 'learning')),
        review: rate(window.filter(review => review.stateBefore === 'review')),
        relearning: rate(window.filter(review => review.stateBefore === 'relearning')),
      };

      return {
        windowDays: days,
        overall: rate(window),
        byState,
        reviewed: window.length,
        recalled: window.filter(review => review.rating >= 2).length,
      } satisfies RetentionSummary;
    }),
};
