/**
 * The `notebooks` table, and the roll-up the home grid renders.
 *
 * Every statement here carries `where user_id = $1`, including the fetches
 * keyed by primary key. A notebook id is not a capability: it arrives from the
 * client, and treating "the client knew the id" as "the client owns the row" is
 * exactly the leak RLS used to make impossible. See ADR 0008.
 *
 * ── `counts` and `readiness` are computed, and how matters ────────────────
 *
 * The contract's `Notebook` carries `counts` (sources, artifacts, due cards)
 * and a `readiness` roll-up. Neither is a column: storing them would mean every
 * card review wrote back up the tree, and the first write that failed halfway
 * would leave the home grid lying.
 *
 * **FR6 §8.4 named the trap and this file avoids it.** The fake recomputes
 * readiness per notebook by walking its artifacts and then their cards, and
 * `listNotebooks` calls that per notebook — N notebooks × their artifacts ×
 * their cards. In memory that costs nothing; in SQL it is a correlated subquery
 * per row and a table scan at scale.
 *
 * So the counts arrive as three `left join`ed aggregate subqueries, each
 * grouped by notebook and each index-covered:
 *
 *   sources    `sources_notebook_idx`
 *   artifacts  `artifacts_notebook_idx`
 *   due cards  `cards_artifact_due_idx`, joined through artifacts
 *
 * One row per notebook crosses the wire, not one row per card — which is the
 * contract's own instruction on `Notebook.counts`: "a few aggregate columns,
 * not a nested graph".
 */

import { query } from '../lib/db.ts';
import type { NotebookRow } from '../lib/rows.ts';

const COLUMNS = 'id, user_id, title, description, created_at, updated_at';

/** A notebook with the three counts the home grid renders. */
export interface NotebookWithCounts extends NotebookRow {
  sourceCount: number;
  artifactCount: number;
  dueCards: number;
  /** Ready artifacts by kind, for the readiness sentence. */
  readyDecks: number;
  readyQuizzes: number;
  readyNotesets: number;
  readyExams: number;
}

/**
 * The counts, as three grouped subqueries.
 *
 * `$2` is the server's clock. The due count is a fact about the database and a
 * client with a skewed clock should not be able to shift it — the same reason
 * `listDecks` takes `now` rather than reading it inside the query.
 *
 * Only `status = 'ready'` artifacts contribute to the kind counts. FR4's drift
 * row: a `failed` artifact keeps its row with no contents at all, so counting
 * it would report decks that cannot be opened.
 */
const COUNTS_JOIN = `
  left join (
    select notebook_id, count(*)::int as n
      from public.sources
     where user_id = $1
     group by notebook_id
  ) s on s.notebook_id = n.id
  left join (
    select notebook_id,
           count(*)::int                                              as n,
           count(*) filter (where kind = 'deck'    and status = 'ready')::int as decks,
           count(*) filter (where kind = 'quiz'    and status = 'ready')::int as quizzes,
           count(*) filter (where kind = 'noteset' and status = 'ready')::int as notesets,
           count(*) filter (where kind = 'exam'    and status = 'ready')::int as exams
      from public.artifacts
     where user_id = $1
     group by notebook_id
  ) a on a.notebook_id = n.id
  left join (
    select art.notebook_id, count(*)::int as n
      from public.cards c
      join public.artifacts art on art.id = c.artifact_id
     where c.user_id = $1
       and art.user_id = $1
       and c.status = 'active'
       and c.fsrs_state <> 'new'
       and c.due <= $2
     group by art.notebook_id
  ) d on d.notebook_id = n.id`;

const COUNTS_SELECT = `
  coalesce(s.n, 0)        as "sourceCount",
  coalesce(a.n, 0)        as "artifactCount",
  coalesce(d.n, 0)        as "dueCards",
  coalesce(a.decks, 0)    as "readyDecks",
  coalesce(a.quizzes, 0)  as "readyQuizzes",
  coalesce(a.notesets, 0) as "readyNotesets",
  coalesce(a.exams, 0)    as "readyExams"`;

