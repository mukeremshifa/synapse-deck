import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * A row of segmented options, all visible at once.
 *
 * Against a Select: use this when there are two to four choices and seeing them
 * all is worth the space — a card-format filter, a difficulty, a date range.
 * Past four, or when the options are data rather than modes, use a Select. The
 * test is whether a user benefits from reading the options they did *not* pick.
 *
 * `type="single"` behaves as a radio group; `type="multiple"` as checkboxes.
 * Radix handles the roles, which is most of why this is not four buttons.
 */

const toggleVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium',
    'whitespace-nowrap transition-colors',
    'hover:bg-accent hover:text-accent-foreground',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-raised',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      size: {
        sm: 'h-7 px-tight',
        default: 'h-8 px-snug',
        lg: 'h-10 px-base',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        'bg-muted inline-flex w-fit items-center rounded-lg p-hairline',
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ size }), className)}
      style={{ transitionDuration: 'var(--duration-instant)' }}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleVariants };
