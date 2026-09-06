import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRails, type RailKey } from './use-rails';

/**
 * The three-pane notebook shell: sources, workspace, studio.
 *
 * ── Why three panes, and why the studio is a launcher ─────────────────────
 *
 * The shape is NotebookLM's, because that is what the owner asked for and
 * because it is the right shape for source-grounded work: what you are studying
 * stays visible while you work on it, instead of being a thing you uploaded once
 * and can no longer see.
 *
 * The one deliberate divergence is what the right rail *does*. In NotebookLM the
 * studio holds its artifacts — an audio overview plays in the panel, a study
 * guide renders in it — because those artifacts are derived views with no life
 * of their own. Ours are not. A card carries FSRS state for months and an exam
 * attempt is a durable record, and a timed exam rendered into a 380px column is
 * a worse exam than one that owns the screen. So the studio **launches** full
 * routes rather than containing them (P11 §2), and that is the line where the
 * clone stops.
 *
 * ── The rails are collapsible because reading is the point ────────────────
 *
 * Three columns on a 1280px laptop leaves the middle one about 520px wide, which
 * is a fine width for chat and a poor one for reading a lecture PDF. Both rails
 * collapse, and the state persists per rail — a user who reads with the sources
 * rail shut should not have to shut it again on every notebook.
 *
 * The persistence itself lives in `use-rails.ts`; see that file for why it is
 * defensive about `localStorage`.
 */

/**
 * A rail heading. Its own component only so the two rails cannot drift apart —
 * they are visually identical and a divergence would read as a bug.
 */
function RailHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </h2>
      {action}
    </div>
  );
}

export type NotebookLayoutProps = {
  /** Rendered above the three panes: notebook title, breadcrumb, account. */
  header: ReactNode;
  sources: ReactNode;
  workspace: ReactNode;
  studio: ReactNode;
  /** Slot for a rail-level action, e.g. "Add source". */
  sourcesAction?: ReactNode;
};

export function NotebookLayout({
  header,
  sources,
  workspace,
  studio,
  sourcesAction,
}: NotebookLayoutProps) {
  const { open, toggle } = useRails();

  /*
   * Below `lg` the rails become overlays rather than columns — three columns on
   * a phone is one column of confetti. They are closed by default there, which
   * is why the drawer state is tracked separately from the desktop rail state:
   * a user who collapsed the sources rail on a laptop has not thereby expressed
   * an opinion about what a phone should do.
   */
  const [drawer, setDrawer] = useState<RailKey | null>(null);

  const closeDrawer = useCallback(() => setDrawer(null), []);

  // Escape closes the drawer. The panes behind it stay in the DOM but are
  // hidden at this breakpoint, so there is nothing focusable behind the scrim.
  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawer, closeDrawer]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {header}

      <div className="flex min-h-0 flex-1">
        {/* ── Sources rail ─────────────────────────────────────────────── */}
        <aside
          className={cn(
            'bg-card hidden shrink-0 flex-col border-r transition-[width] duration-200 lg:flex',
            open.sources ? 'w-72' : 'w-0 overflow-hidden border-r-0',
          )}
          aria-label="Sources"
        >
          <RailHeader title="Sources" action={sourcesAction} />
          <div className="min-h-0 flex-1 overflow-y-auto">{sources}</div>
        </aside>

        {/* ── Workspace ────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/*
            The rail toggles live over the workspace rather than inside the
            rails, because a control that hides a panel cannot live inside the
            panel it hides — there would be no way back.
          */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b px-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex"
                onClick={() => toggle('sources')}
                aria-pressed={open.sources}
              >
                <PanelLeftIcon className="size-4" aria-hidden />
                <span className="sr-only">
                  {open.sources ? 'Hide sources' : 'Show sources'}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setDrawer('sources')}
              >
                <PanelLeftIcon className="size-4" aria-hidden />
                <span className="sr-only">Show sources</span>
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="hidden lg:inline-flex"
                onClick={() => toggle('studio')}
                aria-pressed={open.studio}
              >
                <PanelRightIcon className="size-4" aria-hidden />
                <span className="sr-only">
                  {open.studio ? 'Hide studio' : 'Show studio'}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setDrawer('studio')}
              >
                <PanelRightIcon className="size-4" aria-hidden />
                <span className="sr-only">Show studio</span>
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{workspace}</div>
        </main>

        {/* ── Studio rail ──────────────────────────────────────────────── */}
        <aside
          className={cn(
            'bg-card hidden shrink-0 flex-col border-l transition-[width] duration-200 lg:flex',
            open.studio ? 'w-80' : 'w-0 overflow-hidden border-l-0',
          )}
          aria-label="Studio"
        >
          <RailHeader title="Studio" />
          <div className="min-h-0 flex-1 overflow-y-auto">{studio}</div>
        </aside>
      </div>

      {/* ── Mobile drawers ───────────────────────────────────────────────── */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={closeDrawer}
            aria-label="Close"
          />
          <div
            className={cn(
              'bg-card absolute inset-y-0 flex w-80 max-w-[85vw] flex-col shadow-xl',
              drawer === 'sources' ? 'left-0 border-r' : 'right-0 border-l',
            )}
            role="dialog"
            aria-modal="true"
            aria-label={drawer === 'sources' ? 'Sources' : 'Studio'}
          >
            <RailHeader
              title={drawer === 'sources' ? 'Sources' : 'Studio'}
              action={
                <Button variant="ghost" size="sm" onClick={closeDrawer}>
                  Close
                </Button>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {drawer === 'sources' ? sources : studio}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
