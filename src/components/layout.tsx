import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import { cn } from '@/lib/utils';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

/**
 * The layout vocabulary — six components, so no screen hand-rolls padding again.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * Before FR1 every screen opened with its own wrapper: `max-w-xl space-y-6` on
 * Settings, something else on the dashboard, something else again on the
 * blueprint. None of them was wrong, and no two agreed — which is why the app
 * read as several products. Brief §3.6 asks for a vocabulary instead: a screen
 * *chooses* a shape rather than describing one.
 *
 * Spacing here comes from the `--space-*` tokens, so "the gap between sections"
 * is a decision made once in `globals.css` rather than a `space-y-6` typed into
 * forty files.
 *
 * ── What FR2 gets ─────────────────────────────────────────────────────────
 *
 * `PaneGroup` / `Pane` are the three-pane shell's substrate, `Rail` is the
 * fixed-width column beside it, `Toolbar` is the strip at the top of a pane.
 * The handoff in the FR1 plan lists the props; this is the source of truth.
 */

/* ── Page ─────────────────────────────────────────────────────────────── */

/**
 * A whole screen's frame: the max width, the page padding, the vertical rhythm.
 *
 * `width` is the one decision a screen makes here, and the names are about
 * content rather than pixels:
 *
 *   prose   a single column meant to be read or filled in. Settings, a form.
 *   wide    a dashboard or a grid. Multiple columns of cards.
 *   full    edge to edge, no max width. The three-pane shell, a runner.
 *
 * `full` also drops the page padding, because a pane group manages its own.
 */
export function Page({
  width = 'wide',
  className,
  children,
}: {
  width?: 'prose' | 'wide' | 'full';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="page"
      className={cn(
        'flex flex-col gap-section',
        width === 'prose' && 'mx-auto w-full max-w-xl px-gutter py-gutter',
        width === 'wide' && 'mx-auto w-full max-w-6xl px-gutter py-gutter',
        width === 'full' && 'h-full w-full',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A page's own heading block: the title, an optional sentence under it, and
 * the actions that belong to the whole screen.
 *
 * The title is the one place per screen the serif face is allowed — that is
 * the typography rule, and putting it in a component is how the rule gets
 * enforced rather than merely written down.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-base', className)}
    >
      <div className="flex min-w-0 flex-col gap-hairline">
        <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-tight">{actions}</div>}
    </div>
  );
}

/* ── SectionHeader ────────────────────────────────────────────────────── */

/**
 * The heading for a section *within* a screen.
 *
 * Sans, not serif, and deliberately quieter than `PageHeader` — a screen has
 * one subject, and a second serif heading competes with it rather than
 * subdividing it. The `<h2>` is the real hierarchy; the styling follows it.
 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="section-header"
      className={cn('flex flex-wrap items-center justify-between gap-snug', className)}
    >
      <div className="flex min-w-0 flex-col gap-hairline">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-tight">{actions}</div>}
    </div>
  );
}

/**
 * A titled block within a page. `SectionHeader` plus its content, with the
 * gap between them decided once.
 */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-slot="section" className={cn('flex flex-col gap-base', className)}>
      {title && <SectionHeader title={title} description={description} actions={actions} />}
      {children}
    </section>
  );
}

/* ── Toolbar ──────────────────────────────────────────────────────────── */

/**
 * The strip of controls at the top of a pane or a list.
 *
 * Fixed height, so panes line up across a three-pane shell — a toolbar that
 * grows with its content makes the whole layout ragged. Anything that would
 * make it taller belongs below it.
 *
 * `role="toolbar"` is deliberately *not* set: that role brings arrow-key
 * roving focus, which is right for a group of icon buttons and wrong for the
 * mixed bag of a search field and two dropdowns that these usually hold. A
 * caller with a genuine button group should set it on that group.
 */
export function Toolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        'flex h-11 shrink-0 items-center gap-tight border-b px-snug',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Pushes everything after it to the far end of a Toolbar. */
export function ToolbarSpacer() {
  return <div data-slot="toolbar-spacer" className="flex-1" />;
}

/* ── Rail ─────────────────────────────────────────────────────────────── */

/**
 * A fixed-width column beside the main content — navigation, a source list.
 *
 * Distinct from a `Pane`: a rail does not resize. That is the whole difference,
 * and it is a real one — a user dragging a nav column wider is a user who has
 * been given a decision they did not want. If it should resize, it is a Pane.
 */
export function Rail({
  side = 'left',
  className,
  children,
}: {
  side?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      data-slot="rail"
      className={cn(
        'flex w-60 shrink-0 flex-col overflow-y-auto',
        side === 'left' ? 'border-r' : 'border-l',
        className,
      )}
    >
      {children}
    </aside>
  );
}

/* ── PaneGroup ────────────────────────────────────────────────────────── */

