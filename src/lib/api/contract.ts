import { z } from 'zod';

import {
  CardPayload,
  ExamConfig,
  GENERATION_LIMITS,
  GradeSchema,
  McqPayload,
} from '../schemas';

/**
 * **The contract. This interface is the FR7 backend's specification.**
 *
 * If you have arrived here cold to rebuild `services/api/`, this file is what
 * you are building. Every method on `ApiClient` below is a route the backend
 * must serve, and every schema above it is a shape it must return. Nothing else
 * in the frontend defines these nouns — that is the point.
 *
 * ── Why an interface of named methods, and not `api.get<T>(path)` ─────────
 *
 * The old seam was verb-shaped: `api.get<T>('/decks')` takes a string and a
 * caller-asserted type parameter, so nothing can implement it *differently* in
 * a way TypeScript checks. A fake behind that seam would have to parse URLs and
 * guess what `T` was meant to be, and drift between fake and real would surface
 * as a 404 at runtime rather than as a compile error.
 *
 * So this file declares one interface of named methods with typed arguments and
 * typed returns; `client.ts` and `fake.ts` are two implementations of it. That
 * is what makes drift a compile error, and it is the whole reason FR0 exists
 * (brief §2.2(1)).
 *
 * ── The model, in one line ────────────────────────────────────────────────
 *
 * **The notebook is the only first-class citizen.** Sources, artifacts, topics,
 * attempts and reviews belong to exactly one notebook and have no existence
 * outside it. Every notebook-scoped method therefore takes `notebookId` as its
 * required first parameter — never optional, never defaulted, never inferred
 * from a heuristic. A surface that cannot name its notebook is not a valid
 * surface (brief §1), and a defaulted scope is how a bug becomes silent — the
 * same argument CLAUDE.md's data-access rule 1 makes on the server side.
 *
 * ── One Zod definition per concept ────────────────────────────────────────
 *
 * CLAUDE.md's standing rule. After FR0 the home for these entity shapes is this
 * file. `CardPayload`, `McqPayload`, `ExamConfig`, `GradeSchema` and
 * `GENERATION_LIMITS` are **imported** from `schemas.ts` rather than redefined,
 * because those shapes are model-independent and earned their place (brief
 * §1.4). What is *not* imported is anything built on the old flat model —
 * `DeckInput`, `StartJobRequest`'s `deckTitle` — which stays where it is,
 * serving the running app until FR7.
 */

// ---------------------------------------------------------------------------
// Errors — part of the contract, because FR4 designs against them
// ---------------------------------------------------------------------------

/**
 * Every way a call in this interface can fail, as a closed union.
 *
 * The vocabulary is not invented: it extends the `StreamEvent` error codes
 * already in use (`schemas.ts`) with the transport-level codes today's
 * `ApiError` carries. A closed union means a surface can `switch` on it and
 * TypeScript will say when a new code has no handler — which is the property
 * FR4 needs to design the generation and error surfaces properly.
 */
