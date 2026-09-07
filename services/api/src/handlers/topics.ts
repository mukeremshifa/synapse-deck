/**
 * `/topics` — the user's topics, with the counts the blueprint weighs.
 *
 * ── Why this route did not exist until DS3 ────────────────────────────────
 *
 * `topics` has been a real table since migration 0004 and `reconcileTopics` has
 * been filling it at the review gate since P10. But **nothing ever read it
 * across the wire**: every screen that appeared to group by topic was grouping
 * fixture data carrying `topicId` and `topicName` inline. DS3 §0 found this by
 * grepping for "topic" in `src/lib/queries.ts` and getting nothing.
 *
 * So this is the blocking task of that phase — the blueprint cannot come off
 * fixtures until there is something to read instead.
 *
 * No SQL here. See `handlers/profile.ts` for the four steps every handler
 * follows.
 */

import { countUnfiledCards, listTopicsWithCounts } from '../data/topics.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError } from '../lib/rows.ts';

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);

    /*
     * Two reads, in parallel. They touch different rows of the same table and
     * neither depends on the other, so a transaction would buy consistency
     * nobody consumes: the blueprint is a proposal recomputed on every load,
     * and a card filed between these two queries changes a weight by a fraction
     * of a percent on the next render rather than corrupting anything.
     */
    const [topics, unfiled] = await Promise.all([
      listTopicsWithCounts(userId),
      countUnfiledCards(userId),
    ]);

    /*
     * `unfiledCards` travels beside the list rather than inside it. It is a
     * count without an id — nothing can be filed under it and no exam can be
     * scoped to it — and a synthetic row with a fake uuid would flow into code
     * paths that assume a topic they can address. See `countUnfiledCards`.
     */
    return json(200, { topics, unfiledCards: unfiled });
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
