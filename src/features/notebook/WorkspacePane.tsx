import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3Icon,
  LayersIcon,
  LibraryIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Toolbar, ToolbarSpacer } from '@/components/layout';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useModal } from '@/app/modals';
import { notebookPath } from '@/lib/notebooks';
import { DeckBody } from '@/features/cards/DeckBody';
import { useArtifact } from '@/features/study/queries';
import { SourceBody } from './SourceBody';
import { useNotebook, useSources } from './queries';
import { useWorkspace } from './workspace';

/**
 * The centre pane: **whatever is selected.**
 *
 * ═══ What this replaces, and why ═════════════════════════════════════════
 *
 * The centre used to be chat, at 52% of the notebook, and ROADMAP.md priority 1
 * calls that the layout's central mistake: *the most transient pane owned the
 * most screen.* Chat is `useState([])`, resets on navigation, and has never
 * answered a real question, because no embedding key was ever supplied. The
 * study material — the reason the product exists — was cramped into a quarter.
 *
 * So the centre now shows the thing you are working on: a source you are
 * reading, a deck you are editing, or the notebook itself. Chat moved to a
 * sheet you open when you want it (`ChatSheet`), which is the surface that
 * suits something ephemeral.
 *
 * ── It renders bodies, not pages ─────────────────────────────────────────
 *
 * Both things this pane can show already existed as full-screen surfaces, and
 * neither is re-implemented here. `SourceBody` was split from its sheet by the
 * session that built it, for exactly this moment; `DeckBody` was split out of
 * `DeckBrowser`'s `FocusFrame` by this one. Each takes ids, reads its own data
 * and owns no layout, so one component renders in a pane and on its own route
 * with no forked copy to keep in step.
 *
 * ── The resting state is a summary, not the overview page ────────────────
 *
 * `/overview` is a wide analytics dashboard — eight queries, a year-long
 * heatmap, retention curves, topic mastery. It is built for a full-width page
 * and it stays on one. Mounting it here would fire eight aggregate queries
 * every time a notebook opens, to render a 365-bucket heatmap into a 40%
 * column, which is a worse version of both screens.
 *
 * What the roadmap actually asks for is navigational: the Overview was
 * reachable *only* through a tile labelled "Diagnostics" buried in the Studio
 * grid, which is why it was never found. That is fixed by giving it a real,
 * named link — here and in the notebook header — rather than by inlining the
 * page. The resting state is instead the cheap summary `Notebook.counts`
 * already carries, which costs no query this shell was not already making.
 */
