import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Views of the same subject, one at a time.
 *
 * **Tabs are not navigation.** If switching changes *what* you are looking at
 * rather than *how*, that is a route — FR2 owns the route table, and a tab that
 * should have been a URL is a back button that does nothing. The notebook's
 * Sources / Studio / Chat are panes, not tabs, for this reason.
 *
 * The indicator is the accent as a field under the active label, not a coloured
 * label: `--primary` is near-white and accent *text* is invisible on paper
 * (rule 2 in `globals.css`). The active tab therefore lifts onto the card
 * surface, and the accent appears as a hairline beneath it.
 */

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center',
        'rounded-lg p-hairline',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-snug py-1',
        'text-sm font-medium whitespace-nowrap transition-all',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-background data-[state=active]:text-foreground',
        'data-[state=active]:shadow-raised',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      style={{ transitionDuration: 'var(--duration-instant)' }}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
