/**
 * What to study next, and in what order.
 *
 * SPEC §6 states the policy in one line — "due reviews first; new cards mixed in
 * up to the daily cap; reviews are never starved by new cards" — and that line
 * hides the most common scheduling bug in the genre. A queue that puts new cards
 * first feels productive for a week and then buries the user under reviews that
 * were quietly postponed. So the policy lives here, as a pure function, and the
 * database query stays a plain fetch.
 */

/**
 * What the policy needs of a card: an identity, and nothing else.
 *
 * **FR5 widened this from a card row to `{ id }`.** It named `due` and
 * `fsrs_state` in snake_case, which was the old stack's shape — and the
 * interleave below reads neither. Splitting due from fresh is the *caller's*
 * job (the server does it, in `PracticeQueue`), so requiring those two fields
 * only forced a contract card to be renamed on the way in for a check nothing
 * performed. Narrowing the constraint is what let the policy be re-pointed at
 * the contract with the maths untouched, which is FR5 §2's rule.
 */
export type QueueCard = {
  id: string;
};

export type QueuePolicyInput<T extends QueueCard> = {
  /** Everything active and due, oldest first. Includes learning/relearning. */
  due: T[];
  /** Cards never studied, in creation order. */
  fresh: T[];
  /** `profiles.daily_new_limit`. */
  dailyNewLimit: number;
  /** New cards already introduced during the current study day (§6, 04:00). */
  introducedToday: number;
};

/**
 * Interleave the two streams.
 *
 * Every due review makes it into the result — the cap applies only to new cards,
 * and running out of new cards never removes a review. New cards are spread
 * through the session rather than front- or back-loaded, so a long queue does not
 * end with twenty unfamiliar cards in a row when concentration is lowest.
 */
export function buildQueue<T extends QueueCard>({
  due,
  fresh,
  dailyNewLimit,
  introducedToday,
}: QueuePolicyInput<T>): T[] {
  const allowance = Math.max(0, dailyNewLimit - introducedToday);
  const introductions = fresh.slice(0, allowance);

  if (introductions.length === 0) return [...due];
  if (due.length === 0) return introductions;

  // Place the new cards at even fractions through the review stream. Insertion
  // points are computed against the review list only, so no review can be
  // displaced — the two streams merge, they do not compete.
  const spacing = due.length / introductions.length;
  const queue: T[] = [];
  let nextIntroduction = 0;

  for (let index = 0; index < due.length; index += 1) {
    while (
      nextIntroduction < introductions.length &&
      nextIntroduction * spacing <= index
    ) {
      queue.push(introductions[nextIntroduction]!);
      nextIntroduction += 1;
    }
    queue.push(due[index]!);
  }
  queue.push(...introductions.slice(nextIntroduction));

  return queue;
}

/** How many new cards may still be introduced today. */
export function remainingNewAllowance(
  dailyNewLimit: number,
  introducedToday: number,
): number {
  return Math.max(0, dailyNewLimit - introducedToday);
}

/**
 * The soonest a card comes back, for the "nothing due — next card in 4 hours"
 * empty state. Null when the user has no scheduled cards at all, which is a
 * different message.
 */
export function nextDueAfter(dues: readonly string[], now: Date): Date | null {
  let soonest: number | null = null;
  for (const due of dues) {
    const time = new Date(due).getTime();
    if (time <= now.getTime()) continue;
    if (soonest === null || time < soonest) soonest = time;
  }
  return soonest === null ? null : new Date(soonest);
}
