import { useRef, useState, type FormEvent } from 'react';
import { ChevronDownIcon, LoaderIcon, MessageSquareIcon, SendIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAsk, type AskCitation, type Turn } from './useAsk';

/**
 * The centre pane: chat, grounded in the notebook's own sources. DS2 task 7.
 *
 * ── What this file used to say, and why that changed ──────────────────────
 *
 * Until DS2 this pane shipped deliberately empty, with **no input box**, and
 * the header said why: a chat input that accepts a question and returns a
 * plausible answer assembled from nothing is the most dishonest thing this
 * rewrite could ship. Unlike a stub card — which announces itself in its own
 * text and passes a review gate — a fluent wrong answer about the user's own
 * study material is indistinguishable from a right one.
 *
 * **That refusal is lifted, and only because the thing it was waiting for now
 * exists.** Retrieval is real: `migrations/0007_chunk_embeddings.sql` holds a
 * vector per chunk, `data/chunks.ts` searches them scoped to one user and one
 * notebook, and `handlers/chat.ts` refuses to call a model at all when nothing
 * clears the relevance floor. The input box is honest now because there is
 * something behind it; it would not have been before.
 *
 * The inherited reasoning still binds this file, in three places:
 *
 * 1. **The no-answer case is a first-class outcome, not an error.** "Your
 *    sources don't cover this" is the feature working. It renders as an
 *    ordinary turn in the transcript — no red, no toast, no retry button.
 * 2. **A citation is a chunk.** A few paragraphs, expandable to show the
 *    passage. **Not a page number and not a highlight**, because the data
 *    cannot support either: chunking produces flat text with no page dimension
 *    and the original upload is not retained as text. Implying more precision
 *    than the data has is the same failure as a stub answer, one layer down.
 * 3. **Answers and passages are untrusted output** — model prose and document
 *    text. Both are rendered as text. `dangerouslySetInnerHTML` is blocked by
 *    an ESLint rule and this pane is exactly the surface that rule exists for.
 *
 * ── The pending state is a spinner, not a fake stream ─────────────────────
 *
 * A question takes a few seconds: an embedding call, a vector search, then a
 * completion. Nothing streams — the endpoint returns one JSON object — so the
 * pending state says "thinking" and means it. A simulated token-by-token
 * reveal would be a lie about what the system is doing, and DS2 §2 puts real
 * streaming in a later phase precisely so it is not faked here first.
 */
export function WorkspacePane({ notebookId }: { notebookId: string | undefined }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const ask = useAsk(notebookId);
  const endRef = useRef<HTMLDivElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (question === '' || ask.isPending || notebookId === undefined) return;

    const id = `${Date.now()}-${turns.length}`;
    setTurns(previous => [...previous, { id, question }]);
    setDraft('');

    ask.mutate(question, {
      // Both callbacks resolve the *same* turn by id rather than appending, so
      // two questions asked in quick succession cannot land their answers in
      // the wrong order. The input is disabled while pending, which makes that
      // unlikely; resolving by id makes it impossible.
      onSuccess: response =>
        setTurns(previous =>
          previous.map(turn => (turn.id === id ? { ...turn, response } : turn)),
        ),
      onError: (error: Error) =>
        setTurns(previous =>
          previous.map(turn =>
            turn.id === id ? { ...turn, error: error.message } : turn,
          ),
        ),
      onSettled: () =>
        // After paint, so the newly rendered answer is what scrolls into view.
        requestAnimationFrame(() =>
          endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
        ),
    });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6 py-6">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <div className="flex h-full items-center">
            <EmptyState
              className="w-full"
              icon={<MessageSquareIcon />}
              title="Ask your sources a question"
              description={
                <>
                  <p>
                    Answers come from the documents in this notebook and are cited
                    back to the passage they came from.
                  </p>
                  <p className="mt-3">
                    If your sources don&rsquo;t cover something, you&rsquo;ll be
                    told that rather than given a guess.
                  </p>
                </>
              }
            />
          </div>
        ) : (
          <div className="space-y-6">
            {turns.map(turn => (
              <TurnView key={turn.id} turn={turn} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="mt-4 shrink-0">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              // Enter sends, Shift+Enter breaks the line. The convention every
              // chat input has trained people to expect.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            placeholder="Ask about your sources…"
            rows={2}
            disabled={ask.isPending || notebookId === undefined}
            className="resize-none pr-12"
            aria-label="Ask a question about this notebook's sources"
          />
          <Button
            type="submit"
            size="icon"
            disabled={draft.trim() === '' || ask.isPending || notebookId === undefined}
            className="absolute right-2 bottom-2 size-8"
          >
            {ask.isPending ? (
              // `animate-spin` is disabled wholesale by the reduced-motion
              // block, as PipelineStages notes — the icon still marks the state.
              <LoaderIcon className="size-4 animate-spin" aria-hidden />
            ) : (
              <SendIcon className="size-4" aria-hidden />
            )}
            <span className="sr-only">{ask.isPending ? 'Thinking' : 'Ask'}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}

/** One question and whatever came back. */
function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <p className="bg-muted max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2 text-sm whitespace-pre-wrap">
          {turn.question}
        </p>
      </div>

      {turn.error !== undefined ? (
        /*
         * A real failure — the network, the vendor, an expired session. This is
         * the *only* state in this pane that reads as an error, and keeping it
         * visually distinct from the no-answer case below is the whole point:
         * one means something broke, the other means the feature worked.
         */
        <p className="text-destructive text-sm" role="alert">
          {turn.error}
        </p>
      ) : turn.response === undefined ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
          Reading your sources…
        </p>
      ) : turn.response.answer === null ? (
        <NoAnswer reason={turn.response.reason} />
      ) : (
        <Answer text={turn.response.answer} citations={turn.response.citations} />
      )}
    </div>
  );
}

