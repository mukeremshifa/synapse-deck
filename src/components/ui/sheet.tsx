import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A panel docked to an edge. Radix has no separate sheet primitive — a sheet
 * *is* a dialog that enters from the side, so this is Dialog with different
 * positioning, and it inherits the same focus trap and escape handling.
 *
 * ── When this rather than a Dialog ────────────────────────────────────────
 *
 * A dialog interrupts: it takes the centre, and the thing behind it stops
 * mattering until you answer. A sheet accompanies: it arrives beside content
 * that is still the subject. Brief §3.2 leans on both, and picking wrong is the
 * usual way an app's modals start feeling arbitrary — so, concretely:
 *
 *   Dialog   a decision or a short form. Generate, confirm, rename.
 *   Sheet    a surface you *work in* while the page stays relevant. Filters,
 *            a card's detail beside the list it came from, source metadata.
 *
 * `side` defaults to right because that is where a detail panel belongs in a
 * left-to-right reading order; `bottom` is the mobile answer to the same need.
 */

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

type SheetSide = 'top' | 'right' | 'bottom' | 'left';

const SIDE_POSITION: Record<SheetSide, string> = {
  right: 'inset-y-0 right-0 h-full w-full max-w-md border-l',
  left: 'inset-y-0 left-0 h-full w-full max-w-md border-r',
  top: 'inset-x-0 top-0 h-auto max-h-[85vh] border-b',
  bottom: 'inset-x-0 bottom-0 h-auto max-h-[85vh] border-t',
};

function SheetContent({
  className,
  children,
  side = 'right',
  showClose = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: SheetSide;
  showClose?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetPrimitive.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        // `data-side` is what the ui-sheet rules in globals.css switch on, so
        // the slide direction and the docking edge cannot disagree.
        data-side={side}
        className={cn(
          'ui-sheet bg-background fixed z-50 flex flex-col gap-gutter p-gutter shadow-modal',
          SIDE_POSITION[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <SheetPrimitive.Close
            className={cn(
              'absolute top-4 right-4 rounded-md p-1 opacity-60 transition-opacity',
              'hover:opacity-100 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            <XIcon className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-tight', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-tight sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetSide,
};
