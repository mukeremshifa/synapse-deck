/**
 * The `artifacts` table — the central noun, and its computed counts.
 *
 * One kind-tagged table, not four (brief §1.1). See the header of
 * `services/api/migrations/0010_notebooks.sql` for why, and do not "simplify"
 * it back into four parallel tables.
 *
 * Every statement carries `where user_id = $1`, and every statement that
 * reaches an artifact through its notebook filters on both ids (ADR 0008).
 *
 * ── The counts are computed, and joined rather than correlated ────────────
 *
 * `ArtifactPayload` carries per-kind counts — a deck's card/due/new, a quiz's
 * question/answered, a note set's block/read, an exam's question/attempt. None
 * of them is stored: a stored count drifts the first time a write fails halfway.
 *
 * **FR6 §8.4 named the shape to avoid.** The fake recomputes each artifact's
 * readiness by walking the card, question, attempt and note-block stores on
 * every read, and `listArtifacts` does that per row. In SQL that is a
 * correlated subquery per artifact — fine at 6, a table scan at 600.
 *
 * So all four count sets arrive as `left join`ed aggregates, grouped by
 * `artifact_id` and index-covered by `cards_artifact_status_idx`,
 * `questions_artifact_idx`, `note_blocks_artifact_idx` and
 * `attempts_artifact_idx`. One row per artifact crosses the wire.
 */

import { query } from '../lib/db.ts';
import type { ArtifactKind, ArtifactRow, ArtifactStatus } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, notebook_id, kind, title, status, error, source_ids, ' +
  'sources_snapshot, payload, created_at, updated_at';

/** An artifact with every count its kind's payload needs. */
export interface ArtifactWithCounts extends ArtifactRow {
  cardCount: number;
  dueCount: number;
  newCount: number;
  questionCount: number;
  answeredCount: number;
  blockCount: number;
  readBlockCount: number;
  attemptCount: number;
}

/**
 * `$2` is the server's clock, for the due count.
 *
 * `answeredCount` counts **distinct questions** answered at least once across
 * this quiz's attempts, not answer rows: sitting the same quiz twice must not
 * report twice as many questions answered as the quiz has.
 */
const COUNTS_JOIN = `
  left join (
    select artifact_id,
           count(*) filter (where status = 'active')::int                    as cards,
           count(*) filter (where status = 'active'
                              and fsrs_state <> 'new' and due <= $2)::int    as due,
           count(*) filter (where status = 'active' and fsrs_state = 'new')::int as fresh
      from public.cards
     where user_id = $1 and artifact_id is not null
     group by artifact_id
  ) c on c.artifact_id = a.id
  left join (
    select artifact_id, count(*)::int as questions
      from public.questions
     where user_id = $1
     group by artifact_id
  ) q on q.artifact_id = a.id
  left join (
    select artifact_id,
           count(*)::int                                    as blocks,
           count(*) filter (where read_at is not null)::int  as read_blocks
      from public.note_blocks
     where user_id = $1
     group by artifact_id
  ) nb on nb.artifact_id = a.id
  left join (
    select artifact_id, count(*)::int as attempts
      from public.attempts
     where user_id = $1
     group by artifact_id
  ) at on at.artifact_id = a.id
  left join (
    select t.artifact_id, count(distinct t.question_id)::int as answered
      from (
        select att.artifact_id, aa.question_id
          from public.attempt_answers aa
          join public.attempts att on att.id = aa.attempt_id
         where aa.user_id = $1
           and att.user_id = $1
           and aa.selected_option is not null
      ) t
     where t.question_id is not null
     group by t.artifact_id
  ) ans on ans.artifact_id = a.id`;

const COUNTS_SELECT = `
  coalesce(c.cards, 0)        as "cardCount",
  coalesce(c.due, 0)          as "dueCount",
  coalesce(c.fresh, 0)        as "newCount",
  coalesce(q.questions, 0)    as "questionCount",
  coalesce(ans.answered, 0)   as "answeredCount",
  coalesce(nb.blocks, 0)      as "blockCount",
  coalesce(nb.read_blocks, 0) as "readBlockCount",
  coalesce(at.attempts, 0)    as "attemptCount"`;

const SELECT_LIST = COLUMNS.split(', ')
  .map(column => `a.${column}`)
  .join(', ');

/**
 * A notebook's artifacts, newest first, optionally narrowed to one kind.
 *
 * Keyset pagination on `(created_at, id)`, for the reason `listNotebooks`
 * gives. **Every status is returned**, including `generating` and `failed`:
 * both are real, listable rows the contract requires — a generating artifact
 * shows greyed and unopenable, a failed one keeps its row so the user can see
 * what did not work and retry.
 */
