import { Link } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/layout';
import { EmptyState } from '@/components/states';
import { Provenance, ReadinessBadge } from '@/components/artifact-bits';
import { ARTIFACT_KINDS, type Artifact, type ArtifactKind } from '@/lib/api';
import { notebookPath } from '@/lib/notebooks';
import { plural } from '@/lib/format';

/**
 * Everything the notebook has produced, by kind, with its provenance —
 * **the thing nothing in the app could show before this screen.**
 *
 * The Studio already lists artifacts per kind. What it cannot do is put the
 * whole notebook's output in one place with what each was built from and how
 * ready each is, which is what makes this the overview's centre rather than a
 * second copy of the Studio.
 *
 * ── One notebook, named by the route ──────────────────────────────────────
 *
 * There is no notebook selector on this screen and there must never be one.
 * The old dashboard guessed a notebook; this page is *given* one by the URL,
 * and that difference is the whole reason the re-architecture happened. A
 * selector here is the guess coming back wearing a different hat (FR6 §2).
 */

const KIND_LABELS: Record<ArtifactKind, { one: string; many: string }> = {
  deck: { one: 'Deck', many: 'Decks' },
  quiz: { one: 'Quiz', many: 'Quizzes' },
  noteset: { one: 'Note set', many: 'Note sets' },
  exam: { one: 'Exam', many: 'Exams' },
};

export function ArtifactList({
  notebookId,
  artifacts,
  liveSourceIds,
}: {
  notebookId: string;
  artifacts: readonly Artifact[];
  /**
   * The sources that still exist. Used **only** to decide whether a name in a
   * snapshot is live — never to resolve a name, which comes from the snapshot.
   */
  liveSourceIds: ReadonlySet<string>;
}) {
  if (artifacts.length === 0) {
    return (
      <EmptyState
        title="Nothing generated yet"
        description="Decks, quizzes, note sets and exams made from this notebook's sources will be listed here, each with what it was built from."
        action={
          <Link
            to={notebookPath.open(notebookId)}
            className="text-sm underline underline-offset-4"
          >
            Back to the notebook
          </Link>
        }
      />
    );
  }

  /*
   * Grouped by kind, in the contract's own kind order rather than one declared
   * here. `ARTIFACT_KINDS` is `ArtifactKind.options`, so a fifth kind added to
   * the contract appears in this list without anyone editing it — the same
   * property §3 asks of readiness, applied to the grouping.
   */
  return (
    <div className="gap-gutter flex flex-col">
      {ARTIFACT_KINDS.map(kind => {
        const own = artifacts.filter(artifact => artifact.kind === kind);
        if (own.length === 0) return null;
        const label = KIND_LABELS[kind];
        return (
          <section key={kind}>
            <SectionHeader
              title={own.length === 1 ? label.one : label.many}
              description={countLine(kind, own)}
            />
            <ul className="mt-tight gap-tight flex flex-col">
              {own.map(artifact => (
                <li key={artifact.id}>
                  <ArtifactCard
                    artifact={artifact}
                    notebookId={notebookId}
                    liveSourceIds={liveSourceIds}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The one-line summary under a kind's heading.
 *
 * **Counts only `ready` artifacts** (FR4's drift row). A failed generation
 * keeps its row so the user can see what did not work, but it has no contents
 * at all — 0 cards, 0 questions, 0 blocks. A notebook with two failed decks
 * that reported "2 decks, 0 cards" would be describing decks that cannot be
 * opened, so the summary counts what is openable and the rows below say what
 * happened to the rest.
 */
function countLine(kind: ArtifactKind, artifacts: readonly Artifact[]): string {
  const ready = artifacts.filter(artifact => artifact.status === 'ready');
  const unready = artifacts.length - ready.length;
  const suffix = unready === 0 ? '' : ` · ${String(unready)} not ready`;

  let total = 0;
  for (const artifact of ready) {
    switch (artifact.payload.kind) {
      case 'deck':
        total += artifact.payload.cardCount;
        break;
      case 'quiz':
      case 'exam':
        total += artifact.payload.questionCount;
        break;
      case 'noteset':
        total += artifact.payload.topicCount;
        break;
    }
  }

  const noun = kind === 'deck' ? 'card' : kind === 'noteset' ? 'topic' : 'question';
  return `${plural(total, noun)}${suffix}`;
}

/**
 * One artifact: what it is, how ready it is, and what it was built from.
 *
 * A `generating` or `failed` artifact is a real, listable row that is **not a
 * link** — the contract calls `generating` "greyed, unopenable", and a failed
 * one has nothing to open. Both keep their row rather than vanishing, which is
 * the alternative to a generate button that appears to have done nothing.
 */
function ArtifactCard({
  artifact,
  notebookId,
  liveSourceIds,
}: {
  artifact: Artifact;
  notebookId: string;
  liveSourceIds: ReadonlySet<string>;
}) {
  const body = (
    <CardContent className="py-snug">
      <div className="gap-tight flex items-start">
        <p className="min-w-0 flex-1 truncate font-medium" title={artifact.title}>
          {artifact.title}
        </p>
        <ReadinessBadge readiness={artifact.readiness} status={artifact.status} />
      </div>

      {/*
        Server-computed and rendered exactly as received — "12 cards due", "3 of
        8 questions unsat". The overview does not recompute it, which is what
        makes criterion 3's agreement with home structural: both render the same
        string from the same field.
      */}
      <p className="text-muted-foreground mt-hairline text-sm">
        {artifact.readiness.detail}
      </p>

      <Provenance artifact={artifact} liveSourceIds={liveSourceIds} />
    </CardContent>
  );

  if (artifact.status !== 'ready') {
    return <Card className="bg-muted/30 text-muted-foreground">{body}</Card>;
  }

  return (
    <Card className="hover:bg-accent transition-colors">
      <Link to={runnerPath(notebookId, artifact)} className="block">
        {body}
      </Link>
    </Card>
  );
}

/**
 * Where an artifact opens. **Every runner names its artifact** — FR2's route
 * change, and the reason these helpers require an id: a caller with none to
 * pass is a surface that was about to guess, and it now fails to compile.
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
