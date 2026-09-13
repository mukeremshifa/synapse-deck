import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  EyeOffIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { FocusFrame } from '@/app/FocusFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { formatDueIn } from '@/lib/format';
import { notebookPath } from '@/lib/notebooks';
import type { Card, FsrsState } from '@/lib/api';
// `CardPayload` comes from `schemas.ts`, not the contract: one Zod definition
// per concept, shared by client and server (CLAUDE.md).
import type { CardPayload } from '@/lib/schemas';
import { useArtifact } from '@/features/study/queries';
import { NotReady, WrongKind } from '@/features/study/WrongKind';
import { CardEditor } from './CardEditor';
import { cardSummary } from './card-summary';
import {
  useCards,
  useCreateCards,
  useDeleteCards,
  useSetCardStatus,
  useUpdateCard,
} from './queries';

/**
 * `/notebooks/:notebookId/decks/:deckId/cards` — **the deck, opened to look at
 * rather than to be graded by.**
 *
 * ═══ Why this screen exists ══════════════════════════════════════════════
 *
 * Until this commit a user met their cards **one at a time, during review, with
 * no way to change one.** A hallucinated card was permanent: the only thing you
 * could do with a wrong answer was keep being asked it. `CardEditor` had
 * existed since P8 and `updateCard` since FR0, and neither had a screen — the
 * editor was mounted by nothing at all.
 *
 * ── Why not in the review runner ─────────────────────────────────────────
 *
 * Because `PracticeSession.tsx:47` is right:
 *
 * > Editing mid-review is also the one moment the user is least able to judge a
 * > card fairly.
 *
 * Mid-review you are not reading the card, you are failing it, and "this card
 * is badly worded" and "I do not know this" feel identical from inside. So the
 * editor lives here, where browsing is the activity and nothing is being
 * scored, and the runner keeps no edit button. That is settled in ROADMAP.md.
 *
 * ── Two decisions this screen had to take ────────────────────────────────
 *
 * **1. An edit that splits into several cards updates the first and creates the
 * rest.** `CardEditor.onSubmit` hands back `CardPayload[]` — a cloze with three
 * deletions is three cards — while `updateCard` takes exactly one payload. The
 * alternatives were to refuse the split or to drop the extras; dropping is
 * silent data loss, and refusing blocks a real edit, because adding a second
 * deletion to a cloze you already have is an ordinary thing to want. So the
 * card being edited keeps its identity **and its schedule** — it takes the
 * first payload, so months of reviews survive the edit — and the further
 * deletions arrive as new cards at the zero FSRS state, which is what they are.
 * The toast says so, because a user who typed one card and got three should be
 * told.
 *
 * **2. Delete confirms; suspend does not.** Deleting destroys the card's FSRS
 * history, which is the months of work the user has actually done — the
 * schedule is the product, not the text — and nothing in this app can bring it
 * back. Suspend is the reversible one, it sits in the same menu, and the
 * confirmation names it rather than only warning. By `modals.tsx`'s rule the
 * confirmation is local state and not in the URL: you can be in "editing a
 * card", you cannot be in "about to confirm a delete".
 */
export function DeckBrowser() {
  const { notebookId, deckId } = useParams<{ notebookId: string; deckId: string }>();

  // The route cannot match without both. This is the narrowing that lets
  // everything below require them rather than threading `string | undefined`.
  if (!notebookId || !deckId) return null;

  return <Browser notebookId={notebookId} deckId={deckId} />;
}

