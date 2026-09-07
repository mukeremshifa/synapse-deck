import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOutIcon, SettingsIcon } from 'lucide-react';

import { useAuth } from '@/features/auth/AuthProvider';
import { useProfile } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ThemeChoice } from './ThemeChoice';

/**
 * Who is signed in, and the three things that belong to them rather than to the
 * app: settings, theme, sign out.
 *
 * Before P6 all three were peers of the navigation — Settings was a seventh nav
 * link and the theme button sat beside it — which said that "change the colour
 * scheme" is a destination in the same sense that Practice is. It is not, and a
 * nav with seven equal items has no primary path through it.
 *
 * Hand-rolled rather than Radix's dropdown menu. The layout is eager (it wraps
 * every protected route), the menu is a button and a panel, and a floating-UI
 * dependency in the first chunk a signed-in user downloads costs more than it
 * settles here. What it does owe the user is the behaviour they expect from a
 * menu, so: Escape closes it and returns focus to the trigger, a click outside
 * closes it, moving focus out of it closes it, and navigating closes it.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const { pathname } = useLocation();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const email = user?.email ?? '';
  const name = profile?.display_name?.trim() || email.split('@')[0] || 'Account';

  // A menu left open across a navigation hangs over the page the user asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      // Tabbing past the last item is a way out of the menu, so it is also a
      // way to close it. `relatedTarget` is null when focus leaves the document
      // entirely — switching tabs should not dismiss anything.
      onBlur={event => {
        const next = event.relatedTarget as Node | null;
        if (next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'flex items-center gap-2 rounded-full py-1 pl-1 text-sm transition-colors',
          // No right padding below `sm`, where the label is hidden and the
          // trigger is the avatar alone.
          'pr-1 sm:pr-3',
          'focus-visible:ring-ring outline-none focus-visible:ring-2',
          open ? 'bg-secondary' : 'hover:bg-accent',
        )}
      >
        <span
          aria-hidden
          className="bg-foreground text-background flex size-7 items-center justify-center rounded-full text-xs font-semibold uppercase"
        >
          {name.slice(0, 1)}
        </span>
        {/*
          `sr-only` rather than `hidden` below `sm`: the avatar beside it is
          `aria-hidden`, so this span is the button's whole accessible name and
          dropping it from the tree would leave an unlabelled control. DS4b task
          2 — the visible label cost 74px that a 375px header could not spare.
        */}
        <span className="sr-only max-w-32 truncate sm:not-sr-only">{name}</span>
      </button>

      {open && (
        <div
          id={panelId}
          className={cn(
            'bg-popover text-popover-foreground absolute right-0 z-50 mt-2 w-64',
            'space-y-3 rounded-lg border p-3 shadow-lg',
          )}
        >
          <div className="px-1">
            <p className="truncate text-sm font-medium">{name}</p>
            {email && (
              <p className="text-muted-foreground truncate font-mono text-xs">{email}</p>
            )}
          </div>

          <Link
            to="/settings"
            className="hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm outline-none focus-visible:ring-2"
          >
            <SettingsIcon className="size-4" aria-hidden />
            Settings
          </Link>

          <div className="space-y-1.5 border-t pt-3">
            <p className="text-muted-foreground px-1.5 text-xs">Appearance</p>
            <ThemeChoice />
          </div>

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => void signOut()}
              className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm outline-none focus-visible:ring-2"
            >
              <LogOutIcon className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