export async function listArtifacts(
  userId: string,
  notebookId: string,
  now: Date,
  limit: number,
  cursor: { createdAt: string; id: string } | null,
  kind?: ArtifactKind,
): Promise<ArtifactWithCounts[]> {
  const params: unknown[] = [userId, now.toISOString(), notebookId, limit];
  let filter = '';
  if (kind) {
    filter += ` and a.kind = $${params.length + 1}`;
    params.push(kind);
  }
  if (cursor) {
    filter += ` and (a.created_at, a.id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid)`;
    params.push(cursor.createdAt, cursor.id);
  }

  const result = await query<ArtifactWithCounts>(
    `select ${SELECT_LIST}, ${COUNTS_SELECT}
       from public.artifacts a
       ${COUNTS_JOIN}
      where a.user_id = $1 and a.notebook_id = $3${filter}
      order by a.created_at desc, a.id desc
      limit $4`,
    params,
  );
  return result.rows;
}

export async function getArtifact(
  userId: string,
  notebookId: string,
  artifactId: string,
  now: Date,
): Promise<ArtifactWithCounts | null> {
  const result = await query<ArtifactWithCounts>(
    `select ${SELECT_LIST}, ${COUNTS_SELECT}
       from public.artifacts a
       ${COUNTS_JOIN}
      where a.user_id = $1 and a.notebook_id = $3 and a.id = $4`,
    [userId, now.toISOString(), notebookId, artifactId],
  );
  return result.rows[0] ?? null;
}

/**
 * The same fetch without the notebook in the path.
 *
 * The runners route by artifact id and already know their notebook, but the
 * pipeline does not — it holds an artifact id and needs the row. Still filtered
 * on `user_id`, which is the boundary that matters.
 */
export async function getArtifactById(
  userId: string,
  artifactId: string,
): Promise<ArtifactRow | null> {
  const result = await query<ArtifactRow>(
    `select ${COLUMNS} from public.artifacts where user_id = $1 and id = $2`,
    [userId, artifactId],
  );
  return result.rows[0] ?? null;
}

export interface ArtifactInsert {
  notebookId: string;
  kind: ArtifactKind;
  title: string;
  status?: ArtifactStatus;
  sourceIds?: string[];
  sourcesSnapshot?: unknown;
  payload?: unknown;
}

export async function createArtifact(
  userId: string,
  input: ArtifactInsert,
): Promise<ArtifactRow> {
  const result = await query<ArtifactRow>(
    `insert into public.artifacts
       (user_id, notebook_id, kind, title, status, source_ids, sources_snapshot, payload)
     values ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb, $8::jsonb)
     returning ${COLUMNS}`,
    [
      userId,
      input.notebookId,
      input.kind,
      input.title,
      input.status ?? 'generating',
      input.sourceIds ?? [],
      JSON.stringify(input.sourcesSnapshot ?? []),
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

/**
 * Rename an artifact, and/or replace its blueprint.
 *
 * `updateArtifact` was widened by FR6 from `{ title }` to `{ title?, blueprint? }`
 * so the exam blueprint editor had something to call — FR4's generate modal had
 * promised the blueprint could be adjusted once the exam existed, and until
 * that widening there was no way to send one.
 *
 * The blueprint is merged into `payload` rather than replacing it, so an exam's
 * `config` survives a reweighting. `basis` becomes `'manual'` at the handler,
 * which is what `'manual'` exists to record: a UI that must explain how a
 * weighting was arrived at has to be able to say "you set this".
 */
export async function updateArtifact(
  userId: string,
  notebookId: string,
  artifactId: string,
  input: { title?: string; blueprint?: unknown },
): Promise<ArtifactRow | null> {
  const result = await query<ArtifactRow>(
    `update public.artifacts
        set title = coalesce($4, title),
            payload = case
              when $5::jsonb is null then payload
              else payload || jsonb_build_object('blueprint', $5::jsonb)
            end
      where user_id = $1 and notebook_id = $2 and id = $3
      returning ${COLUMNS}`,
    [
      userId,
      notebookId,
      artifactId,
      input.title ?? null,
      input.blueprint === undefined ? null : JSON.stringify(input.blueprint),
    ],
  );
  return result.rows[0] ?? null;
}

/** Mark a generation finished, or failed with a reason the user can act on. */
export async function finishArtifact(
  userId: string,
  artifactId: string,
  input: { status: ArtifactStatus; error?: string | null; payload?: unknown },
): Promise<ArtifactRow | null> {
  const result = await query<ArtifactRow>(
    `update public.artifacts
        set status = $3,
            error = $4,
            payload = case when $5::jsonb is null then payload else payload || $5::jsonb end
      where user_id = $1 and id = $2
      returning ${COLUMNS}`,
    [
      userId,
      artifactId,
      input.status,
      input.error ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
    ],
  );
  return result.rows[0] ?? null;
}

/** Delete an artifact and its contents, which cascade by foreign key. */
export async function deleteArtifact(
  userId: string,
  notebookId: string,
  artifactId: string,
): Promise<boolean> {
  const result = await query(
    `delete from public.artifacts
      where user_id = $1 and notebook_id = $2 and id = $3`,
    [userId, notebookId, artifactId],
  );
  return (result.rowCount ?? 0) > 0;
}
