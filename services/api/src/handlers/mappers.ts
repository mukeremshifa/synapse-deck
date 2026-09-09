/**
 * Row → contract translation, shared by the FR7 handlers.
 *
 * The data layer returns snake_cased rows as Postgres shapes them;
 * `src/lib/api/contract.ts` specifies camelCase objects with nested computed
 * fields. Something has to bridge that, and doing it here rather than in SQL
 * aliases keeps the queries readable and the nesting in TypeScript, where a
 * shape change is a compile error rather than a silently wrong column name.
 *
 * **No SQL in this file, and no `userId` decisions.** It is pure mapping: it
 * never chooses which rows a caller may see. That is the data layer's job and
 * the tenancy boundary lives there (ADR 0008).
 */

import { pgTimestampToIso } from '../lib/db.ts';
import type {
  ArtifactRow,
  CardRow,
  AttemptAnswerRow,
  AttemptRow,
  NoteBlockRow,
  NoteTopicRow,
  QuestionRow,
  SourceRow,
} from '../lib/rows.ts';

/**
 * Whatever Postgres gave us, as an ISO 8601 string.
 *
 * `pg` may hand back a `Date` or a string depending on the type parser in
 * force, and `db.ts` installs a string parser for `timestamptz` precisely so
 * microseconds survive — see its header, and why truncating them breaks the
 * optimistic-concurrency token. This handles both rather than assuming.
 */
export function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return pgTimestampToIso(value);
}

/** Base64url, so a cursor is opaque and URL-safe. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Decode a cursor, or treat a malformed one as absent.
 *
 * A cursor is opaque to the client, so a corrupted one is not a request the
 * user can fix — returning page one is a better answer than a 400 they cannot
 * act on.
 */
export function decodeCursor<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Build the contract's `Page<T>` from `limit + 1` rows.
 *
 * The caller over-fetches by one: if the extra row came back there is another
 * page, and that is known without a second `count(*)` over the same predicate.
 * The extra row is dropped before mapping, so it never reaches the client.
 */
export function page<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  cursorFor: (row: Row) => string,
): { items: Item[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];
  return {
    items: visible.map(map),
    nextCursor: hasMore && last ? cursorFor(last) : null,
  };
}

/**
 * A notebook's or an artifact's readiness.
 *
 * **One implementation, used by both**, because FR6 required the overview's
 * per-artifact readiness to agree with home's roll-up and the way to guarantee
 * that is to have one function decide.
 *
 * Only `ready` artifacts contribute. FR4's drift row: a `failed` artifact keeps
 * its row with no contents, so counting it would promise decks that cannot be
 * opened.
 */
export function readiness(counts: {
  sources: number;
  artifacts: number;
  decks: number;
  quizzes: number;
  notesets: number;
  exams: number;
}): { state: 'ready' | 'partial' | 'none'; detail: string } {
  const parts: string[] = [];
  const say = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  say(counts.decks, 'deck', 'decks');
  say(counts.quizzes, 'quiz', 'quizzes');
  say(counts.notesets, 'note set', 'note sets');
  say(counts.exams, 'exam', 'exams');

  if (parts.length > 0) {
    return { state: 'ready', detail: `${parts.join(' · ')} ready` };
  }
  // Artifacts exist but none is ready: they are generating, or they failed.
  if (counts.artifacts > 0) {
    return { state: 'partial', detail: 'Nothing ready yet' };
  }
  if (counts.sources > 0) {
    return { state: 'none', detail: 'Nothing generated yet' };
  }
  return { state: 'none', detail: 'Empty' };
}

/** The contract's `Source`. */
export function toSource(row: SourceRow) {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    error: row.error,
    // `bigint` arrives as a string from `pg` — it does not fit a JS number in
    // general — so it is narrowed here rather than shipped as a string the
    // contract does not declare.
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    createdAt: toIso(row.created_at),
    topicNames: row.topic_names ?? [],
  };
}

