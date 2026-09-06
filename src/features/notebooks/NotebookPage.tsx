import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { NotebookLayout } from '@/app/NotebookLayout';
import { isResumable, notebookPath, type Notebook } from '@/lib/notebooks';
import { useDeck, useDecks } from '@/lib/queries';
import { NotebookHeader } from './NotebookHeader';
import { SourcesRail, type NotebookSource } from './sources/SourcesRail';
import { StudioRail } from './studio/StudioRail';
import { WorkspacePane } from './workspace/WorkspacePane';

/**
 * One notebook, in three panes.
 *
 * ── Where the counts come from ────────────────────────────────────────────
 *
 * `useDeck` returns the row; the counts live on `useDecks`, which the list page
 * has usually already fetched and React Query therefore serves from cache. So
 * this reads both and prefers the counted entry — one request in the common
 * case, and correct rather than zero in the uncommon one (a deep link straight
 * to a notebook, where the list has never been fetched).
 *
 * Showing zeroes while the counts load would be worse than showing nothing: a
 * "0 due" that becomes "18 due" a moment later has already told the user they
 * were finished.
 */
export function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();

  const deck = useDeck(notebookId);
  const decks = useDecks();

  const [sources] = useState<NotebookSource[]>([]);

  const notebook = useMemo<Notebook | null>(() => {
    if (!deck.data) return null;
    const counted = decks.data?.find(entry => entry.id === deck.data.id);
    return {
      id: deck.data.id,
      title: deck.data.title,
      updatedAt: deck.data.updated_at,
      cardCount: counted?.cardCount ?? 0,
      dueCount: counted?.dueCount ?? 0,
      newCount: counted?.newCount ?? 0,
      sourceCount: null,
      resumable: isResumable(deck.data),
    };
  }, [deck.data, decks.data]);

  if (deck.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (deck.isError || !notebook) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <EmptyState
          title="Could not open this notebook"
          description={
            deck.isError ? (deck.error as Error).message : 'It may have been deleted.'
          }
          action={
            <Button onClick={() => void navigate(notebookPath.list())}>
              All notebooks
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <NotebookLayout
      header={<NotebookHeader title={notebook.title} resumable={notebook.resumable} />}
      sources={
        <SourcesRail
          sources={sources}
          onAddDocument={() => void navigate('/create/document')}
          onAddText={() => void navigate('/create/text')}
        />
      }
      workspace={<WorkspacePane notebookId={notebookId} />}
      studio={
        <StudioRail
          notebook={notebook}
          onGenerate={() => void navigate('/create/text')}
        />
      }
    />
  );
}
