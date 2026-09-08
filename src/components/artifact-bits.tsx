/**
 * The two things every artifact row renders, wherever it renders — **shared,
 * because three copies was the alternative.**
 *
 * Home, the notebook's Studio and FR6's overview all list artifacts, and all
 * three must say the same thing about the same artifact. Home and the Studio
 * had each grown their own `ReadinessBadge`, identical in every respect, which
 * is exactly how two copies begin; the overview would have made a third, and
 * `Provenance` — with the dangling-source rule that is easy to get subtly
 * wrong — would have been copied with it.
 *
 * In `src/components/` rather than in a feature, because no feature owns it.
 */

import { TriangleAlertIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { Artifact, Readiness } from '@/lib/api';

/**
 * Readiness as a badge — **one component, so home and the overview cannot
 * drift.**
 *
 * FR6 criterion 3 asks that the overview's readiness agree exactly with home's,
 * and criterion 4 asks that a new artifact kind not require editing home. Both
 * are properties of *where readiness is computed*, and it is computed in one
 * place already: the server projects `Artifact.readiness` and rolls it up into
 * `Notebook.readiness`, and every screen renders the string it is handed. No
 * client recomputes it, so there is nothing to disagree about.
 *
 * What could still drift is the rendering. Home and the Studio each grew their
 * own `ReadinessBadge` — identical, which is exactly how two copies begin, and
 * FR6 would have made a third. This is that component, extracted rather than
 * copied again.
 *
 * ── Why a new kind touches nothing ────────────────────────────────────────
 *
 * Neither this badge nor home switches on `kind`. `state` is a closed
 * three-value union that a kind does not extend, and `detail` is a sentence the
 * server has already written and counted — "12 cards due", "3 of 8 questions
 * unsat". A fifth kind arriving with its own readiness rule changes
 * `projectArtifact` and the roll-up's label table, both server-side, and every
 * screen renders it correctly having never been recompiled against it. The card
 * count this replaced could not do that: "18 due" is a *deck's* unit, so a kind
 * that is not measured in cards had nowhere to appear.
 */
export function ReadinessBadge({
  readiness,
  status,
}: {
  readiness: Readiness;
  /**
   * An artifact's status, where there is one. It overrides the badge: a
   * `generating` or `failed` artifact has a readiness of `none`, and a blank
   * where "Failed" belongs is the row saying nothing about what went wrong.
   *
   * Omitted for a notebook, which has no such status.
   */
  status?: Artifact['status'];
}) {
  if (status === 'generating') return <Badge variant="secondary">Generating</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  /*
   * `none` draws nothing, deliberately. An empty notebook is a normal state and
   * not a warning — a grid of grey "none" chips reads as a list of problems.
   */
  if (readiness.state === 'none') return null;
  return (
    <Badge variant={readiness.state === 'ready' ? 'default' : 'secondary'}>
      {readiness.state === 'ready' ? 'Ready' : 'In progress'}
    </Badge>
  );
}

/**
 * What an artifact was built from — **and the dangling case, which is the point.**
 *
 * > A dangling `sourceId` is a valid state, not an error. (Brief §1.2(7).)
 *
 * Deleting a source does not delete the artifacts made from it, so an id in
 * `sourceIds` may name a source `listSources` no longer returns. The contract's
 * rule, and the one this function implements:
 *
 * > **Use `sourceIds` to *link* to a source; use `sourcesSnapshot` to *name*
 * > one.**
 *
 * So the names come from the snapshot, which is frozen at generation and never
 * dangles — every source is named whether or not it still exists. `sourceIds`
 * only decides whether a name is *live*, and a deleted one is rendered struck
 * through with a title attribute saying what happened. It is not omitted: an
 * artifact that silently drops a source from its provenance is lying about what
 * it was built from, which is exactly what the snapshot exists to prevent.
 *
 * `fixtures.ts` ships `art-deck-abx` naming `src-pharm-deleted`, which
 * `listSources` does not return, so this path renders on the very first screen
 * of the pharmacology notebook.
 */
export function Provenance({
  artifact,
  liveSourceIds,
}: {
  artifact: Artifact;
  liveSourceIds: ReadonlySet<string>;
}) {
  if (artifact.sourcesSnapshot.length === 0) return null;

  const gone = artifact.sourcesSnapshot.filter(
    snapshot => !liveSourceIds.has(snapshot.sourceId),
  ).length;

  return (
    <p className="text-muted-foreground mt-hairline flex flex-wrap items-center gap-x-1 text-xs">
      {gone > 0 && (
        <TriangleAlertIcon
          className="size-3 shrink-0 text-(--color-grade-hard-mark)"
          aria-label={`${String(gone)} source${gone === 1 ? '' : 's'} deleted`}
        />
      )}
      <span className="sr-only">Built from </span>
      {artifact.sourcesSnapshot.map((snapshot, index) => {
        const live = liveSourceIds.has(snapshot.sourceId);
        return (
          <span key={snapshot.sourceId} className="min-w-0">
            <span
              className={live ? undefined : 'line-through'}
              title={live ? snapshot.title : `${snapshot.title} — deleted`}
            >
              {snapshot.title}
            </span>
            {/* Trailing, so a wrap never begins with a stray separator. */}
            {index < artifact.sourcesSnapshot.length - 1 && (
              <span aria-hidden> · </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
