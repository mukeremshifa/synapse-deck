/**
 * `/notebooks/{notebookId}/jobs` — starting work, and watching it.
 *
 * `addSource` and `createArtifact` both return a `Job`, never the finished
 * thing (brief §2.2, FR0 §3(2)). Reading a document and calling a model take
 * seconds to minutes, and an API that resolved them synchronously would design
 * a client that cannot show progress.
 *
 * **No SQL here** (§3.1 rule 3); `userId` comes only from the verified JWT
 * (rule 4).
 *
 * ── Four kinds generate, and only one of them existed before ──────────────
 *
 * The pre-FR7 pipeline made cards and nothing else. Quiz, note set and exam
 * generation are new. All four run through `runJob` below, which reports **the
 * stages FR4's UI displays** — that mapping was FR4's discipline and this is
 * the other half of it. A job that reported a stage no surface renders is a
 * progress bar that stalls on a name the user has never seen.
 */

import {
  createArtifact,
  finishArtifact,
  getArtifactById,
} from '../data/artifacts.ts';
import { createArtifactCards, type FreshScheduling } from '../data/cards.ts';
import { createNoteBlocks } from '../data/note-blocks.ts';
import {
  createNotebookJob,
  getNotebookJob,
  listNotebookJobs,
  updateNotebookJob,
  type NotebookJobRow,
} from '../data/notebook-jobs.ts';
import { notebookExists } from '../data/notebooks.ts';
import { createQuestions } from '../data/questions.ts';
import {
  createSource,
  finishSource,
  getSourceTexts,
  liveSourceIds,
} from '../data/sources.ts';
import { reconcileNotebookTopics } from '../data/topics.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { resolveProvider } from '../lib/providers/index.ts';
import { ApiError, notFound } from '../lib/rows.ts';
import { toIso } from './mappers.ts';

/**
 * A never-reviewed card's FSRS state.
 *
 * These are the values `newCardScheduling` in `src/lib/fsrs.ts` returns, and
 * they are constants rather than an import on purpose: that module calls
 * `ts-fsrs` at runtime, and `services/api` deliberately ships one runtime
 * dependency (`pg`) so a Lambda bundle stays small enough that cold start is
 * about the VPC and nothing else.
 *
 * **This is a duplication, and it is bounded.** A new card is by definition one
 * nothing has happened to: every counter is zero, there is no stability or
 * difficulty yet, and it is due immediately. `due` is the only field with any
 * arithmetic behind it, and `createEmptyCard(now).due` is `now`. If FSRS ever
 * gives a fresh card a non-trivial schedule, this stops being true and the
 * dependency has to be re-decided rather than this constant edited.
 */
function freshScheduling(now: Date): FreshScheduling {
  return {
    fsrs_state: 'new',
    // `createEmptyCard(now).due` is `now`: a new card is available immediately.
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
    scheduled_days: 0,
    elapsed_days: 0,
    learning_steps: 0,
  };
}

/** The contract's `Job`. */
function toJob(row: NotebookJobRow) {
  return {
    id: row.id,
    notebookId: row.notebook_id ?? '',
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    unitsTotal: row.chunk_count,
    unitsCompleted: row.chunks_completed,
    unitsFailed: row.units_failed,
    truncated: row.truncated,
    error: row.error
      ? { code: row.error_code ?? 'internal', message: row.error }
      : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    // **Populated only on success**, as the contract requires. The row knows
    // its `artifact_id` from creation (migration 0011), which is what lets a
    // *running* job be matched to what it is building; publishing it only on
    // success keeps the contract's promise intact.
    result:
      row.status === 'succeeded'
        ? {
            artifactId: row.artifact_id ?? undefined,
            sourceId: row.source_id ?? undefined,
          }
        : null,
  };
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    const notebookId = event.pathParameters?.['notebookId'];
    if (!notebookId) throw new ApiError(400, 'A notebook id is required.');
    if (!(await notebookExists(userId, notebookId))) throw notFound('Notebook');

    const jobId = event.pathParameters?.['jobId'];

    if (jobId !== undefined) {
      if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);
      const row = await getNotebookJob(userId, notebookId, jobId);
      if (!row) throw notFound('Job');
      return json(200, toJob(row));
    }

    if (method === 'GET') {
      const rows = await listNotebookJobs(userId, notebookId);
      return json(200, rows.map(toJob));
    }

    if (method !== 'POST') throw new ApiError(405, `${method} is not allowed here.`);

    const body = readJsonBody(event) as { type?: unknown; input?: unknown };
    if (body.type === 'add-source') {
      return json(202, await startAddSource(userId, notebookId, body.input));
    }
    if (body.type === 'create-artifact') {
      return json(202, await startCreateArtifact(userId, notebookId, body.input));
    }
    throw new ApiError(400, 'A job needs a type of "add-source" or "create-artifact".');
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}

