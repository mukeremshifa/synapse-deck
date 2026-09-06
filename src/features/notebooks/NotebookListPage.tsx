import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { NotebookPenIcon, PlusIcon, SearchIcon, TrashIcon } from 'lucide-react';

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
import { toNotebook, notebookPath, type Notebook } from '@/lib/notebooks';
import { DeckInput } from '@/lib/schemas';
import { useCreateDeck, useDecks, useDeleteDeck } from '@/lib/queries';

/**
 * Every notebook you have. The front door for a signed-in user.
 *
 * Replaces both `DashboardPage` and `DecksPage`, which had drifted into two
 * views of the same list: the dashboard showed decks with due counts and a
 * "practise now" call, the deck list showed decks with due counts and a
 * "practise" button per row. One grid, and the counts live on the tile.
 *
 * A grid rather than the old rows because a notebook has more to say than a
 * deck did — sources, cards, what is due, whether it is mid-generation — and
 * four numbers in a row is a table nobody reads.
 */
export function NotebookListPage() {
  const decks = useDecks();
  const deleteDeck = useDeleteDeck();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Notebook | null>(null);

  const notebooks = useMemo(
    () => (decks.data ?? []).map(toNotebook),
    [decks.data],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return notebooks;
    return notebooks.filter(notebook =>
      notebook.title.toLowerCase().includes(needle),
    );
  }, [notebooks, search]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Notebooks</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            A notebook holds your sources, and everything you make from them.
          </p>
        </div>
        <Button onClick={() => setCreating(value => !value)}>
          <PlusIcon /> New notebook
        </Button>
      </header>

      {creating && (
        <Card>
          <CardContent>
            <NewNotebookForm onDone={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}

      {notebooks.length > 0 && (
        <div className="relative max-w-sm">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            className="pl-8"
            placeholder="Search notebooks"
            aria-label="Search notebooks"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      )}

      {decks.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : decks.isError ? (
        <EmptyState
          title="Could not load your notebooks"
          description={(decks.error as Error).message}
          action={<Button onClick={() => void decks.refetch()}>Try again</Button>}
        />
      ) : notebooks.length === 0 ? (
        <EmptyState
          icon={<NotebookPenIcon />}
          title="No notebooks yet"
          description="Start one, add what you're studying, and turn it into cards and exams."
          action={<Button onClick={() => setCreating(true)}>Create a notebook</Button>}
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(notebook => (
            <li key={notebook.id}>
              <NotebookTile
                notebook={notebook}
                onDelete={() => setPendingDelete(notebook)}
              />
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
              toast.error('Could not delete the notebook', {
                description: (error as Error).message,
              }),
          });
        }}
      />
    </div>
  );
}

/**
 * One notebook.
 *
 * The whole tile is the link, with the delete button lifted out of it — a
 * button nested inside an anchor is invalid HTML and behaves differently in
 * every browser. So the anchor covers the tile via an overlay and the delete
 * control sits above it in the stacking order.
 */
function NotebookTile({
  notebook,
  onDelete,
}: {
  notebook: Notebook;
  onDelete: () => void;
}) {
  const ready = notebook.dueCount + notebook.newCount;

  return (
    <Card className="group hover:border-foreground/20 relative h-full transition-colors">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 font-medium">
            <Link
              to={notebookPath.open(notebook.id)}
              className="focus-visible:ring-ring rounded-sm outline-none before:absolute before:inset-0 before:content-[''] focus-visible:ring-2"
            >
              {notebook.title}
            </Link>
          </h2>
          {notebook.resumable ? (
            <Badge variant="secondary" className="relative shrink-0">
              Draft
            </Badge>
          ) : null}
        </div>

        <dl className="text-muted-foreground mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div className="flex gap-1">
            <dt className="sr-only">Cards</dt>
            <dd>{plural(notebook.cardCount, 'card')}</dd>
          </div>
          {ready > 0 ? (
            <div className="flex gap-1">
              <dt className="sr-only">Ready to practise</dt>
              <dd className="text-foreground font-medium">{ready} ready</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive relative opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={onDelete}
          >
            <TrashIcon aria-hidden />
            <span className="sr-only">Delete {notebook.title}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Creating an empty notebook. Sources and cards come after. */
function NewNotebookForm({ onDone }: { onDone: () => void }) {
  const createDeck = useCreateDeck();
  const navigate = useNavigate();

  const form = useForm<DeckInput>({
    resolver: zodResolver(DeckInput),
    defaultValues: { title: '', description: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(values => {
        createDeck.mutate(values, {
          onSuccess: deck => {
            onDone();
            // Straight into the notebook: an empty one is useless until a
            // source is added, and the add-source control lives inside it.
            void navigate(notebookPath.open(deck.id));
          },
          onError: error =>
            toast.error('Could not create the notebook', {
              description: (error as Error).message,
            }),
        });
      })}
    >
      <div className="space-y-2">
        <Label htmlFor="notebook-title">Title</Label>
        <Input
          id="notebook-title"
          autoFocus
          placeholder="Pharmacology — week 3"
          {...form.register('title')}
        />
        {form.formState.errors.title && (
          <p className="text-destructive text-sm">
            {form.formState.errors.title.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notebook-description">Description (optional)</Label>
        <Textarea
          id="notebook-description"
          rows={2}
          placeholder="What this covers."
          {...form.register('description')}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={createDeck.isPending}>
          {createDeck.isPending ? 'Creating…' : 'Create notebook'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
