import * as React from 'react';
import { SearchIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * A filterable list of commands — the palette behind ⌘K.
 *
 * ── Why this is not `cmdk` ────────────────────────────────────────────────
 *
 * shadcn's stock `command.tsx` wraps the `cmdk` package. The brief named
 * exactly two new dependencies and this was not one of them, so the palette is
 * built here on the Dialog above plus a controlled list. What `cmdk` would add
 * over this is fuzzy scoring and grouped virtualisation; what it costs is a
 * dependency whose own filtering behaviour then has to be understood before
 * FR2 can change it. If a later phase finds the matching genuinely inadequate,
 * adding `cmdk` then is a small change — the exported names below are
 * deliberately the ones `cmdk` uses.
 *
 * ── The keyboard contract ─────────────────────────────────────────────────
 *
 * ↑/↓ move, Enter runs, Escape closes (Dialog's own). The active item is
 * tracked in state rather than by focus, because focus stays in the input —
 * that is what lets you keep typing while moving through results, and it is
 * why `aria-activedescendant` is here rather than `tabIndex`.
 */

type CommandContextValue = {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  register: (id: string, run: () => void) => () => void;
};

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommandContext(who: string) {
  const context = React.useContext(CommandContext);
  if (!context) throw new Error(`<${who}> must be rendered inside <Command>`);
  return context;
}

function Command({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // A ref, not state: registration happens during render of the children, and
  // writing to state there would loop.
  const items = React.useRef(new Map<string, () => void>());

  const register = React.useCallback((id: string, run: () => void) => {
    items.current.set(id, run);
    return () => {
      items.current.delete(id);
    };
  }, []);

  const move = React.useCallback(
    (delta: number) => {
      const ids = [...items.current.keys()];
      if (ids.length === 0) return;
      const current = activeId === null ? -1 : ids.indexOf(activeId);
      // Wraps at both ends: a palette where Down stops at the bottom makes you
      // reach for the mouse to get back to the top.
      const next = (current + delta + ids.length) % ids.length;
      setActiveId(ids[next] ?? null);
    },
    [activeId],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter' && activeId) {
        event.preventDefault();
        items.current.get(activeId)?.();
      }
    },
    [move, activeId],
  );

  const value = React.useMemo(
    () => ({ activeId, setActiveId, register }),
    [activeId, register],
  );

  return (
    <CommandContext.Provider value={value}>
      <div
        data-slot="command"
        className={cn('flex size-full flex-col overflow-hidden', className)}
        onKeyDown={onKeyDown}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  );
}

/**
 * The palette as a modal. `title` and `description` are required and visually
 * hidden — a dialog with no accessible name is announced as "dialog", which
 * tells a screen-reader user nothing about what just took over their screen.
 */
function CommandDialog({
  title = 'Command palette',
  description = 'Search for a command to run.',
  open,
  onOpenChange,
  children,
}: {
  title?: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" showClose={false}>
        <span className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </span>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const { activeId } = useCommandContext('CommandInput');
  return (
    <div className="flex items-center gap-tight border-b px-snug">
      <SearchIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <input
        data-slot="command-input"
        type="text"
        // Focus never leaves this input; the "focused" row is reported here.
        role="combobox"
        aria-expanded
        aria-controls="command-list"
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        className={cn(
          'placeholder:text-muted-foreground h-11 w-full bg-transparent text-sm outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-list"
      id="command-list"
      role="listbox"
      className={cn('max-h-72 overflow-x-hidden overflow-y-auto p-hairline', className)}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-empty"
      role="presentation"
      className={cn('text-muted-foreground py-6 text-center text-sm', className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: React.ComponentProps<'div'> & { heading?: React.ReactNode }) {
  return (
    <div data-slot="command-group" role="group" className={cn('py-1', className)} {...props}>
      {heading && (
        <div className="text-muted-foreground px-tight py-1 text-xs font-medium">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-separator"
      role="presentation"
      className={cn('bg-border -mx-hairline my-hairline h-px', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  value,
  onSelect,
  children,
  disabled,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  /** Stable id, and what `onSelect` receives. Must be unique in the list. */
  value: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
}) {
  const { activeId, setActiveId, register } = useCommandContext('CommandItem');
  const active = activeId === value;

  const run = React.useCallback(() => {
    if (!disabled) onSelect?.(value);
  }, [disabled, onSelect, value]);

  // Registration order is render order, which is what makes ↑/↓ follow the
  // visual order rather than an arbitrary one.
  React.useEffect(() => (disabled ? undefined : register(value, run)), [
    disabled,
    register,
    value,
    run,
  ]);

  return (
    <div
      data-slot="command-item"
      id={value}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-active={active || undefined}
      onPointerMove={() => !disabled && setActiveId(value)}
      onClick={run}
      className={cn(
        'flex cursor-default items-center gap-tight rounded-md px-tight py-1.5 text-sm',
        'outline-none select-none',
        'data-[active]:bg-accent data-[active]:text-accent-foreground',
        'aria-disabled:pointer-events-none aria-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The key hint on the right. Mono, per the typography rule. */
function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('text-muted-foreground ml-auto font-mono text-xs', className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
