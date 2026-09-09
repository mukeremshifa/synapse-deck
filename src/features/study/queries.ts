import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  api,
  type Artifact,
  type Attempt,
  type AttemptAnswer,
  type Blueprint,
  type Card,
  type NextSchedule,
  type NoteTopic,
  type PracticeQueue,
  type Question,
  type SubmitAttemptInput,
} from '@/lib/api';
import { notebookKeys } from '@/features/notebook/queries';
import { homeKeys } from '@/features/home/queries';
import type { Grade } from '@/lib/schemas';
import { projectGraded } from './scheduling';

/**
 * The four runners' reads and writes — **FR5's re-pointing at the FR0 contract.**
 *
 * FR2's drift row makes this the first task of any phase that owns a screen:
 * before this file, practice and the exam still ran on `src/lib/queries.ts`, the
 * old deck-shaped stack over `api-client.ts`, and both **500'd against a
 * fake-fixture id** because home and the notebook had already moved. That was
 * the two-stack seam, and this file closes it for the study surfaces.
 *
 * ── Keys ─────────────────────────────────────────────────────────────────
 *
 * Extends FR3's `notebookKeys` rather than opening a second namespace, so
 * **every key still names its notebook** and an invalidation stays scoped to the
 * notebook in front of the user. The additions all name their artifact too,
 * which is the same rule one level down: a queue for *this deck*, questions for
 * *this quiz*, blocks for *this note set*. Nothing here can cache a question
 * the contract cannot ask.
 *
 * ── What is deliberately not here ────────────────────────────────────────
 *
 * No polling. FR4's `useNotebookJobs` is the only thing that watches generation
 * (its drift row: do not add a third mechanism), and a runner is entered on a
 * `ready` artifact — which, since FR4 §6.3, **cannot change under it**, because
 * a regeneration produces a new artifact rather than replacing this one. That is
 * the assumption every runner below is built on and it is why none of them
 * refetch their contents mid-session.
 */
export const studyKeys = {
  artifact: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'artifact', artifactId] as const,
  queue: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'queue', artifactId] as const,
  questions: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'questions', artifactId] as const,
  attempt: (notebookId: string, attemptId: string) =>
    [...notebookKeys.all(notebookId), 'attempt', attemptId] as const,
  attempts: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'attempts', artifactId] as const,
  noteTopics: (notebookId: string, artifactId: string) =>
    [...notebookKeys.all(notebookId), 'note-topics', artifactId] as const,
};

/* ── The artifact a runner is a sitting of ────────────────────────────── */

/**
 * The deck, quiz, exam or note set named in the route.
 *
 * **Every runner starts here**, because every runner route names its artifact
 * (FR2). A runner that could not fetch its own artifact would be one that had
 * guessed which one it meant, which is the audit finding this whole phase
 * exists to fix.
 */
export function useArtifact(notebookId: string, artifactId: string) {
  return useQuery<Artifact>({
    queryKey: studyKeys.artifact(notebookId, artifactId),
    queryFn: () => api.getArtifact(notebookId, artifactId),
  });
}

/* ── Practice ─────────────────────────────────────────────────────────── */

/**
 * The queue for **one deck**, named in the route.
 *
 * `artifactId` is required here even though the contract makes it optional:
 * omitting it queues every deck in the notebook, and a runner reached from
 * `/notebooks/:id/decks/:deckId/practice` that queued every deck is exactly the
 * bug FR2's drift row describes — the old page read `:notebookId`, passed it as
 * a deck id, and a user practising one notebook got cards from all of them.
 *
 * `staleTime: Infinity` because **a queue is a snapshot of a session.**
 * Refetching under someone mid-session reorders the cards they are working
 * through. The session ends, and then a refetch is an explicit act.
 */
export function usePracticeQueue(notebookId: string, artifactId: string) {
  return useQuery<PracticeQueue>({
    queryKey: studyKeys.queue(notebookId, artifactId),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: () => api.getPracticeQueue(notebookId, artifactId),
  });
}

export type ReviewVariables = {
  card: Card;
  grade: Grade;
  durationMs: number | null;
  next: NextSchedule;
};

/**
 * Commit one rating.
 *
 * **`next` is computed by the caller, not here**, and that is the contract's
 * design rather than an accident: the interval the user was *shown* on the
 * rating button must be the interval committed, so the preview the session
 * already holds is threaded into `gradeToNext` and the result passed in.
 * Recomputing it in this mutation would re-roll the scheduler's fuzz and commit
 * a different number from the one on the button.
 *
 * The optimistic update drops the card from the cached queue so that a remount
 * does not re-serve a card that was just rated.
 */
