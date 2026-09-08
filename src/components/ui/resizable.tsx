import * as React from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { GripVerticalIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Resizable panes — the substrate for FR2's three-pane shell.
 *
 * ── This is not shadcn's stock `resizable.tsx`, and cannot be ─────────────
 *
 * That file is written against `react-resizable-panels` v2, whose API is
 * `PanelGroup` / `PanelResizeHandle` and a `direction` prop. The installed
 * version is **v4**, which renames these to `Group` / `Separator` and takes
 * `orientation`. Copying the published shadcn source here would not compile.
 *
 * The names below stay the shadcn ones (`ResizablePanelGroup`,
 * `ResizableHandle`) because that is what a session reading FR2's plan will
 * look for — this file is the adapter that makes the familiar names work
 * against the library actually installed.
 *
 * ── The handle is not decoration ──────────────────────────────────────────
 *
 * It is a control, so it gets `--border-strong` when focused, a real hit area
 * wider than the line it draws, and keyboard resize (which v4 gives us for
 * free on the separator). A 1px hairline that only responds to a pixel-perfect
 * mouse is the usual way a three-pane layout becomes unusable.
 */

function ResizablePanelGroup({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      orientation={orientation}
      className={cn(
        'flex h-full w-full',
        orientation === 'vertical' && 'flex-col',
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({ className, ...props }: React.ComponentProps<typeof Panel>) {
  return (
    <Panel
      data-slot="resizable-panel"
      // `overflow-hidden` matters: without it a pane's content sets a minimum
      // width and the group silently stops honouring `minSize`.
      className={cn('overflow-hidden', className)}
      {...props}
    />
  );
}

function ResizableHandle({
  withHandle = false,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'bg-border relative flex items-center justify-center',
        // The visible line stays a hairline; the grab area is the padding
        // around it. `after` is that area — 9px total on the axis being
        // dragged, which is about the minimum a pointer reliably hits.
        'w-px after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2',
        'data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full',
        'data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:top-1/2',
        'data-[orientation=vertical]:after:h-2 data-[orientation=vertical]:after:w-full',
        'data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0',
        'hover:bg-border-strong data-[state=drag]:bg-primary transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      style={{ transitionDuration: 'var(--duration-instant)' }}
      {...props}
    >
      {withHandle && (
        <div
          className={cn(
            'bg-border-strong z-10 flex h-5 w-2.5 items-center justify-center rounded-xs',
            'text-background',
          )}
        >
          <GripVerticalIcon className="size-2.5" aria-hidden />
        </div>
      )}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
