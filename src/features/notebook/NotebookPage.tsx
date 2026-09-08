import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeftIcon, SettingsIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MEDIA_WIDE,
  Page,
  Pane,
  PaneGroup,
  PaneHandle,
  useMediaQuery,
} from '@/components/layout';
import { ErrorState, LoadingState } from '@/components/states';
import { AccountMenu } from '@/app/AccountMenu';
import { useModal } from '@/app/modals';
import { notebookPath } from '@/lib/notebooks';
import { AddSourceModal } from './AddSourceModal';
import { ChatPane } from './ChatPane';
import { GenerateModal } from './GenerateModal';
import { NotebookSettingsModal } from './NotebookSettingsModal';
import { SourcesPane } from './SourcesPane';
import { StudioPane } from './StudioPane';
import { useNotebook, useSources } from './queries';

/**
 * The notebook — sources, chat, Studio. FR3, brief §3.3.
 *
 * ═══ The shape, and the one rule behind it ═══════════════════════════════
 *
 * > **Every screen answers "which notebook?" from the route, never from a
 * > heuristic.**
 *
 * `notebookId` comes from the path and is passed to every pane and every hook.
 * Nothing here infers a notebook, and nothing here can create one — which is
 * the fix for the behaviour the audit called the worst it found, where the only
 * enabled call to action on a notebook navigated away and made a *new* one.
 *
 * ── Three panes above tablet, three tabs below. §6.1. ────────────────────
 *
 * Three resizable panes do not fit at 375px — the sources rail alone wants
 * ~240px, and DS4b's mobile pass found real horizontal-scroll defects on
 * screens far simpler than this one. The options were a drawer, tabs, or a
 * documented desktop-only stance. **Tabs, below `md`:**
 *
 * - A **drawer** hides two of the three surfaces behind a control the user has
 *   to discover, and this screen's whole argument is that the three belong
 *   together and visible. A drawer would make Studio — the answer to "where did
 *   this exam come from?" — the thing you have to go looking for.
 * - **Desktop-only** is a real option and the honest one for a timed exam,
 *   which is why the runners take the viewport. But adding a source and reading
 *   a note are exactly the things a student does on a phone between lectures,
 *   and refusing them is a bigger loss than a layout compromise.
 * - **Tabs** keep all three reachable in one tap, cost nothing above `md`, and
 *   the pane contents are already list-shaped columns that reflow to one
 *   column without changes.
 *
 * Both branches render the same three components with the same props, so there
 * is one implementation of each pane and no mobile fork to keep in step.
 *
 * ── Selection lives here ─────────────────────────────────────────────────
 *
 * Which sources ground a chat answer is chosen in the left pane and used in the
 * centre one, so it is state in the shell that owns both. `AskInput.sourceIds`
 * empty means "every ready source" — the contract's comment calls that a choice
 * the UI makes explicit rather than a default the server invents — so the chat
 * pane is told the ready count too, and says which it is using.
 */
export function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();

  /*
   * A route param is a string from the URL bar. React Router guarantees the
   * segment exists to have matched this route, but not that it names anything,
   * so the loaded state below is where a bad id becomes an error — not here.
   */
  if (notebookId === undefined) {
    return (
      <Page width="full">
        <ErrorState title="No notebook named" detail="This URL is missing a notebook." />
      </Page>
    );
  }

  return <NotebookShell notebookId={notebookId} />;
}