/**
 * The sources do not cover it. **Rendered as an ordinary answer, deliberately.**
 *
 * Same typography as a real answer, no error colour, no icon suggesting
 * something went wrong. A user who is shown a warning triangle every time their
 * documents genuinely lack an answer learns to read the honest case as a
 * malfunction — and the next thing that gets asked for is the fallback that
 * DS2 §3 forbids.
 *
 * The three reasons say different things because they need different responses:
 * one wants a source added, one wants a different question, and one is a
 * deployment problem the user cannot fix.
 */
function NoAnswer({ reason }: { reason: 'no_sources' | 'not_covered' | 'unavailable' | null }) {
  const text =
    reason === 'no_sources'
      ? "There's nothing to search yet — this notebook has no sources that were indexed for chat. Add a source, and questions will be answered from it."
      : reason === 'unavailable'
        ? 'Chat is unavailable in this deployment: no model is configured that can answer questions. Card generation still works.'
        : "Your sources don't cover this. I only answer from the documents in this notebook, so I'd rather say that than guess.";

  return <p className="text-muted-foreground text-sm leading-relaxed">{text}</p>;
}

function Answer({ text, citations }: { text: string; citations: AskCitation[] }) {
  return (
    <div className="space-y-3">
      {/*
       * `whitespace-pre-wrap` on plain text. The answer is untrusted model
       * output: it is rendered as text, never as markup, and the citation
       * markers `[1]` are left in the prose where the model put them so a
       * reader can see which sentence rests on which passage.
       */}
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>

      {citations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            {/*
             * "Passage", not "page" and not "source". The word has to match
             * what the data can actually resolve to — see the file header.
             */}
            {citations.length === 1 ? 'From 1 passage' : `From ${citations.length} passages`}
          </p>
          {citations.map(citation => (
            <CitationView
              key={`${citation.jobId}-${citation.chunkIndex}`}
              citation={citation}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One citation, collapsed to its marker and expandable to the passage.
 *
 * Collapsed by default because six passages of a few paragraphs each would bury
 * the answer they support. Expandable rather than linked, because there is
 * nowhere to link *to*: a chunk has no page in a document and no standalone
 * view, so showing the text here is the most precise thing available.
 */
function CitationView({ citation }: { citation: AskCitation }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border text-sm">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left"
      >
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs font-medium">
          {citation.marker}
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {/*
           * A one-line preview of the passage itself rather than a title: a
           * chunk has no title, and inventing one ("Section 3") would name
           * something the document does not have.
           */}
          {citation.text.slice(0, 120)}
        </span>
        <ChevronDownIcon
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && (
        /*
         * The passage. **Untrusted document text, rendered as text.** This is
         * the surface the `dangerouslySetInnerHTML` rule exists for: the user
         * pasted this content from somewhere, and it is displayed, never
         * interpreted.
         */
        <p className="text-muted-foreground border-t px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
          {citation.text}
        </p>
      )}
    </div>
  );
}