export function useReviewCard(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ card, grade, durationMs, next }: ReviewVariables) =>
      api.reviewCard(notebookId, {
        cardId: card.id,
        grade,
        durationMs,
        // Byte for byte. A mismatch is `stale_card` — two tabs rating the same
        // card — and is an expected outcome, not a crash.
        expectedUpdatedAt: card.updatedAt,
        next,
      }),

    onMutate: async ({ card, next }) => {
      const key = studyKeys.queue(notebookId, artifactId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PracticeQueue>(key);
      if (previous) {
        const graded = projectGraded(card, next);
        queryClient.setQueryData<PracticeQueue>(key, {
          ...previous,
          due: previous.due.filter(queued => queued.id !== card.id),
          fresh: previous.fresh.filter(queued => queued.id !== card.id),
          // A new card rated is a new card introduced. Keeping this in step
          // matters because the allowance is what the empty state reports.
          introducedToday:
            card.fsrsState === 'new'
              ? previous.introducedToday + 1
              : previous.introducedToday,
          nextDueAt: soonest(previous.nextDueAt, graded.due),
        });
      }
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          studyKeys.queue(notebookId, artifactId),
          context.previous,
        );
      }
    },

    onSuccess: () => {
      // The deck's due/new counts moved, and so did the notebook's readiness
      // and home's grid. Invalidated once per rating rather than refetching the
      // queue, which `staleTime: Infinity` deliberately holds still.
      void queryClient.invalidateQueries({
        queryKey: studyKeys.artifact(notebookId, artifactId),
      });
      void queryClient.invalidateQueries({
        queryKey: notebookKeys.artifacts(notebookId),
      });
      void queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) });
      void queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
    },
  });
}

/** The soonest of two due times, either of which may be absent. */
function soonest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.localeCompare(b) <= 0 ? a : b;
}

/**
 * Undo the last rating on a card.
 *
 * The review is tombstoned rather than deleted (the contract's `undoneAt`), so
 * this is an audit-preserving reversal and not a hole in the history.
 */
export function useUndoReview(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cardId: string) => api.undoReview(notebookId, cardId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: studyKeys.artifact(notebookId, artifactId),
      });
      void queryClient.invalidateQueries({
        queryKey: notebookKeys.artifacts(notebookId),
      });
      void queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
    },
  });
}

/** Grade a card and produce the `next` to commit. Re-exported for the runners. */
export { gradeToNext, previewFor, toScheduling } from './scheduling';

/* ── Questions and attempts ───────────────────────────────────────────── */

/**
 * The questions of a quiz or exam, in stored order.
 *
 * Order matters and is the server's: a runner that re-sorted these would break
 * the correspondence between a question and the answer recorded against it.
 * Shuffling, where an exam asks for it, happens **once when the attempt starts**
 * and never at render time.
 */
export function useQuestions(notebookId: string, artifactId: string) {
  return useQuery<Question[]>({
    queryKey: studyKeys.questions(notebookId, artifactId),
    staleTime: Infinity,
    queryFn: () => api.listQuestions(notebookId, artifactId),
  });
}

/**
 * Begin a sitting — or **rejoin one**, for a quiz.
 *
 * The contract resolves that: `startAttempt` on a quiz with an `in-progress`
 * attempt returns *that* attempt rather than opening a second one beside it.
 * So this one call is both "start" and "resume", and the runner does not have
 * to decide which it is doing — it reads `answers.length` and carries on.
 * That is FR5 §6.1's answer, and the reason quiz resume needs no local storage.
 */
/**
 * Reweight an exam — **the promise FR4's generate modal made.**
 *
 * That modal tells the user the blueprint "belongs to the exam, and you can
 * adjust it once it exists". Until FR6 nothing could: `updateArtifact` took
 * `{ title }` alone, so the capability did not exist in the contract at all.
 * It does now, and this is the only caller.
 *
 * The blueprint lives with its exam (brief §1.2(9)), so the editor is on the
 * exam brief rather than on the notebook overview — the overview's plan puts
 * per-exam blueprints explicitly out of its own scope for that reason.
 *
 * Invalidates rather than writing the response into the cache, because the
 * server sets `basis` to `'manual'` and recomputes the payload: what comes
 * back is not what was sent.
 */
export function useUpdateBlueprint(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (blueprint: Blueprint) =>
      api.updateArtifact(notebookId, artifactId, { blueprint }),
    onSuccess: artifact => {
      queryClient.setQueryData(studyKeys.artifact(notebookId, artifactId), artifact);
      // The notebook's artifact list and the overview show this exam too.
      void queryClient.invalidateQueries({
        queryKey: ['api', 'notebook', notebookId],
      });
    },
  });
}

export function useStartAttempt(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.startAttempt(notebookId, artifactId),
    onSuccess: attempt => {
      queryClient.setQueryData(studyKeys.attempt(notebookId, attempt.id), attempt);
    },
  });
}

/**
 * Save an in-progress quiz attempt. **Quizzes only** — an exam is submitted
 * whole, and calling this from one would make a half-sat exam a durable record
 * of something that never happened.
 */
