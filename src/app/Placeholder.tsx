import { Link } from 'react-router-dom';
import { ConstructionIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/states';
import { Page, PageHeader } from '@/components/layout';

/**
 * A route that exists, resolves, and is honest about being unbuilt.
 *
 * ── Why a placeholder is a deliverable rather than a stub ─────────────────
 *
 * FR2 creates the routes FR3–FR6 fill. The plan's §2 names the trap directly:
 * it is very tempting to fill one while you are here, and a phase that fills
 * four of them is three other phases done badly in one commit. So a route that
 * renders this component is *complete* FR2 work — the address resolves, the
 * frame is right, and the screen says who owns what goes inside it.
 *
 * **It names its phase on screen deliberately.** A blank div and a "coming
 * soon" are the same thing to the next session: an unexplained gap it has to
 * reverse-engineer from the plans. `phase="FR3"` renders as text a reader can
 * take straight to `docs/plans/FR3-the-notebook.md`.
 *
 * ── It still answers "which notebook?" ────────────────────────────────────
 *
 * Every placeholder route below `/notebooks/:notebookId` receives the ids from
 * its own path and shows them. That is not decoration: the rule this phase runs
 * under is that a surface names its notebook from the route (brief §1), and a
 * placeholder that could not would be an invalid surface even while empty. It
 * is also how deep-linking gets checked by hand — paste a runner URL, and the
 * ids it parsed are on the screen.
 */
export function Placeholder({
  title,
  phase,
  description,
  ids,
  backTo = '/',
  backLabel = 'Back to home',
}: {
  title: string;
  /** The plan that builds this screen, e.g. `'FR3'`. Rendered on screen. */
  phase: string;
  description: string;
  /** Route params this surface was addressed with. Shown, so a pasted URL is checkable. */
  ids?: Record<string, string | undefined>;
  backTo?: string;
  backLabel?: string;
}) {
  const entries = Object.entries(ids ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );

  return (
    <Page width="prose">
      <PageHeader title={title} description={`${phase} builds this screen.`} />
      <EmptyState
        icon={<ConstructionIcon />}
        title={`${phase} builds this`}
        description={
          <>
            <p>{description}</p>
            {entries.length > 0 && (
              <dl className="mt-base grid grid-cols-[auto_1fr] gap-x-snug gap-y-hairline text-left">
                {entries.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground font-mono text-xs">{key}</dt>
                    {/* Mono: an id is a value you compare and type (DESIGN-SYSTEM §3). */}
                    <dd className="font-mono text-xs break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        }
        action={
          <Button asChild variant="outline">
            <Link to={backTo}>{backLabel}</Link>
          </Button>
        }
      />
    </Page>
  );
}
