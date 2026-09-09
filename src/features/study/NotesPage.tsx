import { Link, useParams } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';

import { FocusFrame } from '@/app/FocusFrame';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/states';
import { notebookPath } from '@/lib/notebooks';
import { useSources } from '@/features/notebook/queries';
import type { NoteTopic, SourceSnapshot } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NoteBlocks } from './NoteBlocks';
import { NotReady, WrongKind } from './WrongKind';
import {
  useArtifact,
  useNoteTopics,
  useSetNoteSetCompleted,
  useSetTopicCompleted,
} from './queries';

/**
 * `/notebooks/:notebookId/notes/:noteSetId` — the note **reader**.
 *
 * ══ Read-only, and no longer "for now" ════════════════════════════════════
 *
 * Earlier revisions of this file called the editor "a later phase". **It is not
 * planned.** A note set is generated from one source and read; if it is wrong,
 * the answer is to regenerate it, not to edit the model's output into something
 * whose provenance no longer matches the `sourcesSnapshot` beside it. The block
 * structure stays because it is what makes the rendering safe and the topics
 * addressable — not because something will edit it later.
 *
 * ── Progress is per topic, declared, and reversible ──────────────────────
 *
 * This page used to mark blocks read **by observation**: an IntersectionObserver
 * counted blocks that crossed the viewport, monotonically, and that count was
 * readiness. That is gone, and the reasoning is worth keeping:
 *
 * > Scrolling past a paragraph is not a claim about having understood it. The
 * > observer measured **which pixels had been on screen**, then reported it as
 * > reading — so a fast scroll to the bottom marked a note set fully read, and
 * > nothing the student did could correct it, because the count only ever went
 * > up.
 *
 * A tick is a claim, so it can be withdrawn. Ticking is per topic (§4.2), which
 * is why `NoteTopic` exists as a contract noun rather than being inferred from
 * heading levels — see its comment for why that inference would be wrong.
 *
 * **The button at the end is a separate axis.** Ticking every topic does not
 * press it, and pressing it does not tick every topic. See `ArtifactPayload`.
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
  const topics = useNoteTopics(notebookId, noteSetId);
  const sources = useSources(notebookId);

  const frameProps = {
    title: 'Notes',
    ...(artifact.data ? { subtitle: artifact.data.title } : {}),
    exitTo: notebookPath.open(notebookId),
  };

  if (artifact.isError || topics.isError) {
    const error = artifact.error ?? topics.error;
    return (
      <FocusFrame {...frameProps}>
        <ErrorState
          title="Could not load these notes"
          {...(error instanceof Error ? { detail: error.message } : {})}
          onRetry={() => {
            void artifact.refetch();
            void topics.refetch();
          }}
        />
      </FocusFrame>
    );
  }

  if (artifact.isPending || topics.isPending) {
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

  if (topics.data.length === 0) {
    return (
      <FocusFrame {...frameProps}>
        <EmptyState
          title="These notes are empty"
          description="Generation finished without writing any topics."
          action={
            <Button asChild>
              <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
            </Button>
          }
        />
      </FocusFrame>
    );
  }

  const { payload } = artifact.data;

  return (
    <Reader
      notebookId={notebookId}
      noteSetId={noteSetId}
      title={artifact.data.title}
      topics={topics.data}
      sourcesSnapshot={artifact.data.sourcesSnapshot}
      // `sourceIds` *links*; the snapshot *names*. A source id that no longer
      // appears in `listSources` is a valid state, so what is live is computed
      // by intersecting rather than by assuming a lookup hits.
      liveSourceIds={new Set((sources.data ?? []).map(source => source.id))}
      origin={payload.kind === 'noteset' ? payload.origin : 'generated'}
      completedCount={payload.kind === 'noteset' ? payload.completedTopicCount : 0}
      completedAt={payload.kind === 'noteset' ? payload.completedAt : null}
    />
  );
}

function Reader({
  notebookId,
  noteSetId,
  title,
  topics,
  sourcesSnapshot,
  liveSourceIds,
  origin,
  completedCount,
  completedAt,
}: {
  notebookId: string;
  noteSetId: string;
  title: string;
  topics: NoteTopic[];
  sourcesSnapshot: SourceSnapshot[];
  liveSourceIds: ReadonlySet<string>;
  origin: 'generated' | 'chat';
  completedCount: number;
  completedAt: string | null;
}) {
  const setTopic = useSetTopicCompleted(notebookId, noteSetId);
  const setCompleted = useSetNoteSetCompleted(notebookId, noteSetId);

  /*
   * **Which topics are ticked is derived, not held in state.**
   *
   * The payload carries a *count*, not the ids — the contract's reason is that
   * a list endpoint must not ship every id of every artifact — so the reader
   * reconstructs "the first n" from the count, exactly as a document read in
   * order implies. Holding a local set instead would mean two sources of truth
   * for the same fact, and the optimistic update in `useSetTopicCompleted`
   * already keeps the count honest between the click and the response.
   *
   * The consequence, stated rather than hidden: **ticking out of order is
   * displayed in order.** Ticking only the third topic shows the first as
   * ticked instead. That is a real limitation of storing a count, and the fix
   * is a payload that carries ids — a contract change, not a change here.
   */
  const ticked = (index: number) => index < completedCount;

  const total = topics.length;
  const done = Math.min(total, completedCount);
  const complete = completedAt !== null;

  return (
    <FocusFrame
      title="Notes"
      subtitle={title}
      exitTo={notebookPath.open(notebookId)}
      status={
        <span className="text-muted-foreground text-sm tabular-nums">
          {done} / {total} topics
        </span>
      }
    >
      <article className="space-y-gutter mx-auto max-w-2xl">
        <header className="space-y-snug pb-gutter border-b">
          <h1 className="font-serif text-3xl leading-tight">{title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Where a note came from is worth saying: one written from a chat
              answer (§1.2(4)) is a different kind of artefact from one
              generated over a source, and the reader should not have to guess
              which they are reading.
            */}
            <Badge variant="outline">
              {origin === 'chat' ? 'Saved from chat' : 'Generated from a source'}
            </Badge>
            {complete && <Badge variant="outline">Completed</Badge>}
          </div>
          {sourcesSnapshot.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Built from {sourcesSnapshot.map(source => source.title).join(', ')}
            </p>
          )}
          <Progress value={total === 0 ? 0 : (done / total) * 100} />
        </header>

        {topics.map((topic, index) => (
          <Topic
            key={topic.id}
            topic={topic}
            index={index}
            completed={ticked(index)}
            sourcesSnapshot={sourcesSnapshot}
            liveSourceIds={liveSourceIds}
            onToggle={completed => {
              setTopic.mutate({ topicId: topic.id, completed });
            }}
          />
        ))}

        <footer className="pt-gutter flex flex-wrap items-center justify-between gap-3 border-t">
          <span className="text-muted-foreground text-xs">
            {complete
              ? 'You marked this complete.'
              : done === total
                ? 'Every topic is ticked.'
                : `${String(total - done)} of ${String(total)} topics still to read.`}
          </span>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
            </Button>
            {/*
              **The declaration, and it is reversible.** A student who presses
              this by accident, or who comes back to re-read, can take it back —
              the same reasoning as an untickable topic. It is deliberately not
              disabled while topics are outstanding: finishing early is a
              legitimate thing to decide, and a button that refused would be
              arguing with the person who decided it.
            */}
            <Button
              variant={complete ? 'outline' : 'default'}
              disabled={setCompleted.isPending}
              onClick={() => {
                setCompleted.mutate(!complete);
              }}
            >
              {complete ? (
                <>
                  <CheckIcon aria-hidden />
                  Completed
                </>
              ) : (
                'Mark as complete'
              )}
            </Button>
          </div>
        </footer>
      </article>
    </FocusFrame>
  );
}