export const ApiErrorCode = z.enum([
  /** Signed out, or the token has expired and could not be refreshed. */
  'unauthorized',
  /** Authenticated, but this is not yours. Deliberately distinct from `not_found`. */
  'forbidden',
  'not_found',
  /** The request body failed validation. `issues` carries the field-level messages. */
  'invalid_input',
  /** The monthly generation allowance is used up. */
  'quota_exceeded',
  /** The provider or the API is throttling. Retryable, after a wait. */
  'rate_limited',
  /** The source text exceeds what the model can be given. */
  'input_too_long',
  /** The model declined to answer. Not an error the user can fix by retrying. */
  'refused',
  /** The model or the embedding vendor failed. Retryable. */
  'provider_error',
  /**
   * The card was rated somewhere else first — `expectedUpdatedAt` did not
   * match. An expected outcome of two open tabs, not a crash.
   */
  'stale_card',
  /** The network did not carry the request. Retryable. */
  'network',
  /**
   * **The route exists in this contract and not yet in the backend.**
   *
   * `client.ts` throws this rather than inventing data. FR0 §6 tabulates every
   * method that does; that table is FR7's build list.
   */
  'not_implemented',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * The error every method in this interface rejects with.
 *
 * A class rather than a plain object so `instanceof` works at a catch site that
 * may also see a `TypeError` from a broken fetch. `client.ts` maps the
 * transport's `ApiError` onto this; `fake.ts` constructs it directly, which is
 * how error states become dialable.
 */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** Field-level messages from a server-side Zod parse, if any. */
    readonly issues?: { path: string; message: string }[],
    /** The HTTP status, where there was one. Absent for fake-injected errors. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** Narrow an unknown catch value. The only sanctioned way to read a code. */
export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * An ISO 8601 timestamp, as the server produced it.
 *
 * A string rather than a `Date`, and deliberately: the optimistic-concurrency
 * token on a review is compared byte for byte, so a value that has been through
 * a `Date` and back can fail to match one that is otherwise identical. Parse at
 * the edge that renders, never in transit.
 */
export const Timestamp = z.string().min(1);

/**
 * A study day, `YYYY-MM-DD`, in the user's timezone. Not a timestamp: which day
 * a review falls in depends on a zone, and the server applies it.
 */
export const StudyDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Readiness — what a thing is worth doing right now (brief §1.3).
 *
 * Replaces the raw card count that was the app's only signal. `state` is what a
 * badge renders; `detail` is the sentence beside it ("12 cards due", "3 of 8
 * questions unsat"). Both are computed, never stored.
 *
 * **This is the one legitimate roll-up in the contract, and it is worth saying
 * why.** FR0's rule is that `fake.ts` may not have capabilities a real API could
 * not have, and a computed roll-up looks superficially like a violation. It is
 * not: a real API computes this server-side in SQL, which is precisely why
 * brief §2.1 rejected `json-server` — that returns stored rows and cannot.
 * What the fake must not do is compute it from data a client would not have.
 */
export const Readiness = z.object({
  state: z.enum(['ready', 'partial', 'none']),
  /** Human-readable and already counted. Rendered as text, never as HTML. */
  detail: z.string(),
});
export type Readiness = z.infer<typeof Readiness>;

/**
 * One page of a list.
 *
 * **Paginated here because it would be paginated at FR7** (FR0 §3(3)). A fake
 * that returns every row of everything designs screens that have never seen a
 * second page, and the second page is where they break. `cursor` is opaque:
 * callers pass back what they were given and never construct one.
 */
export interface Page<T> {
  items: T[];
  /** Null when this is the last page. */
  nextCursor: string | null;
}

/** What every paginated method accepts. Both fields optional; defaults are the server's. */
export interface PageRequest {
  cursor?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------

/**
 * The only top-level object.
 *
 * `readiness` is the roll-up across this notebook's artifacts ("2 decks · 1 quiz
 * ready"), computed server-side. `counts` is the cheap summary a notebook card
 * on the home grid needs *without* fetching the notebook's contents — a home
 * screen that had to list every notebook's artifacts to render a grid would be
 * N+1 requests. That is a real API's problem too, and so it is solved here the
 * way a real API would solve it: a few aggregate columns, not a nested graph.
 */
export const Notebook = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  readiness: Readiness,
  counts: z.object({
    sources: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    /** Cards due across every deck in this notebook, right now. */
    dueCards: z.number().int().nonnegative(),
  }),
});
export type Notebook = z.infer<typeof Notebook>;

export const CreateNotebookInput = z.object({
  title: z.string().trim().min(1, 'Give the notebook a title').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type CreateNotebookInput = z.infer<typeof CreateNotebookInput>;

export const UpdateNotebookInput = CreateNotebookInput.partial();
export type UpdateNotebookInput = z.infer<typeof UpdateNotebookInput>;

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const SourceKind = z.enum(['document', 'text', 'url']);
export type SourceKind = z.infer<typeof SourceKind>;

/**
 * Material a notebook is built from — **persisted, not session state.**
 *
 * The current app holds these in `useState([])`, so they vanish on refresh and
 * nothing generated can say what it came from (brief §0). A source is an entity
 * with an id because artifacts point at it.
 *
 * `status` exists because adding a source is a job: the text must be extracted,
 * chunked and embedded before the source can ground anything. A source that is
 * `processing` is real and listable but not yet usable as generation input, and
 * the UI has to be able to say so rather than offering it and failing.
 */
export const Source = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  kind: SourceKind,
  title: z.string().trim().min(1).max(255),
  status: z.enum(['processing', 'ready', 'failed']),
  /** Why it failed, for a source the pipeline could not read. Null otherwise. */
  error: z.string().nullable(),
  /** Bytes for a document, characters for a paste. Null while unknown. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: Timestamp,
  /**
   * Topic metadata from the chunking pipeline (brief §1.2(5)).
   *
   * These are the raw per-source names. A notebook's topics are reconciled from
   * its sources' — by name (ADR 0009), and **notebook-scoped**, which is the fix
   * for the live cross-notebook bug. `listTopics` returns the reconciled result.
   */
  topicNames: z.array(z.string().min(1)),
});
export type Source = z.infer<typeof Source>;

/**
 * Adding a source. Exactly one of a document, a paste or a URL.
 *
 * A discriminated union rather than three optional fields with a refinement,
 * because "exactly one" expressed as a refinement is a runtime check and
 * expressed as a union is a compile-time one. The old `StartJobRequest` used
 * the refinement, and it is the shape a caller most often gets wrong.
 *
 * `objectKey` is the key returned by `requestUpload`. It is re-derived and
 * re-checked server-side against the caller's own prefix rather than trusted:
 * a key is not a capability, and one arriving in a request body could name
 * anyone's object.
 */
export const AddSourceInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('document'),
    objectKey: z.string().trim().min(1).max(1024),
    title: z.string().trim().min(1).max(255),
  }),
  z.object({
    kind: z.literal('text'),
    text: z
      .string()
      .trim()
      .min(GENERATION_LIMITS.minChars)
      .max(GENERATION_LIMITS.maxChars),
    title: z.string().trim().min(1).max(255),
  }),
  z.object({
    kind: z.literal('url'),
    url: z.string().url(),
    title: z.string().trim().min(1).max(255).optional(),
  }),
]);
export type AddSourceInput = z.infer<typeof AddSourceInput>;

export const UploadRequest = z.object({
  /**
   * The user's own filename. Display only — it never becomes the object key,
   * which is generated server-side. A filename is untrusted input and a key
   * built from one is a path-traversal bug waiting to be written.
   */
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** Where to PUT a document, and what to reference afterwards. */
export const UploadTicket = z.object({
  uploadUrl: z.string().url(),
  /** The object key, to hand to `addSource`. Not a URL, and not secret. */
  objectKey: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

/**
 * A topic, reconciled across one notebook's sources.
 *
 * **Notebook-scoped, and that scope is the fix.** The live app reconciles
 * topics per user, so a two-notebook account weights one subject's exam by
 * another subject's topics (DS4 §0). Reconciliation stays by-name (ADR 0009);
 * what changes is the scope it runs in.
 */
export const Topic = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  slug: z.string().min(1),
  /** Active cards filed under this topic, across this notebook's decks. */
  cardCount: z.number().int().nonnegative(),
  /** Of those, how many have been reviewed at least once. */
  reviewedCount: z.number().int().nonnegative(),
});
export type Topic = z.infer<typeof Topic>;

export const TopicSummary = z.object({
  topics: z.array(Topic),
  /**
   * Active cards in this notebook carrying no topic at all.
   *
   * Not a topic and not an error — a card's topic is nullable by design. Shown
   * as an "Unfiled" row rather than dropped, because weights computed over only
   * the topiced cards claim to describe all of the user's material while
   * describing a subset.
   */
  unfiledCards: z.number().int().nonnegative(),
});
export type TopicSummary = z.infer<typeof TopicSummary>;

// ---------------------------------------------------------------------------
// Artifact — the central move (brief §1.1)
// ---------------------------------------------------------------------------

export const ArtifactKind = z.enum(['deck', 'quiz', 'noteset', 'exam']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ARTIFACT_KINDS = ArtifactKind.options;

/**
 * A source as it was when an artifact was generated from it.
 *
 * **This is why artifacts survive source deletion** (brief §1.2(7)). The ids in
 * `Artifact.sourceIds` may dangle; this snapshot still says what the artifact
 * was built from. Same principle as ADR 0013 — a pointer is not the meaning.
 */
export const SourceSnapshot = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  kind: SourceKind,
});
export type SourceSnapshot = z.infer<typeof SourceSnapshot>;

/**
 * One block of a note set. **Never one text blob** (brief §1.2(2)).
 *
 * A blob would make the later editor a migration: block-level editing,
 * reordering and citation anchoring cannot be added to a string without
 * re-parsing content that was never structured. So the structure exists from
 * day one, even though FR5 only reads it.
 *
 * **Rendered as text, never as HTML.** These blocks are untrusted LLM output.
 * A renderer producing elements is required; `dangerouslySetInnerHTML` is
 * ESLint-blocked and must stay that way (CLAUDE.md).
 */
export const NoteBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string(),
  }),
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal('quote'),
    text: z.string(),
    /** The source this passage came from, if still known. **May dangle.** */
    sourceId: z.string().min(1).nullable(),
  }),
]);
export type NoteBlock = z.infer<typeof NoteBlock>;

