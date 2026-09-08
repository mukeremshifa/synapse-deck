import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BookOpenIcon,
  ClipboardListIcon,
  FileQuestionIcon,
  LayersIcon,
  SparklesIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toolbar, ToolbarSpacer } from '@/components/layout';
import { ErrorState, LoadingState } from '@/components/states';
import type { Artifact, ArtifactKind, Readiness, Source } from '@/lib/api';
import { notebookPath } from '@/lib/notebooks';
import { useModal } from '@/app/modals';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GenerationPanel } from './GenerationPanel';
import { useNotebookJobs } from './jobs';
import { groupByKind, useArtifacts, useDeleteArtifact } from './queries';

/**
 * The right pane: everything this notebook has generated, by kind.
 *
 * ═══ What this fixes ═════════════════════════════════════════════════════
 *
 * > "The exam button opens an exam and nobody knows where it came from."
 *
 * That was the audit's line, and it had two causes. The route named no artifact
 * — `/notebooks/:id/exam` could only ever mean *the* exam — and the rail listed
 * *kinds* rather than *things*, so a notebook with three exams showed one
 * button. FR2 fixed the route (every runner names its artifact); this pane
 * fixes the rail. **Each entry lists that notebook's artifacts of that kind**,
 * so many decks show as many decks and many exams as many exams, each with a
 * name, a readiness and the sources it came from.
 *
 * ── Five entries, and they are data-driven ───────────────────────────────
 *
 * Four come straight from `ARTIFACT_KINDS` in the contract, in a table below.
 * Brief §1.1's rule is that a new feature is a new `kind`, and this pane keeps
 * that promise for four of the five: adding a kind to the contract adds a row
 * here, because the entries are derived from the union rather than typed out.
 *
 * **Diagnostics is the fifth and it is not an artifact kind** — it is a *view*
 * over attempts and card states, and FR6 builds it. So it is a hardcoded entry
 * that links to the overview, and it is marked as such in the table rather than
 * being quietly folded in as if it were a kind. Recorded in the plan's §6.4.
 *
 * ── Empty entries open a modal FR4 fills ─────────────────────────────────
 *
 * The plan names this as the trap: an artifact list makes you want to build the
 * generate modal, and that is FR4's. So an empty entry opens `?modal=generate`
 * with its kind, and `GenerateModalPlaceholder` says plainly that FR4 builds
 * it. A documented handoff is complete work for FR3.
 */
export function StudioPane({
  notebookId,
  sources,
}: {
  notebookId: string;
  sources: Source[] | undefined;
}) {
  const artifacts = useArtifacts(notebookId);
  const grouped = groupByKind(artifacts.data);
  const { openModal } = useModal();

  /*
   * FR4. The jobs query is what animates every `generating` row below and what
   * refetches this list when one lands — which is why FR3's `refetchInterval`
   * on `useArtifacts` is gone. Two mechanisms watching the same thing is worse
   * than either.
   */
  const jobs = useNotebookJobs(notebookId);
  const deleteArtifact = useDeleteArtifact(notebookId);
  const [pendingDelete, setPendingDelete] = useState<Artifact | null>(null);

  /*
   * Which source ids still resolve. Passed down so every row can answer "is
   * this provenance link still live?" without each of them rebuilding the set —
   * and, more importantly, so the dangling case is handled in exactly one place.
   */
  const liveSourceIds = new Set((sources ?? []).map(source => source.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <SparklesIcon className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-medium">Studio</h2>
        <ToolbarSpacer />
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-snug">
        {artifacts.isPending && <LoadingState label="Loading this notebook’s work" />}

        {artifacts.isError && (
          <ErrorState
            title="Could not load the Studio"
            detail={artifacts.error.message}
            onRetry={() => void artifacts.refetch()}
          />
        )}

        {artifacts.data && (
          <div className="flex flex-col gap-gutter">
            {/*
              What is running, what failed, and what finished with gaps — above
              the entries, because it is the thing that changed since the user
              last looked. FR4 task 2.
            */}
            <GenerationPanel
              notebookId={notebookId}
              jobs={jobs.data}
              artifacts={artifacts.data}
              onRetry={artifact => {
                /*
                 * Retry reopens the modal for that kind rather than resubmitting
                 * silently. The original request's options are not recoverable —
                 * the contract stores what was *produced*, not what was asked
                 * for — and re-running a guess at them is how a user ends up
                 * with a deck they did not order. The modal is prefilled to the
                 * defaults and the user confirms, which is one click more and no
                 * invented state.
                 */
                openModal('generate', { kind: artifact.kind });
              }}
              onDismissFailed={artifact => {
                setPendingDelete(artifact);
              }}
            />

            {STUDIO_ENTRIES.map(entry => (
              <StudioSection
                key={entry.id}
                entry={entry}
                notebookId={notebookId}
                artifacts={entry.kind ? grouped[entry.kind] : []}
                liveSourceIds={liveSourceIds}
              />
            ))}
          </div>
        )}
      </div>

      {/*
        Clearing a failed generation destroys a row, so it confirms — and by
        `modals.tsx`'s rule a confirmation stays local state rather than going
        in the URL: you can be "generating a quiz", you cannot be "about to
        confirm a delete".
      */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title="Clear this failed generation?"
        description={
          pendingDelete
            ? `“${pendingDelete.title}” never produced anything, so nothing is lost. It disappears from the Studio.`
            : ''
        }
        confirmLabel="Clear it"
        confirming={deleteArtifact.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteArtifact.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
            },
            onError: (error: unknown) => {
              setPendingDelete(null);
              toast.error('Could not clear it', {
                description: error instanceof Error ? error.message : 'Unknown error',
              });
            },
          });
        }}
      />
    </div>
  );
}