/** The per-kind half of an `Artifact`, assembled from the row and its counts. */
export function artifactPayload(
  row: ArtifactRow,
  counts: {
    cardCount: number;
    dueCount: number;
    newCount: number;
    questionCount: number;
    answeredCount: number;
    topicCount: number;
    completedTopicCount: number;
    attemptCount: number;
  },
) {
  const stored = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case 'deck':
      return {
        kind: 'deck' as const,
        cardCount: counts.cardCount,
        dueCount: counts.dueCount,
        newCount: counts.newCount,
      };
    case 'quiz':
      return {
        kind: 'quiz' as const,
        questionCount: counts.questionCount,
        answeredCount: counts.answeredCount,
      };
    case 'noteset':
      return {
        kind: 'noteset' as const,
        // Only what cannot be derived is stored; the counts are computed.
        origin: (stored['origin'] as 'generated' | 'chat') ?? 'generated',
        topicCount: counts.topicCount,
        completedTopicCount: counts.completedTopicCount,
        // A column rather than a payload key — it cannot be derived from
        // anything, which is exactly what ADR 0017 says belongs on the row.
        completedAt: row.completed_at ? toIso(row.completed_at) : null,
      };
    case 'exam':
      return {
        kind: 'exam' as const,
        config: stored['config'],
        blueprint: stored['blueprint'],
        questionCount: counts.questionCount,
        attemptCount: counts.attemptCount,
      };
  }
}

/**
 * An artifact's readiness, by kind.
 *
 * Each kind measures readiness differently, which is why this is a switch
 * rather than a shared count: a deck is ready when it has cards, a note set
 * when the student says it is, an exam when it has been sat.
 */
export function artifactReadiness(
  row: ArtifactRow,
  counts: {
    cardCount: number;
    dueCount: number;
    questionCount: number;
    answeredCount: number;
    topicCount: number;
    completedTopicCount: number;
    attemptCount: number;
  },
): { state: 'ready' | 'partial' | 'none'; detail: string } {
  if (row.status === 'generating') return { state: 'none', detail: 'Generating' };
  if (row.status === 'failed') return { state: 'none', detail: row.error ?? 'Failed' };

  switch (row.kind) {
    case 'deck':
      if (counts.cardCount === 0) return { state: 'none', detail: 'No cards' };
      return counts.dueCount > 0
        ? { state: 'ready', detail: `${counts.dueCount} due` }
        : { state: 'ready', detail: '' };
    case 'quiz':
      if (counts.questionCount === 0) return { state: 'none', detail: 'No questions' };
      return counts.answeredCount >= counts.questionCount
        ? { state: 'ready', detail: 'Answered' }
        : { state: 'partial', detail: `${counts.answeredCount}/${counts.questionCount}` };
    case 'noteset':
      if (counts.topicCount === 0) return { state: 'none', detail: 'Empty' };
      /*
       * **Readiness follows the button, not the ticks.** A note set the student
       * declared finished reads `ready` even with topics outstanding — that is
       * what the declaration is for, and a row that contradicted it would be
       * arguing with the person who made it.
       */
      if (row.completed_at !== null) return { state: 'ready', detail: 'Completed' };
      return counts.completedTopicCount > 0
        ? {
            state: 'partial',
            detail: `${counts.completedTopicCount}/${counts.topicCount} topics`,
          }
        : { state: 'none', detail: `${counts.topicCount} topics` };
    case 'exam':
      if (counts.questionCount === 0) return { state: 'none', detail: 'No questions' };
      return counts.attemptCount > 0
        ? { state: 'ready', detail: `${counts.attemptCount} sat` }
        : { state: 'ready', detail: 'Not sat' };
  }
}