/**
 * A question, as a quiz or an exam asks it.
 *
 * **A question is not a card, and this is the seam that keeps it that way.** A
 * card fuses content with FSRS scheduling state; a question answered once under
 * time is not on a schedule at all. Forcing questions into cards means nullable
 * scheduling columns and a weakened constraint — compromising the flashcard
 * model to accommodate a different one.
 *
 * Free-text is deliberately absent: grading it needs a model and a rubric.
 */
export const Question = z.object({
  id: z.string().min(1),
  payload: McqPayload,
  topicId: z.string().min(1).nullable(),
  topicName: z.string().min(1).nullable(),
});
export type Question = z.infer<typeof Question>;

/**
 * How an exam is weighted across topics (brief §1.2(9)).
 *
 * **The blueprint belongs to the exam, not the notebook.** That is what finally
 * gives a blueprint something to blueprint: a per-notebook blueprint describes
 * an exam that does not exist, so nothing can be checked against it.
 */
export const BlueprintWeight = z.object({
  /** Null is the "Unfiled" row — real material with no topic. */
  topicId: z.string().min(1).nullable(),
  topicName: z.string().min(1),
  /** Questions allocated to this topic. Sums to the exam's `questionCount`. */
  questions: z.number().int().nonnegative(),
});
export type BlueprintWeight = z.infer<typeof BlueprintWeight>;

export const Blueprint = z.object({
  weights: z.array(BlueprintWeight),
  /** How the weights were arrived at, for a UI that must explain itself. */
  basis: z.enum(['card-counts', 'mastery', 'manual']),
});
export type Blueprint = z.infer<typeof Blueprint>;

/**
 * The kind-specific half of an artifact — a discriminated union on `kind`.
 *
 * **One kind-tagged noun, not four types** (brief §1.1). This is the central
 * modelling move and the one a future session is most likely to try to
 * "simplify" back into four parallel tables. Do not. The single shape delivers,
 * at once: one list of everything a notebook has produced; provenance through
 * `sourceIds`; readiness bundling; and "more coming features" as a new `kind`
 * rather than a new subsystem.
 *
 * The payload is where a note set's blocks and an exam's blueprint each get a
 * home without any of that being given up.
 *
 * **Counts, not contents.** Cards, questions and blocks are fetched by their own
 * methods. Inlining them would be a pre-joined graph no list endpoint could
 * produce at a sane cost — the rule in FR0 §3(1).
 */
export const ArtifactPayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('deck'),
    cardCount: z.number().int().nonnegative(),
    dueCount: z.number().int().nonnegative(),
    newCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('quiz'),
    questionCount: z.number().int().nonnegative(),
    /** Questions answered at least once, across this quiz's attempts. */
    answeredCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('noteset'),
    /** Generated by the pipeline, or saved from a chat response (§1.2(4)). */
    origin: z.enum(['generated', 'chat']),
    blockCount: z.number().int().nonnegative(),
    /** Blocks the reader has marked read — what readiness counts. */
    readBlockCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('exam'),
    config: ExamConfig,
    blueprint: Blueprint,
    questionCount: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative(),
  }),
]);
export type ArtifactPayload = z.infer<typeof ArtifactPayload>;

/**
 * Anything generated from a notebook's sources.
 *
 * ── `sourceIds` may dangle, and that is a valid state ─────────────────────
 *
 * **Every consumer through FR6 must handle it.** Deleting a source does not
 * delete or invalidate the artifacts made from it (brief §1.2(7)), so an id in
 * `sourceIds` may name a source that `listSources` no longer returns. That is
 * expected, not an error, and code that treats it as one throws on ordinary
 * user behaviour.
 *
 * What to render instead is `sourcesSnapshot`, which is complete and never
 * dangles. **Use `sourceIds` to *link* to a source; use `sourcesSnapshot` to
 * *name* one.** `fixtures.ts` ships a dangling id precisely so this path is
 * exercised by anything built against the fake.
 */
export const Artifact = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  kind: ArtifactKind,
  title: z.string().trim().min(1).max(200),
  /** Provenance. **May contain ids no longer present in `listSources`.** */
  sourceIds: z.array(z.string().min(1)),
  /** What it was built from, frozen at generation. Never dangles. */
  sourcesSnapshot: z.array(SourceSnapshot),
  /**
   * `generating` is a real, listable state: `createArtifact` returns a job, and
   * the artifact exists in the list — greyed, unopenable — while the job runs.
   * `failed` keeps the row so the user can see what did not work, and retry.
   */
  status: z.enum(['generating', 'ready', 'failed']),
  readiness: Readiness,
  createdAt: Timestamp,
  payload: ArtifactPayload,
});
export type Artifact = z.infer<typeof Artifact>;

/**
 * What a generate modal collects (FR4).
 *
 * **No cross-notebook sources** (brief §1.2(6)): the server checks that every
 * id in `sourceIds` belongs to the notebook named in the path, and rejects the
 * request otherwise rather than silently dropping the foreign ones.
 */
