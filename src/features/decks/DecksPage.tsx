import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  LayersIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/EmptyState';
import { plural } from '@/lib/format';
import { DeckInput } from '@/lib/schemas';
import {
  useCreateDeck,
  useDecks,
  useDeleteDeck,
  type DeckWithCounts,
} from '@/lib/queries';

export function DecksPage() {
  const decks = useDecks();
  const deleteDeck = useDeleteDeck();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeckWithCounts | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return decks.data ?? [];
    return (decks.data ?? []).filter(
      deck =>
        deck.title.toLowerCase().includes(needle) ||
        (deck.description ?? '').toLowerCase().includes(needle),
    );
  }, [decks.data, search]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight">Decks</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/create/text">
              <SparklesIcon /> Generate
            </Link>
          </Button>
          <Button onClick={() => setCreating(value => !value)}>
            <PlusIcon /> New deck
          </Button>
        </div>
      </header>

      {creating && (
        <Card>
          <CardContent>
            <NewDeckForm onDone={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}

      {(decks.data?.length ?? 0) > 0 && (
        <div className="relative max-w-sm">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            className="pl-8"
            placeholder="Search decks"
            aria-label="Search decks"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      )}

      {decks.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : decks.isError ? (
        <EmptyState
          title="Could not load your decks"
          description={(decks.error as Error).message}
          action={<Button onClick={() => void decks.refetch()}>Try again</Button>}
        />
      ) : decks.data.length === 0 ? (
        <EmptyState
          icon={<LayersIcon />}
          title="No decks yet"
          description="A deck is a set of cards you practise together — one per subject works well."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/create/text">
                  <SparklesIcon /> Generate from text
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setCreating(true)}>
                Create an empty deck
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`Nothing matches “${search}”`}
          description="Try a shorter search."
          action={
            <Button variant="outline" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map(deck => (
            <li key={deck.id}>
              <DeckRow deck={deck} onDelete={() => setPendingDelete(deck)} />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => !open && setPendingDelete(null)}
        title={`Delete “${pendingDelete?.title ?? ''}”?`}
        description={
          <>
            This deletes {plural(pendingDelete?.cardCount ?? 0, 'card')} and their whole
            review history. It cannot be undone.
          </>
        }
        confirming={deleteDeck.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteDeck.mutate(pendingDelete.id, {
            onSuccess: () => {
              toast.success(`Deleted “${pendingDelete.title}”`);
              setPendingDelete(null);
            },
            onError: error =>
              toast.error('Could not delete the deck', {
                description: (error as Error).message,
              }),
          });
        }}
      />
    </div>
  );
}

function DeckRow({ deck, onDelete }: { deck: DeckWithCounts; onDelete: () => void }) {
  const ready = deck.dueCount + deck.newCount;
  const generating = deck.status === 'generating';
  // A generation that was interrupted leaves a resumable deck behind. This is
  // the way back into the review gate (SPEC §4.1: abandoning leaves a resumable
  // draft deck).
  //
  // Read from `deck.status`, not from a count of draft cards: P10's migration
  // 0003 moved drafts to DynamoDB, so the deck list can no longer count them.
  // `decks.status = 'draft'` is a different column with its own meaning --
  // "generation finished, the gate has not been passed" -- and it is the one
  // that actually says a deck is resumable.
  const resumable = deck.status === 'draft';

  return (
    <Card className="hover:border-foreground/25 py-4 transition-colors">
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/decks/${deck.id}`}
            className="focus-visible:ring-ring rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            {deck.title}
          </Link>
          <p className="text-muted-foreground mt-0.5 text-sm tabular-nums">
            {plural(deck.cardCount, 'card')}
            {deck.dueCount > 0 && ` · ${deck.dueCount} due`}
            {deck.newCount > 0 && ` · ${deck.newCount} new`}
            {resumable && ' · waiting to be reviewed'}
          </p>
        </div>

        {generating ? (
          <Badge variant="secondary">Writing cards…</Badge>
        ) : resumable ? (
          <Badge variant="secondary">To review</Badge>
        ) : ready > 0 ? (
          <Badge variant="secondary">
            <span className="font-mono tabular-nums">{ready}</span> ready
          </Badge>
        ) : (
          <Badge variant="outline">Up to date</Badge>
        )}

        {/*
          Every button in this list is `outline` or quieter, including the ones
          on a deck with work waiting. Twenty rows with an accent button each is
          twenty primary actions, which is none — the one accent on this screen
          belongs to "New deck" in the header (P6). The badge is what says which
          row has something to do.
        */}
        <div className="flex gap-1">
          {resumable && (
            <Button asChild size="sm" variant="secondary">
              <Link to={`/create/review/${deck.id}`}>
                <SparklesIcon /> Review cards
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to={`/practice/${deck.id}`}>
              <PlayIcon /> Practise
            </Link>
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${deck.title}`}
            onClick={onDelete}
          >
            <TrashIcon />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NewDeckForm({ onDone }: { onDone: () => void }) {
  const createDeck = useCreateDeck();
  const form = useForm<DeckInput>({
    resolver: zodResolver(DeckInput),
    defaultValues: { title: '', description: '' },
  });

  const onSubmit = form.handleSubmit(async values => {
    try {
      const deck = await createDeck.mutateAsync(values);
      toast.success(`Created “${deck.title}”`);
      form.reset();
      onDone();
    } catch (error) {
      toast.error('Could not create the deck', {
        description: (error as Error).message,
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="deck-title">Title</Label>
        <Input
          id="deck-title"
          autoFocus
          placeholder="Cell biology"
          aria-invalid={Boolean(form.formState.errors.title)}
          {...form.register('title')}
        />
        {form.formState.errors.title && (
          <p role="alert" className="text-destructive text-sm">
            {form.formState.errors.title.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="deck-description">Description (optional)</Label>
        <Textarea id="deck-description" {...form.register('description')} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Create deck
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
