import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  EyeOffIcon,
  EyeIcon,
  FileQuestionIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { CardEditor } from '@/features/cards/CardEditor';
import { cardSummary } from '@/features/cards/card-summary';
import { formatDueIn, plural, truncate } from '@/lib/format';
import { CARD_KINDS, type CardKind, type CardPayload } from '@/lib/schemas';
import {
  parseCardPayload,
  useCards,
  useCreateCards,
  useDeck,
  useDeleteCards,
  useSetCardStatus,
  useUpdateCard,
  type CardRow,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<CardKind, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  mcq: 'Choice',
};

/**
 * The densest screen in the product, so P6 made its rhythm quieter rather than
 * louder: the kind is a small caps label instead of a bordered badge, every
 * figure is tabular so the columns line up down the page, and the row separator
 * is the only rule. A hundred badges is a hundred boxes to look past before
 * reading the card you came for.
 */

export function NotebookCardsPage() {
  // The route says notebookId; the hooks say deckId. Same id — the rename
  // stopped at the wire (`src/lib/notebooks.ts`).
  const { notebookId: deckId } = useParams<{ notebookId: string }>();
  const deck = useDeck(deckId);
  const cards = useCards(deckId);

  const [kindFilter, setKindFilter] = useState<CardKind | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const createCards = useCreateCards();
  const updateCard = useUpdateCard();
  const deleteCards = useDeleteCards();
  const setStatus = useSetCardStatus();

  const visible = useMemo(
    () =>
      (cards.data ?? []).filter(card => kindFilter === 'all' || card.kind === kindFilter),
    [cards.data, kindFilter],
  );

  if (!deckId) return null;

  const toggle = (cardId: string) =>
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });

  const addCards = async (payloads: CardPayload[]) => {
    try {
      await createCards.mutateAsync({ deckId, payloads });
      toast.success(
        payloads.length > 1 ? `Added ${payloads.length} cards` : 'Card added',
      );
      setAdding(false);
    } catch (error) {
      toast.error('Could not add the card', { description: (error as Error).message });
    }
  };

  const saveEdit = async (card: CardRow, payloads: CardPayload[]) => {
    const [first, ...extra] = payloads;
    if (!first) return;
    try {
      await updateCard.mutateAsync({ cardId: card.id, deckId, payload: first });
      // An edit that adds a second deletion group becomes a second card rather
      // than an error the user cannot act on (SPEC §5.3).
      if (extra.length > 0) {
        await createCards.mutateAsync({ deckId, payloads: extra });
        toast.success(`Saved, and split into ${payloads.length} cards`);
      } else {
        toast.success('Card saved');
      }
      setEditingId(null);
    } catch (error) {
      toast.error('Could not save the card', { description: (error as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={deckId ? `/notebooks/${deckId}` : '/notebooks'}
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            ← Back to the notebook
          </Link>
          <h1 className="mt-1 font-serif text-3xl tracking-tight">
            {deck.data?.title ?? <Skeleton className="h-8 w-48" />}
          </h1>
          {deck.data?.description && (
            <p className="text-muted-foreground mt-1 text-sm">{deck.data.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/practice/${deckId}`}>
              <PlayIcon /> Practise
            </Link>
          </Button>
          <Button onClick={() => setAdding(value => !value)}>
            <PlusIcon /> Add card
          </Button>
        </div>
      </header>

      {adding && (
        <Card>
          <CardContent>
            <CardEditor
              autoFocus
              submitLabel="Add card"
              onSubmit={addCards}
              onCancel={() => setAdding(false)}
            />
          </CardContent>
        </Card>
      )}

      {cards.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : cards.isError ? (
        <EmptyState
          title="Could not load these cards"
          description={(cards.error as Error).message}
          action={<Button onClick={() => void cards.refetch()}>Try again</Button>}
        />
      ) : (cards.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<FileQuestionIcon />}
          title="This deck is empty"
          description="Add a card by hand — basic, cloze, or multiple choice. Generating them from text arrives in the next phase."
          action={<Button onClick={() => setAdding(true)}>Add the first card</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="Filter by card type"
              className="w-44"
              value={kindFilter}
              onChange={event => setKindFilter(event.target.value as CardKind | 'all')}
            >
              <option value="all">All types</option>
              {CARD_KINDS.map(kind => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </Select>

            <span className="text-muted-foreground text-sm tabular-nums">
              {plural(visible.length, 'card')}
            </span>

            {selected.size > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm tabular-nums">{selected.size} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setStatus.mutate(
                      { cardIds: [...selected], status: 'suspended', deckId },
                      {
                        onSuccess: () => {
                          toast.success(`Suspended ${plural(selected.size, 'card')}`);
                          setSelected(new Set());
                        },
                      },
                    )
                  }
                >
                  <EyeOffIcon /> Suspend
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <TrashIcon /> Delete
                </Button>
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={`No ${KIND_LABELS[kindFilter as CardKind]?.toLowerCase()} cards`}
              description="Change the filter, or add one."
              action={
                <Button variant="outline" onClick={() => setKindFilter('all')}>
                  Show all types
                </Button>
              }
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {visible.map(card => (
                <li
                  key={card.id}
                  className="hover:bg-muted/40 px-3 py-2.5 transition-colors"
                >
                  {editingId === card.id ? (
                    <CardEditor
                      defaultValue={parseCardPayload(card)}
                      submitLabel="Save changes"
                      autoFocus
                      onCancel={() => setEditingId(null)}
                      onSubmit={payloads => saveEdit(card, payloads)}
                    />
                  ) : (
                    <CardListRow
                      card={card}
                      checked={selected.has(card.id)}
                      onToggle={() => toggle(card.id)}
                      onEdit={() => setEditingId(card.id)}
                      onSetStatus={status =>
                        setStatus.mutate({ cardIds: [card.id], status, deckId })
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${plural(selected.size, 'card')}?`}
        description="Their review history goes too. This cannot be undone — suspending keeps a card out of the queue without losing anything."
        confirming={deleteCards.isPending}
        onConfirm={() =>
          deleteCards.mutate(
            { cardIds: [...selected], deckId },
            {
              onSuccess: () => {
                toast.success(`Deleted ${plural(selected.size, 'card')}`);
                setSelected(new Set());
                setConfirmingDelete(false);
              },
              onError: error =>
                toast.error('Could not delete', {
                  description: (error as Error).message,
                }),
            },
          )
        }
      />
    </div>
  );
}

function CardListRow({
  card,
  checked,
  onToggle,
  onEdit,
  onSetStatus,
}: {
  card: CardRow;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSetStatus: (status: 'active' | 'suspended') => void;
}) {
  const payload = parseCardPayload(card);
  const suspended = card.status === 'suspended';

  return (
    <div className="flex items-center gap-3">
      <input
        type="checkbox"
        className="size-4 shrink-0"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select card: ${payload ? truncate(cardSummary(payload), 40) : 'unreadable card'}`}
      />

      <div className={cn('min-w-0 flex-1', suspended && 'opacity-60')}>
        <p className="truncate text-sm">
          {payload ? (
            truncate(cardSummary(payload), 90)
          ) : (
            <span className="text-muted-foreground italic">
              Unreadable content — edit to fix
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0 tracking-wide uppercase">
            {KIND_LABELS[card.kind]}
          </span>
          {suspended ? (
            <span>Suspended</span>
          ) : card.fsrs_state === 'new' ? (
            <span>New</span>
          ) : (
            <span className="font-mono tabular-nums">
              Due {formatDueIn(new Date(card.due), new Date())}
            </span>
          )}
          {card.reps > 0 && (
            <span className="tabular-nums">· {plural(card.reps, 'review')}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={suspended ? 'Unsuspend card' : 'Suspend card'}
          onClick={() => onSetStatus(suspended ? 'active' : 'suspended')}
        >
          {suspended ? <EyeIcon /> : <EyeOffIcon />}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Edit card" onClick={onEdit}>
          <PencilIcon />
        </Button>
      </div>
    </div>
  );
}
