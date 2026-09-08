import { useState } from 'react';
import {
  FileTextIcon,
  GlobeIcon,
  LibraryIcon,
  Loader2Icon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
  TypeIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Toolbar, ToolbarSpacer } from '@/components/layout';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import type { Source, SourceKind } from '@/lib/api';
import { useModal } from '@/app/modals';
import { useDeleteSource, useSources } from './queries';

/**
 * The left pane: this notebook's sources, and the button that adds one.
 *
 * ═══ The two rules this pane exists to satisfy ═══════════════════════════
 *
 * > **Sources are persisted entities, not `useState([])`.**
 *
 * P11's `SourcesRail` held its sources in component state, so every one of them
 * vanished on refresh. That is the bug FR3 exists to fix and the reason
 * `Source` is a noun in the contract with `listSources` / `addSource` /
 * `deleteSource` behind it. Nothing here holds a source in local state; the
 * list is a query, and adding one is a mutation that invalidates it.
 *
 * > **"+ Add source" is the notebook's primary CTA** (brief §3.3).
 *
 * Adding a source is the notebook's defining act — everything else in the app
 * is generated *from* sources, so a notebook with none can do nothing at all.
 * Before FR3 the only enabled call to action on a notebook was "Generate
 * cards", which navigated away and **created a new notebook**; the audit called
 * that the single worst behaviour it found. So the button is here, it is
 * `variant="default"` at the top of the pane, and it adds to *this* notebook.
 *
 * ── Selection is the pane's other job ────────────────────────────────────
 *
 * The checkboxes feed the chat pane: `AskInput.sourceIds` grounds an answer in
 * chosen sources, and the contract's comment is explicit that empty means every
 * ready source — "a choice the UI makes explicit, not a default the server
 * invents". So selection lives in the shell and is passed down, rather than
 * being invented in the chat pane where the sources are not.
 *
 * Only `ready` sources can be selected. One still processing has no chunks to
 * retrieve from and a failed one has nothing at all, so offering them as
 * grounding would be offering a promise the retrieval cannot keep.
 */
export function SourcesPane({
  notebookId,
  selectedIds,
  onToggleSource,
}: {
  notebookId: string;
  selectedIds: ReadonlySet<string>;
  onToggleSource: (sourceId: string) => void;
}) {
  const sources = useSources(notebookId);
  const { openModal } = useModal();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <LibraryIcon className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-medium">Sources</h2>
        <ToolbarSpacer />
        {sources.data && sources.data.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {sources.data.length}
          </span>
        )}
      </Toolbar>

      {/*
        The primary CTA, above the list rather than below it: a notebook with no
        sources is the case that matters most, and a button under an empty list
        is a button under nothing.
      */}
      <div className="border-b p-snug">
        <Button
          className="w-full"
          onClick={() => {
            openModal('add-source');
          }}
        >
          <PlusIcon aria-hidden />
          Add source
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-snug">
        {sources.isPending && <LoadingState label="Loading sources" />}

        {sources.isError && (
          <ErrorState
            title="Could not load sources"
            detail={sources.error.message}
            onRetry={() => void sources.refetch()}
          />
        )}

        {sources.data?.length === 0 && (
          <EmptyState
            icon={<LibraryIcon />}
            title="No sources yet"
            description="Add a document, some text or a link. Everything this notebook can generate is built from its sources."
          />
        )}

        {sources.data && sources.data.length > 0 && (
          <ul className="flex flex-col gap-hairline">
            {sources.data.map(source => (
              <SourceRow
                key={source.id}
                notebookId={notebookId}
                source={source}
                selected={selectedIds.has(source.id)}
                onToggle={() => {
                  onToggleSource(source.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One source.
 *
 * The status is carried by the icon rather than a badge, because a rail this
 * narrow cannot afford a badge on every row and three of the four states are
 * the uninteresting one. `processing` spins, `failed` warns and says why;
 * `ready` just shows what kind of thing it is.
 */
function SourceRow({
  notebookId,
  source,
  selected,
  onToggle,
}: {
  notebookId: string;
  source: Source;
  selected: boolean;
  onToggle: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteSource(notebookId);
  const selectable = source.status === 'ready';

  return (
    <li className="group hover:bg-accent/50 flex items-start gap-tight rounded-md p-tight">
      <Checkbox
        className="mt-0.5"
        checked={selected}
        disabled={!selectable}
        onCheckedChange={onToggle}
        aria-label={
          selectable
            ? `Ground answers in ${source.title}`
            : `${source.title} is not ready to ground answers`
        }
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-tight">
          <SourceIcon source={source} />
          <p className="truncate text-sm" title={source.title}>
            {source.title}
          </p>
        </div>

        {/*
          `error` is a string from the pipeline and is rendered as text. It can
          carry provider output, which is untrusted — the same rule the card
          content follows.
        */}
        {source.status === 'failed' && (
          <p className="text-destructive mt-hairline text-xs">
            {source.error ?? 'Could not be read.'}
          </p>
        )}
        {source.status === 'processing' && (
          <p className="text-muted-foreground mt-hairline text-xs">
            Processing… {/* FR4 replaces this with the real job progress. */}
          </p>
        )}
        {source.status === 'ready' && source.error !== null && (
          <p className="text-muted-foreground mt-hairline text-xs">{source.error}</p>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        aria-label={`Delete ${source.title}`}
        onClick={() => {
          setConfirming(true);
        }}
      >
        <TrashIcon aria-hidden />
      </Button>

      {/*
        A confirmation, so by `modals.tsx`'s rule it is local state and not in
        the URL: you can be in "adding a source", you cannot be in "about to
        confirm a delete".

        The description states what deleting does *not* do. Artifacts built from
        a source survive its deletion (brief §1.2(7)) — that is a deliberate
        product decision, and a user who expects a cascade and does not get one
        has been surprised by their own data.
      */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${source.title}"?`}
        description="Anything already generated from this source is kept, and will still show what it was built from. New answers and new generations will no longer draw on it."
        confirmLabel="Delete source"
        confirming={remove.isPending}
        onConfirm={() => {
          remove.mutate(source.id, {
            onSuccess: () => {
              setConfirming(false);
              toast.success('Source deleted', {
                description: 'Artifacts built from it were kept.',
              });
            },
            onError: (error: unknown) =>
              toast.error('Could not delete the source', {
                description: error instanceof Error ? error.message : 'Unknown error',
              }),
          });
        }}
      />
    </li>
  );
}

const SOURCE_ICON: Record<SourceKind, typeof FileTextIcon> = {
  document: FileTextIcon,
  text: TypeIcon,
  url: GlobeIcon,
};

function SourceIcon({ source }: { source: Source }) {
  if (source.status === 'processing') {
    return (
      <Loader2Icon
        className="text-muted-foreground size-3.5 shrink-0 animate-spin"
        aria-hidden
      />
    );
  }
  if (source.status === 'failed') {
    return (
      <TriangleAlertIcon
        className="text-destructive size-3.5 shrink-0"
        aria-hidden
      />
    );
  }
  const Icon = SOURCE_ICON[source.kind];
  return <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />;
}
