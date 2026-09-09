import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Undo2Icon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card as CardShell, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { BrokenCard, CardBack, CardFront } from '@/features/cards/CardFace';
import { RatingButtons } from '@/features/practice/RatingButtons';
import { SessionSummary } from '@/features/practice/SessionSummary';
import type { Card, PracticeQueue } from '@/lib/api';
import { isApiClientError } from '@/lib/api';
import { type SchedulePreview } from '@/lib/fsrs';
import { CardPayload, Grade } from '@/lib/schemas';
import { buildQueue, remainingNewAllowance } from '@/lib/queue';
import { cn } from '@/lib/utils';
import { gradeToNext, previewFor, useReviewCard, useUndoReview } from './queries';

/**
 * One practice session, on the contract.
 *
 * ── What changed from the old runner, and what deliberately did not ───────
 *
 * The interaction is the one P1 shipped and it is good work: reveal, rate, the
 * interval on the button, undo, keyboard throughout. FR5 §2 is explicit that
 * this is a **re-pointing** — the maths in `fsrs.ts` and the policy in
 * `queue.ts` keep their place. What moved is the shape underneath: `CardRow`
 * (snake_case, from the old deck stack) became the contract's `Card`, and the
 * queue arrives as `{ due, fresh }` for **this deck** rather than as a
 * pre-interleaved list for a guessed notebook.
 *
 * **The interleave runs here**, which is where the contract says it belongs:
 * `PracticeQueue`'s doc comment calls itself "the reads, not the policy",
 * because the same policy drives this queue, home's "new available" figure and
 * the forecast's day 0. One implementation, on the client, in `queue.ts`.
 *
 * ── Session state is component state ─────────────────────────────────────
 *
 * Not TanStack Query (SPEC §8.3). The queue arrives once as a snapshot and this
 * component works through it; refetching underneath someone would reorder the
 * cards they are part-way through. Since FR4 §6.3 there is a stronger version
 * of the same guarantee: a regeneration produces a *new* artifact, so this
 * deck's cards cannot change under the session at all.
 *
 * ── The card editor is gone from here ────────────────────────────────────
 *
 * The old runner had an inline `CardEditor` behind `E`. The contract supports
 * the write (`updateCard`), but a card editor is a surface of its own and FR5's
 * §2 scope table gives the editor to a later phase — it lists the notes editor
 * explicitly and the same argument holds for cards. Editing mid-review is also
 * the one moment the user is least able to judge a card fairly. Removed rather
 * than half-carried.
 */

type RatedEntry = { card: Card; grade: Grade };

