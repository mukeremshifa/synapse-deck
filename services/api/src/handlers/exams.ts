/**
 * `/exams/answers` — where an exam attempt stops being forgotten.
 *
 * ── What this fixes ───────────────────────────────────────────────────────
 *
 * The exam runner graded in the browser and kept nothing. `src/lib/mastery.ts`
 * has always read two signals — FSRS retention and exam accuracy — and the
 * second had no source at all, so the diagnostic's most valuable finding (a
 * topic where the two disagree) was computed over fixture data. This route is
 * that signal's write path; `data/answers.ts` and migration 0008 are the rest.
 *
 * ── One request per attempt ───────────────────────────────────────────────
 *
 * Not one per question. An exam is submitted once, and per-question writes turn
 * a submission into twenty requests that can half-fail — leaving a mastery map
 * moved by an arbitrary fraction of a sitting. The data layer wraps the batch
 * in a transaction for the same reason.
 *
 * ── The path has no attempt id in it, deliberately ────────────────────────
 *
 * `POST /exams/{id}/answers` would put a client-generated id in the URL of a
 * resource that does not exist server-side: there is no `exams` table, because
 * an exam is currently assembled in the browser. The attempt id travels in the
 * body, where it reads as what it is — a grouping key the client chose — rather
 * than as the address of something the server knows about.
 *
 * No SQL here. See `handlers/profile.ts` for the four steps every handler
 * follows.
 */

import { countAnswers, listAnswers, recordAnswers } from '../data/answers.ts';
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
import { ApiError } from '../lib/rows.ts';
import { AttemptSubmission } from '../lib/schemas.ts';

/**
 * How far back the diagnostic looks, in days.
 *
 * An exam sat a year ago says little about what someone knows now, and an
 * unbounded read grows without limit. 180 days is long enough to cover a
 * course, short enough that the signal is about the present. The client may ask
 * for less; it may not ask for more, because the cap is what bounds the query.
 */
const DEFAULT_WINDOW_DAYS = 180;
const MAX_WINDOW_DAYS = 365;

/**
 * The most answers one read returns.
 *
 * `mastery.ts` averages over them, so this is a bound on a mean rather than a
 * page of a list: 2000 answers is 40 fifty-question exams, well past the point
 * where one more changes a topic's accuracy.
 */
const ANSWER_READ_LIMIT = 2000;

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    // ── POST /exams/answers — record one sitting ──────────────────────────
    if (method === 'POST') {
      const submission = AttemptSubmission.parse(readJsonBody(event));
      const rows = await recordAnswers(
        userId,
        submission.attemptId,
        submission.answers.map(answer => ({
          questionText: answer.questionText,
          cardId: answer.cardId,
          topicId: answer.topicId,
          topicName: answer.topicName,
          correct: answer.correct,
          selectedOption: answer.selectedOption,
          elapsedMs: answer.elapsedMs,
        })),
      );
      // How many actually landed, rather than an empty 201: the client compares
      // it against what it sent instead of assuming, which is the same contract
      // the bulk card operations use.
      return json(201, { recorded: rows.length, attemptId: submission.attemptId });
    }

    // ── GET /exams/answers — the exam signal the diagnostic reads ─────────
    if (method === 'GET') {
      const requested = Number(queryParam(event, 'days') ?? DEFAULT_WINDOW_DAYS);
      const days =
        Number.isFinite(requested) && requested > 0
          ? Math.min(Math.floor(requested), MAX_WINDOW_DAYS)
          : DEFAULT_WINDOW_DAYS;
      const since = new Date(Date.now() - days * 86_400_000);

      const [answers, total] = await Promise.all([
        listAnswers(userId, since, ANSWER_READ_LIMIT),
        // Separate from the windowed read so the client can tell "you have
        // never sat an exam" from "your last one is older than this window".
        // They render the same absence and only the first should say "go and
        // sit one".
        countAnswers(userId),
      ]);

      return json(200, { answers, total, windowDays: days });
    }

    throw new ApiError(405, `${method} is not allowed here.`);
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
