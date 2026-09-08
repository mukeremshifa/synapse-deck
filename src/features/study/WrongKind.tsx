import { Link } from 'react-router-dom';
import { SignpostIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/states';
import { notebookPath } from '@/lib/notebooks';
import type { Artifact, ArtifactKind } from '@/lib/api';

/**
 * The route named one kind and the id turned out to be another.
 *
 * ── Why this is a real state and not defensive padding ───────────────────
 *
 * FR3 makes only `ready` artifacts into links, and each link is built by
 * `runnerPath`, which maps a kind to its route — so the ordinary path can never
 * produce this. **A pasted or bookmarked URL still can**, and so can a link
 * from before an artifact was deleted and its id reused. The drift log's
 * standing instruction is not to rely on the guarded path alone.
 *
 * What it does about it matters more than that it exists: the artifact *does*
 * exist and the user *can* open it — just not here. So this offers the door
 * rather than a 404, which would say the thing they asked for is missing when
 * it is one route away.
 *
 * A `generating` or `failed` artifact lands here too, through `NotReady`: those
 * have no contents to run, and the honest answer is the notebook, where FR4's
 * job panel is showing what is happening to them.
 */
export function WrongKind({
  notebookId,
  artifact,
  expected,
}: {
  notebookId: string;
  artifact: Artifact;
  expected: ArtifactKind;
}) {
  return (
    <EmptyState
      icon={<SignpostIcon />}
      title={`That is a ${KIND_NOUN[artifact.kind]}, not a ${KIND_NOUN[expected]}`}
      description={
        <>
          <span className="text-foreground font-medium">{artifact.title}</span> exists in
          this notebook, but it opens somewhere else.
        </>
      }
      action={
        <Button asChild>
          <Link to={runnerPath(notebookId, artifact)}>
            Open the {KIND_NOUN[artifact.kind]}
          </Link>
        </Button>
      }
    />
  );
}

/**
 * The artifact is real and the right kind, but it has nothing to run yet.
 *
 * `generating` and `failed` are listable states (the contract's `Artifact`
 * comment), so the row exists in the Studio either way — greyed while a job
 * runs, kept after one fails so the failure can be seen and acted on. Neither
 * has contents, and a runner that opened one anyway would show an empty session
 * and call it done.
 *
 * **The way out is the notebook, deliberately.** FR4's job panel lives there
 * and is the only thing watching generation; a "Try again" here would be a
 * second mechanism for something that already has one.
 */
export function NotReady({
  notebookId,
  artifact,
}: {
  notebookId: string;
  artifact: Artifact;
}) {
  const generating = artifact.status === 'generating';
  return (
    <EmptyState
      icon={<SignpostIcon />}
      title={generating ? 'Still being generated' : 'This never finished generating'}
      description={
        generating ? (
          <>
            <span className="text-foreground font-medium">{artifact.title}</span> is still
            being written. The notebook shows how far along it is.
          </>
        ) : (
          <>
            Generating{' '}
            <span className="text-foreground font-medium">{artifact.title}</span> failed,
            so it has no contents to open. The notebook says why, and can try again.
          </>
        )
      }
      action={
        <Button asChild>
          <Link to={notebookPath.open(notebookId)}>Back to the notebook</Link>
        </Button>
      }
    />
  );
}

const KIND_NOUN: Record<ArtifactKind, string> = {
  deck: 'deck',
  quiz: 'quiz',
  exam: 'exam',
  noteset: 'note set',
};

/**
 * Where an artifact opens. The same mapping `StudioPane` uses — every runner
 * names its artifact, so every one of these takes an id.
 */
function runnerPath(notebookId: string, artifact: Artifact): string {
  switch (artifact.kind) {
    case 'deck':
      return notebookPath.practice(notebookId, artifact.id);
    case 'quiz':
      return notebookPath.quiz(notebookId, artifact.id);
    case 'exam':
      return notebookPath.exam(notebookId, artifact.id);
    case 'noteset':
      return notebookPath.notes(notebookId, artifact.id);
  }
}
