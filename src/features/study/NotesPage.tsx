import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { FocusFrame } from '@/app/FocusFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { notebookPath } from '@/lib/notebooks';
import { useSources } from '@/features/notebook/queries';
import type { NoteBlock, SourceSnapshot } from '@/lib/api';
import { NoteBlocks } from './NoteBlocks';
import { NotReady, WrongKind } from './WrongKind';
import { useArtifact, useMarkBlocksRead, useNoteBlocks } from './queries';

/**
 * `/notebooks/:notebookId/notes/:noteSetId` — the note **reader**.
 *
 * Read-only, deliberately: FR5 §2's scope table gives the editor to a later
 * phase, and §1.2(2)'s block structure is what keeps that cheap — block-level
 * editing and reordering can be added to a union of blocks, and cannot be added
 * to a string without re-parsing content that was never structured.
 *
 * ── Reading is progress, and it is per block ─────────────────────────────
 *
 * A note set contributes to readiness through `readBlockCount` — the contract's
 * comment on `markBlocksRead` says it is "per block, so a reader can resume".
 * That makes reading itself the unit of work here, in the way a rating is in
 * practice, and it is why this page observes blocks rather than offering a
 * "mark as read" button: a button measures intent and an observer measures
 * reading.
 *
 * **Read is monotonic.** The fake takes the maximum of what it holds and what
 * arrives, so scrolling back up cannot un-read a section — and that is right,
 * because it did not become unread.
 */
export function NotesPage() {
  const { notebookId, noteSetId } = useParams<{
    notebookId: string;
    noteSetId: string;
  }>();
  if (!notebookId || !noteSetId) return null;
  return <Notes notebookId={notebookId} noteSetId={noteSetId} />;
}

