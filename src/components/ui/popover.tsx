import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A small anchored surface holding *interactive* content.
 *
 * The distinction that keeps these three straight, because they look alike and
 * are not interchangeable for anyone using a keyboard or a screen reader:
 *
 *   Tooltip   describes the thing it points at. Not focusable, cannot hold a
 *             control, vanishes on blur. Never the only place information lives.
 *   Popover   holds controls. Focus moves into it; escape closes it.
 *   Dropdown  holds a *menu* — a list of commands with roving focus and
 *             typeahead. If the items are commands, this is the wrong file.
 */

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'ui-pop bg-popover text-popover-foreground z-50 w-72 rounded-lg border p-snug shadow-overlay',
          'outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