/**
 * The five entries.
 *
 * `kind` is the contract's `ArtifactKind` for the four that are one, and `null`
 * for Diagnostics, which is a view rather than a thing you generate. The null
 * is what stops a later session wiring a "generate a diagnostic" modal to a
 * kind that does not exist in the contract.
 */
type StudioEntry = {
  id: string;
  label: string;
  /**
   * The label in "+ New …". Separate from `label` because the entry's heading
   * and the verb phrase want different words: the heading is "Exam simulator",
   * which names the surface, and "+ New exam simulator" is not what a user
   * would call the thing they are about to make.
   */
  newLabel: string;
  icon: LucideIcon;
  kind: ArtifactKind | null;
  /** What the entry says when the notebook has none of these yet. */
  empty: string;
};

const STUDIO_ENTRIES: readonly StudioEntry[] = [
  {
    id: 'quiz',
    newLabel: 'quiz',
    label: 'Quiz',
    icon: FileQuestionIcon,
    kind: 'quiz',
    empty: 'Check yourself on a few questions.',
  },
  {
    id: 'deck',
    newLabel: 'cards',
    label: 'Cards',
    icon: LayersIcon,
    kind: 'deck',
    empty: 'Spaced repetition over your sources.',
  },
  {
    id: 'noteset',
    newLabel: 'note set',
    label: 'Notes',
    icon: BookOpenIcon,
    kind: 'noteset',
    empty: 'A structured summary you can read and mark off.',
  },
  {
    id: 'exam',
    newLabel: 'exam',
    label: 'Exam simulator',
    icon: ClipboardListIcon,
    kind: 'exam',
    empty: 'A timed paper, built to a blueprint.',
  },
  {
    id: 'diagnostics',
    newLabel: 'diagnostics',
    label: 'Diagnostics',
    icon: StethoscopeIcon,
    kind: null,
    empty: 'Where you are strong and where you are not.',
  },
];

function StudioSection({
  entry,
  notebookId,
  artifacts,
  liveSourceIds,
}: {
  entry: StudioEntry;
  notebookId: string;
  artifacts: Artifact[];
  liveSourceIds: ReadonlySet<string>;
}) {
  const { openModal } = useModal();
  const Icon = entry.icon;

  return (
    <section className="flex flex-col gap-tight">
      <div className="flex items-center gap-tight px-tight">
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <h3 className="text-sm font-medium">{entry.label}</h3>
        {artifacts.length > 0 && (
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {artifacts.length}
          </span>
        )}
      </div>

      {/*
        Diagnostics is a view over what the other four produced, so it links to
        FR6's overview rather than offering to generate anything.
      */}
      {entry.kind === null ? (
        <Button variant="outline" size="sm" className="justify-start" asChild>
          <Link to={notebookPath.overview(notebookId)}>{entry.empty}</Link>
        </Button>
      ) : artifacts.length === 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="text-muted-foreground justify-start font-normal"
          onClick={() => {
            openModal('generate', { kind: entry.kind ?? '' });
          }}
        >
          {entry.empty}
        </Button>
      ) : (
        <ul className="flex flex-col gap-hairline">
          {artifacts.map(artifact => (
            <li key={artifact.id}>
              <ArtifactRow
                artifact={artifact}
                notebookId={notebookId}
                liveSourceIds={liveSourceIds}
              />
            </li>
          ))}
          <li>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground w-full justify-start font-normal"
              onClick={() => {
                openModal('generate', { kind: entry.kind ?? '' });
              }}
            >
              + New {entry.newLabel}
            </Button>
          </li>
        </ul>
      )}
    </section>
  );
}

/**
 * One artifact: its title, its readiness, and where it came from.
 *
 * A `generating` or `failed` artifact is a real, listable row that is **not a
 * link** — the contract says `generating` is "greyed, unopenable", and a failed
 * one has nothing to open. Both keep their row so the user can see what
 * happened, which is the alternative to a generate button that appears to do
 * nothing.
 */
