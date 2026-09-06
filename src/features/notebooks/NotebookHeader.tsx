import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from 'lucide-react';

import { AccountMenu } from '@/app/AccountMenu';
import { LogoMark } from '@/components/Logo';
import { Badge } from '@/components/ui/badge';
import { notebookPath } from '@/lib/notebooks';

/**
 * The bar above the three panes: the way out, the notebook's name, the account.
 *
 * Deliberately 56px and quiet. It competes with three panes of content directly
 * beneath it, and the notebook's title is the only thing on it a user actually
 * needs — everything else is either an escape hatch or an affordance they will
 * use once a session.
 *
 * The back link is a `Link` to the list rather than a history `-1`. A user who
 * arrived at a notebook from the review gate, or by pasting a URL, has no
 * useful "back", and a chevron that sometimes leaves the app is worse than one
 * that always goes to the same place.
 */
export function NotebookHeader({
  title,
  resumable,
}: {
  title: string;
  /** See `Notebook.resumable` — `deck_status`, not `card_status`. */
  resumable: boolean;
}) {
  return (
    <header className="bg-background flex h-14 shrink-0 items-center gap-3 border-b px-3">
      <Link
        to={notebookPath.list()}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded-md px-1 py-1 text-sm outline-none focus-visible:ring-2"
      >
        <ChevronLeftIcon className="size-4" aria-hidden />
        <LogoMark className="size-5" />
        <span className="sr-only">All notebooks</span>
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {/*
          The badge is the only route back into an abandoned review gate, so it
          is chrome that carries real function. See P11 §5.3 — this reads
          `deck_status`, and the resemblance to the removed `card_status`
          'draft' is exactly the trap the plan names.
        */}
        {resumable ? (
          <Badge variant="secondary" className="shrink-0">
            Draft
          </Badge>
        ) : null}
      </div>

      <AccountMenu />
    </header>
  );
}
