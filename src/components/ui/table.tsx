import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A real table, for real tabular data.
 *
 * **Use it only when the data is genuinely a table** — rows that share columns,
 * where comparing down a column is the point. A list of cards is a list; giving
 * it borders and a header row does not make it tabular, it makes it harder to
 * scan. FR6's diagnostics are the honest consumer.
 *
 * `<table>` rather than a grid of divs, deliberately: the semantics are what
 * let a screen reader say "row 4 of 12, Retention, 87%" instead of reading a
 * wall of unrelated numbers. That is not recoverable with ARIA on divs without
 * writing considerably more code than this file contains.
 *
 * Numbers belong in `font-mono tabular-nums`, per the typography rule — a
 * column of figures that do not line up is the single most common reason a data
 * table looks amateur. `TableCell` does not force it, because not every cell is
 * a number; the caller opts in per column.
 */

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    // The wrapper scrolls, not the page: a wide table must never be the reason
    // the whole document scrolls sideways.
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-muted-foreground h-9 px-snug text-left align-middle text-xs font-medium',
        'whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-snug align-middle', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-base text-sm', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