/**
 * One topic: its heading, its blocks, and the tick that says it is read.
 *
 * The checkbox sits in the heading rather than after the content, so the state
 * is visible while reading and reachable without scrolling to the end of a long
 * topic — and so the whole set can be scanned for what is left.
 */
function Topic({
  topic,
  index,
  completed,
  sourcesSnapshot,
  liveSourceIds,
  onToggle,
}: {
  topic: NoteTopic;
  index: number;
  completed: boolean;
  sourcesSnapshot: SourceSnapshot[];
  liveSourceIds: ReadonlySet<string>;
  onToggle: (completed: boolean) => void;
}) {
  const labelId = `topic-${topic.id}-title`;

  return (
    <section
      aria-labelledby={labelId}
      className={cn(
        'space-y-gutter pt-gutter border-t transition-opacity',
        // Read topics recede rather than disappear — still there to re-read,
        // but no longer competing for attention with what is left.
        completed && 'opacity-70',
      )}
    >
      <div className="gap-snug flex items-start">
        <Checkbox
          className="mt-1.5"
          checked={completed}
          aria-labelledby={labelId}
          onCheckedChange={value => {
            onToggle(value === true);
          }}
        />
        <h2 id={labelId} className="flex-1 font-serif text-xl leading-tight">
          <span className="text-muted-foreground mr-2 text-sm tabular-nums">
            {index + 1}.
          </span>
          {topic.title}
        </h2>
      </div>

      <NoteBlocks
        blocks={topic.blocks}
        sourcesSnapshot={sourcesSnapshot}
        liveSourceIds={liveSourceIds}
      />
    </section>
  );
}