export const CreateArtifactInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('deck'),
    title: z.string().trim().min(1).max(200),
    sourceIds: z.array(z.string().min(1)),
    cardCount: z
      .number()
      .int()
      .min(GENERATION_LIMITS.minCards)
      .max(GENERATION_LIMITS.maxCards),
    cardKinds: z.array(z.enum(['basic', 'cloze', 'mcq'])).min(1),
    depth: z.enum(['recall', 'balanced', 'deep']),
  }),
  z.object({
    kind: z.literal('quiz'),
    title: z.string().trim().min(1).max(200),
    sourceIds: z.array(z.string().min(1)),
    questionCount: z.number().int().min(1).max(50),
    depth: z.enum(['recall', 'balanced', 'deep']),
  }),
  z.object({
    kind: z.literal('noteset'),
    title: z.string().trim().min(1).max(200),
    sourceIds: z.array(z.string().min(1)),
    depth: z.enum(['recall', 'balanced', 'deep']),
    /**
     * Present when this note set is being saved from a chat response
     * (§1.2(4)) — the only committed requirement chat has on this contract.
     * Absent means an ordinary generation from sources.
     */
    fromResponseId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('exam'),
    title: z.string().trim().min(1).max(200),
    sourceIds: z.array(z.string().min(1)),
    config: ExamConfig,
    /** Omitted means "weight it for me" — the server derives from card counts. */
    blueprint: Blueprint.optional(),
  }),
]);
export type CreateArtifactInput = z.infer<typeof CreateArtifactInput>;

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const FsrsState = z.enum(['new', 'learning', 'review', 'relearning']);
export type FsrsState = z.infer<typeof FsrsState>;

/**
 * A card. Belongs to a deck artifact, which belongs to a notebook.
 *
 * **Cards are locked to their deck** (brief §1.2(8)): membership is fixed at
 * generation, which is why there is no move operation anywhere in this
 * interface and `artifactId` has no setter.
 *
 * `payload` is `CardPayload` **imported from `schemas.ts`** — the basic / cloze
 * / mcq union is model-independent and earned its place (brief §1.4). Do not
 * redefine it here or anywhere else.
 *
 * Content and scheduling are separate fields on purpose: editing a card must
 * never disturb its schedule.
 */
export const Card = z.object({
  id: z.string().min(1),
  /** The deck artifact this card belongs to. */
  artifactId: z.string().min(1),
  notebookId: z.string().min(1),
  topicId: z.string().min(1).nullable(),
  payload: CardPayload,
  /** The passage this card was generated from, where one is known. */
  sourceExcerpt: z.string().nullable(),
  status: z.enum(['active', 'suspended']),
  fsrsState: FsrsState,
  due: Timestamp,
  /** Null for a card that has never been reviewed — not zero. */
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  lastReviewedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  /**
   * The optimistic-concurrency token. Sent back byte for byte when rating, so
   * two tabs cannot both apply a grade to the same card state.
   */
  updatedAt: Timestamp,
});
export type Card = z.infer<typeof Card>;

/** Content only. Scheduling is never patched from the client. */
export const UpdateCardInput = z.object({ payload: CardPayload });
export type UpdateCardInput = z.infer<typeof UpdateCardInput>;

// ---------------------------------------------------------------------------
// Review — FSRS state, per card
// ---------------------------------------------------------------------------

/**
 * The scheduling state a grade produces, computed client-side and validated
 * server-side.
 *
 * `applyGrade` in `fsrs.ts` runs on the client and the result is sent as `next`.
 * The server validates the shape key by key and rejects anything else. That is
 * not the client being trusted: it is the client and the server sharing one
 * implementation of a pure function, so the interval the user was *shown* is the
 * interval that gets committed.
 */
export const NextSchedule = z.object({
  fsrsState: FsrsState,
  due: Timestamp,
  stability: z.number(),
  difficulty: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  lastReviewedAt: Timestamp,
});
export type NextSchedule = z.infer<typeof NextSchedule>;

export const ReviewCardInput = z.object({
  cardId: z.string().min(1),
  grade: GradeSchema,
  /** Null is a real value: a card may be rated before any timer started. */
  durationMs: z.number().int().nonnegative().nullable(),
  /** The card's `updatedAt`, byte for byte. A mismatch is `stale_card`. */
  expectedUpdatedAt: Timestamp,
  next: NextSchedule,
});
export type ReviewCardInput = z.infer<typeof ReviewCardInput>;

/** One logged rating. What `progress.ts` and `mastery.ts` aggregate. */
export const Review = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  notebookId: z.string().min(1),
  rating: GradeSchema,
  stateBefore: FsrsState,
  stabilityAfter: z.number().nullable(),
  difficultyAfter: z.number().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  reviewedAt: Timestamp,
  /** Set when undone. An undone rating is tombstoned, never deleted. */
  undoneAt: Timestamp.nullable(),
});
export type Review = z.infer<typeof Review>;

/**
 * A practice session's queue, as the server assembles it.
 *
 * **The reads, not the policy.** `buildQueue` and the daily new-card cap still
 * run on the client, because the same policy drives this queue, the home
 * screen's "new available" figure and the forecast's day 0 — a second
 * implementation server-side is how those three start disagreeing about what
 * today's allowance is. The server fetches; the client decides.
 */
export const PracticeQueue = z.object({
  due: z.array(Card),
  fresh: z.array(Card),
  introducedToday: z.number().int().nonnegative(),
  dailyNewLimit: z.number().int().nonnegative(),
  /** Soonest due time among cards not yet due — the empty state's sentence. */
  nextDueAt: Timestamp.nullable(),
  fetchedAt: Timestamp,
});
export type PracticeQueue = z.infer<typeof PracticeQueue>;

// ---------------------------------------------------------------------------
// Attempt — one sitting of a quiz or an exam
// ---------------------------------------------------------------------------

/**
 * One answer within an attempt.
 *
 * `questionText` is copied rather than joined for: it is the authority for what
 * the answer meant once the question behind it has been regenerated or deleted
 * (ADR 0013). `selectedOption` indexes into the **presented** option order,
 * which is why shuffling is resolved once when the attempt starts rather than at
 * render time — an index into an order that changes on re-render grades the
 * wrong option.
 */
