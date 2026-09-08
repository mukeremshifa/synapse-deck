import * as React from 'react';
import { Avatar as AvatarPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * A user's mark. One user per account, so this is the account menu's trigger
 * and little else — but it is in the set because the shell needs one and a
 * hand-rolled circle-with-initials is exactly the sort of thing that ends up
 * drawn three slightly different ways.
 *
 * The fallback is not a loading state: Radix shows it when there is no image or
 * the image fails, which for this app is the common case rather than the edge
 * one. It gets the accent as a field (rule 2 in `globals.css`) with ink on top.
 */
function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex size-8 shrink-0 overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'bg-primary text-primary-foreground flex size-full items-center justify-center',
        'rounded-full text-xs font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