// ---------------------------------------------------------------------------
// add-source
// ---------------------------------------------------------------------------

/**
 * Add a source, and read it.
 *
 * The source row is created immediately, `processing`, so the sources pane can
 * show it before the text has been extracted — which is why `Source` has a
 * `status` at all.
 */
async function startAddSource(
  userId: string,
  notebookId: string,
  raw: unknown,
): Promise<unknown> {
  const input = (raw ?? {}) as {
    kind?: unknown;
    title?: unknown;
    text?: unknown;
    url?: unknown;
    objectId?: unknown;
  };
  const kind =
    input.kind === 'text' || input.kind === 'document' || input.kind === 'url'
      ? input.kind
      : 'text';
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 255)
      : 'Untitled source';
  const text = typeof input.text === 'string' ? input.text : null;

  const source = await createSource(userId, {
    notebookId,
    kind,
    title,
    status: 'processing',
    content: text,
    sizeBytes: text ? text.length : null,
    objectId: typeof input.objectId === 'string' ? input.objectId : null,
  });

  const job = await createNotebookJob(userId, {
    notebookId,
    kind: 'add-source',
    sourceId: source.id,
  });

  // Fulfilled in the background. The response is the job, immediately.
  void runAddSource(userId, job.id, source.id, text);
  return toJob(job);
}

async function runAddSource(
  userId: string,
  jobId: string,
  sourceId: string,
  text: string | null,
): Promise<void> {
  try {
    await updateNotebookJob(userId, jobId, {
      status: 'running',
      stage: 'extracting',
    });

    if (!text || !text.trim()) {
      await finishSource(userId, sourceId, {
        status: 'failed',
        error: 'That source had no readable text.',
      });
      await updateNotebookJob(userId, jobId, {
        status: 'failed',
        stage: 'done',
        error: 'That source had no readable text.',
        errorCode: 'empty_source',
      });
      return;
    }

    await updateNotebookJob(userId, jobId, { stage: 'saving' });
    await finishSource(userId, sourceId, {
      status: 'ready',
      content: text,
      sizeBytes: text.length,
    });
    await updateNotebookJob(userId, jobId, { status: 'succeeded', stage: 'done' });
  } catch (error) {
    await failJob(userId, jobId, error);
    await finishSource(userId, sourceId, {
      status: 'failed',
      error: 'That source could not be read.',
    });
  }
}

// ---------------------------------------------------------------------------
// create-artifact
// ---------------------------------------------------------------------------

/**
 * Start a generation.
 *
 * The artifact row is created `generating` before the job runs, so it is a
 * real, listable row while the work happens — greyed and unopenable, which the
 * contract requires and FR4's UI renders.
 *
 * **No cross-notebook sources** (brief §1.2(6)): the ids are checked against
 * this notebook and the request is rejected if any is foreign, rather than the
 * foreign ones being silently dropped.
 */
async function startCreateArtifact(
  userId: string,
  notebookId: string,
  raw: unknown,
): Promise<unknown> {
  const input = (raw ?? {}) as {
    kind?: unknown;
    title?: unknown;
    sourceIds?: unknown;
    cardCount?: unknown;
    cardKinds?: unknown;
    questionCount?: unknown;
    depth?: unknown;
    config?: unknown;
    blueprint?: unknown;
  };

  const kind = input.kind;
  if (kind !== 'deck' && kind !== 'quiz' && kind !== 'noteset' && kind !== 'exam') {
    throw new ApiError(400, 'An artifact kind is required.');
  }
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 200)
      : 'Untitled';

  const requested = Array.isArray(input.sourceIds)
    ? input.sourceIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (requested.length === 0) {
    throw new ApiError(400, 'Generating needs at least one source.');
  }

  const live = new Set(await liveSourceIds(userId, notebookId));
  const foreign = requested.filter(id => !live.has(id));
  if (foreign.length > 0) {
    // Rejected rather than filtered: silently dropping a source produces an
    // artifact the user believes covers material it never saw.
    throw new ApiError(400, 'Every source must belong to this notebook.');
  }

  const texts = await getSourceTexts(userId, notebookId, requested);
  const snapshot = texts.map(source => ({
    sourceId: source.id,
    title: source.title,
    kind: source.kind,
  }));

  const artifact = await createArtifact(userId, {
    notebookId,
    kind,
    title,
    status: 'generating',
    sourceIds: requested,
    sourcesSnapshot: snapshot,
    // Only what cannot be derived is stored. An exam's config and blueprint
    // are inputs; every count is computed on read.
    payload:
      kind === 'noteset'
        ? { origin: 'generated' }
        : kind === 'exam'
          ? {
              config: input.config ?? { questionCount: 20, durationMinutes: 30 },
              blueprint: input.blueprint ?? { weights: [], basis: 'card-counts' },
            }
          : {},
  });

  const job = await createNotebookJob(userId, {
    notebookId,
    kind: 'create-artifact',
    artifactId: artifact.id,
  });

  void runCreateArtifact(userId, notebookId, job.id, artifact.id, {
    kind,
    depth:
      input.depth === 'recall' || input.depth === 'deep' ? input.depth : 'balanced',
    cardCount: clamp(input.cardCount, 1, 50, 12),
    cardKinds: Array.isArray(input.cardKinds)
      ? (input.cardKinds.filter(
          (value): value is 'basic' | 'cloze' | 'mcq' =>
            value === 'basic' || value === 'cloze' || value === 'mcq',
        ) ?? ['basic'])
      : ['basic'],
    questionCount: clamp(input.questionCount, 1, 50, 10),
    texts: texts.map(source => ({
      id: source.id,
      title: source.title,
      content: source.content ?? '',
    })),
  });

  return toJob(job);
}

