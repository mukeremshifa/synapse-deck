/**
 * Asking a notebook a question. DS2 task 7.
 *
 * ── A mutation, not a query, and the transcript lives in the component ────
 *
 * `useJobProgress` polls because a job changes on its own. A question does not:
 * it is asked once, answered once, and never changes again. So this is
 * `useMutation`, and the transcript is component state rather than cache — a
 * React Query cache keyed by question text would treat "what is glycolysis"
 * asked twice as one entry, and the second ask would return the first answer
 * from cache without spending anything. That sounds like a feature until the
 * user asked again because the first answer was wrong.
 *
 * ── The no-answer case is a success, not an error ─────────────────────────
 *
 * The endpoint returns 200 with `answer: null` when the sources do not cover a
 * question, and that shape is carried through here unchanged. It reaches the
 * pane as data, so it renders as an ordinary turn in the transcript rather than
 * through an error path. "Your sources don't cover this" is the feature working
 * correctly and must not look like a failure — see the pane, and DS2 task 7.
 *
 * A thrown error means something actually broke: the network, the model vendor,
 * a 401. Those are different and are shown differently.
 */

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/**
 * A passage an answer drew on.
 *
 * ── What this resolves to, stated because the UI must not overclaim ───────
 *
 * A **chunk** — a few paragraphs, as the ingestion pipeline split the document.
 * It is not a page number and not a character offset into the original file:
 * chunking produces flat text with no page dimension, and the upload is not
 * retained as text. A chunk is a real, checkable citation. It is not a
 * highlighted sentence in a PDF, and nothing in this UI may imply that it is.
 */
export interface AskCitation {
  jobId: string;
  chunkIndex: number;
  /** The number the answer text cites, as `[1]`. */
  marker: number;
  /** The passage. **Untrusted document text** — rendered as text, never HTML. */
  text: string;
}

export interface AskResponse {
  /** Null when the sources do not cover the question. */
  answer: string | null;
  reason: 'no_sources' | 'not_covered' | 'unavailable' | null;
  citations: AskCitation[];
}

/** One side of the transcript. */
export interface Turn {
  /**
   * Local only, for React keys. Not an id the server knows: nothing is
   * persisted, and a transcript that survived a reload would imply a history
   * this feature does not keep.
   */
  id: string;
  question: string;
  /** Undefined while in flight. */
  response?: AskResponse;
  /** Set when the request itself failed — distinct from a no-answer response. */
  error?: string;
}

export function useAsk(notebookId: string | undefined) {
  return useMutation({
    mutationFn: (question: string) =>
      // The notebook/deck translation, at the wire. `src/lib/notebooks.ts` is
      // explicit that the rename stops at the frontend adapter: a component
      // says notebook, the wire says deck.
      api.post<AskResponse>(`/decks/${notebookId!}/ask`, { question }),
    // Deliberately no retry. Every attempt costs an embedding and a completion,
    // and a question that failed once is worth the user deciding to ask again
    // rather than being asked three times on their behalf.
    retry: false,
  });
}
