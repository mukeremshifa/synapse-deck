import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The modal. Brief §3.2 makes modals the main verb of the re-architected app —
 * generate, review-gate, add-source and the command palette are all dialogs —
 * so this is not a rarely-used primitive and it is worth getting exact.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 *
 * `ui-overlay` and `ui-panel` are defined in `globals.css` against Radix's
 * `data-state`, so the durations and easings here are the motion tokens rather
 * than numbers typed into a component. A dialog *travels*, so it gets
 * `--duration-moving` in and `--duration-quick` out — faster out than in is
 * deliberate; a UI that lingers on exit feels slow.
 *
 * ── The close button, and when to hide it ─────────────────────────────────
 *
 * `showClose` defaults to true and should almost always stay that way. The one
 * legitimate reason to pass false is a dialog whose only exits are explicit
 * decisions — which is `ConfirmDialog`'s job, and it is built on AlertDialog
 * rather than this for exactly that reason.
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('ui-overlay fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'ui-panel bg-background fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-lg',
          'gap-gutter -translate-x-1/2 -translate-y-1/2 rounded-xl border p-gutter shadow-modal',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              'absolute top-4 right-4 rounded-md p-1 opacity-60 transition-opacity',
              'hover:opacity-100 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              'disabled:pointer-events-none',
            )}
          >
            <XIcon className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-tight text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-tight sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
