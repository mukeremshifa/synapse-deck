import { useRef, useState } from 'react';
import {
  ArrowUpIcon,
  BookmarkPlusIcon,
  MessageCircleIcon,
  QuoteIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toolbar, ToolbarSpacer } from '@/components/layout';
import { EmptyState } from '@/components/states';
import type { AskResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnswerText } from './AnswerText';
import { useAsk, useSaveResponseAsNote } from './queries';

/**
 * The centre pane: grounded chat over this notebook's sources.
 *
 * ═══ What is settled here, and what is deliberately not ══════════════════
 *
 * FR3 builds the *pane*. It does **not** settle the chat model — history,
 * persistence and threading are left undecided on purpose (brief §1.2(4),
 * §6.4), because that decision needs the backend conversation FR7 has and this
 * phase does not. So the exchanges below live in component state and are gone
 * on refresh, and **that is the documented state of the phase rather than a
 * bug**: it is the same `useState([])` that made `SourcesRail` wrong, and the
 * difference is that a source is a persisted noun in the contract and a chat
 * turn is not a noun in the contract at all. Sources were wrong because the
 * contract said they should be stored; chat is undecided because nothing says
 * what storing it would mean.
 *
 * The one requirement the brief does make is honoured: **a single response can
 * be saved as a note**, which is the escape hatch that makes an unsaved
 * transcript acceptable. Anything worth keeping becomes a note set — a real
 * artifact, in Studio, that survives everything.
 *
 * ── Untrusted output ─────────────────────────────────────────────────────
 *
 * Every answer is LLM output and goes through `AnswerText`, which produces
 * elements and cannot produce HTML. No `dangerouslySetInnerHTML`, no disabled
 * ESLint rule. The excerpt in a citation is untrusted for the same reason and
 * is rendered as plain text.
 *
 * ── Grounding is explicit ────────────────────────────────────────────────
 *
 * `AskInput.sourceIds` comes from the checkboxes in the sources pane. The
 * contract's comment says empty means every ready source — "a choice the UI
 * makes explicit, not a default the server invents" — so the composer states
 * which it is, in words, above the input. A user who has selected two of five
 * sources and forgotten should not have to infer it from the answer.
 *
 * ── It has never answered a real question ────────────────────────────────
 *
 * DS2 built the retrieval and citation path and no embedding key was ever
 * supplied, so `ask` has never returned a real answer end to end. Under the
 * fake it answers fine and the surface is exercised; that proves the surface,
 * not the retrieval. Recorded in the plan's §7 and not reported as working.
 */
