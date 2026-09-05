import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3Icon,
  ClipboardCheckIcon,
  LayersIcon,
  LayoutDashboardIcon,
  PlayIcon,
  SparklesIcon,
} from 'lucide-react';

import { LogoLockup } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { AccountMenu } from './AccountMenu';
import { RouteErrorBoundary } from './ErrorBoundary';

/**
 * The shell: identity on the left, the places you go in the middle, and the
 * account on the right.
 *
 * Settings is deliberately not one of them. Through P1–P5 the nav was six peer
 * links and a theme button in a wrapping row, which gave equal weight to
 * "practise" and "change your timezone" and left no shape for the eye to follow.
 * What remains is the product's actual loop, in the order it is lived.
 *
 * **Exam is the sixth, and it is a peer rather than a child of Practice**
 * (AWS-native brief section 2). The positioning is that neither half is
 * subordinate: flashcards are not a feature of the exam tool and the exam is not
 * a feature of the flashcard tool. Nesting it under Practice would say the
 * opposite in the one place a user actually reads the product's shape. It sits
 * after Practice because that is the order the loop is lived in — study, then
 * sit the thing you were studying for, then look back.
 */

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/decks', label: 'Decks', icon: LayersIcon },
  { to: '/create/text', label: 'Create', icon: SparklesIcon },
  { to: '/practice', label: 'Practice', icon: PlayIcon },
  { to: '/exam', label: 'Exam', icon: ClipboardCheckIcon },
  { to: '/progress', label: 'Progress', icon: BarChart3Icon },
] as const;

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Sticky: practice and the review gate are long scrolling pages, and the
          way out of them should not be a scroll away. */}
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4">
          <NavLink
            to="/dashboard"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <LogoLockup />
          </NavLink>

          <nav aria-label="Main" className="flex h-full min-w-0 flex-1 items-center">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full items-center gap-1.5 px-3 text-sm transition-colors',
                    'focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    // The indicator is ink, not the accent: every screen already
                    // spends its one accent on the thing to do next, and a nav
                    // that also glows competes with it on every page.
                    'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full',
                    isActive
                      ? 'text-foreground after:bg-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground after:bg-transparent',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>

          <AccountMenu />
        </div>
      </header>

      {/* Inside the layout, so a page that throws keeps the nav and the user
          can walk out of it. The root boundary in providers.tsx catches the
          case where the layout itself is what broke. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <RouteErrorBoundary>
          <Outlet />
        </RouteErrorBoundary>
      </main>

      {/* P5 pointed this at `docs/SPEC.md`, a file nobody reading the footer can
          open, and P7 replaced it with a claim about the review log. The claim
          was a marketing line on every screen of a signed-in app, and `/progress`
          already says the same thing where it means something. A credit is what
          is left, and it is the only thing here that is about this footer. */}
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs">
          <span className="text-foreground font-serif text-sm">SynapseDeck</span>
          <span>Built by mukeremshifa</span>
        </div>
      </footer>
    </div>
  );
}