function ArtifactRow({
  artifact,
  notebookId,
  liveSourceIds,
}: {
  artifact: Artifact;
  notebookId: string;
  liveSourceIds: ReadonlySet<string>;
}) {
  const body = (
    <>
      <div className="flex items-start gap-tight">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={artifact.title}>
          {artifact.title}
        </p>
        <ReadinessBadge readiness={artifact.readiness} status={artifact.status} />
      </div>

      {/* Server-computed and rendered as received — "12 cards due". */}
      <p className="text-muted-foreground mt-hairline text-xs">
        {artifact.readiness.detail}
      </p>

      <Provenance artifact={artifact} liveSourceIds={liveSourceIds} />
    </>
  );

  const className =
    'block w-full rounded-md border p-tight text-left transition-colors';

  if (artifact.status !== 'ready') {
    return (
      <div className={`${className} bg-muted/30 text-muted-foreground`}>{body}</div>
    );
  }

  return (
    <Link to={runnerPath(notebookId, artifact)} className={`${className} hover:bg-accent`}>
      {body}
    </Link>
  );
}

/**
 * Where an artifact opens. **Every runner names its artifact** — that is FR2's
 * route change and the reason these helpers require an id (its drift row: a
 * caller with no artifact id to pass is a surface that was about to guess).
 */
function runnerPath(notebookId: string, artifact: Artifact): string {
  switch (artifact.kind) {
    case 'deck':
      return notebookPath.practice(notebookId, artifact.id);
    case 'quiz':
      return notebookPath.quiz(notebookId, artifact.id);
    case 'exam':
      return notebookPath.exam(notebookId, artifact.id);
    case 'noteset':
      return notebookPath.notes(notebookId, artifact.id);
  }
}

/**
 * What an artifact was built from — **and the dangling case, which is the point.**
 *
 * > A dangling `sourceId` is a valid state, not an error. (Brief §1.2(7).)
 *
 * Deleting a source does not delete the artifacts made from it, so an id in
 * `sourceIds` may name a source `listSources` no longer returns. The contract's
 * rule, and the one this function implements:
 *
 * > **Use `sourceIds` to *link* to a source; use `sourcesSnapshot` to *name*
 * > one.**
 *
 * So the names come from the snapshot, which is frozen at generation and never
 * dangles — every source is named whether or not it still exists. `sourceIds`
 * only decides whether a name is *live*, and a deleted one is rendered struck
 * through with a title attribute saying what happened. It is not omitted: an
 * artifact that silently drops a source from its provenance is lying about what
 * it was built from, which is exactly what the snapshot exists to prevent.
 *
 * `fixtures.ts` ships `art-deck-abx` naming `src-pharm-deleted`, which
 * `listSources` does not return, so this path renders on the very first screen
 * of the pharmacology notebook.
 */
function Provenance({
  artifact,
  liveSourceIds,
}: {
  artifact: Artifact;
  liveSourceIds: ReadonlySet<string>;
}) {
  if (artifact.sourcesSnapshot.length === 0) return null;

  const gone = artifact.sourcesSnapshot.filter(
    snapshot => !liveSourceIds.has(snapshot.sourceId),
  ).length;

  return (
    <p className="text-muted-foreground mt-hairline flex flex-wrap items-center gap-x-1 text-xs">
      {gone > 0 && (
        <TriangleAlertIcon
          className="size-3 shrink-0 text-(--color-grade-hard-mark)"
          aria-label={`${String(gone)} source${gone === 1 ? '' : 's'} deleted`}
        />
      )}
      <span className="sr-only">Built from </span>
      {artifact.sourcesSnapshot.map((snapshot, index) => {
        const live = liveSourceIds.has(snapshot.sourceId);
        return (
          <span key={snapshot.sourceId} className="min-w-0">
            <span
              className={live ? undefined : 'line-through'}
              title={live ? snapshot.title : `${snapshot.title} — deleted`}
            >
              {snapshot.title}
            </span>
            {/* Trailing, so a wrap never begins with a stray separator. */}
            {index < artifact.sourcesSnapshot.length - 1 && (
              <span aria-hidden> · </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * Readiness as a badge. `status` overrides it: an artifact still generating or
 * failed has a readiness of `none` with a detail that says which, and the badge
 * should say which too rather than showing nothing.
 */
function ReadinessBadge({
  readiness,
  status,
}: {
  readiness: Readiness;
  status: Artifact['status'];
}) {
  if (status === 'generating') return <Badge variant="secondary">Generating</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (readiness.state === 'none') return null;
  return (
    <Badge variant={readiness.state === 'ready' ? 'default' : 'secondary'}>
      {readiness.state === 'ready' ? 'Ready' : 'In progress'}
    </Badge>
  );
}