function Browser({ notebookId, deckId }: { notebookId: string; deckId: string }) {
  const artifact = useArtifact(notebookId, deckId);
  const cards = useCards(notebookId, deckId);
  const [adding, setAdding] = useState(false);

  const frameProps = {
    title: 'Cards',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
    width: 'wide' as const,
  };

  if (artifact.isError) {
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load this deck"
          detail={artifact.error.message}
          onRetry={() => void artifact.refetch()}
        />
      </FocusFrame>
    );
  }

  if (artifact.isPending) {
    return (
      <FocusFrame {...frameProps}>
        <div className="flex flex-col gap-tight">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </FocusFrame>
    );
  }

  // A pasted URL can name a quiz, and a bookmark can outlive a generation. Both
  // are offered the door rather than a 404 — the artifact exists, it just does
  // not open here.
  if (artifact.data.kind !== 'deck') {
    return (
      <FocusFrame {...frameProps}>
        <WrongKind notebookId={notebookId} artifact={artifact.data} expected="deck" />
      </FocusFrame>
    );
  }

  if (artifact.data.status !== 'ready') {
    return (
      <FocusFrame {...frameProps}>
        <NotReady notebookId={notebookId} artifact={artifact.data} />
      </FocusFrame>
    );
  }

  const count = cards.cards.length;

  return (
    <FocusFrame {...frameProps}>
      <div className="flex flex-col gap-snug">
        <div className="flex items-center gap-tight">
          <p className="text-muted-foreground text-sm">
            {count === 0
              ? 'No cards yet'
              : `${String(count)} ${count === 1 ? 'card' : 'cards'}`}
            {cards.hasNextPage ? ' so far' : ''}
          </p>
          <div className="ml-auto flex items-center gap-tight">
            <Button variant="outline" size="sm" asChild>
              <Link to={notebookPath.practice(notebookId, deckId)}>
                <PlayIcon aria-hidden />
                Practise
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden />
              Add card
            </Button>
          </div>
        </div>

        {/*
          The create form is inline above the list rather than in a dialog: it is
          the same editor the edit action mounts, and a card you just wrote
          should appear in the list you are already looking at.
        */}
        {adding && (
          <AddCard
            notebookId={notebookId}
            deckId={deckId}
            onDone={() => {
              setAdding(false);
            }}
          />
        )}

        {cards.isError && (
          <ErrorState
            title="Could not load these cards"
            detail={cards.error.message}
            onRetry={() => void cards.refetch()}
          />
        )}

        {cards.isPending && (
          <div className="flex flex-col gap-tight">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        )}

        {!cards.isPending && !cards.isError && count === 0 && !adding && (
          <EmptyState
            icon={<LayersIcon />}
            title="This deck has no cards"
            description="Add one by hand, or generate more from this notebook's sources."
            action={
              <Button
                onClick={() => {
                  setAdding(true);
                }}
              >
                <PlusIcon aria-hidden />
                Add card
              </Button>
            }
          />
        )}

        {count > 0 && (
          <ul className="flex flex-col gap-tight">
            {cards.cards.map(card => (
              <CardRow key={card.id} notebookId={notebookId} card={card} />
            ))}
          </ul>
        )}

        {/*
          A real "Load more", because this list is genuinely paginated: a
          generated deck routinely runs past one page, and the card you came to
          fix is as likely to be on the second as the first.
        */}
        {cards.hasNextPage && (
          <Button
            variant="outline"
            className="self-center"
            disabled={cards.isFetchingNextPage}
            onClick={() => {
              void cards.fetchNextPage();
            }}
          >
            {cards.isFetchingNextPage ? 'Loading…' : 'Load more cards'}
          </Button>
        )}
      </div>
    </FocusFrame>
  );
}

/** The create form. `defaultValue={null}` is what makes `CardEditor` a create. */
function AddCard({
  notebookId,
  deckId,
  onDone,
}: {
  notebookId: string;
  deckId: string;
  onDone: () => void;
}) {
  const create = useCreateCards(notebookId);

  return (
    <div className="rounded-lg border p-snug">
      <CardEditor
        defaultValue={null}
        autoFocus
        submitLabel="Add card"
        onCancel={onDone}
        onSubmit={payloads => {
          create.mutate(
            { artifactId: deckId, payloads },
            {
              onSuccess: created => {
                onDone();
                if (created.length === 1) {
                  toast.success('Card added');
                } else {
                  toast.success(`${String(created.length)} cards added`, {
                    description: 'One card per deletion, so this draft became several.',
                  });
                }
              },
              onError: (error: unknown) =>
                toast.error('Could not add the card', {
                  description: error instanceof Error ? error.message : 'Unknown error',
                }),
            },
          );
        }}
      />
    </div>
  );
}

/**
 * One card: what it asks, what kind it is, and where it is in its schedule.
 *
 * The front text comes from `cardSummary` rather than a re-derived preview — it
 * already unwraps cloze markers, because a raw deletion marker in a list you are
 * scanning is noise.
 */
