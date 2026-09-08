import { Link, Outlet } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { AccountMenu } from './AccountMenu';
import { RouteErrorBoundary } from './ErrorBoundary';

/**
 * The frame for everything that is not a notebook: home and settings.
 *
 * ── The nav is gone, and its absence is the point ─────────────────────────
 *
 * P6 built a six-tab header — Dashboard, Decks, Create, Practice, Exam,
 * Progress. P11 cut it to one link, correctly: every one of those six was an
 * activity you perform *on a notebook*, and a global "Practice" tab would have
 * to mean "practise across all notebooks", which is a different and mostly
 * unwanted product. A later phase brought it back to two, `/home` and
 * `/notebooks`, because a prompt and an index seemed like different screens.
 *
 * **FR2 merged those two into one home** (brief §3.1). A nav with one item is a
 * nav pretending to be a choice, so what is left is the lockup — which was
 * already the link to `/` — the account menu, and nothing between them.
 *
 * **The rule that survived every one of those revisions, and is the test any
 * future link has to pass: an activity you do *to* a notebook never appears
 * here.** It has no notebook to name, so it would have to guess one, and the
 * guess is what FR2 deleted.
 */

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
        {/*
          `gap-3` below `sm`. DS4b task 2 found every shell screen scrolling
          horizontally to 499px at 375px wide, and tightening the gap rather
          than wrapping is what keeps the header one row on a phone. With the
          nav gone there are two children instead of three, so there is more
          room than that measurement assumed — the tighter gap is kept because
          it costs nothing.
        */}
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link
            to="/"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {/*
              The wordmark is back at every width. DS4b hid it below `sm`
              because its ~110px pushed the nav pills over the account avatar
              by 15px; FR2 deleted the pills, so the constraint that hid it is
              gone and a phone gets the app's name again.
            */}
            <LogoLockup />
          </Link>

          {/*
            The spacer that used to be the nav. `flex-1` on an empty div pushes
            the account menu to the far end without a nav element pretending to
            be one — an empty `<nav aria-label="Main">` announces a landmark
            with nothing in it.
          */}
          <div className="flex-1" />

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
