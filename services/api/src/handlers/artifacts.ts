/**
 * `/notebooks/{notebookId}/artifacts` and everything that hangs off an
 * artifact: its questions, its note blocks and its attempts.
 *
 * One Lambda for the group, for the reason `handlers/decks.ts` gives.
 *
 * **No SQL here** (§3.1 rule 3), and `userId` comes only from the verified JWT
 * (rule 4). Every data-layer call passes both `userId` and `notebookId`, so
 * knowing an artifact id from another notebook is not enough to reach it.
 */

import {
  deleteArtifact,
  getArtifact,
  listArtifacts,
  setNoteSetCompleted,
  updateArtifact,
} from '../data/artifacts.ts';
import {
  getAttempt,
  listAnswers,
  listAttempts,
  saveProgress,
  startAttempt,
  submitAttempt,
  sweepAbandoned,
  type AnswerInput,
} from '../data/attempts.ts';
import {
  introducedToday,
  listArtifactCards,
  notebookQueue,
} from '../data/cards.ts';
import {
  listNoteBlocks,
  listNoteTopics,
  setTopicCompleted,
} from '../data/note-topics.ts';
import { getProfile } from '../data/profiles.ts';
import { notebookExists } from '../data/notebooks.ts';
import { listQuestions } from '../data/questions.ts';
import {
  QuestionPayload,
  QuestionResponse,
  gradeResponse,
  questionStem,
  responseSelectedOption,
} from '../lib/schemas.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  queryParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError, notFound } from '../lib/rows.ts';
import {
  decodeCursor,
  encodeCursor,
  page,
  toArtifact,
  toCard,
  toAttempt,
  toIso,
  toNoteTopic,
  toQuestion,
} from './mappers.ts';

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method, path } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    const notebookId = event.pathParameters?.['notebookId'];
    if (!notebookId) throw new ApiError(400, 'A notebook id is required.');

    const artifactId = event.pathParameters?.['artifactId'];
    const attemptId = event.pathParameters?.['attemptId'];

    /*
     * ── The practice queue ────────────────────────────────────────────────
     *
     * **The reads, not the policy.** The contract is explicit that the server
     * fetches and the client decides: `buildQueue` and the daily new-card cap
     * stay client-side, because one policy drives this queue, home's "new
     * available" figure and the forecast's day 0. A second implementation here
     * is how those three start disagreeing about what today's allowance is.
     *
     * So this returns every due and every new card, uncapped, plus the two
     * numbers the cap needs — `introducedToday` and `dailyNewLimit`.
     */
    if (path.endsWith('/queue')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');

      const profile = await getProfile(userId);
      const zone = profile?.timezone ?? 'UTC';
      const forArtifact = queryParam(event, 'artifactId') ?? null;
      const [queue, introduced] = await Promise.all([
        notebookQueue(userId, notebookId, forArtifact, new Date()),
        introducedToday(userId, notebookId, zone),
      ]);

      return json(200, {
        due: queue.due.map(toCard),
        fresh: queue.fresh.map(toCard),
        introducedToday: introduced,
        dailyNewLimit: profile?.daily_new_limit ?? 20,
        nextDueAt: queue.nextDueAt ? toIso(queue.nextDueAt) : null,
        fetchedAt: new Date().toISOString(),
      });
    }

    // ── Attempts addressed directly: /notebooks/{id}/attempts[/{attemptId}] ─
    if (path.includes('/attempts') && artifactId === undefined) {
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');

      if (attemptId !== undefined) {
        const attempt = await getAttempt(userId, attemptId);
        if (!attempt || attempt.notebook_id !== notebookId) throw notFound('Attempt');

        if (method === 'GET') {
          await sweepAbandoned(userId);
          const [answers, kind] = await Promise.all([
            listAnswers(userId, attempt.id),
            artifactKind(userId, notebookId, attempt.artifact_id),
          ]);
          return json(200, toAttempt(attempt, kind, answers));
        }

        /*
         * PATCH saves progress, POST submits.
         *
         * The attempt names its own artifact, so the questions to grade against
         * are looked up rather than taken from the path — which is why the
         * contract addresses an attempt by its id alone.
         *
         * **`correct` and the score are computed here**, never taken from the
         * body: a client that could assert either could score its own exam.
         */
        if (method !== 'POST' && method !== 'PATCH') {
          throw new ApiError(405, `${method} is not allowed here.`);
        }

        const body = readJsonBody(event) as { answers?: unknown };
        const answers = await gradeAnswers(userId, attempt.artifact_id, body.answers);

        const updated =
          method === 'PATCH'
            ? await saveProgress(userId, attemptId, answers)
            : await submitAttempt(userId, attemptId, answers);

        if (!updated) {
          // The attempt exists but is no longer in progress — a second tab
          // submitted it. An expected outcome, not a crash.
          throw new ApiError(409, 'That attempt is no longer in progress.');
        }
        const [saved, kind] = await Promise.all([
          listAnswers(userId, attemptId),
          artifactKind(userId, notebookId, attempt.artifact_id),
        ]);
        return json(200, toAttempt(updated, kind, saved));
      }

      if (method === 'GET') {
        await sweepAbandoned(userId);
        const limit = Math.min(Number(queryParam(event, 'limit') ?? 50), 100);
        const cursor = decodeCursor<{ startedAt: string; id: string }>(
          queryParam(event, 'cursor'),
        );
        const forArtifact = queryParam(event, 'artifactId') ?? null;
        const rows = await listAttempts(userId, notebookId, forArtifact, limit + 1, cursor);

        // The answers for every listed attempt, in one pass rather than one
        // query per row. A sittings list is short, but N+1 is N+1.
        const answersByAttempt = new Map(
          await Promise.all(
            rows.map(
              async row => [row.id, await listAnswers(userId!, row.id)] as const,
            ),
          ),
        );
        const kinds = new Map(
          await Promise.all(
            [...new Set(rows.map(row => row.artifact_id))].map(
              async id => [id, await artifactKind(userId!, notebookId, id)] as const,
            ),
          ),
        );

        return json(
          200,
          page(
            rows,
            limit,
            row =>
              toAttempt(
                row,
                kinds.get(row.artifact_id) ?? 'quiz',
                answersByAttempt.get(row.id) ?? [],
              ),
            last => encodeCursor({ startedAt: toIso(last.started_at), id: last.id }),
          ),
        );
      }

      throw new ApiError(405, `${method} is not allowed here.`);
    }

    // ── The artifact collection ───────────────────────────────────────────
    if (artifactId === undefined) {
      if (method !== 'GET') {
        // Creating one is a job — generation is work. See handlers/generation.ts.
        throw new ApiError(
          405,
          'Creating an artifact is a job. POST /notebooks/{id}/jobs instead.',
        );
      }
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');

      const limit = Math.min(Number(queryParam(event, 'limit') ?? 50), 100);
      const cursor = decodeCursor<{ createdAt: string; id: string }>(
        queryParam(event, 'cursor'),
      );
      const kindFilter = queryParam(event, 'kind');
      const rows = await listArtifacts(
        userId,
        notebookId,
        new Date(),
        limit + 1,
        cursor,
        kindFilter as 'deck' | 'quiz' | 'noteset' | 'exam' | undefined,
      );
      return json(
        200,
        page(rows, limit, toArtifact, last =>
          encodeCursor({ createdAt: toIso(last.created_at), id: last.id }),
        ),
      );
    }

    // ── Sub-resources of one artifact ─────────────────────────────────────
    if (path.endsWith('/questions')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!artifact) throw notFound('Artifact');
      const rows = await listQuestions(userId, artifactId);
      return json(200, rows.map(toQuestion));
    }

    if (path.endsWith('/cards')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!artifact) throw notFound('Artifact');
      const limit = Math.min(Number(queryParam(event, 'limit') ?? 50), 100);
      const cursor = decodeCursor<{ createdAt: string; id: string }>(
        queryParam(event, 'cursor'),
      );
      const rows = await listArtifactCards(userId, artifactId, limit + 1, cursor);
      return json(
        200,
        page(rows, limit, toCard, last =>
          encodeCursor({ createdAt: toIso(last.created_at), id: last.id }),
        ),
      );
    }

    if (path.endsWith('/topics')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!artifact) throw notFound('Artifact');

      /*
       * **Two queries for the whole set, not two per topic.** The topics and
       * every block of the note set are read once and grouped here; a note set
       * is a dozen topics at most (`NOTESET_LIMITS`), and the page always
       * renders all of them, so a per-topic fetch would be an N+1 for nothing.
       */
      const [topics, blocks] = await Promise.all([
        listNoteTopics(userId, artifactId),
        listNoteBlocks(userId, artifactId),
      ]);

      const byTopic = new Map<string, typeof blocks>();
      for (const block of blocks) {
        const bucket = byTopic.get(block.topic_id);
        if (bucket) bucket.push(block);
        else byTopic.set(block.topic_id, [block]);
      }

      return json(
        200,
        topics.map(topic => toNoteTopic(topic, byTopic.get(topic.id) ?? [])),
      );
    }

    // Ticking one topic off, or unticking it: `…/topics/:topicId`.
    const topicMatch = /\/topics\/([^/]+)$/.exec(path);
    if (topicMatch) {
      if (method !== 'PATCH') throw new ApiError(405, `${method} is not allowed here.`);
      const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!artifact) throw notFound('Artifact');

      const topicId = decodeURIComponent(topicMatch[1] ?? '');
      const body = readJsonBody(event) as { completed?: unknown };
      if (typeof body.completed !== 'boolean') {
        throw new ApiError(400, '`completed` must be true or false.');
      }

      /*
       * A null return means the topic is not this user's, or not this note
       * set's — a 404, rather than a success reporting a count for a write that
       * never happened.
       */
      const count = await setTopicCompleted(
        userId,
        artifactId,
        topicId,
        body.completed,
      );
      if (count === null) throw notFound('Topic');

      // The whole artifact, so the reader's readiness updates from one
      // response rather than a second fetch.
      const updated = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!updated) throw notFound('Artifact');
      return json(200, toArtifact(updated));
    }

    // The button at the end: `…/completion`.
    if (path.endsWith('/completion')) {
      if (method !== 'PATCH') throw new ApiError(405, `${method} is not allowed here.`);

      const body = readJsonBody(event) as { completed?: unknown };
      if (typeof body.completed !== 'boolean') {
        throw new ApiError(400, '`completed` must be true or false.');
      }

      // Scoped to notesets in the statement itself, so a deck id 404s rather
      // than being stamped with a completion that means nothing for its kind.
      const row = await setNoteSetCompleted(
        userId,
        notebookId,
        artifactId,
        body.completed,
      );
      if (!row) throw notFound('Note set');

      const updated = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!updated) throw notFound('Artifact');
      return json(200, toArtifact(updated));
    }

    if (path.endsWith('/attempts')) {
      // Starting a sitting. Returns the in-progress one if there is a live one,
      // which is what makes a reloaded quiz resumable.
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
      if (!artifact) throw notFound('Artifact');
      if (artifact.kind !== 'quiz' && artifact.kind !== 'exam') {
        throw new ApiError(400, 'Only a quiz or an exam can be sat.');
      }
      const attempt = await startAttempt(userId, notebookId, artifactId);
      const answers = await listAnswers(userId, attempt.id);
      return json(201, toAttempt(attempt, artifact.kind, answers));
    }

    // ── One artifact ──────────────────────────────────────────────────────
    switch (method) {
      case 'GET': {
        const row = await getArtifact(userId, notebookId, artifactId, new Date());
        if (!row) throw notFound('Artifact');
        return json(200, toArtifact(row));
      }

      case 'PATCH': {
        const body = readJsonBody(event) as { title?: unknown; blueprint?: unknown };
        const input: { title?: string; blueprint?: unknown } = {};
        if (typeof body.title === 'string') {
          const title = body.title.trim();
          if (!title || title.length > 200) {
            throw new ApiError(400, 'A title must be 1–200 characters.');
          }
          input.title = title;
        }
        if (body.blueprint !== undefined) {
          const blueprint = body.blueprint as { weights?: unknown };
          if (!blueprint || !Array.isArray(blueprint.weights)) {
            throw new ApiError(400, 'A blueprint needs a weights array.');
          }
          // `manual` exists for exactly this: a UI that explains how a
          // weighting was arrived at must be able to say "you set this".
          input.blueprint = { weights: blueprint.weights, basis: 'manual' };
        }
        const updated = await updateArtifact(userId, notebookId, artifactId, input);
        if (!updated) throw notFound('Artifact');
        const row = await getArtifact(userId, notebookId, artifactId, new Date());
        if (!row) throw notFound('Artifact');
        return json(200, toArtifact(row));
      }

      case 'DELETE': {
        const deleted = await deleteArtifact(userId, notebookId, artifactId);
        if (!deleted) throw notFound('Artifact');
        return noContent();
      }

      default:
        throw new ApiError(405, `${method} is not allowed here.`);
    }
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}

