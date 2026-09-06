import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCheckIcon, PlayIcon, SparklesIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { plural } from '@/lib/format';
import { notebookPath } from '@/lib/notebooks';
import {
  parseCardPayload,
  useAcceptDrafts,
  useDeck,
  useDeleteCards,
  useDraftCards,
  useFinishReviewGate,
  useUpdateCard,
  type CardRow,
} from '@/lib/queries';
import type { CardPayload } from '@/lib/schemas';
import { useDeckJob, type JobProgress } from './useJobProgress';
import { StagingList, type StagedCard } from './StagingList';

/**
 * `/create/review/:deckId` — the review gate (SPEC §4.1 step 5).
 *
 * The highest-leverage feature in the product: generated cards are about 80%
 * good, and reviewing a bad card every few days for a year is worse than never
 * having had it. Everything here exists to make rejecting a card as cheap as
 * accepting one.
 *
 * The drafts are already rows, written as they streamed in, so this page is
 * reachable after a refresh, after a crash, or a day later from `/decks` — and
 * accepting is an UPDATE, not an insert. Nothing about a card changes when it is
 * accepted except its status: it was created with fresh-card scheduling, so it
 * lands in the `new` queue exactly as a hand-written card does.
 */

export function ReviewGatePage() {
  const { deckId } = useParams<{ deckId: string }>();
  const deck = useDeck(deckId);
  const drafts = useDraftCards(deckId);
  // What did *not* make it into this deck (P10 task 6). Deliberately not
  // gated on `isPending`: a slow job lookup must never delay the cards.
  const job = useDeckJob(deckId);

  if (!deckId) return null;

  // The exit exists in every branch, including the failed ones. A review gate
  // you cannot leave is the worst screen in the app to strand someone on.
  const exitTo = notebookPath.open(deckId);

  if (drafts.isPending || deck.isPending) {
    return (
      <FocusFrame title="Review" exitTo={exitTo} width="wide">
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </FocusFrame>
    );
  }

  if (drafts.isError || deck.isError) {
    return (
      <FocusFrame title="Review" exitTo={exitTo} width="wide">
        <EmptyState
          title="Could not load these drafts"
          description={((drafts.error ?? deck.error) as Error).message}
          action={<Button onClick={() => void drafts.refetch()}>Try again</Button>}
        />
      </FocusFrame>
    );
  }

  return (
    <FocusFrame title="Review" subtitle={deck.data.title} exitTo={exitTo} width="wide">
      <ReviewGate
        // Remount on a different deck: the gate keeps a working copy of the
        // queue, and a working copy from another deck would be nonsense.
        key={deckId}
        deckId={deckId}
        deckTitle={deck.data.title}
        drafts={drafts.data}
        job={job.data ?? null}
      />
    </FocusFrame>
  );
}

type Outcome = 'accepted' | 'rejected';