export const AttemptAnswer = z.object({
  questionId: z.string().min(1),
  questionText: z.string().trim().min(1).max(4000),
  topicId: z.string().min(1).nullable(),
  topicName: z.string().min(1).nullable(),
  /** Null for a question the candidate never answered. */
  selectedOption: z.number().int().nonnegative().nullable(),
  correct: z.boolean(),
  /** Flagged for review. Real exams have this and candidates rely on it. */
  flagged: z.boolean(),
  elapsedMs: z.number().int().nonnegative().nullable(),
});
export type AttemptAnswer = z.infer<typeof AttemptAnswer>;

/** Why an attempt ended. `expired` is the timer running out. */
export const AttemptOutcome = z.enum([
  'in-progress',
  'submitted',
  'expired',
  'abandoned',
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

/**
 * One sitting of a quiz or an exam.
 *
 * **Quiz and exam are separate kinds with separate runners** (brief §1.2(3)) —
 * but they produce the same *record*, because what is recorded is the same
 * thing: which questions were answered, how, and whether they were right. The
 * difference is delivery — one-per-page, reveal-on-answer and repeatable versus
 * timed and simulated — and delivery lives in the runner, not here.
 *
 * A quiz attempt is **resumable**, which is why `outcome` carries
 * `'in-progress'` and answers accumulate through `saveAttemptProgress`. An exam
 * attempt is submitted whole.
 */
export const Attempt = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  /** The quiz or exam artifact sat. */
  artifactId: z.string().min(1),
  artifactKind: z.enum(['quiz', 'exam']),
  outcome: AttemptOutcome,
  startedAt: Timestamp,
  submittedAt: Timestamp.nullable(),
  answers: z.array(AttemptAnswer),
  /** Correct over answered. Null while in progress. */
  score: z.number().min(0).max(1).nullable(),
});
export type Attempt = z.infer<typeof Attempt>;

export const SubmitAttemptInput = z.object({
  answers: z.array(AttemptAnswer),
  outcome: z.enum(['submitted', 'expired', 'abandoned']),
});
export type SubmitAttemptInput = z.infer<typeof SubmitAttemptInput>;

// ---------------------------------------------------------------------------
// Job — anything that takes longer than a request
// ---------------------------------------------------------------------------

/**
 * A stage a job passes through.
 *
 * **Every stage here maps one-to-one onto a field the job reports.** That is the
 * constraint carried forward from `PipelineStages.tsx`, and it is the difference
 * between a progress display and a progress bar that lies. It would be easy to
 * write a prettier list — "Identifying topics", "Building your blueprint" — and
 * animate it on a timer; the ticks would then advance whether or not anything
 * happened, and two of those stages would describe work the pipeline does not do.
 *
 * So: **do not add a stage the pipeline could not report.** When the pipeline
 * grows a step, it grows a field, and the stage follows the field.
 */
export const JobStage = z.enum([
  /** The job exists. Always first. */
  'queued',
  /** Text is being read out of the source — `unitsTotal` becomes known here. */
  'extracting',
  /** The source has been divided: `unitsTotal > 0`. */
  'splitting',
  /** The model is being called per unit: `unitsCompleted` against `unitsTotal`. */
  'generating',
  /** Rows are being written. */
  'saving',
  /** Terminal. `status` says whether it worked. */
  'done',
]);
export type JobStage = z.infer<typeof JobStage>;

export const JOB_STAGES = JobStage.options;

export const JobKind = z.enum(['add-source', 'create-artifact']);
export type JobKind = z.infer<typeof JobKind>;

/**
 * Work that takes seconds to minutes. **Never resolved synchronously.**
 *
 * `addSource` and `createArtifact` return one of these, not the finished thing
 * (brief §2.2, FR0 §3(2)). A fake that returned a finished deck would design a
 * UI with no progress surface, and FR4 would then have to invent one against a
 * backend that always needed it.
 *
 * `result` is populated only on `succeeded` and names what was produced — the
 * caller then fetches it by id. Deliberately an id and not the object: inlining
 * the artifact here would be a pre-joined graph the API would have to assemble
 * specially, and the caller already has a method to fetch it.
 */
export const Job = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  kind: JobKind,
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  stage: JobStage,
  /** Units of work — chunks, for the current pipeline. 0 until known. */
  unitsTotal: z.number().int().nonnegative(),
  unitsCompleted: z.number().int().nonnegative(),
  unitsFailed: z.number().int().nonnegative(),
  /**
   * Some units failed but the job still produced something. The review gate's
   * whole reason for existing: the user should see what did *not* make it in.
   */
  truncated: z.boolean(),
  /**
   * Set on `failed`, and on a partial success worth explaining.
   *
   * **A job can fail before any stage reports** — a quota refusal happens at
   * submission, with `unitsTotal` still 0. Every surface polling a job must
   * render that case, and it is not the same as "no progress yet".
   */
  error: z
    .object({ code: ApiErrorCode, message: z.string() })
    .nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  result: z
    .object({
      artifactId: z.string().min(1).nullable(),
      sourceId: z.string().min(1).nullable(),
    })
    .nullable(),
});
export type Job = z.infer<typeof Job>;

// ---------------------------------------------------------------------------
// Chat — grounded questions over a notebook's sources
// ---------------------------------------------------------------------------

/**
 * **Chat is not a noun in this contract, and that is deliberate** (brief
 * §1.2(4)). Whether history is persisted per notebook is an open question, so
 * nothing here stores a conversation. One requirement is committed: saving a
 * single response as a note must be possible, which is why `AskResponse` carries
 * an id that `createArtifact({ kind: 'noteset', fromResponseId })` can cite.
 */
export const AskCitation = z.object({
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  /** The number the answer text cites, as `[1]`. */
  marker: z.number().int().positive(),
  excerpt: z.string(),
});
export type AskCitation = z.infer<typeof AskCitation>;

/**
 * `answer: null` is a **success**, not an error: it means the notebook's sources
 * do not cover the question. Saying so is the honest response, and it is a
 * different surface from a failed request.
 */
export const AskResponse = z.object({
  /** Identifies this response, so it can be saved as a note. */
  id: z.string().min(1),
  question: z.string(),
  answer: z.string().nullable(),
  citations: z.array(AskCitation),
});
export type AskResponse = z.infer<typeof AskResponse>;