function Notes({ notebookId, noteSetId }: { notebookId: string; noteSetId: string }) {
  const artifact = useArtifact(notebookId, noteSetId);
  const blocks = useNoteBlocks(notebookId, noteSetId);
  const sources = useSources(notebookId);

  const frameProps = {
    title: 'Notes',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
  };

  if (artifact.isError || blocks.isError) {
    const error = artifact.error ?? blocks.error;
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load these notes"
          {...(error instanceof Error ? { detail: error.message } : {})}
          onRetry={() => {
            void artifact.refetch();
            void blocks.refetch();
          }}
        />
      </FocusFrame>
    );
  }

  if (artifact.isPending || blocks.isPending) {
    return (
      <FocusFrame {...frameProps}>
        <div className="space-y-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </FocusFrame>
    );
  }

  if (artifact.data.kind !== 'noteset') {
    return (
      <FocusFrame {...frameProps}>
        <WrongKind notebookId={notebookId} artifact={artifact.data} expected="noteset" />
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

  if (blocks.data.length === 0) {
    return (
      <FocusFrame {...frameProps}>
        <EmptyState
          title="These notes are empty"
          description="Generation finished without writing any sections."
          action={
            <Button asChild>
              <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
            </Button>
          }
        />
      </FocusFrame>
    );
  }

  const payload = artifact.data.payload;

  return (
    <Reader
      notebookId={notebookId}
      noteSetId={noteSetId}
      title={artifact.data.title}
      blocks={blocks.data}
      sourcesSnapshot={artifact.data.sourcesSnapshot}
      // `sourceIds` *links*; the snapshot *names*. A source id that no longer
      // appears in `listSources` is a valid state, so what is live is computed
      // by intersecting rather than by assuming a lookup hits.
      liveSourceIds={
        new Set((sources.data ?? []).map(source => source.id))
      }
      origin={payload.kind === 'noteset' ? payload.origin : 'generated'}
      alreadyRead={payload.kind === 'noteset' ? payload.readBlockCount : 0}
    />
  );
}

function Reader({
  notebookId,
  noteSetId,
  title,
  blocks,
  sourcesSnapshot,
  liveSourceIds,
  origin,
  alreadyRead,
}: {
  notebookId: string;
  noteSetId: string;
  title: string;
  blocks: NoteBlock[];
  sourcesSnapshot: SourceSnapshot[];
  liveSourceIds: ReadonlySet<string>;
  origin: 'generated' | 'chat';
  alreadyRead: number;
}) {
  const markRead = useMarkBlocksRead(notebookId, noteSetId);

  /*
   * Which blocks have been on screen.
   *
   * Seeded from what the server already counted, so a reader who returns is not
   * told they have read nothing. The count is what the contract stores — it has
   * no per-index record — so the seed is "the first N", which is what
   * `readBlockCount` means for a document read top to bottom.
   */
  const [read, setRead] = useState<Set<number>>(
    () => new Set(Array.from({ length: alreadyRead }, (_, index) => index)),
  );

  // The set as the observer sees it, so the callback does not need to be
  // rebuilt — and re-attached to every element — on each new block read.
  const readRef = useRef(read);
  readRef.current = read;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const pending = useRef<Set<number>>(new Set());
  const flushTimer = useRef<number | null>(null);

  /**
   * Send what has been read, at most once per idle second.
   *
   * Batched because scrolling through a long note crosses many blocks in a
   * moment, and one request per block would be a burst of writes that all say
   * the same thing. The whole set is sent, not a delta: the contract takes the
   * indexes read so far, so a request that fails costs nothing — the next one
   * carries the same information.
   */
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      const indexes = [...readRef.current].sort((a, b) => a - b);
      if (indexes.length <= alreadyRead) return;
      markRead.mutate(indexes);
    }, 1000);
  }, [alreadyRead, markRead]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.getAttribute('data-block-index'));
          if (Number.isNaN(index) || readRef.current.has(index)) continue;
          pending.current.add(index);
          changed = true;
        }
        if (!changed) return;
        setRead(previous => {
          const next = new Set(previous);
          for (const index of pending.current) next.add(index);
          pending.current.clear();
          return next;
        });
        scheduleFlush();
      },
      // A block counts as read once half of it has been on screen. Any lower
      // and scrolling past a heading marks the section beneath it read.
      { threshold: 0.5 },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    };
  }, [scheduleFlush]);

  /** Attach one block to the observer, and label it with its index. */
  const blockRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      if (!node) return;
      node.setAttribute('data-block-index', String(index));
      observerRef.current?.observe(node);
    },
    [],
  );

  const readCount = Math.min(blocks.length, read.size);
  const complete = readCount >= blocks.length;

  return (
    <FocusFrame
      title="Notes"
      subtitle={title}
      exitTo={notebookPath.open(notebookId)}
      status={
        <span className="text-muted-foreground text-sm tabular-nums">
          {readCount} / {blocks.length} read
        </span>
      }
    >
      <article className="mx-auto max-w-2xl space-y-gutter">
        <header className="space-y-snug border-b pb-gutter">
          <h1 className="font-serif text-3xl leading-tight">{title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Where a note came from is worth saying: one written from a chat
              answer (§1.2(4)) is a different kind of artefact from one
              generated over the sources, and the reader should not have to
              guess which they are reading.
            */}
            <Badge variant="outline">
              {origin === 'chat' ? 'Saved from chat' : 'Generated from sources'}
            </Badge>
            {complete && <Badge variant="outline">Read</Badge>}
          </div>
          {sourcesSnapshot.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Built from {sourcesSnapshot.map(source => source.title).join(', ')}
            </p>
          )}
        </header>

        <NoteBlocks
          blocks={blocks}
          sourcesSnapshot={sourcesSnapshot}
          liveSourceIds={liveSourceIds}
          blockRef={blockRef}
        />

        <footer className="flex items-center justify-between gap-3 border-t pt-gutter">
          <span className="text-muted-foreground text-xs">
            {complete
              ? 'You have read all of this.'
              : `${blocks.length - readCount} sections still to read.`}
          </span>
          <Button asChild variant="ghost">
            <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
          </Button>
        </footer>
      </article>
    </FocusFrame>
  );
}
