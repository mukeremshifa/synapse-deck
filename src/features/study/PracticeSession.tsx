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
            // Put it back rather than silently losing the review.
            setRated(previous => previous.filter(entry => entry.card.id !== card.id));
            setCards(previous => [...previous, card]);
          },
        },
      );
    },
    [card, preview, reviewCard],
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
      className="focus-visible:ring-ring mx-auto max-w-2xl space-y-5 rounded-xl outline-none focus-visible:ring-2"
    >
      <div className="space-y-2">
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

      <CardShell className="py-8">
        <CardContent className="space-y-6 px-8">
          {payload ? (
            <>
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
                <div
                  id="card-answer"
                  className={cn('space-y-6 border-t pt-6', 'motion-safe:animate-in')}
                >
                  <CardBack payload={payload} />
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">
                      How well did you know it?
                    </p>
                    <RatingButtons
                      preview={preview}
                      onRate={rate}
                      suggested={suggestedGrade}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <BrokenCard />
          )}
        </CardContent>
      </CardShell>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
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