function CardRow({ notebookId, card }: { notebookId: string; card: Card }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateCard(notebookId);
  const create = useCreateCards(notebookId);
  const setStatus = useSetCardStatus(notebookId);
  const remove = useDeleteCards(notebookId);

  /**
   * Save an edit, including the case where the draft became several cards.
   *
   * The first payload updates **this** card, so its id and its whole FSRS
   * history survive; any further payloads are created as new cards in the same
   * deck. Sequential rather than concurrent: if the create fails the update has
   * already landed and the user has lost nothing, where the reverse order would
   * leave new cards orphaned beside an unedited original.
   */
  async function saveEdit(payloads: CardPayload[]): Promise<void> {
    const [first, ...rest] = payloads;
    // `onSubmit` cannot produce an empty array — the resolver rejects a draft
    // that yields no card — but the compiler does not know that, and inventing
    // a payload here would be worse than doing nothing.
    if (!first) return;

    try {
      await update.mutateAsync({ cardId: card.id, input: { payload: first } });

      if (rest.length > 0) {
        await create.mutateAsync({
          artifactId: card.artifactId,
          payloads: rest,
          sourceExcerpt: card.sourceExcerpt,
        });
      }

      setEditing(false);
      if (rest.length === 0) {
        toast.success('Card saved', { description: 'Its schedule is unchanged.' });
      } else {
        toast.success(`Card saved, and ${String(rest.length)} added`, {
          description:
            'The extra deletions became new cards. This one kept its schedule.',
        });
      }
    } catch (error: unknown) {
      toast.error('Could not save the card', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border p-snug">
        <CardEditor
          defaultValue={card.payload}
          autoFocus
          submitLabel="Save card"
          onCancel={() => {
            setEditing(false);
          }}
          onSubmit={payloads => saveEdit(payloads)}
        />
      </li>
    );
  }

  const suspended = card.status === 'suspended';

  return (
    <li className={`rounded-lg border p-snug ${suspended ? 'bg-muted/40' : ''}`}>
      <div className="flex items-start gap-tight">
        <div className="min-w-0 flex-1">
          {/*
            Card content is untrusted model output and is rendered as text,
            never as HTML. The eslint rule blocking `dangerouslySetInnerHTML` is
            the backstop; this is the intent.
          */}
          <p className="line-clamp-2 text-sm" title={cardSummary(card.payload)}>
            {cardSummary(card.payload)}
          </p>

          <div className="text-muted-foreground mt-hairline flex flex-wrap items-center gap-tight text-xs">
            <Badge variant="outline" className="shrink-0">
              {KIND_LABELS[card.payload.kind]}
            </Badge>
            {suspended ? (
              <Badge variant="secondary" className="shrink-0">
                Suspended
              </Badge>
            ) : (
              <>
                <span className="shrink-0">{FSRS_LABELS[card.fsrsState]}</span>
                <span aria-hidden>·</span>
                {/*
                  A suspended card deliberately shows no due date: it is not in
                  the queue, and a date beside "Suspended" would be a promise the
                  queue will not keep.
                */}
                <span className="shrink-0">
                  Due {formatDueIn(new Date(card.due), new Date())}
                </span>
              </>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for card: ${cardSummary(card.payload)}`}
            >
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setEditing(true);
              }}
            >
              <PencilIcon aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const next = suspended ? 'active' : 'suspended';
                setStatus.mutate(
                  { cardIds: [card.id], status: next },
                  {
                    onSuccess: () => {
                      toast.success(
                        next === 'suspended'
                          ? 'Card suspended'
                          : 'Card back in the queue',
                      );
                    },
                    onError: (error: unknown) =>
                      toast.error('Could not change the card', {
                        description:
                          error instanceof Error ? error.message : 'Unknown error',
                      }),
                  },
                );
              }}
            >
              <EyeOffIcon aria-hidden />
              {suspended ? 'Unsuspend' : 'Suspend'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setConfirming(true);
              }}
            >
              <TrashIcon aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        Deleting destroys the card's review history, and this says so rather than
        asking "are you sure?". It names suspend, because suspend is what the
        user probably meant if the card is merely bad today.
      */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this card?"
        description="Its review history goes with it, and that cannot be undone. To take a card out of the queue without losing its schedule, suspend it instead."
        confirmLabel="Delete card"
        confirming={remove.isPending}
        onConfirm={() => {
          remove.mutate([card.id], {
            onSuccess: () => {
              setConfirming(false);
              toast.success('Card deleted');
            },
            onError: (error: unknown) =>
              toast.error('Could not delete the card', {
                description: error instanceof Error ? error.message : 'Unknown error',
              }),
          });
        }}
      />
    </li>
  );
}

/** Keyed by the payload's kind, so a fourth kind fails to typecheck until named. */
const KIND_LABELS: Record<CardPayload['kind'], string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  mcq: 'Multiple choice',
};

/** The FSRS states, in the user's words rather than the scheduler's. */
const FSRS_LABELS: Record<FsrsState, string> = {
  new: 'New',
  learning: 'Learning',
  review: 'In review',
  relearning: 'Relearning',
};
