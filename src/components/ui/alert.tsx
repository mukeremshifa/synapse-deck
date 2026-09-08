import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * A message that stays on the page.
 *
 * Against a toast (`sonner`): a toast is for something that *happened* and is
 * over — saved, deleted, copied. An alert is for a condition that is still
 * true, and which the user will still need to know about after they look away.
 * "Could not save" is a toast; "this notebook has no sources yet, so generation
 * is unavailable" is an alert.
 *
 * ── Colour, and why these are tinted rather than filled ───────────────────
 *
 * A filled destructive block is louder than almost any real condition warrants
 * and, at any size, is a large area of saturated colour that unbalances a page.
 * These use the semantic colour as a border and a wash, with the text staying
 * `--foreground` — so the alert is unmistakable without shouting, and the body
 * text keeps its 19.41:1 rather than inheriting whatever the tint gives it.
 *
 * `role` follows the variant: `destructive` is `alert` (interrupts a screen
 * reader, which a failure warrants), everything else is `status` (announced at
 * the next pause). Getting this backwards is how an app becomes exhausting to
 * use with a screen reader.
 */

const alertVariants = cva(
  cn(
    'relative grid w-full items-start gap-x-snug gap-y-hairline rounded-lg border p-snug text-sm',
    'has-[>svg]:grid-cols-[auto_1fr] grid-cols-[0_1fr]',
    "[&>svg]:size-4 [&>svg]:translate-y-0.5",
  ),
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        info: 'border-border-strong/60 bg-muted/50 text-foreground [&>svg]:text-muted-foreground',
        warning: 'border-warning/50 bg-warning/10 text-foreground [&>svg]:text-warning',
        destructive:
          'border-destructive/50 bg-destructive/8 text-foreground [&>svg]:text-destructive',
        success: 'border-success/50 bg-success/10 text-foreground [&>svg]:text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-muted-foreground col-start-2 text-sm leading-relaxed', className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
