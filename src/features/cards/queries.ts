import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import {
  api,
  type Card,
  type CreateCardInput,
  type UpdateCardInput,
} from '@/lib/api';
import { notebookKeys } from '@/features/notebook/queries';
import { homeKeys } from '@/features/home/queries';

/**
 * A deck's cards — the reads and writes behind `DeckBrowser`.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * Four card methods had been in the contract since FR0 and **nothing in `src/`
 * outside `src/lib/api/` called any of them.** `listCards`, `updateCard`,
 * `setCardStatus` and `deleteCards` were a client path that stopped at the
 * client: a user met their cards one at a time during review and could not fix
 * a hallucinated one, because the only surface that could edit a card had no
 * screen to live on. This is that screen's data layer.
 *
 * ── Keys ──────────────────────────────────────────────────────────────────
 *
 * Nested **under `notebookKeys.all`** rather than beside it, and that is the
 * load-bearing choice here. Every existing mutation in the app invalidates
 * `['api', 'notebook', notebookId]`, so a generation that adds cards, a deleted
 * artifact, or a finished job already invalidates this list without any of them
 * having to learn that a card list now exists. A sibling key would have meant
 * editing every one of those call sites, and missing one would show a user a
 * deck whose cards were generated ten seconds ago and are not there.
 */
export const cardKeys = {
  all: (notebookId: string) => [...notebookKeys.all(notebookId), 'cards'] as const,
  list: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'cards', artifactId] as const,
};

/* ── Reads ────────────────────────────────────────────────────────────── */

/**
 * One deck's cards, **paginated for real**.
 *
 * `listCards` returns a `Page<Card>` with an opaque cursor, so this is an
 * infinite query rather than a `useQuery` reading `.items`. The rest of the app
 * reads the first page of its lists and stops — `useSources` says so in as many
 * words — and that is defensible for a rail showing a handful of sources. It is
 * not defensible here: a generated deck is routinely fifty cards and the server
 * caps a page at 100, so "the first page" is a card list that silently omits
 * the cards you came to fix.
 *
 * `flat` is every page concatenated, which is what a list renders.
 */
export function useCards(notebookId: string, artifactId: string) {
  const query = useInfiniteQuery({
    queryKey: cardKeys.list(notebookId, artifactId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.listCards(notebookId, artifactId, pageParam ? { cursor: pageParam } : undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  });

  const flat: Card[] = query.data?.pages.flatMap(page => page.items) ?? [];
  return { ...query, cards: flat };
}

/* ── Writes ───────────────────────────────────────────────────────────── */

/**
 * Add cards by hand. **Plural**, because one cloze draft is several cards.
 *
 * Invalidates the notebook rather than just this list: a new card changes the
 * deck's card count and its due count, which the Studio rail and home's grid
 * both render.
 */
export function useCreateCards(
  notebookId: string,
): UseMutationResult<Card[], Error, CreateCardInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCardInput) => api.createCards(notebookId, input),
    onSuccess: () => invalidateCards(queryClient, notebookId),
  });
}

/**
 * Edit a card's content, and only its content.
 *
 * **The schedule is deliberately untouched** — that is why the contract keeps
 * content and scheduling in separate fields. Someone fixing a typo on a card
 * they have reviewed for four months does not expect to lose the interval, and
 * `UpdateCardInput` has no field that could take it from them.
 */
export function useUpdateCard(
  notebookId: string,
): UseMutationResult<Card, Error, { cardId: string; input: UpdateCardInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, input }: { cardId: string; input: UpdateCardInput }) =>
      api.updateCard(notebookId, cardId, input),
    onSuccess: () => invalidateCards(queryClient, notebookId),
  });
}

/**
 * Suspend or unsuspend. **The reversible one**, and the reason delete is not
 * the only way out of a bad card: a suspended card leaves the queue and keeps
 * every review it has ever had.
 */
export function useSetCardStatus(
  notebookId: string,
): UseMutationResult<
  { ids: string[] },
  Error,
  { cardIds: string[]; status: 'active' | 'suspended' }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      cardIds,
      status,
    }: {
      cardIds: string[];
      status: 'active' | 'suspended';
    }) => api.setCardStatus(notebookId, cardIds, status),
    onSuccess: () => invalidateCards(queryClient, notebookId),
  });
}

/**
 * Delete cards. **Destroys their FSRS history**, which is the months of work
 * the user has actually done — the schedule is the product, not the text.
 * `DeckBrowser` confirms before calling this and says so; suspend is offered in
 * the same menu as the reversible alternative.
 */
export function useDeleteCards(
  notebookId: string,
): UseMutationResult<{ ids: string[] }, Error, string[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardIds: string[]) => api.deleteCards(notebookId, cardIds),
    onSuccess: () => invalidateCards(queryClient, notebookId),
  });
}

/**
 * Everything a card mutation can have changed.
 *
 * The whole notebook, not just the card list: a card's existence and status
 * feed the deck's `readiness.detail` ("12 cards due"), the notebook's roll-up
 * and home's grid. Suspending twenty cards and leaving the rail still promising
 * to practise them is exactly the drift computed readiness exists to prevent.
 */
async function invalidateCards(
  queryClient: QueryClient,
  notebookId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: notebookKeys.all(notebookId) }),
    queryClient.invalidateQueries({ queryKey: homeKeys.notebooks }),
  ]);
}
