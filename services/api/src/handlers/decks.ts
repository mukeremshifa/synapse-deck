/**
 * `/decks` and `/decks/{deckId}` — the deck list, one deck, and the review gate.
 *
 * One Lambda per resource group rather than one per route (P9 task 7): a route
 * per function multiplies cold starts across a page that fetches three things,
 * and a single monolith makes every deploy touch every path. A resource group
 * is the unit that changes together.
 *
 * No SQL here. See `handlers/profile.ts` for the four steps every handler follows.
 */

import {
  createDeck,
  deleteDeck,
  finishReviewGate,
  getDeck,
  listDecks,
  updateDeck,
} from '../data/decks.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  pathParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError, notFound } from '../lib/rows.ts';
import { DeckInput } from '../lib/schemas.ts';

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method, path } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    // `/decks/{deckId}/finish-gate` — closing the review gate. Matched before
    // the collection routes because it is the most specific path.
    if (path.endsWith('/finish-gate')) {
      if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);
      const deck = await finishReviewGate(userId, pathParam(event, 'deckId'));
      if (!deck) throw notFound('Deck');
      return json(200, deck);
    }

    const deckId = event.pathParameters?.['deckId'];

    if (deckId === undefined) {
      switch (method) {
        case 'GET':
          // `now` is the server's clock, not the client's. The due count is a
          // fact about the database and a client with a skewed clock should not
          // be able to shift it.
          return json(200, await listDecks(userId, new Date()));

        case 'POST': {
          const input = DeckInput.parse(readJsonBody(event));
          return json(
            201,
            await createDeck(userId, {
              title: input.title,
              description: input.description || null,
            }),
          );
        }

        default:
          throw new ApiError(405, `${method} is not allowed here.`);
      }
    }

    switch (method) {
      case 'GET': {
        const deck = await getDeck(userId, deckId);
        // 404, never 403. A 403 would confirm the id exists and turn a deck id
        // into an oracle — see `notFound` in lib/rows.ts, and P9 acceptance
        // criterion 5, which checks for exactly this.
        if (!deck) throw notFound('Deck');
        return json(200, deck);
      }

      case 'PATCH': {
        const input = DeckInput.parse(readJsonBody(event));
        const deck = await updateDeck(userId, deckId, {
          title: input.title,
          description: input.description || null,
        });
        if (!deck) throw notFound('Deck');
        return json(200, deck);
      }

      case 'DELETE': {
        // Cards and their reviews cascade with the deck. The confirmation is
        // the client's job (SPEC §10); by the time a request arrives here the
        // user has already said yes.
        const deleted = await deleteDeck(userId, deckId);
        if (!deleted) throw notFound('Deck');
        return json(200, { id: deckId });
      }

      default:
        throw new ApiError(405, `${method} is not allowed here.`);
    }
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