/** Which kind an artifact is, for an `Attempt`'s `artifactKind`. */
async function artifactKind(
  userId: string,
  notebookId: string,
  artifactId: string,
): Promise<'quiz' | 'exam'> {
  const artifact = await getArtifact(userId, notebookId, artifactId, new Date());
  return artifact?.kind === 'exam' ? 'exam' : 'quiz';
}

/**
 * Grade the submitted answers against the stored questions.
 *
 * **`correct` is decided here, never taken from the request.** The client sends
 * what it did; whether that is right is a fact about the question, and a client
 * that could assert it could score its own exam.
 *
 * **The rule itself is `gradeResponse`, imported rather than restated.** Eight
 * kinds now grade eight different ways — a set comparison for multi-select, a
 * tolerance for numeric, a permutation check for ordering, a normalised string
 * match for a fill-in-the-blank — and a second
 * implementation of any of them here would be the version that disagrees with
 * the runner. The runner grades to show the answer immediately; this grades to
 * decide the record. They must never differ, so there is one function.
 *
 * The response is parsed rather than cast: it arrives from a request body, and
 * `QuestionResponse` is what stands between it and a `jsonb` column. A response
 * that fails the parse is treated as unanswered rather than rejected — a stale
 * tab submitting an old shape should not fail a whole paper.
 *
 * `questionText` and the topic are copied from the stored question for the same
 * reason ADR 0013 gives — the answer must stay readable after the question is
 * regenerated or deleted — rather than trusted from the body, where they would
 * be free text.
 */