export const AskInput = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(1000),
  /**
   * Ground the answer in these sources only. Empty means every ready source in
   * the notebook — a choice the UI makes explicit, not a default the server
   * invents.
   */
  sourceIds: z.array(z.string().min(1)),
});
export type AskInput = z.infer<typeof AskInput>;

// ---------------------------------------------------------------------------
// Profile and quota — survive unchanged from today
// ---------------------------------------------------------------------------

export const Profile = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
  /** An IANA zone name. It defines every day boundary in the app. */
  timezone: z.string().min(1),
  dailyNewLimit: z.number().int().nonnegative(),
  /** Per-user FSRS weights, once optimisation exists. Null means defaults. */
  fsrsParams: z.record(z.string(), z.number()).nullable(),
  createdAt: Timestamp,
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileInput = z.object({
  displayName: z.string().trim().max(100).nullable().optional(),
  timezone: z.string().trim().min(1).optional(),
  dailyNewLimit: z.number().int().min(0).max(500).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/**
 * How much of the monthly generation allowance is gone. **Advisory** — this
 * reports and `createArtifact` refuses. Showing it is what stops the refusal
 * being a surprise at submit time.
 */
export const QuotaUsage = z.object({
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  /** When the allowance resets — the 1st of next month, UTC. */
  resetsAt: Timestamp,
});
export type QuotaUsage = z.infer<typeof QuotaUsage>;

// ---------------------------------------------------------------------------
// Aggregates — what the notebook overview reads (FR6)
// ---------------------------------------------------------------------------

/**
 * Notebook-scoped review history, aggregated server-side.
 *
 * **Aggregated, and it has to be.** A serious user's year is tens of thousands
 * of review rows; this returns at most one per study day. The client cannot do
 * that reduction without fetching everything — which is exactly what the
 * Supabase version did, and exactly what a real API must not require.
 *
 * The day bucket depends on the user's timezone, so the *server* computes it
 * from the profile rather than accepting a client-supplied zone.
 */
export const ReviewHistory = z.object({
  timeZone: z.string().min(1),
  /** The study day the user is in — the heatmap's last cell. */
  today: StudyDay,
  days: z.array(
    z.object({ day: StudyDay, reviews: z.number().int().nonnegative() }),
  ),
  total: z.number().int().nonnegative(),
});
export type ReviewHistory = z.infer<typeof ReviewHistory>;

/**
 * What the next `days` study days cost, bucketed server-side.
 *
 * Day 0 carries overdue cards **and** today's remaining new-card allowance, so
 * it equals what practice would serve this minute.
 */
export const DueForecast = z.object({
  timeZone: z.string().min(1),
  takenAt: Timestamp,
  days: z.array(
    z.object({
      day: StudyDay,
      due: z.number().int().nonnegative(),
      fresh: z.number().int().nonnegative(),
    }),
  ),
});
export type DueForecast = z.infer<typeof DueForecast>;

/** The card-state mix, and the mean stability and difficulty behind it. */
export const CardStates = z.object({
  counts: z.object({
    new: z.number().int().nonnegative(),
    learning: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    relearning: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
  }),
  /** Null when nothing has been reviewed — a mean of nothing is not zero. */
  meanStability: z.number().nullable(),
  meanDifficulty: z.number().nullable(),
});
export type CardStates = z.infer<typeof CardStates>;

/**
 * Retention over a window: how often a card was recalled when it came up.
 *
 * Returned as figures rather than raw reviews. The Supabase version fetched
 * every review inside 90 days and computed this in the browser; a real API
 * computes it in SQL, and the difference is thousands of rows on the wire.
 */
export const RetentionSummary = z.object({
  windowDays: z.number().int().positive(),
  /** Null when nothing came up in the window — not zero, which means "all failed". */
  overall: z.number().min(0).max(1).nullable(),
  byState: z.record(FsrsState, z.number().min(0).max(1).nullable()),
  reviewed: z.number().int().nonnegative(),
  recalled: z.number().int().nonnegative(),
});
export type RetentionSummary = z.infer<typeof RetentionSummary>;

/**
 * Topic mastery across one notebook — **added by FR6, and the phase's one
 * contract change.**
 *
 * ── Why this had to become a method ───────────────────────────────────────
 *
 * `mastery.ts` combines two signals per topic: FSRS retention over the topic's
 * cards, and accuracy over the topic's exam answers. The second half is
 * already servable — `AttemptAnswer` carries `topicId`, `topicName` and
 * `correct`, and `listAttempts` is notebook-scoped. **The first half was not.**
 *
 * Retention needs every active card's `stability`, `difficulty` and
 * `lastReviewedAt`, grouped by `topicId`. Cards are listable only as
 * `listCards(notebookId, artifactId)` — per *deck* — because a deck's cards are
 * its contents and a notebook's cards are not a list any screen should page
 * through. So computing this on the client means one paginated call per deck
 * artifact, growing with the notebook: an N+1 assembled in the browser, which
 * is exactly the pre-joined graph FR0 §3(1) forbids, and what its rule about
 * `fake.ts` not having capabilities a real API could not have is protecting.
 *
 * It is the same argument `ReviewHistory` and `RetentionSummary` already won.
 * A real API computes this in SQL over `cards` joined to `topics`, filtered by
 * `notebook_id` — one query, at most a few dozen rows out — where the client
 * would need thousands of card rows to reach the same answer.
 *
 * **`mastery.ts` stays the model and does not move.** Brief §1.4 said the pure
 * modules keep their place, and they do: the fake calls `topicMastery` to
 * produce this, so the arithmetic has exactly one implementation. What changed
 * is *where it runs* — FR7 reimplements it in SQL, and the shape below is the
 * spec for that. The thresholds and bands (`masteryBand`, `divergenceKind`)
 * stay client-side, because they are presentation over this data, and a server
 * that baked them in would make a product decision unchangeable without a
 * deploy.
 *
 * The fields mirror `TopicMastery` in `src/lib/mastery.ts` exactly. That
 * mirroring is deliberate, and is the same relationship `Card` has with
 * `CardPayload`: the module is the pure model, this is the wire shape, and a
 * Zod schema is what makes the wire shape checkable.
 */
export const TopicMasteryEntry = z.object({
  /** Null for the "Unclassified" bucket — real material carrying no topic. */
  topicId: z.string().min(1).nullable(),
  topicName: z.string().min(1),
  /**
   * Mean predicted recall over the topic's *seen* cards, with the denominator
   * beside it. Null when no card in the topic has ever been reviewed — which is
   * not zero, and a UI rendering it as zero calls a new deck a catastrophe.
   */
  retention: z
    .object({
      recall: z.number().min(0).max(1),
      cards: z.number().int().nonnegative(),
      /** Cards in the topic never reviewed. Not evidence of anything yet. */
      newCards: z.number().int().nonnegative(),
    })
    .nullable(),
  /** Exam accuracy, or null when no attempt answer covered this topic. */
  exam: z
    .object({
      accuracy: z.number().min(0).max(1),
      correct: z.number().int().nonnegative(),
      answered: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The headline, confidence-weighted across whichever signals exist. */
  score: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1),
  /** `retention.recall - exam.accuracy`, or null when either signal is absent. */
  divergence: z.number().nullable(),
});
export type TopicMasteryEntry = z.infer<typeof TopicMasteryEntry>;

export const TopicMasteryReport = z.object({
  /** Weakest first; unmeasured topics last. The order a diagnostic reads in. */
  topics: z.array(TopicMasteryEntry),
  /**
   * Active cards the retention half was computed over, and attempt answers the
   * exam half was. **Shown, not implied** — the diagnostic's honesty banner
   * says what its numbers are made of, and it cannot count rows it never
   * fetched now that the aggregation happens server-side.
   */
  cardsConsidered: z.number().int().nonnegative(),
  answersConsidered: z.number().int().nonnegative(),
  /**
   * Attempt answers that could name no topic, and so contributed to no row.
   *
   * Not the same as having sat nothing: a user who has just finished an exam
   * whose questions carry no topic must not be told they have never sat one.
   * `DiagnosticPage` drew that distinction with a client-side filter; with the
   * filtering server-side, the count has to travel or the distinction is lost.
   */
  unattributedAnswers: z.number().int().nonnegative(),
});
export type TopicMasteryReport = z.infer<typeof TopicMasteryReport>;

/**
 * The home screen's global strip (brief §3.5) — **the one deliberately
 * cross-notebook aggregate in this contract.**
 *
 * Everything else is notebook-scoped, on purpose: a global figure that stands in
 * for a notebook is the `focus` guess the whole re-architecture exists to
 * delete. This is different, and the difference is that it names no notebook and
 * offers no action. "You reviewed 40 cards today" is a fact about the user;
 * "practice this" is a claim about a notebook, and only the second one needs a
 * subject.
 *
 * **So nothing on this shape may become a CTA.** A button hung off `dueNow`
 * would have to pick a notebook to send the user to, and picking one is the bug.
 * Every action on the home screen lives on a notebook card.
 */
export const GlobalSummary = z.object({
  /** Cards due right now, across every notebook. */
  dueNow: z.number().int().nonnegative(),
  /** New cards available today after the daily cap, across every notebook. */
  newAvailable: z.number().int().nonnegative(),
  reviewedToday: z.number().int().nonnegative(),
  /** Consecutive study days ending today, or ending yesterday if today is idle. */
  streakDays: z.number().int().nonnegative(),
  timeZone: z.string().min(1),
});
export type GlobalSummary = z.infer<typeof GlobalSummary>;

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

/**
 * **Everything the frontend can ask of a backend. The FR7 specification.**
 *
 * Two implementations exist and must both satisfy this with no cast, no `any`
 * and no `@ts-expect-error`: `fake.ts` (in-memory, the default) and `client.ts`
 * (fetch + Cognito against the live API). If an implementation needs a cast, the
 * contract is wrong — fix the contract, not the implementation.
 *
 * ── Three shapes that are not negotiable ──────────────────────────────────
 *
 * 1. **Every notebook-scoped method takes `notebookId` first**, required. This
 *    is the API-surface expression of "a surface that cannot name its notebook
 *    is not a valid surface", and it rhymes deliberately with CLAUDE.md's
 *    data-access rule 1: a default is how a bug becomes silent, on either side
 *    of the wire.
 * 2. **`addSource` and `createArtifact` return `Job`**, never the finished
 *    thing. Generation involves a model and takes seconds to minutes.
 * 3. **Errors are part of the contract.** Every method rejects with
 *    `ApiClientError` carrying an `ApiErrorCode`. Nothing rejects with a bare
 *    `Error` or a `Response`.
 *
 * ── What is not here, and why ─────────────────────────────────────────────
 *
 * There is no `getNotebookWithEverything`. A screen that needs a notebook, its
 * sources and its artifacts makes three calls, because that is what it will do
 * at FR7 (FR0 §3(1)). Nor is there a cross-notebook aggregate: every stat is
 * notebook-scoped, which is what makes the overview honest where the global
 * dashboard was not.
 */
export interface ApiClient {
  // ── Profile ──────────────────────────────────────────────────────────────

  /**
   * The signed-in user's profile. The server creates the row on first
   * authenticated request, so this never returns null for a signed-in user.
   *
   * `tz` seeds the row's timezone the first time it is created and is ignored
   * on every later call — without it a new account starts on UTC and quietly
   * gets the wrong day boundary.
   */
  getProfile(tz: string): Promise<Profile>;
  updateProfile(input: UpdateProfileInput): Promise<Profile>;

  /** The monthly generation allowance. Advisory; `createArtifact` enforces. */
  getQuota(): Promise<QuotaUsage>;

  /**
   * The home screen's global strip (§3.5). **The only method here that is not
   * notebook-scoped**, and it is scopeless because it names no notebook and
   * offers no action — see `GlobalSummary`.
   */
  getGlobalSummary(): Promise<GlobalSummary>;

  // ── Notebooks ────────────────────────────────────────────────────────────

  listNotebooks(page?: PageRequest): Promise<Page<Notebook>>;
  getNotebook(notebookId: string): Promise<Notebook>;
  createNotebook(input: CreateNotebookInput): Promise<Notebook>;
  updateNotebook(notebookId: string, input: UpdateNotebookInput): Promise<Notebook>;
  /**
   * Destructive. Deletes the notebook and everything belonging to it —
   * sources, artifacts, cards, reviews, attempts — because none of those has an
   * existence outside it (brief §1). The caller must confirm first.
   *
   * This does **not** contradict §1.2(7): an artifact surviving *its source's*
   * deletion is a different question from an artifact surviving the deletion of
   * the notebook that contains it. (Brief §6 q1, answered here.)
   */
  deleteNotebook(notebookId: string): Promise<void>;

  // ── Sources ──────────────────────────────────────────────────────────────

  listSources(notebookId: string, page?: PageRequest): Promise<Page<Source>>;
  getSource(notebookId: string, sourceId: string): Promise<Source>;
  /** A presigned PUT for a document. The browser uploads, then calls `addSource`. */
  requestUpload(notebookId: string, input: UploadRequest): Promise<UploadTicket>;
  /** **Returns a job.** Extraction, chunking and embedding take time. */
  addSource(notebookId: string, input: AddSourceInput): Promise<Job>;
  /**
   * Deleting a source does **not** delete artifacts made from it (§1.2(7)).
   * Their `sourceIds` are left dangling on purpose and `sourcesSnapshot` keeps
   * displaying what they were built from.
   */
  deleteSource(notebookId: string, sourceId: string): Promise<void>;

  // ── Topics ───────────────────────────────────────────────────────────────

  /** Reconciled across this notebook's sources only. Never across notebooks. */
  listTopics(notebookId: string): Promise<TopicSummary>;

  // ── Artifacts ────────────────────────────────────────────────────────────

  listArtifacts(
    notebookId: string,
    filter?: { kind?: ArtifactKind } & PageRequest,
  ): Promise<Page<Artifact>>;
  getArtifact(notebookId: string, artifactId: string): Promise<Artifact>;
  /** **Returns a job.** A model writes the contents; nothing is ready yet. */
  createArtifact(notebookId: string, input: CreateArtifactInput): Promise<Job>;
  updateArtifact(
    notebookId: string,
    artifactId: string,
    input: { title: string },
  ): Promise<Artifact>;
  deleteArtifact(notebookId: string, artifactId: string): Promise<void>;

  // ── Cards (a deck artifact's contents) ───────────────────────────────────

  listCards(
    notebookId: string,
    artifactId: string,
    page?: PageRequest,
  ): Promise<Page<Card>>;
  updateCard(
    notebookId: string,
    cardId: string,
    input: UpdateCardInput,
  ): Promise<Card>;
  /** Out of the queue without losing history. Reversible. */
  setCardStatus(
    notebookId: string,
    cardIds: string[],
    status: 'active' | 'suspended',
  ): Promise<{ ids: string[] }>;
  deleteCards(notebookId: string, cardIds: string[]): Promise<{ ids: string[] }>;

  // ── Practice ─────────────────────────────────────────────────────────────

  /**
   * The session's queue. `artifactId` narrows it to one deck; omitting it
   * queues every deck in the notebook — which is a scope *within* the notebook,
   * not a missing scope. `notebookId` is still required.
   */
  getPracticeQueue(notebookId: string, artifactId?: string): Promise<PracticeQueue>;
  /** Rejects with `stale_card` when `expectedUpdatedAt` no longer matches. */
  reviewCard(notebookId: string, input: ReviewCardInput): Promise<Card>;
  undoReview(notebookId: string, cardId: string): Promise<Card>;

  // ── Questions and attempts (quiz and exam) ───────────────────────────────

  /** The questions of a quiz or exam artifact, in stored order. */
  listQuestions(notebookId: string, artifactId: string): Promise<Question[]>;
  /**
   * Begin a sitting. Shuffling is resolved here, once, so the option order the
   * runner renders is the order the answers index into.
   */
  startAttempt(notebookId: string, artifactId: string): Promise<Attempt>;
  /**
   * Save an in-progress quiz attempt. **Quizzes are resumable** (§1.2(3)); an
   * exam is submitted whole and never calls this.
   */
  saveAttemptProgress(
    notebookId: string,
    attemptId: string,
    answers: AttemptAnswer[],
  ): Promise<Attempt>;
  submitAttempt(
    notebookId: string,
    attemptId: string,
    input: SubmitAttemptInput,
  ): Promise<Attempt>;
  getAttempt(notebookId: string, attemptId: string): Promise<Attempt>;
  listAttempts(
    notebookId: string,
    filter?: { artifactId?: string } & PageRequest,
  ): Promise<Page<Attempt>>;

  // ── Notes (a noteset artifact's contents) ────────────────────────────────

  listNoteBlocks(notebookId: string, artifactId: string): Promise<NoteBlock[]>;
  /** What readiness counts for a note set. Per block, so a reader can resume. */
  markBlocksRead(
    notebookId: string,
    artifactId: string,
    blockIndexes: number[],
  ): Promise<Artifact>;

  // ── Chat ─────────────────────────────────────────────────────────────────

  /** Grounded in this notebook's sources. `answer: null` is a success. */
  ask(notebookId: string, input: AskInput): Promise<AskResponse>;

  // ── Jobs ─────────────────────────────────────────────────────────────────

  getJob(notebookId: string, jobId: string): Promise<Job>;
  /** In-flight and recently finished jobs, so a reload can rejoin one. */
  listJobs(notebookId: string): Promise<Job[]>;

  // ── Aggregates (FR6's overview) ──────────────────────────────────────────

  getReviewHistory(notebookId: string, days: number): Promise<ReviewHistory>;
  getDueForecast(notebookId: string, days: number): Promise<DueForecast>;
  getCardStates(notebookId: string): Promise<CardStates>;
  getRetention(notebookId: string, days: number): Promise<RetentionSummary>;
  /**
   * Topic mastery for the diagnostic (FR6). **Aggregated server-side, and it
   * has to be** — see `TopicMasteryReport`. The alternative is one `listCards`
   * call per deck artifact, assembled in the browser.
   */
  getTopicMastery(notebookId: string): Promise<TopicMasteryReport>;
}
