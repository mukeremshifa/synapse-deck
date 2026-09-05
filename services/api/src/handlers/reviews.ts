/**
 * `/queue`, `/summary`, `/reviews` and `/reviews/undo` — the practice loop.
 *
 * ── Where the §6 policy lives, and why it is not here ─────────────────────
 *
 * This handler fetches; it does not decide. `buildQueue` and
 * `remainingNewAllowance` stay in `src/lib/queue.ts` on the client, because the
 * same policy drives the queue, the dashboard's "new available" figure and the
 * forecast's day 0 — and a second implementation on the server is how those
 * three start disagreeing about what today's allowance is.
 *
 * What the migration does buy is the round trips: four parallel supabase-js
 * calls become one request. On a VPC Lambda that is most of the latency budget.
 *
 * No SQL here. See `handlers/profile.ts` for the four steps every handler follows.
 */

import { readDueSummary, readQueue } from '../data/cards.ts';
import { ensureProfile } from '../data/profiles.ts';
import { reviewCard, undoLastReview } from '../data/reviews.ts';
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
import { ApiError, type SchedulingUpdate } from '../lib/rows.ts';
/**
 * The day boundary, from the client's own module.
 *
 * Imported rather than transcribed, and that is the whole point: `day.ts` says
 * in its header that two implementations of "what day is it" will disagree and
 * the disagreement will look like a scheduling bug. It is pure, has no imports
 * of its own, and already handles the case that makes this hard — turning a
 * wall clock back into an instant across a DST transition.
 *
 * The server needs it because the *counting* query needs a bound, and the
 * client must not be what supplies it: a client that moves this boundary hands
 * itself extra new cards. `resolveTimeZone` gives the same UTC fallback for an
 * unknown zone that the client uses, so a profile holding whatever a past
 * version wrote produces a wrong-but-working day rather than a 500.
 */
import { resolveTimeZone, startOfStudyDay } from '../../../../src/lib/day.ts';

/** How many due cards one queue fetch pulls. Mirrors `QUEUE_FETCH_LIMIT`. */
const QUEUE_FETCH_LIMIT = 400;

/** The keys `review_card` accepts as `p_next`; it rejects anything else. */
const SCHEDULING_KEYS = [
  'fsrs_state',
  'stability',
  'difficulty',
  'due',
  'last_review',
  'scheduled_days',
  'elapsed_days',
  'learning_steps',
] as const;

/**
 * The scheduling update, checked for shape before it reaches the database.
 *
 * The RPC validates these keys too, and does so as the last line of defence.
 * This check is here so a malformed payload is a 400 with a message rather than
 * a Postgres exception, and so the extra-key case is refused on the way in
 * rather than after a round trip.
 */
function readSchedulingUpdate(value: unknown): SchedulingUpdate {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError(400, 'next must be a scheduling object.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(SCHEDULING_KEYS as readonly string[]).includes(key)) {
      throw new ApiError(400, `next contains an unexpected field: ${key}.`);
    }
  }
  for (const key of ['fsrs_state', 'due'] as const) {
    if (typeof record[key] !== 'string') {
      throw new ApiError(400, `next.${key} is required.`);
    }
  }
  return record as unknown as SchedulingUpdate;
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method, path } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    // ── GET /queue ─────────────────────────────────────────────────────────
    if (path.endsWith('/queue')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const now = new Date();
      // The profile, because the timezone decides where today starts and the
      // daily cap decides how many new cards to fetch. Guessing UTC hands out
      // new cards early for most of the world.
      const profile = await ensureProfile(userId);
      const reads = await readQueue(userId, {
        now,
        dayStart: startOfStudyDay(now, resolveTimeZone(profile.timezone)),
        dailyNewLimit: profile.daily_new_limit,
        deckId: queryParam(event, 'deckId') ?? null,
        limit: QUEUE_FETCH_LIMIT,
      });
      // Raw reads plus the numbers the client needs to apply §6 itself.
      return json(200, {
        ...reads,
        dailyNewLimit: profile.daily_new_limit,
        fetchedAt: now.toISOString(),
      });
    }

    // ── GET /summary ───────────────────────────────────────────────────────
    if (path.endsWith('/summary')) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const now = new Date();
      const profile = await ensureProfile(userId);
      const reads = await readDueSummary(userId, {
        now,
        dayStart: startOfStudyDay(now, resolveTimeZone(profile.timezone)),
      });
      return json(200, { ...reads, dailyNewLimit: profile.daily_new_limit });
    }

    // ── POST /reviews/undo ─────────────────────────────────────────────────
    if (path.endsWith('/reviews/undo')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const body = readJsonBody(event) as { cardId?: unknown };
      if (typeof body.cardId !== 'string') {
        throw new ApiError(400, 'cardId is required.');
      }
      // PT404 from the RPC — no such card, not the caller's, or nothing to undo
      // — is mapped to 404 by `errorResponse`.
      return json(200, await undoLastReview(userId, body.cardId));
    }

    // ── POST /reviews ──────────────────────────────────────────────────────
    if (path.endsWith('/reviews')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const body = readJsonBody(event) as {
        cardId?: unknown;
        rating?: unknown;
        durationMs?: unknown;
        expectedUpdatedAt?: unknown;
        next?: unknown;
      };

      if (typeof body.cardId !== 'string') {
        throw new ApiError(400, 'cardId is required.');
      }
      if (
        typeof body.rating !== 'number' ||
        !Number.isInteger(body.rating) ||
        body.rating < 1 ||
        body.rating > 4
      ) {
        throw new ApiError(400, 'rating must be 1, 2, 3 or 4.');
      }
      if (typeof body.expectedUpdatedAt !== 'string') {
        // The optimistic-concurrency token. Without it the RPC cannot tell a
        // stale rating from a fresh one, so it is required rather than defaulted.
        throw new ApiError(400, 'expectedUpdatedAt is required.');
      }

      return json(
        200,
        await reviewCard(userId, body.cardId, {
          rating: body.rating,
          // Genuinely nullable: a card can be rated before any timer started,
          // and zero would read as "answered instantly".
          durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
          expectedUpdatedAt: body.expectedUpdatedAt,
          next: readSchedulingUpdate(body.next),
        }),
      );
    }

    throw new ApiError(404, 'No such route.');
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
