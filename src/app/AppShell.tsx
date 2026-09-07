import { Link, NavLink, Outlet } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { AccountMenu } from './AccountMenu';
import { RouteErrorBoundary } from './ErrorBoundary';

/**
 * The frame for everything that is not a notebook: the dashboard, the notebook
 * list, settings.
 *
 * ── Two global destinations, so there are two links ───────────────────────
 *
 * P6 built a six-tab header — Dashboard, Decks, Create, Practice, Exam,
 * Progress — and P11 deleted it, correctly: every one of those six was an
 * activity you perform *on a notebook*, and a global "Practice" tab would have
 * had to mean "practise across all notebooks", which is a different and mostly
 * unwanted product. P11 concluded that the only global destination left was the
 * list, and that a nav bar with one item should not exist.
 *
 * That conclusion held exactly as long as its premise. There are now two global
 * destinations, because "what should I do right now?" spans notebooks and the
 * list cannot answer it — see `DashboardPage`. Two is enough to need a way
 * between them and still few enough that the header stays quiet.
 *
 * **The P11 rule survives intact and is the thing to keep**: an activity you do
 * *to* a notebook never appears here. If a third link is ever proposed, that is
 * the test it has to pass.
 */

const NAV = [
  { to: '/home', label: 'Home' },
  { to: '/notebooks', label: 'Notebooks' },
] as const;

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
        {/*
          `gap-3` below `sm`, because at 375px the three children (a fixed-width
          lockup, the nav, and the account menu) plus 2x24px of gap overflowed
          the viewport by ~124px — DS4b task 2 found every shell screen scrolling
          horizontally to 499px. The gap tightens rather than the content
          wrapping, so the header stays one row on a phone.
        */}
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link
            to="/home"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {/*
              Mark only below `sm`. The wordmark is ~110px of a 375px header,
              and with it present the nav pills overlapped the account avatar by
              15px (DS4b task 2). The `aria-label` on the Link carries the name,
              so nothing is lost to a screen reader.
            */}
            <LogoLockup wordmarkClassName="hidden sm:inline" />
          </Link>

          {/*
            `min-w-0` lets this actually shrink: a flex item defaults to
            `min-width:auto`, so `flex-1` alone still refuses to go below its
            content width and pushes the account menu off screen.
          */}
          <nav className="flex min-w-0 flex-1 items-center gap-1" aria-label="Main">
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'focus-visible:ring-ring rounded-md px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2',
                    isActive
                      ? 'bg-secondary text-secondary-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <RouteErrorBoundary>
          <Outlet />
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