export function ChatPane({
  notebookId,
  selectedIds,
  readySourceCount,
}: {
  notebookId: string;
  selectedIds: ReadonlySet<string>;
  readySourceCount: number;
}) {
  const [exchanges, setExchanges] = useState<AskResponse[]>([]);
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useAsk(notebookId);
  const sourceIds = [...selectedIds];
  const grounded = sourceIds.length > 0 ? sourceIds.length : readySourceCount;

  const submit = () => {
    const trimmed = question.trim();
    if (trimmed.length === 0 || ask.isPending) return;

    ask.mutate(
      { question: trimmed, sourceIds },
      {
        onSuccess: response => {
          setExchanges(previous => [...previous, response]);
          setQuestion('');
          // After the answer is in the list, not before: scrolling to where the
          // answer will be is a jump to blank space.
          requestAnimationFrame(() => {
            endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          });
        },
        onError: (error: unknown) =>
          toast.error('Could not answer that', {
            description: error instanceof Error ? error.message : 'Unknown error',
          }),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <MessageCircleIcon className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-medium">Chat</h2>
        <ToolbarSpacer />
        <span className="text-muted-foreground text-xs">
          {readySourceCount === 0
            ? 'No sources ready'
            : sourceIds.length > 0
              ? `Grounded in ${String(sourceIds.length)} selected`
              : `Grounded in all ${String(readySourceCount)}`}
        </span>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-gutter p-gutter">
          {exchanges.length === 0 && (
            <EmptyState
              icon={<MessageCircleIcon />}
              title={
                readySourceCount === 0
                  ? 'Add a source to ask questions'
                  : 'Ask about your sources'
              }
              description={
                readySourceCount === 0
                  ? 'Answers are grounded in this notebook’s sources, so there is nothing to draw on yet.'
                  : 'Every answer cites the passages it came from. Anything worth keeping can be saved as a note.'
              }
            />
          )}

          {exchanges.map(exchange => (
            <Exchange
              key={exchange.id}
              notebookId={notebookId}
              response={exchange}
              sourceIds={sourceIds}
            />
          ))}

          {ask.isPending && (
            <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
              Thinking…
            </p>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t p-snug">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-tight">
          <Textarea
            rows={2}
            className="resize-none"
            placeholder={
              readySourceCount === 0
                ? 'Add a source first…'
                : `Ask about ${String(grounded)} source${grounded === 1 ? '' : 's'}…`
            }
            value={question}
            disabled={readySourceCount === 0}
            onChange={event => {
              setQuestion(event.target.value);
            }}
            onKeyDown={event => {
              // Enter sends, Shift+Enter breaks the line — the convention every
              // chat surface uses, and the one users will try first.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button
            size="icon"
            aria-label="Ask"
            disabled={question.trim().length === 0 || ask.isPending}
            onClick={submit}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One question and its answer.
 *
 * `answer: null` is a **success**, not an error — the contract says so, and it
 * means the sources do not cover the question. Rendering it as a failure would
 * teach users that grounded chat is broken when it is in fact being honest, and
 * it is the state a notebook with no ready sources always produces.
 */
function Exchange({
  notebookId,
  response,
  sourceIds,
}: {
  notebookId: string;
  response: AskResponse;
  sourceIds: string[];
}) {
  const [saved, setSaved] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const save = useSaveResponseAsNote(notebookId);

  /*
   * A `[1]` in the answer scrolls to the citation it names and marks it. That
   * is what makes an answer *traceable* rather than merely footnoted, and it is
   * the reason `AskCitation` carries a `marker` at all. A marker with no
   * matching citation is left as plain text by `AnswerText` — the model can
   * emit `[4]` with three sources, and an inert-looking button would be worse
   * than a number.
   */
  const showCitation = (marker: number) => {
    if (!response.citations.some(citation => citation.marker === marker)) return;
    setHighlighted(marker);
    document
      .getElementById(`${response.id}-citation-${String(marker)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <article className="flex flex-col gap-snug">
      <p className="text-sm font-medium">{response.question}</p>

      {response.answer === null ? (
        <p className="text-muted-foreground text-sm">
          Nothing in this notebook&rsquo;s sources answers that. Try another
          question, or add a source that covers it.
        </p>
      ) : (
        <>
          <AnswerText text={response.answer} onCitationClick={showCitation} />

          {response.citations.length > 0 && (
            <ul className="flex flex-col gap-tight">
              {response.citations.map(citation => (
                <li
                  key={`${citation.sourceId}-${String(citation.marker)}`}
                  id={`${response.id}-citation-${String(citation.marker)}`}
                  className={cn(
                    'flex gap-tight rounded-md p-tight text-xs transition-colors',
                    highlighted === citation.marker
                      ? 'bg-accent ring-border-strong ring-1'
                      : 'bg-muted/40',
                  )}
                >
                  <QuoteIcon
                    className="text-muted-foreground mt-0.5 size-3 shrink-0"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-medium">
                      [{citation.marker}] {citation.sourceTitle}
                    </p>
                    {/* Untrusted: an excerpt is a passage of the source. Text. */}
                    <p className="text-muted-foreground mt-hairline">
                      {citation.excerpt}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/*
            Brief §1.2(4)'s one chat requirement. The button disappears once
            used rather than staying live: a second press would make a second
            identical note set, which is a duplicate the user did not ask for
            and would have to go and delete.
          */}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={saved || save.isPending}
            onClick={() => {
              save.mutate(
                { response, sourceIds },
                {
                  onSuccess: () => {
                    setSaved(true);
                    toast.success('Saved as a note', {
                      description: 'It is in Studio under Notes.',
                    });
                  },
                  onError: (error: unknown) =>
                    toast.error('Could not save the note', {
                      description:
                        error instanceof Error ? error.message : 'Unknown error',
                    }),
                },
              );
            }}
          >
            <BookmarkPlusIcon aria-hidden />
            {saved ? 'Saved as a note' : 'Save as note'}
          </Button>
        </>
      )}
    </article>
  );
}
