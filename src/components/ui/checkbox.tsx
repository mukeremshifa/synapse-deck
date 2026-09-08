import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A checkbox.
 *
 * Added at FR3, for the source-selection column that grounds a chat answer in
 * chosen sources. **No new dependency**: `radix-ui` is already the single
 * package FR1's two-dependency line allows, and this is one more primitive out
 * of it rather than a second checkbox library.
 *
 * ── Why a checkbox and not a `ToggleGroup type="multiple"` ───────────────
 *
 * `toggle-group.tsx` already does multi-select, and its own doc comment draws
 * the line this follows: a toggle group is for a handful of *modes* seen all at
 * once, and past four options — or when the options are **data** rather than
 * modes — it is the wrong control. A notebook's sources are data, there can be
 * any number of them, and they are already a list with titles and statuses. So
 * they get a checkbox each, in the row they already have.
 *
 * ── Borders ──────────────────────────────────────────────────────────────
 *
 * `--input`, not `--border`. FR1's drift row: a hairline dark enough to pass
 * SC 1.4.11 does not read as a hairline, so `--border` is decorative and the
 * meaningful boundaries — field outlines, selected states, focused controls —
 * use `--border-strong` / `--input` at 3.17:1. An unchecked checkbox is nothing
 * *but* its outline; drawn in the decorative token it is a 1.35:1 suggestion of
 * a control.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer border-input dark:bg-input/30 size-4 shrink-0 rounded-[4px] border shadow-xs',
        'transition-shadow outline-none',
        'focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2',
        'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3.5" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
