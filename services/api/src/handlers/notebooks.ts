/**
 * `/notebooks`, `/notebooks/{notebookId}` and everything under a notebook that
 * is small enough not to warrant its own Lambda: sources, topics, aggregates.
 *
 * One Lambda per resource group rather than one per route (P9 task 7): a route
 * per function multiplies cold starts across a page that fetches three things.
 *
 * **No SQL here** (§3.1 rule 3). Handlers read `sub` from the authorizer, call
 * the data layer, and map rows to the contract's shapes. `userId` comes only
 * from `requireUserId` — never a body, query parameter or header (rule 4).
 *
 * ── Mapping is this file's real job ───────────────────────────────────────
 *
 * The data layer returns snake_cased rows; `src/lib/api/contract.ts` specifies
 * camelCase shapes with computed fields. That translation lives here rather
 * than in SQL aliases, because the contract's shapes are nested
 * (`counts`, `readiness`, `payload`) and a query that built them would be
 * building JSON in Postgres for no gain.
 */

import {
  cardStates,
  dueForecast,
  masteryAnswers,
  masteryCards,
  retention,
  reviewHistory,
  topicSummary,
} from '../data/aggregates.ts';
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  notebookExists,
  updateNotebook,
  type NotebookWithCounts,
} from '../data/notebooks.ts';
import { deleteSource, getSource, listSources } from '../data/sources.ts';
import { getProfile } from '../data/profiles.ts';
/*
 * The reviewed mastery arithmetic, reused rather than reimplemented in SQL.
 * See the note in `services/api/tsconfig.json` for why this import is safe:
 * `mastery.ts` takes only a *type* from `fsrs.ts`, so `ts-fsrs` never reaches
 * the bundle.
 */
import { topicMastery } from '../../../../src/lib/mastery.ts';
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
  readiness,
  toIso,
  toSource,
} from './mappers.ts';