/**
 * Resizable panes side by side — the three-pane shell of brief §3.3.
 *
 * A thin wrapper over the `resizable` primitive, and worth having because it
 * fixes the two things a caller would otherwise get wrong: panes need
 * `overflow-hidden` or `minSize` is silently ignored, and the handle needs a
 * grab area wider than its hairline. Both are handled in the primitive; this
 * exists so a screen writes `PaneGroup` and gets them.
 *
 * `autoSaveId` persists the layout, which is the feature that makes a
 * resizable shell worth having at all — dragging a pane and finding it reset
 * on the next visit is worse than not being able to drag it.
 *
 * ── `autoSaveId` is ours, not the library's. FR3. ────────────────────────
 *
 * FR1 documented this prop and passed it straight through, which typechecked
 * because the spread was untyped at the time and did nothing at runtime:
 * **`autoSaveId` is a v2 prop and the installed library is v4**, the same
 * divergence FR1's own drift row warns about for `Group`/`Separator`. v4
 * replaces it with `useDefaultLayout`, which hands back a `defaultLayout` and
 * an `onLayoutChanged` for the caller to wire up.
 *
 * So the name is kept and the wiring moved in here, for the reason the wrapper
 * exists at all: this is precisely a thing a caller would otherwise get wrong,
 * and getting it wrong is silent — a shell that appears to persist its layout
 * and does not. Every `PaneGroup` with an `autoSaveId` now actually persists.
 */
export function PaneGroup({
  orientation = 'horizontal',
  autoSaveId,
  className,
  children,
  ...props
}: {
  orientation?: 'horizontal' | 'vertical';
  /** Persists this group's layout under this id. Must be unique per group. */
  autoSaveId?: string;
  className?: string;
  children: ReactNode;
} & Omit<
  React.ComponentProps<typeof ResizablePanelGroup>,
  'orientation' | 'className' | 'children'
>) {
  return autoSaveId === undefined ? (
    <ResizablePanelGroup orientation={orientation} className={className} {...props}>
      {children}
    </ResizablePanelGroup>
  ) : (
    <PersistedPaneGroup
      id={autoSaveId}
      orientation={orientation}
      className={className}
      {...props}
    >
      {children}
    </PersistedPaneGroup>
  );
}

/**
 * The persisting branch, split out because `useDefaultLayout` is a hook and
 * cannot be called conditionally. Two components rather than one that always
 * persists: a group with no id would still write to storage under some
 * fallback key, and two unrelated shells sharing a key restore each other's
 * layouts.
 */
function PersistedPaneGroup({
  id,
  children,
  ...props
}: { id: string; children: ReactNode } & Omit<
  React.ComponentProps<typeof ResizablePanelGroup>,
  'children'
>) {
  /*
   * `onlySaveAfterUserInteractions`, so a window resize — or the imperative
   * layout the library computes on mount — does not overwrite the sizes the
   * user actually dragged. Storage defaults to `localStorage`.
   */
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    onlySaveAfterUserInteractions: true,
  });

  return (
    <ResizablePanelGroup
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      {...props}
    >
      {children}
    </ResizablePanelGroup>
  );
}

/** One pane. `minSize`/`defaultSize` are percentages of the group. */
export function Pane({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ResizablePanel>) {
  return (
    <ResizablePanel className={cn('flex flex-col', className)} {...props}>
      {children}
    </ResizablePanel>
  );
}

/** The draggable divider between two panes. */
export function PaneHandle(props: React.ComponentProps<typeof ResizableHandle>) {
  return <ResizableHandle {...props} />;
}

/* ── Breakpoints ──────────────────────────────────────────────────────── */

/**
 * Whether a CSS media query currently matches, as React state. Added at FR3.
 *
 * ── When to reach for this, and when not to ──────────────────────────────
 *
 * **Almost never.** A responsive class (`md:flex-row`) is the right tool for a
 * layout that *changes shape*, because CSS applies it before the first paint
 * and costs no JavaScript at all. This hook is for the narrower case where the
 * two layouts must not both **exist**: a component mounted and then hidden with
 * `display:none` still runs its effects, still subscribes its queries, and
 * still appears to anything reading the DOM.
 *
 * FR3's notebook is exactly that case. Its three panes are the same three
 * components at every width, so CSS hiding meant two mounted copies of each,
 * two subscriptions to every query, and every list rendering twice in the
 * accessibility tree. Found in a browser, not by reading the code.
 *
 * ── Why `useSyncExternalStore` and not an effect ─────────────────────────
 *
 * An effect-based version starts at a guessed value and corrects after mount,
 * which paints the phone layout for one frame on a desktop. This reads the
 * real value during render, so the first paint is already right. The server
 * snapshot returns `false` — no DOM means no viewport to measure, and the
 * mobile branch is the safer thing to render into an unknown width.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The `md` breakpoint — Tailwind's 768px, and the one this app's shells switch
 * at. Named rather than repeated, so a screen asks "am I wide?" instead of
 * restating a number that lives in the Tailwind config.
 */
export const MEDIA_WIDE = '(min-width: 48rem)';
