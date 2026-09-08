import { Link } from 'react-router-dom';
import { CheckCircle2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Artifact, Job } from '@/lib/api';
import { notebookPath } from '@/lib/notebooks';
import { JobProgress } from './JobProgress';
import { runningJobs } from './jobs';

/**
 * What is being generated right now, at the top of the Studio. **FR4 task 2.**
 *
 * ═══ Why the progress lives here and not in the modal ════════════════════
 *
 * The generate modal closes the moment the job starts, and that is deliberate:
 * a generation takes tens of seconds to minutes, and a modal is a **decision**
 * surface — holding one open to watch a bar is a decision the user already
 * made, blocking the notebook they might reasonably want to use meanwhile.
 *
 * So progress lives in the Studio, beside the artifact it is building. Two
 * things follow, and both are FR4 acceptance criteria:
 *
 * - **Generation never navigates away** (criterion 2). It starts where you are.
 * - **Progress survives navigating away and back** (criterion 4), because this
 *   renders from `listJobs` rather than from anything the modal held. Leave the
 *   notebook, come back, reload the tab — the panel is drawn from the server's
 *   answer to "what is running?". See `jobs.ts` §6.1 for that decision.
 *
 * ── Why progress is a panel and not a bar inside each row ───────────────
 *
 * The obvious design is a progress bar on the `generating` artifact row itself.
 * **The contract does not allow it**, and the limitation is deliberate rather
 * than an oversight: `Job.result` — the only field naming what a job produced —
 * is documented as "populated only on `succeeded`". So while a job is running
 * there is no way to say *which* artifact it is building. Matching on title or
 * on creation time would be a guess, and a guess that puts one generation's
 * progress on another generation's row.
 *
 * A panel listing what is running sidesteps the question entirely: it says how
 * many generations are in flight and how far each has got, without claiming a
 * link it cannot establish. Recorded for FR7, which owns the contract's
 * backend and could add a running `result.artifactId` if a per-row bar is
 * later judged worth it.
 *
 * ── Both callers, not just the modal ─────────────────────────────────────
 *
 * FR3's drift row is explicit that there are two: the generate modal, and
 * **save-response-as-note** from the chat pane, which is a `createArtifact` of
 * kind `noteset` and returns a `Job` like any other. Neither is special here —
 * this renders whatever `listJobs` reports, so a note saved from chat gets the
 * same progress and the same failure surface for free. Anything that starts a
 * job in future does too, without touching this file.
 */
export function GenerationPanel({
  notebookId,
  jobs,
  artifacts,
  onRetry,
  onDismissFailed,
}: {
  notebookId: string;
  jobs: Job[] | undefined;
  artifacts: Artifact[] | undefined;
  /** Reopen the generate modal for the kind that failed. */
  onRetry: (artifact: Artifact) => void;
  /** Remove a failed artifact's row once the user has seen it. */
  onDismissFailed: (artifact: Artifact) => void;
}) {
  const running = runningJobs(jobs);
  const failed = failedGenerations(jobs, artifacts);
  const truncated = truncatedCompletions(jobs, artifacts);

  if (running.length === 0 && failed.length === 0 && truncated.length === 0) return null;

  return (
    <div className="flex flex-col gap-tight">
      {running.map(job => (
        <JobProgress key={job.id} job={job} />
      ))}

      {/*
        A failure is rendered from the **job**, because that is the only thing
        that carries the reason — see `failedGenerations` for why the artifact
        cannot be matched to it, and what that costs.
      */}
      {failed.map(({ job, artifact }) => (
        <FailedGeneration
          key={job.id}
          job={job}
          artifact={artifact}
          onRetry={artifact ? () => { onRetry(artifact); } : undefined}
          onDismiss={artifact ? () => { onDismissFailed(artifact); } : undefined}
        />
      ))}

      {/*
        **The review gate, as what this contract can honestly support.**
        Partial success is the case it exists for — the contract says so on
        `Job.truncated`: "the user should see what did *not* make it in."
      */}
      {truncated.map(({ job, artifact }) => (
        <TruncatedCompletion
          key={job.id}
          job={job}
          artifact={artifact}
          notebookId={notebookId}
        />
      ))}
    </div>
  );
}

/**
 * Failed generations, paired with the artifact each left behind where one can
 * be identified.
 *
 * ── Which way round this goes, and why it matters ────────────────────────
 *
 * **The job is the record of the failure; the artifact is the record of the
 * mess.** Only the job carries `error.code`, and only the artifact survives
 * once the job ages out of the recent list. So the list is driven by jobs — a
 * failure with no reason is a failure the user cannot act on, and rendering
 * from artifacts produced exactly that. Found in a browser: every injected
 * `quota_exceeded` rendered as "stopped without reporting a reason".
 *
 * The pairing is best-effort by design. `Job.result` is documented as populated
 * *only on success*, so a failed job does not name what it was building. The
 * artifact is therefore matched by the one property that does correlate — a
 * `failed` artifact created around the same time — and where no match is found
 * the failure is still shown, just without the buttons that need an artifact
 * id. Reporting a failure with no controls beats hiding it.
 *
 * Artifacts left `failed` with no job to explain them get a row of their own,
 * so a user returning long after the fact still learns that something did not
 * work.
 */