export function PracticeSession({
  notebookId,
  artifactId,
  queue,
  dailyNewLimit,
  onPracticeMore,
}: {
  notebookId: string;
  artifactId: string;
  queue: PracticeQueue;
  dailyNewLimit: number;
  onPracticeMore: () => void;
}) {
  /*
   * The interleave, once, when the session starts.
   *
   * `useState`'s initialiser rather than `useMemo`: this is the session's
   * opening hand and it must not be recomputed, and a `useMemo` is a cache the
   * runtime is allowed to drop. The parent keys this component on the queue's
   * `fetchedAt`, so a genuinely new queue makes a new session.
   */
  const [cards, setCards] = useState<Card[]>(() =>
    buildQueue({
      due: queue.due,
      fresh: queue.fresh,
      dailyNewLimit,
      introducedToday: queue.introducedToday,
    }),
  );

  // The position never moves: rating removes the current card and the next one
  // slides into its place; undo puts one back here. Only the list changes.
  const index = 0;
  const [revealed, setRevealed] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [rated, setRated] = useState<RatedEntry[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shownAt = useRef<number>(Date.now());

  const reviewCard = useReviewCard(notebookId, artifactId);
  const undoReview = useUndoReview(notebookId, artifactId);

  const card = cards[index] ?? null;

  /**
   * The payload, parsed.
   *
   * Card content is **untrusted LLM output**, so it is validated at the edge of
   * the runner rather than trusted because the type says so — the same reason
   * the old runner had `parseCardPayload`. A payload that does not parse gets
   * `BrokenCard` instead of a blank card with no explanation.
   */
  const payload = useMemo(() => {
    if (!card) return null;
    const result = CardPayload.safeParse(card.payload);
    return result.success ? result.data : null;
  }, [card]);

  /** SPEC §12 (7): a multiple-choice answer grades itself, overridably. */
  const suggestedGrade: Grade | null =
    payload?.kind === 'mcq' && selectedOption !== null
      ? payload.options[selectedOption]?.correct
        ? Grade.Good
        : Grade.Again
      : null;

  /*
   * One instant per card, shared by the preview and the commit.
   *
   * `previewFor` derives `elapsed_days` from it, so computing the preview at
   * one instant and the grade at another can round to different intervals —
   * and the whole point of threading the preview through is that the number on
   * the button is the number committed.
   */
  const gradedAt = useRef<number>(Date.now());
  const preview: SchedulePreview | null = useMemo(() => {
    if (!card) return null;
    gradedAt.current = Date.now();
    return previewFor(card, gradedAt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the card, not its object identity
  }, [card?.id]);

  useEffect(() => {
    shownAt.current = Date.now();
    setRevealed(false);
    setSelectedOption(null);
  }, [card?.id]);

  // Focus the session so the keyboard shortcuts work without a click first.
  useEffect(() => {
    containerRef.current?.focus();
  }, [card?.id]);

  const reveal = useCallback(() => setRevealed(true), []);

  const rate = useCallback(
    (grade: Grade) => {
      if (!card || !preview) return;

      const durationMs = Math.max(0, Date.now() - shownAt.current);
      const next = gradeToNext(card, grade, {
        now: gradedAt.current,
        durationMs,
        preview,
      });

      // Advance first. A round trip per card is what makes practice feel like
      // filling in a form (SPEC §8.3); the write catches up behind the user.
      setRated(previous => [...previous, { card, grade }]);
      setCards(previous => previous.filter(queued => queued.id !== card.id));

      reviewCard.mutate(
        { card, grade, durationMs, next },
        {
          onError: error => {
            if (isApiClientError(error) && error.code === 'stale_card') {
              // Another tab already rated this card. Dropping it is correct —
              // the rating that landed first is the real one.
              toast.warning('That card was already rated in another tab.');
              return;
            }
            toast.error('Could not save that rating', {
              description: error instanceof Error ? error.message : undefined,
            });
            /*
             * Put it back **where it was**, not at the end.
             *
             * `[...previous, card]` sent a card whose write failed to the back
             * of the session: the user rated it, saw an error toast, and the
             * card they were told to re-rate was then dozens of cards away —
             * or, at the end of a session, appeared after the summary should
             * have shown. Restoring at `index` is what undo already does, and
             * a failed write should land in the same place a reverted one
             * does.
             */
            setRated(previous => previous.filter(entry => entry.card.id !== card.id));
            setCards(previous => [
              ...previous.slice(0, index),
              card,
              ...previous.slice(index),
            ]);
          },
        },
      );
    },
    [card, index, preview, reviewCard],
  );

  const undo = useCallback(() => {
    const last = rated.at(-1);
    if (!last || undoReview.isPending) return;

    undoReview.mutate(last.card.id, {
      onSuccess: restored => {
        setRated(previous => previous.slice(0, -1));
        // Show it again, with the schedule it had before the mistake.
        setCards(previous => [
          ...previous.slice(0, index),
          restored,
          ...previous.slice(index),
        ]);
        setRevealed(false);
        /*
         * And clear the choice, which `setRevealed(false)` alone did not.
         *
         * The effect that resets per-card state is keyed on `card?.id`, and
         * undo restores *the same id* — so it does not re-fire, and the stale
         * `selectedOption` survived. On a multiple-choice card that meant the
         * undone card came back with the previous answer still selected and
         * the answer hidden: `suggestedGrade` was already computed from it, so
         * pressing Space re-rated the card instantly with the grade the user
         * had just undone.
         */
        setSelectedOption(null);
        toast.success('Rating undone');
      },
      onError: error =>
        toast.error('Could not undo', {
          description: error instanceof Error ? error.message : undefined,
        }),
    });
  }, [index, rated, undoReview]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'enter') {
        event.preventDefault();
        if (!revealed) reveal();
        else if (suggestedGrade !== null) rate(suggestedGrade);
        return;
      }
      if (key === 'u') {
        event.preventDefault();
        undo();
        return;
      }
      if (revealed && key >= '1' && key <= '4') {
        event.preventDefault();
        rate(Number(key) as Grade);
      }
    },
    [rate, reveal, revealed, suggestedGrade, undo],
  );

  if (!card || !preview) {
    return (
      <SessionSummary
        reviewed={rated.length}
        ratings={countRatings(rated)}
        nextDueAt={queue.nextDueAt}
        heldBackNew={Math.max(
          0,
          queue.fresh.length -
            remainingNewAllowance(dailyNewLimit, queue.introducedToday),
        )}
        onPracticeMore={onPracticeMore}
      />
    );
  }

  const total = cards.length + rated.length;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Practice session"
      /*
       * A column that fills the height `FocusFrame fill` hands down. The meter
       * and the footer keep their natural height; the card takes what is left.
       *
       * The card is the page's centre of gravity, not the whole of it — it
       * grows into the leftover space, but the meter above and the undo row
       * below keep their own, so it reads as the prominent component on a page
       * rather than as a full-bleed panel with chrome jammed against the edges.
       */
      className="focus-visible:ring-ring mx-auto flex h-full w-full max-w-2xl flex-col gap-5 rounded-xl outline-none focus-visible:ring-2"
    >
      <div className="shrink-0 space-y-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            <span className="text-foreground font-mono tabular-nums">{cards.length}</span>{' '}
            left · <span className="font-mono tabular-nums">{rated.length}</span> done
          </span>
          <div className="flex items-center gap-2">
            {card.fsrsState === 'new' && <Badge variant="outline">New</Badge>}
            {card.lapses > 0 && (
              <Badge variant="outline">
                <span className="font-mono tabular-nums">{card.lapses}</span> lapses
              </Badge>
            )}
          </div>
        </div>

        {/* Ink, not the accent. The one accent on this screen is the Easy
            rating, which is the thing the session is trying to produce. */}
        <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
          <div
            className="bg-foreground h-full rounded-full transition-[width] duration-300"
            style={{ width: `${total === 0 ? 0 : (rated.length / total) * 100}%` }}
          />
        </div>
      </div>

      {/*
        Two regions, and the split is the point of this layout.

        **The question sits in the middle; the controls sit flush against the
        bottom edge.** They used to be one stack, so "Show answer" and the four
        ratings floated directly beneath the question text — a one-line card put
        them near the top of the panel, a long one pushed them down, and the
        control pressed every few seconds was never twice in the same place.
        Pinning them to the card's base makes them a fixed target, and leaves
        the question centred in the space above it.

        `min-h-0` on the shell and on the question region, for the reason
        `FocusFrame` gives: without it a flex child floors at its content
        height, so a long question would push the controls off the card instead
        of scrolling within it.
      */}
      <CardShell className="flex min-h-0 flex-1 flex-col gap-0 py-0">
        {payload ? (
          <>
            {/* The question, centred in whatever height is left over. */}
            <CardContent className="flex min-h-0 flex-1 flex-col justify-center gap-6 overflow-y-auto px-8 py-8">
              <CardFront
                className="text-2xl"
                payload={payload}
                revealed={revealed}
                selectedOption={selectedOption}
                onSelectOption={optionIndex => {
                  setSelectedOption(optionIndex);
                  setRevealed(true);
                }}
              />

              {/*
                The answer stays with the question rather than moving into the
                pinned region: it is something to read, and reading it is how
                you choose between the four ratings. Only the controls pin.
              */}
              {revealed && (
                <div
                  id="card-answer"
                  className={cn('border-t pt-6', 'motion-safe:animate-in')}
                >
                  <CardBack payload={payload} />
                </div>
              )}
            </CardContent>

            {/*
              Flush bottom. `shrink-0` so it keeps its height when the question
              above is long, and a top border so it reads as the card's base
              rather than as content that merely happens to be last.
            */}
            <div className="shrink-0 border-t px-8 py-5">
              {/*
                The flip is a button with aria-expanded (SPEC §8.4): the answer
                must be reachable by a screen reader, and the card must not
                become a keyboard trap.
              */}
              {!revealed ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  aria-expanded={false}
                  aria-controls="card-answer"
                  onClick={reveal}
                >
                  Show answer <Kbd className="ml-1">Space</Kbd>
                </Button>
              ) : (
                <div className="space-y-2 motion-safe:animate-in">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    How well did you know it?
                  </p>
                  <RatingButtons
                    preview={preview}
                    onRate={rate}
                    suggested={suggestedGrade}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <CardContent className="flex min-h-0 flex-1 flex-col justify-center px-8 py-8">
            <BrokenCard />
          </CardContent>
        )}
      </CardShell>

      <div className="text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={rated.length === 0 || undoReview.isPending}
        >
          <Undo2Icon /> Undo <Kbd>U</Kbd>
        </Button>
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Kbd>Space</Kbd> reveals · <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
        </span>
      </div>
    </div>
  );
}

function countRatings(rated: RatedEntry[]): Record<Grade, number> {
  const counts = {
    [Grade.Again]: 0,
    [Grade.Hard]: 0,
    [Grade.Good]: 0,
    [Grade.Easy]: 0,
  };
  for (const entry of rated) counts[entry.grade] += 1;
  return counts;
}