function ReviewGate({
  deckId,
  deckTitle,
  drafts,
  job,
}: {
  deckId: string;
  deckTitle: string;
  drafts: CardRow[];
  job: JobProgress | null;
}) {
  const navigate = useNavigate();
  const acceptDrafts = useAcceptDrafts();
  const deleteCards = useDeleteCards();
  const updateCard = useUpdateCard();
  const finishGate = useFinishReviewGate();

  /**
   * The queue is seeded once and then owned here, the same arrangement
   * `PracticeSession` uses (SPEC §8.3). Refetching under the user would reorder
   * the cards they are part-way through judging, and every accept and reject is
   * already written through to the database.
   */
  const [queue, setQueue] = useState<CardRow[]>(drafts);
  const [cursor, setCursor] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [tally, setTally] = useState({ accepted: 0, rejected: 0 });
  const [finished, setFinished] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const staged = useMemo(() => queue.map(toStagedCard).filter(isReadable), [queue]);
  const unreadable = queue.length - staged.length;
  const current = staged[Math.min(cursor, Math.max(0, staged.length - 1))] ?? null;

  useEffect(() => {
    if (!editingId) containerRef.current?.focus();
  }, [editingId, staged.length]);

  const markBusy = useCallback((cardId: string, busy: boolean) => {
    setBusyIds(previous => {
      const next = new Set(previous);
      if (busy) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  }, []);

  /** Remove a judged card and keep the cursor pointing at something sensible. */
  const settle = useCallback(
    (cardId: string, outcome: Outcome) => {
      setQueue(previous => previous.filter(row => row.id !== cardId));
      setTally(previous => ({ ...previous, [outcome]: previous[outcome] + 1 }));
      setCursor(previous => Math.max(0, Math.min(previous, staged.length - 2)));
    },
    [staged.length],
  );

  const accept = useCallback(
    (card: StagedCard) => {
      if (busyIds.has(card.id)) return;
      markBusy(card.id, true);
      acceptDrafts.mutate(
        { cardIds: [card.id], deckId },
        {
          onSuccess: () => settle(card.id, 'accepted'),
          onError: error =>
            toast.error('Could not accept that card', {
              description: (error as Error).message,
            }),
          onSettled: () => markBusy(card.id, false),
        },
      );
    },
    [acceptDrafts, busyIds, deckId, markBusy, settle],
  );

  const reject = useCallback(
    (card: StagedCard) => {
      if (busyIds.has(card.id)) return;
      markBusy(card.id, true);
      // Rejecting deletes the row (SPEC §4.1). A draft nobody wants is not
      // history worth keeping, and leaving it would make the deck's card count
      // permanently wrong.
      deleteCards.mutate(
        { cardIds: [card.id], deckId },
        {
          onSuccess: () => settle(card.id, 'rejected'),
          onError: error =>
            toast.error('Could not reject that card', {
              description: (error as Error).message,
            }),
          onSettled: () => markBusy(card.id, false),
        },
      );
    },
    [busyIds, deckId, deleteCards, markBusy, settle],
  );

  const saveEdit = useCallback(
    async (card: StagedCard, payload: CardPayload) => {
      try {
        await updateCard.mutateAsync({ cardId: card.id, deckId, payload });
        // Show the edit immediately on the card in front of the user rather than
        // waiting for a refetch that this page deliberately does not do.
        setQueue(previous =>
          previous.map(row =>
            row.id === card.id ? { ...row, kind: payload.kind, payload } : row,
          ),
        );
      } catch (error) {
        toast.error('Could not save that edit', {
          description: (error as Error).message,
        });
      }
    },
    [deckId, updateCard],
  );

  const acceptAll = useCallback(() => {
    const ids = staged.map(card => card.id);
    if (ids.length === 0) return;
    acceptDrafts.mutate(
      { cardIds: ids, deckId },
      {
        onSuccess: () => {
          setQueue(previous => previous.filter(row => !ids.includes(row.id)));
          setTally(previous => ({
            ...previous,
            accepted: previous.accepted + ids.length,
          }));
          setCursor(0);
        },
        onError: error =>
          toast.error('Could not accept the remaining cards', {
            description: (error as Error).message,
          }),
      },
    );
  }, [acceptDrafts, deckId, staged]);

  // The gate is finished when nothing is left to judge: the deck stops being a
  // draft and the audit row learns how many cards survived (SPEC §13 (2)).
  // This also runs on a gate reopened with nothing in it — someone who accepted
  // every card and then closed the tab before the deck was flipped, which would
  // otherwise leave `/decks` advertising a review that no longer exists.
  useEffect(() => {
    if (finished || staged.length > 0) return;
    setFinished(true);
    finishGate.mutate(
      { deckId },
      {
        onError: error =>
          toast.error('The deck could not be finished', {
            description: (error as Error).message,
          }),
      },
    );
  }, [deckId, finishGate, finished, staged.length, tally]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // An open editor owns the keyboard. Checking the event target rather than
      // a flag covers every input the editor has, including the ones it grows
      // later.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!current) return;

      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        accept(current);
      } else if (key === 'r') {
        event.preventDefault();
        reject(current);
      } else if (key === 'e') {
        event.preventDefault();
        setEditingId(current.id);
      } else if (event.key === 'ArrowDown' || key === 'j') {
        event.preventDefault();
        setCursor(previous => Math.min(previous + 1, staged.length - 1));
      } else if (event.key === 'ArrowUp' || key === 'k') {
        event.preventDefault();
        setCursor(previous => Math.max(previous - 1, 0));
      }
    },
    [accept, current, reject, staged.length],
  );

  if (staged.length === 0) {
    return (
      <GateSummary
        deckId={deckId}
        deckTitle={deckTitle}
        tally={tally}
        unreadable={unreadable}
        onPractise={() => navigate(`/practice/${deckId}`)}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Review generated cards"
      className="focus-visible:ring-ring space-y-5 rounded-xl outline-none focus-visible:ring-2"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The frame's subtitle already names the notebook; this line is the
              tally, which is the number that changes as you work. */}
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-mono tabular-nums">
              {staged.length}
            </span>{' '}
            to review · <span className="font-mono tabular-nums">{tally.accepted}</span>{' '}
            accepted · <span className="font-mono tabular-nums">{tally.rejected}</span>{' '}
            rejected
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={acceptAll} disabled={acceptDrafts.isPending}>
            <CheckCheckIcon /> Accept all
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/notebooks">Finish later</Link>
          </Button>
        </div>
      </header>

      {/*
        The shortcuts, stated once and kept on screen. P2 bound A/R/E because
        judging eighty cards with a mouse is what makes people accept the bad
        ones; a shortcut nobody is told about does not do that job.
      */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>A</Kbd> accept
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>R</Kbd> reject
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>E</Kbd> edit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="border-l pl-3">
          Rejecting deletes the card; leaving the page keeps the rest as drafts.
        </span>
      </div>

      {unreadable > 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          {plural(unreadable, 'draft')} could not be read and{' '}
          {unreadable === 1 ? 'is' : 'are'} not shown here. Delete{' '}
          {unreadable === 1 ? 'it' : 'them'} from the deck page.
        </p>
      )}

      {/*
        P10 task 6, and the plan's wording is the specification: "one line at the
        review gate". A fan-out that discards 31 good chunks because 9 failed is
        worse than one that admits the gap — but a deck that quietly contains
        three quarters of a document is worse than both, because the user has no
        way to know. So the gap is stated here, where the cards are being judged,
        rather than only on the page that started the job.

        `chunksFailed` is null when the count is genuinely unknown, which reads
        differently from zero and must not be rendered as "nothing failed".
      */}
      {job !== null && job.chunksFailed !== null && job.chunksFailed > 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          <span className="text-foreground font-mono tabular-nums">
            {job.chunksSucceeded ?? 0}
          </span>{' '}
          of <span className="font-mono tabular-nums">{job.chunkCount}</span> sections of
          this document produced cards;{' '}
          <span className="font-mono tabular-nums">{job.chunksFailed}</span> could not be
          read. What is here is everything that was written.
        </p>
      )}

      {job !== null && job.truncated && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
          This document was longer than one job covers, so only its first part was used.
        </p>
      )}

      {/*
        Placeholder cards say so here too. The upload page already warns, but
        this is the screen where someone decides to keep a card — the last and
        most important place for it to be obvious.
      */}
      {job !== null && job.providers.includes('stub') && (
        <p className="text-destructive rounded-lg border border-dashed p-3 text-sm">
          These are placeholder cards — no language model was called.
        </p>
      )}

      <StagingList
        cards={staged}
        cursor={Math.min(cursor, staged.length - 1)}
        onAccept={accept}
        onReject={reject}
        onEdit={saveEdit}
        onFocusCard={setCursor}
        busyIds={busyIds}
        editingId={editingId}
        onEditingChange={setEditingId}
      />
    </div>
  );
}