function failedGenerations(
  jobs: Job[] | undefined,
  artifacts: Artifact[] | undefined,
): { job: Job; artifact: Artifact | undefined }[] {
  const failedArtifacts = (artifacts ?? []).filter(
    artifact => artifact.status === 'failed',
  );
  const claimed = new Set<string>();

  const fromJobs = (jobs ?? [])
    .filter(job => job.status === 'failed' && job.kind === 'create-artifact')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(job => {
      const artifact = failedArtifacts.find(
        candidate => !claimed.has(candidate.id) && candidate.createdAt <= job.updatedAt,
      );
      if (artifact) claimed.add(artifact.id);
      return { job, artifact };
    });

  /*
   * A failed artifact whose job is gone. Synthesised so the row still renders,
   * with a null error that `failureFromJob` states honestly rather than showing
   * an empty box.
   */
  const orphans = failedArtifacts
    .filter(artifact => !claimed.has(artifact.id))
    .map(artifact => ({
      job: {
        id: `orphan-${artifact.id}`,
        notebookId: artifact.notebookId,
        kind: 'create-artifact' as const,
        status: 'failed' as const,
        stage: 'queued' as const,
        unitsTotal: 0,
        unitsCompleted: 0,
        unitsFailed: 0,
        truncated: false,
        error: null,
        createdAt: artifact.createdAt,
        updatedAt: artifact.createdAt,
        result: null,
      },
      artifact,
    }));

  return [...fromJobs, ...orphans];
}

/**
 * Jobs that succeeded but did not produce everything they were asked for.
 *
 * A clean success gets no panel at all — the artifact simply appears in the
 * list, ready, which is the whole outcome and needs no announcement. Only a
 * **partial** success has something to say, and saying it is the point:
 *
 * > A deck that quietly contains three quarters of a document is a product
 * > that lies.
 */
function truncatedCompletions(
  jobs: Job[] | undefined,
  artifacts: Artifact[] | undefined,
): { job: Job; artifact: Artifact }[] {
  const byId = new Map((artifacts ?? []).map(artifact => [artifact.id, artifact]));
  return (jobs ?? [])
    .filter(job => job.status === 'succeeded' && job.truncated)
    .flatMap(job => {
      const artifactId = job.result?.artifactId ?? null;
      if (artifactId === null) return [];
      const artifact = byId.get(artifactId);
      if (!artifact || artifact.status !== 'ready') return [];
      return [{ job, artifact }];
    });
}

function FailedGeneration({
  job,
  artifact,
  onRetry,
  onDismiss,
}: {
  job: Job;
  /** Absent when the failure could not be matched to a row. */
  artifact: Artifact | undefined;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex flex-col gap-hairline">
      {artifact && (
        <p className="text-muted-foreground truncate text-xs" title={artifact.title}>
          {artifact.title}
        </p>
      )}
      <JobProgress job={job} onRetry={onRetry} onDismiss={onDismiss} />
    </div>
  );
}

/**
 * A generation that finished with gaps — the surface Task 4 asks for.
 *
 * **Its exit is "close"**, which is the property that removes a whole bug
 * class: the page this replaces navigated to a route that did not exist when
 * the user finished with it. There is nowhere to navigate to here, so there is
 * nothing to get wrong.
 */
function TruncatedCompletion({
  job,
  artifact,
  notebookId,
}: {
  job: Job;
  artifact: Artifact;
  notebookId: string;
}) {
  return (
    <div className="border-border-strong flex flex-col gap-tight rounded-lg border p-snug">
      <div className="flex items-start gap-tight">
        <CheckCircle2Icon
          className="mt-0.5 size-4 shrink-0 text-(--color-grade-easy-mark)"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-hairline">
          <p className="text-sm font-medium">{artifact.title} is ready, with gaps</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {job.unitsFailed > 0
              ? `${String(job.unitsCompleted)} of ${String(job.unitsTotal)} sections produced content; ${String(job.unitsFailed)} could not be used. What is here is complete and usable — the rest of your sources are not represented in it.`
              : 'This was longer than one generation covers, so only the first part of your sources was used.'}
          </p>
        </div>
      </div>
      <div className="flex gap-tight">
        <Button size="sm" asChild>
          <Link to={runnerPath(notebookId, artifact)}>Open it</Link>
        </Button>
      </div>
    </div>
  );
}

/** Where an artifact opens. Every runner names its artifact (FR2). */
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