function NotebookShell({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId);
  const sources = useSources(notebookId);
  const { openModal } = useModal();

  /*
   * The grounding selection. A `Set` of ids rather than the sources themselves:
   * the list is refetched (it polls while a source is processing), and holding
   * objects would mean holding stale copies of rows that have since changed
   * status.
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const toggleSource = (sourceId: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (!next.delete(sourceId)) next.add(sourceId);
      return next;
    });
  };

  /* Which layout is mounted. See the branch below for why this is not CSS. */
  const wide = useMediaQuery(MEDIA_WIDE);

  const readySourceCount = (sources.data ?? []).filter(
    source => source.status === 'ready',
  ).length;

  if (notebook.isError) {
    return (
      <div className="flex min-h-dvh flex-col">
        <NotebookHeader notebookId={notebookId} title="Notebook" />
        <div className="p-gutter">
          <ErrorState
            title="Could not open this notebook"
            detail={notebook.error.message}
            onRetry={() => void notebook.refetch()}
          />
        </div>
      </div>
    );
  }

  const panes = {
    sources: (
      <SourcesPane
        notebookId={notebookId}
        selectedIds={selectedIds}
        onToggleSource={toggleSource}
      />
    ),
    chat: (
      <ChatPane
        notebookId={notebookId}
        selectedIds={selectedIds}
        readySourceCount={readySourceCount}
      />
    ),
    studio: <StudioPane notebookId={notebookId} sources={sources.data} />,
  };

  return (
    <div className="flex h-dvh flex-col">
      <NotebookHeader
        notebookId={notebookId}
        title={notebook.data?.title ?? 'Notebook'}
        pending={notebook.isPending}
        onSettings={() => {
          openModal('notebook-settings');
        }}
      />

      {/*
        ── One branch is mounted, not both ───────────────────────────────

        The obvious implementation is `md:hidden` on the tabs and `hidden
        md:block` on the panes, and it is wrong in two ways that a browser found
        in one screenshot:

        1. **`PaneGroup` ignores a `hidden` passed to it.**
           `ResizablePanelGroup` hardcodes `flex` in its own `cn(...)`, and
           tailwind-merge treats `hidden` as the same conflict group, so the
           caller's class loses and *both layouts render at once* — the tabs
           above a three-pane shell crushed into 375px.
        2. **CSS hiding still mounts.** Even with a wrapper div fixing (1),
           both branches stay in the DOM: three `SourcesPane`s exist, every
           list renders twice, and every query has two subscribers.

        So the branch is chosen in JS from a media query. That costs a listener
        and one render on crossing the breakpoint, and buys exactly one mounted
        copy of each pane. `useSyncExternalStore` rather than an effect, so the
        first paint already has the right answer instead of flashing the mobile
        layout on a desktop.
      */}
      {wide ? (
        /*
          `autoSaveId` persists the drag, which FR1's `PaneGroup` comment calls
          the feature that makes a resizable shell worth having — a pane that
          resets on every visit is worse than one that does not move.

          The minimums are not decoration: below ~15% the sources rail truncates
          every title to nothing, and the centre pane is where the reading
          happens, so it keeps the largest share by default.
        */
        <PaneGroup autoSaveId="notebook-panes" className="min-h-0 flex-1">
          <Pane defaultSize={22} minSize={15} className="border-r">
            {panes.sources}
          </Pane>
          <PaneHandle />
          <Pane defaultSize={52} minSize={30}>
            {panes.chat}
          </Pane>
          <PaneHandle />
          <Pane defaultSize={26} minSize={18} className="border-l">
            {panes.studio}
          </Pane>
        </PaneGroup>
      ) : (
        <Tabs
          defaultValue="sources"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-snug mt-snug">
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="studio">Studio</TabsTrigger>
          </TabsList>
          <TabsContent value="sources" className="min-h-0 flex-1">
            {panes.sources}
          </TabsContent>
          <TabsContent value="chat" className="min-h-0 flex-1">
            {panes.chat}
          </TabsContent>
          <TabsContent value="studio" className="min-h-0 flex-1">
            {panes.studio}
          </TabsContent>
        </Tabs>
      )}

      {/*
        The modals this notebook can be in the middle of. Mounted once here
        rather than inside a pane: `?modal=add-source` must restore on a pasted
        URL, and a modal mounted inside a tab would only exist when that tab is
        the selected one.
      */}
      <AddSourceModal notebookId={notebookId} />
      <NotebookSettingsModal notebookId={notebookId} />
      <GenerateModal notebookId={notebookId} />
    </div>
  );
}

/**
 * The notebook's own header.
 *
 * It is not `AppShell`'s. FR2's route table puts the notebook outside that
 * frame deliberately — a header above a header would cost the panes the
 * vertical space they exist for — so this is the thinner one, carrying the way
 * back to home, the notebook's name, and its settings.
 */
function NotebookHeader({
  notebookId,
  title,
  pending = false,
  onSettings,
}: {
  notebookId: string;
  title: string;
  pending?: boolean;
  onSettings?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-tight border-b px-snug">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Back to home">
        <Link to={notebookPath.home()}>
          <ChevronLeftIcon aria-hidden />
        </Link>
      </Button>

      {pending ? (
        <LoadingState lines={1} className="w-48" label="Loading the notebook" />
      ) : (
        <h1 className="truncate font-serif text-lg" title={title}>
          {title}
        </h1>
      )}

      <div className="flex-1" />

      {/*
        The overview is FR6's, and the link is here because this header is the
        only place that can carry it — it is a view *of this notebook*, so by
        the rule in `AppShell` it can never live in a global nav.
      */}
      <Button variant="ghost" size="sm" asChild>
        <Link to={notebookPath.overview(notebookId)}>Overview</Link>
      </Button>

      {onSettings && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Notebook settings"
          onClick={onSettings}
        >
          <SettingsIcon aria-hidden />
        </Button>
      )}

      <AccountMenu />
    </header>
  );
}
