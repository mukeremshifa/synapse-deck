import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type QueryClient,
} from '@tanstack/react-query';

import {
  api,
  type AddSourceInput,
  type Artifact,
  type ArtifactKind,
  type AskInput,
  type AskResponse,
  type CreateArtifactInput,
  type Job,
} from '@/lib/api';
import { homeKeys } from '@/features/home/queries';

/**
 * The notebook's reads and writes — **FR3's re-pointing at the FR0 contract.**
 *
 * ── Why this file exists at all ───────────────────────────────────────────
 *
 * At the start of FR3 the app ran on two data stacks: `src/lib/queries.ts` (the
 * old deck-shaped one, over `api-client.ts`) and `@/lib/api` (the contract),
 * which only `src/features/home` consumed. FR2's drift row makes re-pointing
 * the first task of every phase that owns a screen, and this is FR3's half:
 * the notebook shell, its sources, its artifacts and its chat.
 *
 * The hooks live beside the screen rather than in `queries.ts` for the reason
 * home's do — hiding a transitional split behind a common wrapper is how it
 * becomes permanent. `queries.ts` dies when FR5 and FR6 have re-pointed the
 * runners and the overview; it is not extended here in the meantime.
 *
 * ── Keys ─────────────────────────────────────────────────────────────────
 *
 * Namespaced under `['api', 'notebook', notebookId, …]`, so **every key names
 * its notebook**. That is not tidiness: it is what makes invalidation after a
 * mutation scoped to the notebook the user is looking at, and it mirrors the
 * contract's own rule that `notebookId` is the required first parameter of
 * everything (brief §1). A key that could not name its notebook would be
 * caching a question the contract cannot ask.
 */
export const notebookKeys = {
  all: (notebookId: string) => ['api', 'notebook', notebookId] as const,
  detail: (notebookId: string) => ['api', 'notebook', notebookId, 'detail'] as const,
  sources: (notebookId: string) => ['api', 'notebook', notebookId, 'sources'] as const,
  artifacts: (notebookId: string) =>
    ['api', 'notebook', notebookId, 'artifacts'] as const,
  /** In-flight and recently finished generation. FR4's `jobs.ts` owns it. */
  jobs: (notebookId: string) => ['api', 'notebook', notebookId, 'jobs'] as const,
};

/* ── Reads ────────────────────────────────────────────────────────────── */

/** The notebook itself: title, description, readiness roll-up, counts. */
export function useNotebook(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.detail(notebookId),
    queryFn: () => api.getNotebook(notebookId),
  });
}

/**
 * This notebook's sources.
 *
 * **Reads `.items`** — the contract is paginated (FR0's drift row). The first
 * page is the rail; a notebook with more sources than one page is a real
 * scrolling decision, and FR3 does not invent a "Load more" nobody has seen.
 *
 * **FR3's poll is gone, and its removal is the point.** This used to
 * `refetchInterval` while any source was `processing` — the honest minimum
 * before a job surface existed. FR4 built that surface (`jobs.ts` polls
 * `listJobs`), and its drift row is explicit that leaving this in would mean
 * two mechanisms watching the same thing: the job query already invalidates
 * this one when a job finishes, so a second poll would only ever race it.
 */
export function useSources(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.sources(notebookId),
    queryFn: () => api.listSources(notebookId),
    select: page => page.items,
  });
}

/**
 * Every artifact in this notebook, of every kind, in one query.
 *
 * **One query rather than five, and that is a deliberate trade.** The Studio
 * shows five entries at once; five `listArtifacts(notebookId, { kind })` calls
 * would be five round trips to render one rail, and the kinds are grouped
 * client-side from a list the screen needs in full anyway. The contract's
 * `kind` filter stays available for a surface that genuinely wants one kind —
 * FR5's runners, FR6's overview.
 *
 * A `generating` artifact is a real, listable row (the contract says so). FR3
 * polled here while one was in flight; **FR4 removed that poll** for the reason
 * given on `useSources` — `jobs.ts` watches the jobs and invalidates this query
 * when one finishes, so the row updates from the mechanism that actually knows.
 */
export function useArtifacts(notebookId: string) {
  return useQuery({
    queryKey: notebookKeys.artifacts(notebookId),
    queryFn: () => api.listArtifacts(notebookId),
    select: page => page.items,
  });
}

/** Artifacts of one kind, grouped from the single list above. */
export function groupByKind(
  artifacts: Artifact[] | undefined,
): Record<ArtifactKind, Artifact[]> {
  const grouped: Record<ArtifactKind, Artifact[]> = {
    deck: [],
    quiz: [],
    noteset: [],
    exam: [],
  };
  for (const artifact of artifacts ?? []) grouped[artifact.kind].push(artifact);
  return grouped;
}

/* ── Writes ───────────────────────────────────────────────────────────── */