function GateSummary({
  deckId,
  deckTitle,
  tally,
  unreadable,
  onPractise,
}: {
  deckId: string;
  deckTitle: string;
  tally: { accepted: number; rejected: number };
  unreadable: number;
  onPractise: () => void;
}) {
  const judged = tally.accepted + tally.rejected;

  if (judged === 0 && unreadable === 0) {
    return (
      <EmptyState
        icon={<SparklesIcon />}
        title="Nothing left to review"
        description={`Every card in “${deckTitle}” has already been accepted or rejected.`}
        action={
          <div className="flex gap-2">
            <Button onClick={onPractise}>
              <PlayIcon /> Practise
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/notebooks/${deckId}`}>Open notebook</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-4 text-center">
        <h1 className="font-serif text-2xl tracking-tight">“{deckTitle}” is ready</h1>
        <p className="text-muted-foreground text-sm">
          {plural(tally.accepted, 'card')} accepted, {tally.rejected} rejected. The
          accepted cards are in the new queue and will come up in your next session.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={onPractise}>
            <PlayIcon /> Practise now
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/notebooks/${deckId}`}>Open notebook</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function toStagedCard(row: CardRow, index: number): StagedCard | null {
  const payload = parseCardPayload(row);
  if (!payload) return null;
  return {
    id: row.id,
    index,
    payload,
    sourceExcerpt: row.source_excerpt,
  };
}

function isReadable(card: StagedCard | null): card is StagedCard {
  return card !== null;
}
