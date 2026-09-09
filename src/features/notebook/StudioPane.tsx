import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BookOpenIcon,
  ClipboardListIcon,
  FileQuestionIcon,
  LayersIcon,
  PlayIcon,
  SparklesIcon,
  StethoscopeIcon,
  type LucideIcon,
} from 'lucide-react';

import { Toolbar, ToolbarSpacer } from '@/components/layout';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import type { Artifact, ArtifactKind } from '@/lib/api';
import { notebookPath } from '@/lib/notebooks';
import { useModal } from '@/app/modals';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GenerationPanel } from './GenerationPanel';
import { useNotebookJobs } from './jobs';
import { useArtifacts, useDeleteArtifact } from './queries';

/**
 * The right pane: what you can make, and what you have made.
 *
 * ═══ Two regions, not five sections ══════════════════════════════════════
 *
 * FR3 built this as one section per kind — a heading, then that kind's
 * artifacts, then "+ New quiz". It kept the promise that many exams show as
 * many exams, but it interleaved two different questions on one surface:
 * *what can I generate?* and *what do I have?* With five headings the answer
 * to the first was spread down the pane, each occurrence a different width,
 * and the answer to the second was cut into five lists that never sorted
 * against each other.
 *
 * So the pane now separates them:
 *
 * - **A grid of generators**, one tile per thing that can be made. Every tile
 *   opens the generate modal. This is the whole "what can I make" answer, in
 *   one glance, at one size.
 * - **A flat list of artifacts** below it, newest first, every kind together.
 *   Each row carries its own kind label, so nothing is lost by dropping the
 *   per-kind headings — and a notebook's work now reads in the order it was
 *   made rather than in the order the kinds happen to be declared.
 *
 * The grid is still derived from `ARTIFACT_KINDS` in the contract, which is
 * brief §1.1's rule: a new kind is a new tile without editing a layout.
 *
 * ── Readiness is a sentence, not a tag ───────────────────────────────────
 *
 * Rows no longer render a `ReadinessBadge`. A "Ready" chip on every finished
 * artifact is a column of identical green — it distinguishes nothing, because
 * *finished* is the normal state of a list of finished things. What a user
 * actually wants off a glance is the state they are in: "never sat", "3 of 8
 * questions unsat", "12 cards due". That is `readiness.detail`, already
 * computed and counted server-side, and it now carries the row on its own.
 *
 * The badge component still exists for home and the overview, which list
 * *notebooks* — a roll-up across artifacts, where a state chip does earn its
 * place. See `artifact-bits.tsx`.
 *
 * **Loading gets its own format when the time comes.** A `generating` row is
 * currently a plain dimmed row saying so; the progress surface is
 * `GenerationPanel` above. Deliberately not a spinner-per-row — the contract
 * cannot say which artifact a running job is building (`Job.result` is
 * populated only on success), which is written up in `GenerationPanel`.
 */