/** The contract's `Artifact`. */
export function toArtifact(
  row: ArtifactRow & {
    cardCount: number;
    dueCount: number;
    newCount: number;
    questionCount: number;
    answeredCount: number;
    topicCount: number;
    completedTopicCount: number;
    attemptCount: number;
  },
) {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    kind: row.kind,
    title: row.title,
    // May contain ids `listSources` no longer returns. That is a valid state
    // and every consumer through FR6 handles it.
    sourceIds: row.source_ids ?? [],
    // Frozen at generation, complete, never dangles. This is what the
    // provenance line renders.
    sourcesSnapshot: (row.sources_snapshot ?? []) as unknown[],
    status: row.status,
    readiness: artifactReadiness(row, row),
    createdAt: toIso(row.created_at),
    payload: artifactPayload(row, row),
  };
}

/** The contract's `Question`. */
export function toQuestion(row: QuestionRow & { topic_name?: string | null }) {
  return {
    id: row.id,
    payload: row.payload,
    topicId: row.topic_id,
    topicName: row.topic_name ?? null,
  };
}


/**
 * The contract's `NoteTopic` — a topic and the blocks it owns.
 *
 * **The blocks are passed in rather than fetched here**: the handler reads every
 * block of the note set in one query and groups them, which is what keeps a
 * dozen topics from becoming a dozen queries.
 *
 * A block is emitted as **exactly the contract's union and nothing more** — no
 * row id, no timestamps. `NoteBlock` has no id field by design (the contract
 * says so), and shipping internal columns to the client is how a field nobody
 * declared ends up depended on.
 */
export function toNoteTopic(row: NoteTopicRow, blocks: NoteBlockRow[]) {
  return {
    id: row.id,
    title: row.title,
    sourceTopicId: row.source_topic_id,
    blocks: blocks.map(block => ({ ...((block.block ?? {}) as Record<string, unknown>) })),
  };
}

/** The contract's `AttemptAnswer`. */
export function toAttemptAnswer(row: AttemptAnswerRow) {
  return {
    questionId: row.question_id ?? '',
    questionText: row.question_text,
    topicId: row.topic_id,
    topicName: row.topic_name,
    // Parsed by the contract's `QuestionResponse` at the client boundary, not
    // here: this maps a row, and a malformed response is the parse's to report.
    response: (row.response ?? null) as never,
    selectedOption: row.selected_option,
    correct: row.correct,
    flagged: row.flagged,
    elapsedMs: row.elapsed_ms,
  };
}

/** The contract's `Attempt`. */
export function toAttempt(
  row: AttemptRow,
  kind: 'quiz' | 'exam',
  answers: AttemptAnswerRow[],
) {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    artifactId: row.artifact_id,
    artifactKind: kind,
    outcome: row.outcome,
    startedAt: toIso(row.started_at),
    submittedAt: row.submitted_at ? toIso(row.submitted_at) : null,
    answers: answers.map(toAttemptAnswer),
    score: row.score,
  };
}

/**
 * The contract's `Card`.
 *
 * `notebook_id` comes from the joined artifact rather than a column on `cards`
 * — the card knows its artifact and the artifact knows its notebook, and
 * denormalising it onto every card row would be a third place for the same
 * fact to drift.
 *
 * **`updatedAt` is passed through untouched.** It is the optimistic-concurrency
 * token: the client sends it back byte for byte and `review_card` compares it
 * as a timestamp, so the microseconds Postgres stores must survive the trip.
 * `toIso` is a pure string transform for exactly this reason — see `db.ts`.
 */
export function toCard(row: CardRow & { notebook_id: string }) {
  return {
    id: row.id,
    artifactId: row.artifact_id ?? '',
    notebookId: row.notebook_id,
    topicId: row.topic_id,
    payload: row.payload,
    sourceExcerpt: row.source_excerpt,
    // `archived` exists in the column's enum but not in the contract, which has
    // only active and suspended. Nothing writes it today; mapping it to
    // suspended is the closest true statement rather than inventing a state.
    status: row.status === 'suspended' || row.status === 'archived' ? 'suspended' : 'active',
    fsrsState: row.fsrs_state,
    due: toIso(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    lastReviewedAt: row.last_review ? toIso(row.last_review) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