interface GenerationPlan {
  kind: 'deck' | 'quiz' | 'noteset' | 'exam';
  depth: 'recall' | 'balanced' | 'deep';
  cardCount: number;
  cardKinds: ('basic' | 'cloze' | 'mcq')[];
  questionCount: number;
  texts: { id: string; title: string; content: string }[];
}

/**
 * Run a generation to completion, reporting the contract's stages as it goes.
 *
 * One provider call per source rather than per chunk: the sources here are
 * already the unit the user chose, and `unitsTotal`/`unitsCompleted` count them
 * so the progress bar means something a user can see on screen.
 *
 * **A partial success is still a success.** If one source of four fails, the
 * artifact keeps what the other three produced, `unitsFailed` records the loss
 * and `truncated` says so — the review gate's whole reason for existing is that
 * the user should see what did not make it in.
 */
async function runCreateArtifact(
  userId: string,
  notebookId: string,
  jobId: string,
  artifactId: string,
  plan: GenerationPlan,
): Promise<void> {
  try {
    const usable = plan.texts.filter(source => source.content.trim().length > 0);

    await updateNotebookJob(userId, jobId, {
      status: 'running',
      stage: 'splitting',
      unitsTotal: usable.length,
    });

    if (usable.length === 0) {
      await finishArtifact(userId, artifactId, {
        status: 'failed',
        error: 'None of the chosen sources had readable text.',
      });
      await updateNotebookJob(userId, jobId, {
        status: 'failed',
        stage: 'done',
        error: 'None of the chosen sources had readable text.',
        errorCode: 'empty_source',
      });
      return;
    }

    await updateNotebookJob(userId, jobId, { stage: 'generating' });

    const provider = resolveProvider();
    const cards: { payload: unknown; sourceExcerpt: string | null; topic: string | null }[] =
      [];
    const topicNames: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const source of usable) {
      try {
        // Every kind is generated from the same card call. Quiz and exam
        // questions are MCQs, and a note set is prose — see `blocksFrom`.
        const result = await provider.generateChunk({
          text: source.content.slice(0, 20000),
          cardCount: plan.kind === 'deck' ? plan.cardCount : plan.questionCount,
          kinds: plan.kind === 'deck' ? plan.cardKinds : ['mcq'],
          depth: plan.depth,
        });
        for (const payload of result.cards) {
          cards.push({
            payload,
            sourceExcerpt: source.content.slice(0, 500),
            topic: result.topics[0] ?? null,
          });
        }
        topicNames.push(...result.topics);
        completed += 1;
      } catch {
        // One source failing must not cost the others. The count is what the
        // user is shown, rather than an exception that discards the rest.
        failed += 1;
      }
      await updateNotebookJob(userId, jobId, {
        unitsCompleted: completed,
        unitsFailed: failed,
      });
    }

    if (cards.length === 0) {
      await finishArtifact(userId, artifactId, {
        status: 'failed',
        error: 'The model returned nothing usable.',
      });
      await updateNotebookJob(userId, jobId, {
        status: 'failed',
        stage: 'done',
        error: 'The model returned nothing usable.',
        errorCode: 'generation_failed',
        unitsFailed: failed,
      });
      return;
    }

    await updateNotebookJob(userId, jobId, { stage: 'saving' });

    // Topics are reconciled per notebook, not per user — the cross-notebook
    // bug migration 0010 fixes. See `reconcileNotebookTopics`.
    const reconciled = await reconcileNotebookTopics(
      userId,
      notebookId,
      topicNames.map(name => ({ name })),
    );
    const topicId = reconciled[0]?.topic.id ?? null;

    await writeContents(userId, artifactId, plan, cards, topicId);

    await finishArtifact(userId, artifactId, { status: 'ready', error: null });
    await updateNotebookJob(userId, jobId, {
      status: 'succeeded',
      stage: 'done',
      unitsCompleted: completed,
      unitsFailed: failed,
      truncated: failed > 0,
    });
  } catch (error) {
    await failJob(userId, jobId, error);
    await finishArtifact(userId, artifactId, {
      status: 'failed',
      error: 'Generation failed.',
    });
  }
}