/** The contract's `Notebook`, built from a counted row. */
function toNotebook(row: NotebookWithCounts) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    readiness: readiness({
      sources: row.sourceCount,
      artifacts: row.artifactCount,
      decks: row.readyDecks,
      quizzes: row.readyQuizzes,
      notesets: row.readyNotesets,
      exams: row.readyExams,
    }),
    counts: {
      sources: row.sourceCount,
      artifacts: row.artifactCount,
      dueCards: row.dueCards,
    },
  };
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method, path } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    const notebookId = event.pathParameters?.['notebookId'];

    // ── Collection ────────────────────────────────────────────────────────
    if (notebookId === undefined) {
      switch (method) {
        case 'GET': {
          const limit = Math.min(Number(queryParam(event, 'limit') ?? 50), 100);
          const cursor = decodeCursor<{ updatedAt: string; id: string }>(
            queryParam(event, 'cursor'),
          );
          // One extra row decides `hasMore` without a second count query.
          const rows = await listNotebooks(userId, new Date(), limit + 1, cursor);
          return json(
            200,
            page(rows, limit, toNotebook, last =>
              encodeCursor({ updatedAt: toIso(last.updated_at), id: last.id }),
            ),
          );
        }

        case 'POST': {
          const body = readJsonBody(event) as { title?: unknown; description?: unknown };
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          if (!title || title.length > 200) {
            throw new ApiError(400, 'A notebook needs a title of 1–200 characters.');
          }
          const row = await createNotebook(userId, {
            title,
            description:
              typeof body.description === 'string' && body.description
                ? body.description
                : null,
          });
          // Freshly created: every count is zero, and saying so beats a second
          // round trip to learn it.
          return json(201, {
            id: row.id,
            title: row.title,
            description: row.description,
            createdAt: toIso(row.created_at),
            updatedAt: toIso(row.updated_at),
            readiness: { state: 'none', detail: 'Empty' },
            counts: { sources: 0, artifacts: 0, dueCards: 0 },
          });
        }

        default:
          throw new ApiError(405, `${method} is not allowed here.`);
      }
    }

    // ── Sub-resources ─────────────────────────────────────────────────────
    if (path.endsWith('/topics')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      const summary = await topicSummary(userId, notebookId);
      return json(200, summary);
    }

    if (path.endsWith('/stats/history')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      const profile = await getProfile(userId);
      const zone = profile?.timezone ?? 'UTC';
      const days = Math.min(Number(queryParam(event, 'days') ?? 365), 365);
      const history = await reviewHistory(userId, notebookId, zone, days);
      return json(200, {
        timeZone: zone,
        today: todayIn(zone),
        days: history.days,
        total: history.total,
      });
    }

    if (path.endsWith('/stats/retention')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      const days = Math.min(Number(queryParam(event, 'days') ?? 30), 365);
      const result = await retention(userId, notebookId, days);
      // A ratio over nothing is null, not zero. Zero means "everything was
      // forgotten", which is a different and much worse claim.
      const ratio = (bucket: { reviewed: number; recalled: number }) =>
        bucket.reviewed === 0 ? null : bucket.recalled / bucket.reviewed;
      return json(200, {
        windowDays: days,
        overall: ratio(result.overall),
        byState: {
          new: ratio(result.byState.new),
          learning: ratio(result.byState.learning),
          review: ratio(result.byState.review),
          relearning: ratio(result.byState.relearning),
        },
        reviewed: result.overall.reviewed,
        recalled: result.overall.recalled,
      });
    }

    if (path.endsWith('/stats/states')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      return json(200, await cardStates(userId, notebookId));
    }

    if (path.endsWith('/stats/forecast')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      const profile = await getProfile(userId);
      const zone = profile?.timezone ?? 'UTC';
      const days = Math.min(Number(queryParam(event, 'days') ?? 14), 90);
      const forecast = await dueForecast(userId, notebookId, zone, days);

      /*
       * **The daily new-card cap is applied once, here.**
       *
       * FR6 §8.3 flagged this as a policy written twice. The data layer returns
       * the *inputs* — how many new cards exist, how many were introduced today
       * — and this is the single place the allowance is worked out, using the
       * profile's limit. Day 0 gets the remainder; later days get the full
       * allowance, bounded by what is actually left in the deck.
       */
      const limit = profile?.daily_new_limit ?? 20;
      const remainingToday = Math.max(0, limit - forecast.introducedToday);
      const byDay = new Map(forecast.days.map(entry => [entry.day, entry.due]));

      const days0 = todayIn(zone);
      const out: { day: string; due: number; fresh: number }[] = [];
      let unseen = forecast.newAvailable;
      for (let index = 0; index < days; index += 1) {
        const day = addDays(days0, index);
        const allowance = index === 0 ? remainingToday : limit;
        const fresh = Math.min(allowance, unseen);
        unseen -= fresh;
        out.push({ day, due: byDay.get(day) ?? 0, fresh });
      }

      return json(200, {
        timeZone: zone,
        takenAt: new Date().toISOString(),
        days: out,
      });
    }

    if (path.endsWith('/stats/mastery')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
      const [cards, answers] = await Promise.all([
        masteryCards(userId, notebookId),
        masteryAnswers(userId, notebookId),
      ]);
      const topics = topicMastery(
        cards.map(card => ({
          topicId: card.topicId,
          topicName: card.topicName,
          fsrs_state: card.fsrs_state,
          stability: card.stability,
          difficulty: card.difficulty,
          last_reviewed_at: card.last_reviewed_at ? toIso(card.last_reviewed_at) : null,
        })),
        answers.map(answer => ({
          topicId: answer.topicId,
          topicName: answer.topicName,
          correct: answer.correct,
          answered_at: toIso(answer.answered_at),
        })),
        new Date(),
      );
      return json(200, {
        topics,
        cardsConsidered: cards.length,
        answersConsidered: answers.length,
        // An answer naming no topic contributed to no row. Counted so the
        // diagnostic's honesty banner can say so rather than implying the user
        // has sat nothing.
        unattributedAnswers: answers.filter(
          answer => !answer.topicId && !answer.topicName,
        ).length,
      });
    }

    // ── Sources ───────────────────────────────────────────────────────────
    if (path.includes('/sources')) {
      const sourceId = event.pathParameters?.['sourceId'];

      if (sourceId === undefined) {
        switch (method) {
          case 'GET': {
            if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');
            const limit = Math.min(Number(queryParam(event, 'limit') ?? 50), 100);
            const cursor = decodeCursor<{ createdAt: string; id: string }>(
              queryParam(event, 'cursor'),
            );
            const rows = await listSources(userId, notebookId, limit + 1, cursor);
            return json(
              200,
              page(rows, limit, toSource, last =>
                encodeCursor({ createdAt: toIso(last.created_at), id: last.id }),
              ),
            );
          }

          case 'POST': {
            // `addSource` returns a Job, not a Source: reading a document is
            // work. See handlers/generation.ts.
            throw new ApiError(
              405,
              'Adding a source is a job. POST /notebooks/{id}/jobs instead.',
            );
          }

          default:
            throw new ApiError(405, `${method} is not allowed here.`);
        }
      }

      switch (method) {
        case 'GET': {
          const row = await getSource(userId, notebookId, sourceId);
          // 404, never 403 — a 403 would confirm the id exists and turn a
          // source id into an oracle.
          if (!row) throw notFound('Source');
          return json(200, toSource(row));
        }

        case 'DELETE': {
          const deleted = await deleteSource(userId, notebookId, sourceId);
          if (!deleted) throw notFound('Source');
          // Artifacts made from it survive, with a dangling id and an intact
          // snapshot. Brief §1.2(7).
          return noContent();
        }

        default:
          throw new ApiError(405, `${method} is not allowed here.`);
      }
    }

    // ── One notebook ──────────────────────────────────────────────────────
    switch (method) {
      case 'GET': {
        const row = await getNotebook(userId, notebookId, new Date());
        if (!row) throw notFound('Notebook');
        return json(200, toNotebook(row));
      }

      case 'PATCH': {
        const body = readJsonBody(event) as { title?: unknown; description?: unknown };
        const input: { title?: string; description?: string | null } = {};
        if (typeof body.title === 'string') {
          const title = body.title.trim();
          if (!title || title.length > 200) {
            throw new ApiError(400, 'A notebook needs a title of 1–200 characters.');
          }
          input.title = title;
        }
        if ('description' in body) {
          input.description =
            typeof body.description === 'string' ? body.description : null;
        }
        const updated = await updateNotebook(userId, notebookId, input);
        if (!updated) throw notFound('Notebook');
        const row = await getNotebook(userId, notebookId, new Date());
        if (!row) throw notFound('Notebook');
        return json(200, toNotebook(row));
      }

      case 'DELETE': {
        // Its artifacts go with it — the contract says so explicitly, and the
        // foreign keys enforce it.
        const deleted = await deleteNotebook(userId, notebookId);
        if (!deleted) throw notFound('Notebook');
        return noContent();
      }

      default:
        throw new ApiError(405, `${method} is not allowed here.`);
    }
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}

/** `YYYY-MM-DD` in the user's zone. The study day the heatmap ends on. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Add days to a `YYYY-MM-DD` key.
 *
 * Parsed as UTC noon rather than midnight: the key is already a calendar date
 * in the user's zone, and midnight arithmetic in UTC lands on the previous day
 * for any negative offset. Noon has twelve hours of slack in both directions,
 * which no real timezone offset exceeds.
 */
function addDays(day: string, count: number): string {
  const base = new Date(`${day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + count);
  return base.toISOString().slice(0, 10);
}
