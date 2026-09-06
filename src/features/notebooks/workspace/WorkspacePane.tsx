import { MessageSquareIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';

/**
 * The centre pane. In NotebookLM this is chat, grounded in the sources and
 * answering with citations back into them.
 *
 * ── It ships unbuilt, and visibly so ──────────────────────────────────────
 *
 * Grounded chat is not a frontend feature. It needs chunk embeddings, a vector
 * store, a retrieval endpoint and a citation model that can point at a span of
 * a source — none of which exist, and none of which any phase plan covers
 * (P11 §3). The honest options were to ship the pane empty or to ship a text
 * box wired to something.
 *
 * **There is deliberately no input box.** A chat input that accepts a question
 * and returns a plausible answer assembled from nothing is the single most
 * dishonest thing this rewrite could ship: unlike a stub card, which announces
 * itself in its own text, a fluent wrong answer about the user's own study
 * material is indistinguishable from a right one. The same reasoning the stub
 * defences rest on (P10-SESSION-4) applies with more force here, because there
 * is no review gate between the model and the user.
 *
 * So the pane says what it is and what is missing. When retrieval lands, this
 * file is where the transcript goes.
 */
export function WorkspacePane() {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl items-center px-6 py-10">
      <EmptyState
        className="w-full"
        icon={<MessageSquareIcon />}
        title="Asking questions about your sources isn't built yet"
        description={
          <>
            <p>
              This is where you'll chat with your notebook and get answers cited
              back to the source they came from.
            </p>
            <p className="mt-3">
              It needs a retrieval layer that doesn't exist yet, so there's no
              input here rather than a box that would answer from nothing.
            </p>
            <p className="mt-3">
              What does work today is on the right: turn a source into flashcards
              or an exam, then practise them on a real schedule.
            </p>
          </>
        }
      />
    </div>
  );
}