/** Write the generated contents into whichever table this kind lives in. */
async function writeContents(
  userId: string,
  artifactId: string,
  plan: GenerationPlan,
  cards: { payload: unknown; sourceExcerpt: string | null; topic: string | null }[],
  topicId: string | null,
): Promise<void> {
  const artifact = await getArtifactById(userId, artifactId);
  if (!artifact) return;

  if (plan.kind === 'deck') {
    await createArtifactCards(
      userId,
      artifactId,
      cards.slice(0, plan.cardCount).map(card => ({
        kind: (card.payload as { kind?: string } | null)?.kind ?? 'basic',
        payload: card.payload,
        sourceExcerpt: card.sourceExcerpt,
        topicId,
      })),
      freshScheduling(new Date()),
    );
    return;
  }

  if (plan.kind === 'quiz' || plan.kind === 'exam') {
    // Only MCQs can be asked: grading free text needs a model and a rubric,
    // which the contract leaves out deliberately.
    const mcqs = cards.filter(
      card => (card.payload as { kind?: string } | null)?.kind === 'mcq',
    );
    await createQuestions(
      userId,
      mcqs.slice(0, plan.questionCount).map((card, index) => ({
        artifactId,
        payload: card.payload,
        topicId,
        position: index,
      })),
    );
    return;
  }

  // A note set: prose blocks, never one text blob (brief §1.2(2)).
  await createNoteBlocks(userId, blocksFrom(artifactId, plan, cards));
}

/**
 * Turn generated cards into note blocks.
 *
 * A note set is the same material read rather than drilled, so its blocks are
 * built from the same generation: a heading per source, and a paragraph per
 * card face. The discriminated union is what makes the later editor a feature
 * rather than a migration, so this writes real block types rather than dumping
 * text into one paragraph.
 */
function blocksFrom(
  artifactId: string,
  plan: GenerationPlan,
  cards: { payload: unknown; sourceExcerpt: string | null }[],
): { artifactId: string; block: unknown; position: number; sourceId: string | null }[] {
  const blocks: {
    artifactId: string;
    block: unknown;
    position: number;
    sourceId: string | null;
  }[] = [];
  let position = 0;
  const push = (block: unknown, sourceId: string | null) => {
    blocks.push({ artifactId, block, position, sourceId });
    position += 1;
  };

  const first = plan.texts[0];
  push({ type: 'heading', level: 1, text: first?.title ?? 'Notes' }, null);

  for (const card of cards) {
    const payload = card.payload as {
      kind?: string;
      front?: string;
      back?: string;
      text?: string;
      stem?: string;
    } | null;
    if (!payload) continue;

    if (payload.kind === 'basic' && payload.front && payload.back) {
      push({ type: 'heading', level: 2, text: payload.front }, null);
      push({ type: 'paragraph', text: payload.back }, null);
    } else if (payload.kind === 'cloze' && payload.text) {
      // The cloze markers are stripped: a note is read, not answered.
      push(
        { type: 'paragraph', text: payload.text.replace(/\{\{c\d+::(.*?)\}\}/g, '$1') },
        null,
      );
    } else if (payload.kind === 'mcq' && payload.stem) {
      push({ type: 'paragraph', text: payload.stem }, null);
    }
  }

  return blocks;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Mark a job failed, without letting the failure path throw. */
async function failJob(userId: string, jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  try {
    await updateNotebookJob(userId, jobId, {
      status: 'failed',
      stage: 'done',
      error: message,
      errorCode: 'internal',
    });
  } catch {
    // The job is already lost; throwing here would replace a recorded failure
    // with an unhandled rejection and tell the user nothing.
  }
}
