import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The frame for the things you launch out of a notebook: practice, an exam, the
 * review gate.
 *
 * ── Why these three needed a frame of their own ───────────────────────────
 *
 * Through P6 they were ordinary pages inside `AppLayout`, and the six-tab nav
 * gave them three things for free: a header, horizontal padding, and a way out.
 * P11 routes them through `FullScreenOutlet`, which deliberately contributes no
 * chrome — so without this they render as bare centred blocks pinned to the top
 * of an empty viewport with no exit. That is what "still in P6 chrome" actually
 * meant.
 *
 * The frame is one component rather than three headers because the three
 * screens differ only in what they are called and where "close" goes. Three
 * hand-rolled variations of the same bar is how an app stops looking like one
 * product — the same reasoning `EmptyState` was extracted for.
 *
 * ── The exit is an X, not a nav ───────────────────────────────────────────
 *
 * These are modal in intent: you are mid-review, mid-exam, mid-gate, and the
 * question the header should answer is "how do I get out of this", not "where
 * else could I be". A nav bar here would invite leaving a timed exam by
 * clicking Progress, which is a worse outcome than one deliberate X.
 *
 * `exitTo` is a route rather than `history.back()` for the reason
 * `NotebookHeader` gives: a user who arrived by pasting a URL, or who was
 * redirected here from the gate, has no useful back.
 */
export function FocusFrame({
  title,
  subtitle,
  exitTo,
  exitLabel = 'Close',
  /** Rendered in the header's centre — a timer, a progress count. */
  status,
  /** When true the header is hidden entirely. Exam focus mode uses this. */
  bare = false,
  /** Practice and the gate want a readable column; the exam manages its own. */
  width = 'narrow',
  children,
}: {
  title: string;
  subtitle?: string;
  exitTo: string;
  exitLabel?: string;
  status?: ReactNode;
  bare?: boolean;
  width?: 'narrow' | 'wide' | 'full';
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      {!bare && (
        <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{title}</p>
              {subtitle && (
                <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
              )}
            </div>

            {status && <div className="shrink-0">{status}</div>}

            <Button variant="ghost" size="icon-sm" asChild className="shrink-0">
              <Link to={exitTo} aria-label={exitLabel}>
                <XIcon aria-hidden />
              </Link>
            </Button>
          </div>
        </header>
      )}

      <main
        className={cn(
          'w-full flex-1 px-4 py-8',
          width === 'narrow' && 'mx-auto max-w-2xl',
          width === 'wide' && 'mx-auto max-w-5xl',
        )}
      >
        {children}
      </main>
    </div>
  );
}
