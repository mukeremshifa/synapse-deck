import type { ReactNode } from 'react';

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
 */
export function PaneGroup({
  orientation = 'horizontal',
  className,
  children,
  ...props
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
} & Omit<
  React.ComponentProps<typeof ResizablePanelGroup>,
  'orientation' | 'className' | 'children'
>) {
  return (
    <ResizablePanelGroup orientation={orientation} className={className} {...props}>
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