/**
 * The notebook list, newest activity first.
 *
 * Keyset pagination rather than offset. The contract calls the cursor opaque
 * precisely so this could be a keyset (FR6 §8.4), and `updated_at desc, id desc`
 * is a total order because `id` breaks ties — an offset cursor over a table that
 * is being written to skips and repeats rows.
 */
export async function listNotebooks(
  userId: string,
  now: Date,
  limit: number,
  cursor: { updatedAt: string; id: string } | null,
): Promise<NotebookWithCounts[]> {
  const params: unknown[] = [userId, now.toISOString(), limit];
  let keyset = '';
  if (cursor) {
    keyset = ` and (n.updated_at, n.id) < ($4::timestamptz, $5::uuid)`;
    params.push(cursor.updatedAt, cursor.id);
  }

  const result = await query<NotebookWithCounts>(
    `select n.${COLUMNS.split(', ').join(', n.')}, ${COUNTS_SELECT}
       from public.notebooks n
       ${COUNTS_JOIN}
      where n.user_id = $1${keyset}
      order by n.updated_at desc, n.id desc
      limit $3`,
    params,
  );
  return result.rows;
}

export async function getNotebook(
  userId: string,
  notebookId: string,
  now: Date,
): Promise<NotebookWithCounts | null> {
  const result = await query<NotebookWithCounts>(
    `select n.${COLUMNS.split(', ').join(', n.')}, ${COUNTS_SELECT}
       from public.notebooks n
       ${COUNTS_JOIN}
      where n.user_id = $1 and n.id = $3`,
    [userId, now.toISOString(), notebookId],
  );
  return result.rows[0] ?? null;
}

export interface NotebookInput {
  title: string;
  description: string | null;
}

export async function createNotebook(
  userId: string,
  input: NotebookInput,
): Promise<NotebookRow> {
  const result = await query<NotebookRow>(
    `insert into public.notebooks (user_id, title, description)
     values ($1, $2, $3)
     returning ${COLUMNS}`,
    [userId, input.title, input.description],
  );
  const row = result.rows[0];
  // An insert with `returning` that produces no row cannot happen without the
  // statement having thrown first — a narrowing, not a case to handle.
  if (!row) throw new Error('Insert returned no row.');
  return row;
}

/**
 * Update title and/or description.
 *
 * `coalesce($3, title)` so an omitted field is left alone rather than nulled.
 * The contract's `UpdateNotebookInput` has both optional, and a PATCH that
 * blanks the description because the caller did not mention it is a bug the
 * user only notices later.
 */
export async function updateNotebook(
  userId: string,
  notebookId: string,
  input: { title?: string; description?: string | null },
): Promise<NotebookRow | null> {
  const result = await query<NotebookRow>(
    `update public.notebooks
        set title = coalesce($3, title),
            description = case when $4::boolean then $5 else description end
      where user_id = $1 and id = $2
      returning ${COLUMNS}`,
    [
      userId,
      notebookId,
      input.title ?? null,
      input.description !== undefined,
      input.description ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a notebook and everything under it.
 *
 * **Its artifacts go with it**, and the contract says so explicitly. That is
 * not a contradiction of "an artifact survives its source's deletion": surviving
 * the deletion of one input is a different question from surviving the deletion
 * of the container. Sources, artifacts, cards, questions, note blocks and
 * attempts all cascade from here by foreign key.
 */
export async function deleteNotebook(userId: string, notebookId: string): Promise<boolean> {
  const result = await query(
    `delete from public.notebooks where user_id = $1 and id = $2`,
    [userId, notebookId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Does this notebook belong to this user?
 *
 * Used by the child data modules whose own tables are reached through a
 * notebook. They still filter their own statements on `user_id`; this is the
 * extra check that turns "no rows" into a truthful 404 rather than an empty
 * list for a notebook the caller does not own.
 */
export async function notebookExists(userId: string, notebookId: string): Promise<boolean> {
  const result = await query(
    `select 1 from public.notebooks where user_id = $1 and id = $2`,
    [userId, notebookId],
  );
  return result.rows.length > 0;
}