export function StudioPane({ notebookId }: { notebookId: string }) {
  const artifacts = useArtifacts(notebookId);
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
   * Newest first. The list is flat across kinds now, so it needs an order of
   * its own: creation time is the one every kind shares and the one that
   * matches what a user is looking for after a generation lands.
   */
  const ordered = [...(artifacts.data ?? [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

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
            <GeneratorGrid notebookId={notebookId} />

            {/*
              What is running, what failed, and what finished with gaps — above
              the list and below the grid, because it is the bridge between
              them: it reports on what the grid just started. FR4 task 2.
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

            {/*
              `mt-base` on top of the container's `gap-gutter`. The grid and
              the list answer two different questions — what can I make, what
              have I made — and at one uniform gap they read as one continuous
              stack of tiles. The extra step is what separates them.
            */}
            <section className="mt-base flex flex-col gap-tight">
              <div className="flex items-center gap-tight px-tight">
                <h3 className="text-sm font-medium">Artifacts</h3>
                {ordered.length > 0 && (
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {ordered.length}
                  </span>
                )}
              </div>

              {ordered.length === 0 ? (
                <EmptyState
                  title="Nothing generated yet"
                  description="Pick something above and it will appear here."
                />
              ) : (
                <ul className="flex flex-col gap-hairline">
                  {ordered.map(artifact => (
                    <li key={artifact.id}>
                      <ArtifactRow
                        artifact={artifact}
                        notebookId={notebookId}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
 * What this notebook can make.
 *
 * `kind` is the contract's `ArtifactKind` for the four that are one, and `null`
 * for Diagnostics, which is a *view* over attempts and card states rather than
 * a thing you generate — FR6 builds it, and it links to the overview. The null
 * is what stops a later session wiring a "generate a diagnostic" modal to a
 * kind that does not exist in the contract. Recorded in the plan's §6.4.
 */
type Generator = {
  id: string;
  label: string;
  icon: LucideIcon;
  kind: ArtifactKind | null;
  /** One line under the label, saying what the thing is for. */
  blurb: string;
};

const GENERATORS: readonly Generator[] = [
  {
    id: 'quiz',
    label: 'Quiz',
    icon: FileQuestionIcon,
    kind: 'quiz',
    blurb: 'A few questions to check yourself',
  },
  {
    id: 'deck',
    label: 'Cards',
    icon: LayersIcon,
    kind: 'deck',
    blurb: 'Spaced repetition over your sources',
  },
  {
    id: 'noteset',
    label: 'Notes',
    icon: BookOpenIcon,
    kind: 'noteset',
    blurb: 'A structured summary to read and mark off',
  },
  {
    id: 'exam',
    label: 'Exam',
    icon: ClipboardListIcon,
    kind: 'exam',
    blurb: 'A timed paper, built to a blueprint',
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: StethoscopeIcon,
    kind: null,
    blurb: 'Where you are strong and where you are not',
  },
];

/**
 * The grid. Two columns, because the Studio is a 26%-wide pane that resizes
 * down to 18% — three would put four words on four lines.
 */
function GeneratorGrid({ notebookId }: { notebookId: string }) {
  return (
    <section className="flex flex-col gap-tight">
      <h3 className="px-tight text-sm font-medium">Create</h3>
      <ul className="grid grid-cols-2 gap-hairline">
        {GENERATORS.map(generator => (
          <li key={generator.id} className="min-w-0">
            <GeneratorTile generator={generator} notebookId={notebookId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GeneratorTile({
  generator,
  notebookId,
}: {
  generator: Generator;
  notebookId: string;
}) {
  const { openModal } = useModal();
  const Icon = generator.icon;

  const body = (
    <>
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="mt-hairline block truncate text-sm font-medium">
        {generator.label}
      </span>
      <span className="text-muted-foreground mt-hairline block text-xs leading-snug">
        {generator.blurb}
      </span>
    </>
  );

  const className =
    'hover:bg-accent flex h-full w-full flex-col rounded-md border p-tight text-left transition-colors';

  /*
   * Diagnostics is a view over what the other four produced, so it navigates
   * rather than offering to generate anything.
   */
  if (generator.kind === null) {
    return (
      <Link to={notebookPath.overview(notebookId)} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        openModal('generate', { kind: generator.kind ?? '' });
      }}
    >
      {body}
    </button>
  );
}

/**
 * One artifact: what kind it is, what state you are in with it, and its title.
 *
 * A `generating` or `failed` artifact is a real, listable row that is **not a
 * link** — the contract says `generating` is "greyed, unopenable", and a failed
 * one has nothing to open. Both keep their row so the user can see what
 * happened, which is the alternative to a generate button that appears to do
 * nothing.
 *
 * ── No provenance here, and where it went instead ────────────────────────
 *
 * These rows used to carry a `Provenance` line naming the sources each
 * artifact was built from. In a rail this narrow it was a third line of small
 * grey text under every row, and it pushed the thing you came for — the title
 * and its state — into a denser column.
 *
 * **The dangling-source rule it implemented has not been dropped**, it has
 * moved: `Provenance` still lives in `artifact-bits.tsx` and still renders on
 * FR6's overview, where a row is wide enough to carry it and where "where did
 * this exam come from?" is the question actually being asked. The Studio
 * answers "what have I got, and what do I do next?"
 */
function ArtifactRow({
  artifact,
  notebookId,
}: {
  artifact: Artifact;
  notebookId: string;
}) {
  /*
   * ── Two lines, and the button only sits beside the second ──────────────
   *
   * Kind and state get a full-width line to themselves; the title and the
   * play button share the line below it.
   *
   * The alternative — one text column with the button beside all of it — makes
   * the button's height the row's height, and the state tag ends up indented
   * out of the space the button reserves. The state is the thing the eye runs
   * down a mixed list looking for, so it gets the clean right edge, and the
   * button reserves vertical space only on the line it actually occupies.
   */
  const body = (
    <>
      {/*
        `readiness.detail` is server-computed and rendered as received: "Not
        sat", "3 of 8 questions unsat", "12 cards due".
      */}
      <div className="text-muted-foreground flex items-baseline gap-tight text-xs">
        <span className="shrink-0 font-medium tracking-wide uppercase">
          {KIND_LABELS[artifact.kind]}
        </span>
        <span className="ml-auto min-w-0 truncate text-right">
          {artifact.readiness.detail}
        </span>
      </div>

      <div className="mt-hairline flex items-center gap-tight">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={artifact.title}>
          {artifact.title}
        </p>
        {artifact.status === 'ready' && (
          /*
           * Deliberately not a nested interactive element — a `<button>` inside
           * an `<a>` is invalid HTML and gives one destination two tab stops.
           * It is a styled `<span>`, so the row stays one link and one tab
           * stop while the glyph says where that link goes: away from the
           * notebook, into a full-screen runner.
           */
          <PlayIcon
            className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
            aria-hidden
          />
        )}
      </div>
    </>
  );

  const className = 'block w-full rounded-md border p-tight text-left transition-colors';

  if (artifact.status !== 'ready') {
    return <div className={`${className} bg-muted/30 text-muted-foreground`}>{body}</div>;
  }

  return (
    <Link
      to={runnerPath(notebookId, artifact)}
      className={`${className} hover:bg-accent group`}
    >
      {body}
    </Link>
  );
}

/**
 * What a kind is called in a row.
 *
 * Keyed by `ArtifactKind` rather than derived from `GENERATORS`, so it is a
 * total map the compiler checks: a fifth kind added to the contract fails to
 * typecheck here until it is named, which is the failure you want.
 */
const KIND_LABELS: Record<ArtifactKind, string> = {
  deck: 'Cards',
  quiz: 'Quiz',
  noteset: 'Notes',
  exam: 'Exam',
};

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
