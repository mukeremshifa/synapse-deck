import { Link, Outlet } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { AccountMenu } from './AccountMenu';
import { RouteErrorBoundary } from './ErrorBoundary';

/**
 * The frame for everything that is not a notebook: the notebook list, settings.
 *
 * ── There is no navigation here, and that is the change ───────────────────
 *
 * P6 built a six-tab header — Dashboard, Decks, Create, Practice, Exam,
 * Progress — and it was the right shell for a product whose top-level objects
 * were *activities*. P11's top-level object is a **notebook**, and every one of
 * those six activities is now something you do to one. A global "Practice" tab
 * would have to mean "practise across all notebooks", which is a different and
 * mostly unwanted product: the reason to open a notebook is that you want to
 * work on *that material*.
 *
 * So the only global destinations left are the list and your account, and the
 * list is the logo. A nav bar with one item is a nav bar that should not exist.
 */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4">
          <Link
            to="/notebooks"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <LogoLockup />
          </Link>
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
