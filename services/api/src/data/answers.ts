/**
 * The `answers` table — the exam signal the mastery model was missing.
 *
 * Every statement here carries `where user_id = $1`, including the reads keyed
 * by an attempt id. An attempt id arrives from the client and is not a
 * capability (ADR 0008).
 *
 * ── What this table is for, in one line ───────────────────────────────────
 *
 * `src/lib/mastery.ts` reads two signals and keeps them apart: FSRS retention,
 * which has had a real source since P1, and exam accuracy, which until DS3 had
 * none at all — an exam was graded in the browser and forgotten. This module is
 * the second signal's source. See `migrations/0008_answers.sql` for why an
 * answer snapshots the question rather than joining to the card for it.
 */

import { query, withTransaction } from '../lib/db.ts';
import type { AnswerRow } from '../lib/rows.ts';

const COLUMNS =
  'id, user_id, attempt_id, question_text, card_id, topic_id, topic_name, ' +
  'correct, selected_option, elapsed_ms, answered_at';

/** One graded answer, as the exam runner submits it. */
export interface AnswerInsert {
  questionText: string;
  cardId: string | null;
  topicId: string | null;
  topicName: string | null;
  correct: boolean;
  selectedOption: number | null;
  elapsedMs: number | null;
}

/**
 * Record one sitting's answers. **One round trip for a whole attempt**, not one
 * per question: an exam is submitted once, and a per-question write would turn
 * a submission into twenty requests that can half-fail.
 *
 * ── Why the references are validated rather than trusted ──────────────────
 *
 * `card_id` and `topic_id` arrive from the client, and both are foreign keys to
 * per-user tables. Inserting them unchecked would let a caller attach their own
 * answer to another user's card or topic. That leaks nothing outward — the
 * reads all filter `user_id` — but it corrupts the other user's data in a way
 * nothing would ever surface, which is the same failure `assignCardsToTopic`
 * guards against and for the same reason.
 *
 * So each id is resolved against the caller's own rows and **nulled if it does
 * not belong to them**, rather than rejected. A pointer that cannot be honoured
 * is dropped; the answer itself — the stem, the correctness, the topic name —
 * is preserved regardless, because it is a record of something that genuinely
 * happened and losing it to a stale id would be the worse outcome.
 *
 * One transaction, so an attempt lands whole or not at all. A half-recorded
 * exam would move the mastery map by an arbitrary fraction of a sitting.
 */
export async function recordAnswers(
  userId: string,
  attemptId: string,
  answers: readonly AnswerInsert[],
): Promise<AnswerRow[]> {
  if (answers.length === 0) return [];

  return withTransaction(async client => {
    const rows: AnswerRow[] = [];

    for (const answer of answers) {
      const result = await client.query<AnswerRow>(
        `insert into public.answers
           (user_id, attempt_id, question_text, card_id, topic_id, topic_name,
            correct, selected_option, elapsed_ms)
         values (
           $1, $2, $3,
           -- The card, only if it is the caller's. A subquery rather than the
           -- raw parameter: $4 on its own would accept another user's card id.
           (select c.id from public.cards c where c.id = $4 and c.user_id = $1),
           (select t.id from public.topics t where t.id = $5 and t.user_id = $1),
           $6, $7, $8, $9
         )
         returning ${COLUMNS}`,
        [
          userId,
          attemptId,
          answer.questionText,
          answer.cardId,
          answer.topicId,
          answer.topicName,
          answer.correct,
          answer.selectedOption,
          answer.elapsedMs,
        ],
      );
      const row = result.rows[0];
      // An insert with `returning` that produces no row cannot happen without
      // the statement having thrown first.
      if (!row) throw new Error('Answer insert returned no row.');
      rows.push(row);
    }

    return rows;
  });
}

/**
 * What `mastery.ts` reads: the user's exam answers, with the topic each was
 * filed under.
 *
 * ── `coalesce` on the topic name, and why it reads that way round ─────────
 *
 * `topic_name` was snapshotted at submission and the live topic may since have
 * been renamed or deleted. The *live* name wins where the topic still exists,
 * because the mastery map groups by topic and a renamed topic showing its old
 * label beside its new one would split one topic into two rows on screen — the
 * exact fragmentation ADR 0009 exists to prevent. The snapshot is the fallback,
 * which is what survives a deleted topic.
 *
 * That is a different rule from `question_text`, deliberately: the stem is
 * evidence of what was asked and never re-derived, while a topic name is a
 * label on a grouping and should track the grouping.
 *
 * ── The window, and why there is one ──────────────────────────────────────
 *
 * `since` bounds the read. An exam sat a year ago says little about what the
 * user knows now, and an unbounded read grows without limit for the heaviest
 * users. The caller chooses the window; nothing here assumes one.
 */
export async function listAnswers(
  userId: string,
  since: Date,
  limit: number,
): Promise<AnswerRow[]> {
  const result = await query<AnswerRow>(
    `select a.id, a.user_id, a.attempt_id, a.question_text, a.card_id,
            a.topic_id,
            coalesce(t.name, a.topic_name) as topic_name,
            a.correct, a.selected_option, a.elapsed_ms, a.answered_at
       from public.answers a
       -- Both sides filter. The join predicate alone would be enough given
       -- correct data, and "given correct data" is the assumption RLS used to
       -- make unnecessary (ADR 0008 rule 2).
       left join public.topics t on t.id = a.topic_id and t.user_id = $1
      where a.user_id = $1
        and a.answered_at >= $2
      order by a.answered_at desc
      limit $3`,
    [userId, since.toISOString(), limit],
  );
  return result.rows;
}

/**
 * How many answers the user has recorded at all.
 *
 * Separate from `listAnswers` because the empty state needs to distinguish
 * "you have never sat an exam" from "you sat one, but outside the window the
 * diagnostic reads". Both render as no exam signal; only the first should tell
 * the user to go and sit one.
 */
export async function countAnswers(userId: string): Promise<number> {
  const result = await query<{ n: number }>(
    `select count(*)::int as n from public.answers where user_id = $1`,
    [userId],
  );
  return result.rows[0]?.n ?? 0;
}
