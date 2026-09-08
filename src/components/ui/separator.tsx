import * as React from 'react';
import { Separator as SeparatorPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A rule between groups.
 *
 * `decorative` defaults to true, which is right almost always: the separator is
 * drawing a distinction the layout already makes, so announcing it to a screen
 * reader is noise. Pass `decorative={false}` only when the line is the *only*
 * thing saying two regions are different — which usually means the layout
 * needs fixing rather than the separator needing a role.
 *
 * Uses `--border`, the decorative boundary token, deliberately. A separator is
 * the canonical thing rule 5 in `globals.css` describes as decorative; reaching
 * for `--border-strong` here is what makes an app look like a spreadsheet.
 */
function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
