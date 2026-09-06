import { Link, useParams } from 'react-router-dom';
import { CoffeeIcon, InboxIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { formatDurationWords } from '@/lib/format';
import { notebookPath } from '@/lib/notebooks';
import { useDeck, usePracticeQueue, useProfile } from '@/lib/queries';
import { resolveTimeZone, startOfNextStudyDay } from '@/lib/day';
import { PracticeSession } from './PracticeSession';

export function PracticePage() {
  /*
   * The route says `:notebookId` (P11) and everything below this line says
   * deckId, because the rename stopped at the wire — `usePracticeQueue` and
   * `useDeck` take the id the API knows. Same id, two names, translated here.
   *
   * This is the seam that broke silently during the rewrite: with the param
   * still read as `deckId`, the route supplied nothing, `usePracticeQueue`
   * fell back to its every-deck queue, and a user practising one notebook got
   * cards from all of them. Nothing typechecks that, so it is named here.
   */
  const { notebookId: deckId } = useParams<{ notebookId?: string }>();
  const deck = useDeck(deckId);
  const { data: profile } = useProfile();
  const queue = usePracticeQueue(deckId);

  // Every branch below renders inside the frame, so the way out exists even
  // when the queue failed to load — an error state you cannot leave is the
  // worst one to ship.
  const exitTo = deckId ? notebookPath.open(deckId) : notebookPath.list();
  const frameProps = {
    title: 'Practice',
    ...(deck.data ? { subtitle: deck.data.title } : {}),
    exitTo,
  };

  if (queue.isPending || !queue.data) {
    return (
      <FocusFrame {...frameProps}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </FocusFrame>
    );
  }

  if (queue.isError) {
    return (
      <FocusFrame {...frameProps}>
        <EmptyState
          title="Could not load the queue"
          description={(queue.error as Error).message}
          action={<Button onClick={() => void queue.refetch()}>Try again</Button>}
        />
      </FocusFrame>
    );
  }

  const { cards, nextDueAt, heldBackNew } = queue.data;

  if (cards.length === 0) {
    return (
      <FocusFrame {...frameProps}>
        <NothingDue
          nextDueAt={nextDueAt}
          heldBackNew={heldBackNew}
          timeZone={resolveTimeZone(profile?.timezone)}
          deckId={deckId}
        />
      </FocusFrame>
    );
  }

  return (
    <FocusFrame
      {...frameProps}
      status={
        <span className="text-muted-foreground text-sm tabular-nums">
          {cards.length} in queue
        </span>
      }
    >
      <PracticeSession
        // A new queue is a new session: reset the local state rather than
        // carrying a half-finished one into it.
        key={queue.data.fetchedAt}
        queue={queue.data}
        deckId={deckId}
        onRefetch={() => void queue.refetch()}
      />
    </FocusFrame>
  );
}

/**
 * The highest-value empty state in the app.
 *
 * A user with a healthy schedule sees this most days, and "nothing due" alone
 * reads like something is broken. Saying when the next card arrives turns it
 * into a finished to-do list.
 */
function NothingDue({
  nextDueAt,
  heldBackNew,
  timeZone,
  deckId,
}: {
  nextDueAt: string | null;
  heldBackNew: number;
  timeZone: string;
  deckId?: string;
}) {
  const now = new Date();

  if (heldBackNew > 0) {
    const resetsAt = startOfNextStudyDay(now, timeZone);
    return (
      <EmptyState
        icon={<CoffeeIcon />}
        title="Done for today"
        description={
          <>
            {heldBackNew} new {heldBackNew === 1 ? 'card is' : 'cards are'} waiting, held
            back by today&rsquo;s limit. They unlock in{' '}
            {formatDurationWords(resetsAt.getTime() - now.getTime())}.
          </>
        }
        action={
          <Button asChild variant="outline">
            <Link to="/settings">Raise the daily limit</Link>
          </Button>
        }
      />
    );
  }

  if (nextDueAt) {
    return (
      <EmptyState
        icon={<CoffeeIcon />}
        title="Nothing due"
        description={
          <>
            The next card is due in{' '}
            <span className="text-foreground font-medium">
              {formatDurationWords(new Date(nextDueAt).getTime() - now.getTime())}
            </span>
            . Reviewing early does not help — that is the point of the schedule.
          </>
        }
        action={
          <Button asChild variant="outline">
            <Link to="/notebooks">Back to notebooks</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<InboxIcon />}
      title="No cards to practise yet"
      description="Add a few cards and they will appear here straight away."
      action={
        <Button asChild>
          <Link to={deckId ? `/notebooks/${deckId}` : '/notebooks'}>
            {deckId ? 'Open this notebook' : 'Go to notebooks'}
          </Link>
        </Button>
      }
    />
  );
}
