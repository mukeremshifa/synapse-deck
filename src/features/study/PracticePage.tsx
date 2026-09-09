import { Link, useParams } from 'react-router-dom';
import { CoffeeIcon, InboxIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { formatDurationWords } from '@/lib/format';
import { notebookPath } from '@/lib/notebooks';
import { resolveTimeZone, startOfNextStudyDay } from '@/lib/day';
import { remainingNewAllowance } from '@/lib/queue';
import { useProfile } from '@/features/settings/queries';
import { PracticeSession } from './PracticeSession';
import { useArtifact, usePracticeQueue } from './queries';
import { WrongKind } from './WrongKind';

/**
 * `/notebooks/:notebookId/decks/:deckId/practice` — **this deck, named in the
 * route.**
 *
 * ── The change that matters ──────────────────────────────────────────────
 *
 * The old page read `:notebookId` and handed it to the old stack *as a deck
 * id*, which was the audit's finding and FR2's drift row: with the param read
 * under the wrong name the queue fell back to its every-deck form, and someone
 * practising one notebook got cards from all of them. Nothing typechecked it.
 *
 * Now both ids come from the route and both are used for what they name. There
 * is no fallback: a route without a deck id cannot reach this component, and
 * `usePracticeQueue` requires the artifact id rather than treating it as
 * optional — the surface can no longer guess, because it has nothing to guess
 * with.
 *
 * ── Every branch renders inside the frame ────────────────────────────────
 *
 * Including the error one. A state you can only leave by reloading is the worst
 * one to ship, and an error is exactly when someone needs the way out most.
 */
export function PracticePage() {
  const { notebookId, deckId } = useParams<{ notebookId: string; deckId: string }>();

  // The route cannot match without both, so this is a narrowing rather than a
  // real branch — but it is the narrowing that lets everything below require
  // them, instead of threading `string | undefined` through the session.
  if (!notebookId || !deckId) return null;

  return <Practice notebookId={notebookId} deckId={deckId} />;
}

function Practice({ notebookId, deckId }: { notebookId: string; deckId: string }) {
  const artifact = useArtifact(notebookId, deckId);
  const queue = usePracticeQueue(notebookId, deckId);
  const { data: profile } = useProfile();

  const frameProps = {
    title: 'Practice',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
  };

  if (artifact.isError || queue.isError) {
    const error = artifact.error ?? queue.error;
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load this deck"
          {...(error instanceof Error ? { detail: error.message } : {})}
          onRetry={() => {
            void artifact.refetch();
            void queue.refetch();
          }}
        />
      </FocusFrame>
    );
  }

  if (artifact.isPending || queue.isPending) {
    return (
      <FocusFrame {...frameProps}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </FocusFrame>
    );
  }

  /*
   * The route said "practice", the id named something else.
   *
   * Reachable by hand-typing a URL or following a stale link — FR3 makes only
   * `ready` artifacts into links, so the ordinary path is guarded, but a pasted
   * URL still arrives here. Saying which kind it actually is, with a link to
   * the right runner, beats a 404 for something that does exist.
   */
  if (artifact.data.kind !== 'deck') {
    return (
      <FocusFrame {...frameProps}>
        <WrongKind notebookId={notebookId} artifact={artifact.data} expected="deck" />
      </FocusFrame>
    );
  }

  const dailyNewLimit = profile?.dailyNewLimit ?? queue.data.dailyNewLimit;
  const allowance = remainingNewAllowance(dailyNewLimit, queue.data.introducedToday);
  const sessionSize = queue.data.due.length + Math.min(queue.data.fresh.length, allowance);

  if (sessionSize === 0) {
    return (
      <FocusFrame {...frameProps}>
        <NothingDue
          nextDueAt={queue.data.nextDueAt}
          heldBackNew={Math.max(0, queue.data.fresh.length - allowance)}
          timeZone={resolveTimeZone(profile?.timezone)}
          notebookId={notebookId}
        />
      </FocusFrame>
    );
  }

  /*
   * `fill` only here, and deliberately not on the branches above.
   *
   * A session is one card at a time and should own the screen. The error,
   * loading and nothing-due branches are short blocks that read correctly at
   * their natural height — stretching an empty state to the full viewport
   * puts its button somewhere near the fold and makes a calm screen look
   * broken.
   */
  return (
    <FocusFrame
      {...frameProps}
      fill
      status={
        <span className="text-muted-foreground text-sm tabular-nums">
          {sessionSize} in queue
        </span>
      }
    >
      <PracticeSession
        // A new queue is a new session: reset the local state rather than
        // carrying a half-finished one into it.
        key={queue.data.fetchedAt}
        notebookId={notebookId}
        artifactId={deckId}
        queue={queue.data}
        dailyNewLimit={dailyNewLimit}
        onPracticeMore={() => void queue.refetch()}
      />
    </FocusFrame>
  );
}

/**
 * The highest-value empty state in the app.
 *
 * Someone with a healthy schedule sees this most days, and "nothing due" alone
 * reads like something is broken. Saying when the next card arrives turns it
 * into a finished to-do list.
 */
function NothingDue({
  nextDueAt,
  heldBackNew,
  timeZone,
  notebookId,
}: {
  nextDueAt: string | null;
  heldBackNew: number;
  timeZone: string;
  notebookId: string;
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
            <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<InboxIcon />}
      title="This deck has no cards to practise"
      description="Every card here is suspended, or the deck is empty."
      action={
        <Button asChild>
          <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
        </Button>
      }
    />
  );
}