async function gradeAnswers(
  userId: string,
  artifactId: string,
  raw: unknown,
): Promise<AnswerInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const questions = await listQuestions(userId, artifactId);
  const byId = new Map(questions.map(question => [question.id, question]));

  const out: AnswerInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const answer = entry as {
      questionId?: unknown;
      response?: unknown;
      flagged?: unknown;
      elapsedMs?: unknown;
    };
    if (typeof answer.questionId !== 'string') continue;

    const question = byId.get(answer.questionId);
    // An answer naming a question this artifact does not have is dropped, not
    // an error: a regeneration can remove a question a stale tab still holds.
    if (!question) continue;

    /*
     * The stored question, parsed.
     *
     * A payload that fails this parse cannot be graded against — it is not a
     * question of any kind we know. It still yields a row, marked unanswered
     * and incorrect, because dropping it would quietly shorten the paper.
     */
    const parsedQuestion = QuestionPayload.safeParse(question.payload);
    const parsedResponse = QuestionResponse.safeParse(answer.response);

    const graded =
      parsedQuestion.success && parsedResponse.success
        ? gradeResponse(parsedQuestion.data, parsedResponse.data)
        : false;
    const response = parsedResponse.success ? parsedResponse.data : null;

    out.push({
      questionId: question.id,
      questionText: parsedQuestion.success
        ? questionStem(parsedQuestion.data)
        : stemFallback(question.payload),
      topicId: question.topic_id,
      topicName: question.topic_name ?? null,
      response,
      // Derived, never taken from the body: it is a projection of `response`
      // and a client-supplied one could disagree with it.
      selectedOption: response ? responseSelectedOption(response) : null,
      correct: graded,
      flagged: answer.flagged === true,
      elapsedMs:
        typeof answer.elapsedMs === 'number' && answer.elapsedMs >= 0
          ? Math.trunc(answer.elapsedMs)
          : null,
    });
  }
  return out;
}

/**
 * The prompt text of a payload that failed to parse.
 *
 * `question_text` is `not null` in the schema and is the authority for what an
 * answer meant (ADR 0013), so a row still needs one even when the payload is
 * unreadable. Both spellings are tried before giving up — `true_false` calls it
 * `statement` — and the constant is a last resort rather than the normal path.
 */
function stemFallback(payload: unknown): string {
  const shape = (payload ?? {}) as { stem?: unknown; statement?: unknown };
  if (typeof shape.stem === 'string' && shape.stem.trim()) return shape.stem;
  if (typeof shape.statement === 'string' && shape.statement.trim()) return shape.statement;
  return 'Question';
}