/**
 * Add a source. **Returns a `Job`**, because extraction, chunking and embedding
 * take time — the contract is explicit that this is not a synchronous create.
 *
 * FR3 shows the minimal pending state that follows from that: the source
 * appears in the rail at `processing`, and `useSources` polls until it is
 * `ready` or `failed`. **FR4 replaces this** with the real progress surface
 * over `getJob`, including the case FR0's drift row names — a job that fails
 * before any stage reports, with `unitsTotal` still 0.
 */
export function useAddSource(
  notebookId: string,
): UseMutationResult<Job, Error, AddSourceInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSourceInput) => api.addSource(notebookId, input),
    onSuccess: () => invalidateNotebook(queryClient, notebookId),
  });
}

/**
 * Delete a source. **Artifacts built from it are deliberately untouched**
 * (brief §1.2(7)): their `sourceIds` now dangle and their `sourcesSnapshot`
 * still says what they were built from. So this invalidates the artifact list
 * too — not because the artifacts changed, but because *which of their source
 * ids still resolve* did, and that is what the provenance line renders.
 */
export function useDeleteSource(notebookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.deleteSource(notebookId, sourceId),
    onSuccess: () => invalidateNotebook(queryClient, notebookId),
  });
}

/**
 * Generate an artifact. **Returns a `Job`**, never the finished artifact —
 * FR4's governing rule, and the contract's.
 *
 * The artifact appears immediately in `listArtifacts` at `status: 'generating'`
 * — a real, listable, unopenable row — and the job filling it is polled by
 * `useJobs` in `jobs.ts`. So this invalidates the notebook on success not
 * because anything is finished, but because the *row* now exists.
 *
 * An error here is a failure to **start** a job — a quota refusal is refused at
 * submission — which is a different surface from a job that fails while
 * running. `generation-errors.ts` handles both and says which is which.
 */
export function useCreateArtifact(
  notebookId: string,
): UseMutationResult<Job, Error, CreateArtifactInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArtifactInput) => api.createArtifact(notebookId, input),
    onSuccess: () => invalidateNotebook(queryClient, notebookId),
  });
}

/**
 * Delete an artifact — **and this is how a failed generation is cleared.**
 *
 * A failed artifact keeps its row so the user can see what did not work (the
 * contract is explicit), which means something has to remove it once they have.
 * It is the same call a user deleting a finished artifact makes; nothing about
 * failure is special except that there is no content to lose.
 */
export function useDeleteArtifact(notebookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) => api.deleteArtifact(notebookId, artifactId),
    onSuccess: () => invalidateNotebook(queryClient, notebookId),
  });
}

/** Ask a question grounded in this notebook's sources. */
export function useAsk(
  notebookId: string,
): UseMutationResult<AskResponse, Error, AskInput> {
  return useMutation({
    mutationFn: (input: AskInput) => api.ask(notebookId, input),
  });
}

/**
 * Save one chat response as a note set — brief §1.2(4)'s single chat
 * requirement, and the reason `AskResponse` carries an `id`.
 *
 * It is a `createArtifact` of kind `noteset` with `fromResponseId`, which is
 * why the fixtures ship one with `origin: 'chat'`: a note made this way stays
 * distinguishable from a generated one, for ever, without a second table.
 * **It returns a `Job` like any other generation** — the note is not ready when
 * this resolves, and it appears in Studio's Notes entry as a `generating` row.
 */
export function useSaveResponseAsNote(notebookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      response,
      sourceIds,
    }: {
      response: AskResponse;
      sourceIds: string[];
    }) =>
      api.createArtifact(notebookId, {
        kind: 'noteset',
        title: titleForResponse(response),
        sourceIds,
        depth: 'balanced',
        fromResponseId: response.id,
      }),
    onSuccess: () => invalidateNotebook(queryClient, notebookId),
  });
}

/**
 * A saved response needs a title and the user did not write one. The question
 * is the best available name — it is what the user actually typed — trimmed to
 * the contract's 200-character limit rather than sliced blind, so a long
 * question becomes a readable title instead of a validation error whose cause
 * is invisible.
 */
function titleForResponse(response: AskResponse): string {
  const question = response.question.trim();
  if (question.length === 0) return 'Saved answer';
  return question.length <= 200 ? question : `${question.slice(0, 199).trimEnd()}…`;
}

/**
 * Everything a mutation on this notebook can have changed.
 *
 * Sources, artifacts and the notebook's own roll-up move together: adding a
 * source changes `counts.sources` and can change `readiness`, and deleting one
 * changes which artifact provenance links resolve. Home's grid shows the same
 * roll-up, so it goes too — a notebook whose card on `/` still claims the old
 * count is exactly the drift that computed readiness exists to prevent.
 */
async function invalidateNotebook(
  queryClient: QueryClient,
  notebookId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: notebookKeys.all(notebookId) }),
    queryClient.invalidateQueries({ queryKey: homeKeys.notebooks }),
  ]);
}
