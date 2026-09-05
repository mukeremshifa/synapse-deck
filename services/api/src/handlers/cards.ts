/**
 * `/decks/{deckId}/cards`, `/cards/{cardId}`, and the bulk card operations.
 *
 * No SQL here. See `handlers/profile.ts` for the four steps every handler follows.
 */

import {
  acceptDrafts,
  createCards,
  deleteCards,
  listDeckCards,
  listDraftCards,
  setCardStatus,
  updateCardContent,
  type CardInsert,
  type FreshScheduling,
} from '../data/cards.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  pathParam,
  queryParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError, notFound } from '../lib/rows.ts';
import { CardPayload } from '../lib/schemas.ts';

/**
 * Fresh-card scheduling, without pulling `ts-fsrs` into the bundle.
 *
 * This is `newCardScheduling(now)` from `src/lib/fsrs.ts` with the values
 * inlined. That is a deliberate duplication and it needs a reason, because
 * duplicating scheduling logic is exactly what this project's one-definition
 * rule exists to prevent:
 *
 * `newCardScheduling` calls ts-fsrs's `createEmptyCard`, whose entire
 * contribution for a *brand-new* card is `due = now`. Everything else is the
 * literal zero state below. Importing ts-fsrs here would add the whole
 * scheduling library to a Lambda bundle to compute one timestamp, and cold
 * start on a VPC Lambda is the budget this phase is trying not to spend.
 *
 * **The real scheduler is not duplicated.** Every interval a review produces is
 * computed by `applyGrade` on the client and validated by `review_card` in the
 * database. This function creates cards that have never been reviewed, which is
 * the one case where FSRS has nothing to say.
 */
function freshScheduling(now: Date): FreshScheduling {
  return {
    fsrs_state: 'new',
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
    scheduled_days: 0,
    elapsed_days: 0,
    learning_steps: 0,
  };
}

/** The bulk operations take `{ cardIds: string[] }`, and nothing else. */
function readCardIds(body: unknown): string[] {
  const ids = (body as { cardIds?: unknown } | null)?.cardIds;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    throw new ApiError(400, 'cardIds must be an array of ids.');
  }
  // A cap, because this list is attacker-controlled and becomes a `uuid[]` sent
  // to Postgres. A review gate is tens of cards; a thousand is not a use case.
  if (ids.length > 1000) {
    throw new ApiError(400, 'Too many cards in one request.');
  }
  return ids as string[];
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method, path } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    // ── Bulk operations: POST /cards/{accept,status,delete} ────────────────
    //
    // POST rather than PATCH on a collection, because each takes a list of ids
    // in the body and there is no single resource being addressed.
    if (path.endsWith('/cards/accept')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const ids = await acceptDrafts(userId, readCardIds(readJsonBody(event)));
      // The ids that actually changed. An id in the request that was not the
      // caller's is simply absent from the result — the API does not say which,
      // because saying so is the oracle it refuses to be.
      return json(200, { ids });
    }

    if (path.endsWith('/cards/status')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const body = readJsonBody(event) as { status?: unknown };
      if (body.status !== 'active' && body.status !== 'suspended') {
        throw new ApiError(400, 'status must be "active" or "suspended".');
      }
      const ids = await setCardStatus(userId, readCardIds(body), body.status);
      return json(200, { ids });
    }

    if (path.endsWith('/cards/delete')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const ids = await deleteCards(userId, readCardIds(readJsonBody(event)));
      return json(200, { ids });
    }

    // ── Deck-scoped: /decks/{deckId}/cards ─────────────────────────────────
    const deckId = event.pathParameters?.['deckId'];
    if (deckId !== undefined) {
      switch (method) {
        case 'GET':
          // `?status=draft` is the review gate's queue; anything else is the
          // deck's card list. A query parameter rather than a second route
          // because it is the same collection, filtered.
          return json(
            200,
            queryParam(event, 'status') === 'draft'
              ? await listDraftCards(userId, deckId)
              : await listDeckCards(userId, deckId),
          );

        case 'POST': {
          const body = readJsonBody(event) as {
            payloads?: unknown;
            sourceExcerpt?: unknown;
          };
          const raw = Array.isArray(body.payloads) ? body.payloads : [body.payloads];
          // Every payload through the shared schema. Card content is untrusted
          // (SPEC §10) and this is the last point before a `jsonb` column.
          const payloads = raw.map(payload => CardPayload.parse(payload));
          const sourceExcerpt =
            typeof body.sourceExcerpt === 'string' ? body.sourceExcerpt : null;

          const inserts: CardInsert[] = payloads.map(payload => ({
            kind: payload.kind,
            payload,
            sourceExcerpt,
          }));

          const cards = await createCards(
            userId,
            deckId,
            inserts,
            freshScheduling(new Date()),
          );
          // No rows means the deck was not the caller's: the `owned_deck` CTE
          // matched nothing and the insert wrote nothing. Same 404 as every
          // other ownership failure.
          if (cards.length === 0) throw notFound('Deck');
          return json(201, cards);
        }

        default:
          throw new ApiError(405, `${method} is not allowed here.`);
      }
    }

    // ── Single card: /cards/{cardId} ───────────────────────────────────────
    const cardId = pathParam(event, 'cardId');

    if (method === 'PATCH') {
      // Content only. Editing a card must never disturb its schedule — that is
      // the point of keeping content and scheduling in separate columns (§5.3).
      const payload = CardPayload.parse(readJsonBody(event));
      const card = await updateCardContent(userId, cardId, {
        kind: payload.kind,
        payload,
      });
      if (!card) throw notFound('Card');
      return json(200, card);
    }

    throw new ApiError(405, `${method} is not allowed here.`);
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