export function useSaveAttemptProgress(notebookId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      attemptId,
      answers,
    }: {
      attemptId: string;
      answers: AttemptAnswer[];
    }) => api.saveAttemptProgress(notebookId, attemptId, answers),
    onSuccess: attempt => {
      queryClient.setQueryData(studyKeys.attempt(notebookId, attempt.id), attempt);
    },
  });
}

/** End a sitting: submitted, expired, or abandoned. */
export function useSubmitAttempt(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      attemptId,
      input,
    }: {
      attemptId: string;
      input: SubmitAttemptInput;
    }) => api.submitAttempt(notebookId, attemptId, input),
    onSuccess: attempt => {
      queryClient.setQueryData(studyKeys.attempt(notebookId, attempt.id), attempt);
      void queryClient.invalidateQueries({
        queryKey: studyKeys.attempts(notebookId, artifactId),
      });
      void queryClient.invalidateQueries({
        queryKey: studyKeys.artifact(notebookId, artifactId),
      });
      void queryClient.invalidateQueries({
        queryKey: notebookKeys.artifacts(notebookId),
      });
      void queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) });
      void queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
    },
  });
}

/** Past sittings of one quiz or exam, newest first. */
export function useAttempts(notebookId: string, artifactId: string) {
  return useQuery<Attempt[]>({
    queryKey: studyKeys.attempts(notebookId, artifactId),
    queryFn: async () => {
      const page = await api.listAttempts(notebookId, { artifactId });
      return page.items;
    },
  });
}

/* ── Notes ────────────────────────────────────────────────────────────── */

/**
 * A note set's topics, in reading order, each carrying its own blocks.
 *
 * `staleTime: Infinity` because the content is written once at generation and
 * never changes — there is no editor (§4.2). What *does* change is completion,
 * and that lives on the artifact rather than here, which is why ticking a topic
 * refreshes the artifact and leaves this query alone.
 */
export function useNoteTopics(notebookId: string, artifactId: string) {
  return useQuery<NoteTopic[]>({
    queryKey: studyKeys.noteTopics(notebookId, artifactId),
    staleTime: Infinity,
    queryFn: () => api.listNoteTopics(notebookId, artifactId),
  });
}

/**
 * What every note-set mutation has to refresh.
 *
 * Completion is a *readiness* input, so it is not enough to update the artifact
 * the reader is looking at: the Studio lists this note set with its readiness,
 * the notebook header aggregates it, and home's grid aggregates that. All three
 * are stale the moment a topic is ticked, and a reader who ticks the last topic
 * and navigates back to a notebook still claiming "2 topics to read" is the bug
 * this exists to prevent.
 */
function onNoteSetChanged(
  queryClient: ReturnType<typeof useQueryClient>,
  notebookId: string,
  artifactId: string,
) {
  return (artifact: Artifact) => {
    queryClient.setQueryData(studyKeys.artifact(notebookId, artifactId), artifact);
    void queryClient.invalidateQueries({ queryKey: notebookKeys.artifacts(notebookId) });
    void queryClient.invalidateQueries({ queryKey: notebookKeys.detail(notebookId) });
    void queryClient.invalidateQueries({ queryKey: homeKeys.notebooks });
  };
}

/**
 * Tick a topic off, or untick it.
 *
 * **Optimistic**, because a checkbox that waits for a round trip before it
 * moves feels broken — and this one is safe to be: the mutation carries the
 * desired state rather than an increment, so a failure rolls back to a value
 * that is still correct, and a retry means the same thing as the first attempt.
 */
export function useSetTopicCompleted(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();
  const key = studyKeys.artifact(notebookId, artifactId);

  return useMutation({
    mutationFn: ({ topicId, completed }: { topicId: string; completed: boolean }) =>
      api.setTopicCompleted(notebookId, artifactId, topicId, completed),
    onMutate: async ({ completed }) => {
      // Stop an in-flight refetch from landing on top of the optimistic value.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Artifact>(key);
      if (previous?.payload.kind === 'noteset') {
        const { payload } = previous;
        queryClient.setQueryData<Artifact>(key, {
          ...previous,
          payload: {
            ...payload,
            // Clamped, so a double-click cannot show "3 of 2".
            completedTopicCount: Math.max(
              0,
              Math.min(
                payload.topicCount,
                payload.completedTopicCount + (completed ? 1 : -1),
              ),
            ),
          },
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: onNoteSetChanged(queryClient, notebookId, artifactId),
  });
}

/** The button at the end — the student declaring the note set finished. */
export function useSetNoteSetCompleted(notebookId: string, artifactId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (completed: boolean) =>
      api.setNoteSetCompleted(notebookId, artifactId, completed),
    onSuccess: onNoteSetChanged(queryClient, notebookId, artifactId),
  });
}