export function WorkspacePane({ notebookId }: { notebookId: string }) {
  const { view, show } = useWorkspace();

  const deselect = () => {
    show({ kind: 'overview' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {view.kind === 'overview' && <NotebookHome notebookId={notebookId} />}
      {view.kind === 'source' && (
        <SelectedSource notebookId={notebookId} sourceId={view.id} onClose={deselect} />
      )}
      {view.kind === 'deck' && (
        <SelectedDeck notebookId={notebookId} deckId={view.id} onClose={deselect} />
      )}
    </div>
  );
}

/**
 * The toolbar every selected thing shares: what is open, and the way back.
 *
 * One component rather than a bar per view, for the reason `FocusFrame` is one
 * component: three hand-rolled variations of the same strip is how an app stops
 * looking like one product.
 */
function WorkspaceToolbar({
  icon,
  title,
  actions,
  onClose,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Toolbar>
      {icon}
      <h2 className="min-w-0 truncate text-sm font-medium" title={title}>
        {title}
      </h2>
      <ToolbarSpacer />
      {actions}
      {/*
        Closing returns to the notebook summary rather than navigating away —
        the workspace always shows something, so there is no empty state to
        close into. A button and not a link, because it means "deselect": a
        change to what this pane shows, not a destination.
      */}
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
        <XIcon aria-hidden />
      </Button>
    </Toolbar>
  );
}

/**
 * A source, open in the workspace.
 *
 * The id comes from the URL, so it can name a source that was deleted, one that
 * belongs to another notebook, or nothing at all. `useSources` is already
 * loaded by the shell — the rail lists it — so resolving against that list
 * costs no extra request, and a miss is reported rather than rendered as an
 * empty reader.
 */
function SelectedSource({
  notebookId,
  sourceId,
  onClose,
}: {
  notebookId: string;
  sourceId: string;
  onClose: () => void;
}) {
  const sources = useSources(notebookId);
  const source = sources.data?.find(candidate => candidate.id === sourceId);

  if (sources.isPending) {
    return (
      <div className="p-gutter">
        <LoadingState label="Loading this source" />
      </div>
    );
  }

  if (sources.isError) {
    return (
      <div className="p-gutter">
        <ErrorState
          title="Could not load this source"
          detail={sources.error.message}
          onRetry={() => void sources.refetch()}
        />
      </div>
    );
  }

  if (!source) {
    return (
      <>
        <WorkspaceToolbar
          icon={<LibraryIcon className="text-muted-foreground size-4" aria-hidden />}
          title="Source not found"
          onClose={onClose}
        />
        <div className="p-gutter">
          <EmptyState
            icon={<LibraryIcon />}
            title="That source is not in this notebook"
            description="It may have been deleted, or the link may name a source from somewhere else."
            action={<Button onClick={onClose}>Back to the notebook</Button>}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <WorkspaceToolbar
        icon={<LibraryIcon className="text-muted-foreground size-4" aria-hidden />}
        title={source.title}
        onClose={onClose}
      />
      {/*
        `SourceBody` reads its own content and owns no layout — it was written
        that way to be moved here. The padding and the height are the pane's
        job, which is why they are on this wrapper and not inside it.
      */}
      <div className="p-snug flex min-h-0 flex-1 flex-col">
        <SourceBody notebookId={notebookId} source={source} />
      </div>
    </>
  );
}

/**
 * A deck's cards, open in the workspace.
 *
 * **The URL names the deck** (`?view=deck&item=<id>`), which is not a detail:
 * every runner route names its artifact because a route that read `:notebookId`
 * and treated it as a deck id once served one notebook's session every
 * notebook's cards. A deck openable without an address would be that bug's
 * shape again, so this pane refuses to have one.
 */
function SelectedDeck({
  notebookId,
  deckId,
  onClose,
}: {
  notebookId: string;
  deckId: string;
  onClose: () => void;
}) {
  const artifact = useArtifact(notebookId, deckId);

  /*
   * A deck the id does not name gets the same treatment a missing source gets,
   * and for the same reason: the toolbar is outside `DeckBody`'s own guards, so
   * without this it keeps the title "Cards" and — worse — keeps offering
   * "Practise" and "Full screen" as live links **into the deck that is not
   * there.** Found by opening `?view=deck&item=<made up>` in a browser, where
   * the body said "Could not load this deck" while the header above it offered
   * two ways to navigate deeper into nothing.
   *
   * `isError` rather than `!artifact.data`: while the query is still pending
   * there is nothing to report yet, and `DeckBody` renders the skeletons.
   */
  if (artifact.isError) {
    return (
      <>
        <WorkspaceToolbar
          icon={<LayersIcon className="text-muted-foreground size-4" aria-hidden />}
          title="Deck not found"
          onClose={onClose}
        />
        <div className="p-gutter">
          <EmptyState
            icon={<LayersIcon />}
            title="That deck is not in this notebook"
            description="It may have been deleted, or the link may name a deck from somewhere else."
            action={<Button onClick={onClose}>Back to the notebook</Button>}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <WorkspaceToolbar
        icon={<LayersIcon className="text-muted-foreground size-4" aria-hidden />}
        title={artifact.data?.title ?? 'Cards'}
        onClose={onClose}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link to={notebookPath.practice(notebookId, deckId)}>
                <PlayIcon aria-hidden />
                Practise
              </Link>
            </Button>
            {/*
              The full-screen browser is kept and linked rather than replaced:
              editing a deck of two hundred cards wants the width, and the route
              is what a bookmark or a shared link already points at.
            */}
            <Button variant="ghost" size="sm" asChild>
              <Link to={notebookPath.cards(notebookId, deckId)}>Full screen</Link>
            </Button>
          </>
        }
      />
      <div className="p-snug min-h-0 flex-1 overflow-y-auto">
        <DeckBody notebookId={notebookId} deckId={deckId} />
      </div>
    </>
  );
}

/**
 * The resting state: what this notebook is, and what to do with it next.
 *
 * Everything here is `Notebook.counts` and `Notebook.readiness` — both
 * server-computed, both already fetched by the shell's own `useNotebook`.
 * Nothing is recomputed on the client, which is the rule the overview and home
 * follow and the reason those two cannot disagree.
 */
function NotebookHome({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId);
  const { openModal } = useModal();

  if (notebook.isPending) {
    return (
      <div className="p-gutter">
        <LoadingState lines={3} label="Loading this notebook" />
      </div>
    );
  }

  if (notebook.isError) {
    return (
      <div className="p-gutter">
        <ErrorState
          title="Could not load this notebook"
          detail={notebook.error.message}
          onRetry={() => void notebook.refetch()}
        />
      </div>
    );
  }

  const { counts, readiness, title, description } = notebook.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="gap-section p-gutter mx-auto flex w-full max-w-2xl flex-col">
        <div className="gap-tight flex flex-col">
          <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
          {description !== null && (
            <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
          )}
          {/* `readiness.detail` is server-computed and rendered as received. */}
          <p className="text-muted-foreground text-sm">{readiness.detail}</p>
        </div>

        {counts.sources === 0 ? (
          /*
            A notebook with no sources can do nothing at all — everything else
            is generated *from* sources — so this says that and offers the one
            act that changes it, rather than showing three zeroes.
          */
          <EmptyState
            icon={<LibraryIcon />}
            title="This notebook is empty"
            description="Add a document, some text or a link. Everything this notebook can generate is built from its sources."
            action={
              <Button
                onClick={() => {
                  openModal('add-source');
                }}
              >
                <PlusIcon aria-hidden />
                Add source
              </Button>
            }
          />
        ) : (
          <>
            <dl className="gap-tight grid grid-cols-3">
              <Stat label={counts.sources === 1 ? 'source' : 'sources'} value={counts.sources} />
              <Stat
                label={counts.artifacts === 1 ? 'artifact' : 'artifacts'}
                value={counts.artifacts}
              />
              <Stat label="due now" value={counts.dueCards} />
            </dl>

            {/*
              The two things a user opening a notebook actually wants: make
              something, or see where they stand. Both were previously reachable
              only by hunting through the Studio rail.
            */}
            <div className="gap-tight flex flex-wrap">
              <Button
                onClick={() => {
                  openModal('generate');
                }}
              >
                <SparklesIcon aria-hidden />
                Generate
              </Button>
              {/*
                ── The Overview gets a real link ──────────────────────────

                It was reachable only through a tile labelled "Diagnostics"
                buried in the Studio grid, which is why it was never found. It
                is named here and in the notebook header, in the words the
                product uses for it.
              */}
              <Button variant="outline" asChild>
                <Link to={notebookPath.overview(notebookId)}>
                  <BarChart3Icon aria-hidden />
                  Overview and diagnostics
                </Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="gap-hairline p-snug flex flex-col rounded-md border">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
