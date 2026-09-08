import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A hint attached to a control.
 *
 * **A tooltip is never the only place information lives.** It does not appear
 * on touch, it does not appear for a keyboard user who tabs past quickly, and a
 * screen reader announces it only if the trigger has no better label. Anything
 * a user *needs* belongs on the page; a tooltip is for the icon button whose
 * meaning is obvious to someone who has used the app twice and opaque the first
 * time.
 *
 * `TooltipProvider` belongs once, high in the tree — it is what makes the
 * second tooltip in a toolbar open instantly instead of waiting out the delay
 * again. FR2 mounts it in the shell.
 */

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'ui-pop bg-foreground text-background z-50 rounded-md px-tight py-hairline',
          'text-xs font-medium shadow-overlay',
          className,
        )}
        {...props}
      >
        {children}
        {/* Inverted like the bubble, so the arrow does not read as a separate
            shape stuck to its corner. */}
        <TooltipPrimitive.Arrow className="fill-foreground" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
