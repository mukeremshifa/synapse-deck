import { z } from 'zod';

/**
 * The exam blueprint: what an exam over this material should weigh, and why.
 *
 * **This is the product's signature screen and the brief's Phase B** (§2,
 * enhancement #2 — "planned, as the ingestion phase"). It is the step that turns
 * a pile of uploaded material into a *plan for an exam*, and it is what
 * separates this from the crowded "AI makes flashcards" space a reviewer has
 * already seen.
 *
 * Pure, like `exam.ts`, `fsrs.ts` and `mastery.ts`: no React, no data layer,
 * nothing Supabase- or AWS-shaped. Phase B moves generation server-side, and
 * when it does this module is what it ports rather than what it untangles.
 *
 * ── Why weights are editable, and why that is a schema concern ────────────
 *
 * A generated blueprint is a *proposal*. The model inferred "genetics is 25% of
 * this course" from page counts and repeated headings, which is a reasonable
 * guess and is sometimes wrong in ways only the student knows — their lecturer
 * said the final leans on metabolism, say. So the blueprint is a document the
 * user edits, not an oracle they accept.
 *
 * That makes normalisation a real problem rather than a formatting detail: a
 * user who drags one weight up has implicitly pushed the others down, and
 * weights that no longer sum to 100 produce an exam whose question counts do not
 * add up to its length. `rebalance` below is the whole answer, and it lives here
 * rather than in a component so the arithmetic has one home.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * How hard a topic is, as the blueprint estimates it *before* any evidence.
 *
 * Deliberately distinct from `mastery.ts`'s bands, which describe how the user
 * is actually doing. This is a property of the material; that is a property of
 * the learner. Conflating them would mean a topic becomes "easy" because one
 * student happens to know it.
 */
export const TopicDifficulty = z.enum(['easy', 'medium', 'hard']);
export type TopicDifficulty = z.infer<typeof TopicDifficulty>;

export const BLUEPRINT_LIMITS = {
  minTopics: 1,
  maxTopics: 24,
  /** Below this a topic cannot meaningfully carry a question. */
  minWeight: 0,
  maxWeight: 100,
} as const;

/**
 * One thing the model saw, and where it saw it.
 *
 * **Why this is a record rather than a sentence.** Evidence was `string[]` when
 * this module was written, which let a topic explain itself but not prove
 * anything: "the longest section of the notes" is a claim the user has no way to
 * check without going back to the PDF and counting. Grounding an assertion in
 * the material is the whole difference between a blueprint that is trusted and
 * one that is merely plausible, and it is the property that separates this from
 * a model that answers from nothing.
 *
 * The fields are split by who can produce them, which is the distinction that
 * matters when this stops being a fixture:
 *
 * - `claim` is the model's assertion, and is required. A citation with a
 *   location and nothing to say is not evidence.
 * - `source` is the filename it came from. Required for a generated citation;
 *   the UI is what refuses to render one without it.
 * - `quote` is the material's own words. **Untrusted LLM output like any card
 *   content — render it as text** (CLAUDE.md). It is optional because a claim
 *   about structure ("this heading recurs in four chapters") has no single
 *   passage to quote.
 * - `locator` is a human-readable position: "p. 38", "§4.2". Optional, and
 *   deliberately a display string rather than a page number, because
 *   `chunking.ts` produces `{ index, text }` over a flat string and has no page
 *   dimension at all. A `page: number` field would be a schema inviting the
 *   generator to invent one.
 * - `chunkIndex` is what the pipeline *can* honestly emit today — the chunk the
 *   claim was drawn from. Useless to a reader on its own, which is why it is not
 *   displayed, but it is the join back to the source text once chunks are
 *   persisted and a source viewer exists to jump into.
 */
export const TopicEvidence = z.object({
  claim: z.string().trim().min(1).max(400),
  source: z.string().trim().min(1).max(300).optional(),
  quote: z.string().trim().min(1).max(1000).optional(),
  locator: z.string().trim().min(1).max(60).optional(),
  chunkIndex: z.number().int().min(0).optional(),
});
export type TopicEvidence = z.infer<typeof TopicEvidence>;

export const BlueprintTopic = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  /** Percent of the exam. The set is normalised to sum to 100 by `rebalance`. */
  weight: z.number().min(BLUEPRINT_LIMITS.minWeight).max(BLUEPRINT_LIMITS.maxWeight),
  difficulty: TopicDifficulty,
  /**
   * What the model saw that made it propose this topic at this weight, and
   * where in the material it saw it.
   *
   * **Not decoration.** The "AI reasoning" drawer is the difference between a
   * blueprint the user trusts and one they merely suspect, and a system that
   * cannot say why it proposed something has no business asking to be edited.
   * Empty is allowed — a topic the user added by hand has no evidence, and
   * inventing some for it would be the exact failure this field exists to
   * prevent.
   */
  evidence: z.array(TopicEvidence).default([]),
});
export type BlueprintTopic = z.infer<typeof BlueprintTopic>;

/**
 * The mix of question formats.
 *
 * Only `mcq` is generatable today — `schemas.ts` says free-text "needs a model
 * and a rubric" and leaves it out of `QuestionPayload` on purpose. The other
 * three are carried here because a blueprint that cannot express "this exam is
 * 30% short answer" is not describing a real exam, and Phase C needs the shape
 * to aim at. The UI must mark the ungeneratable ones rather than silently
 * producing MCQs for them; see `GENERATABLE_FORMATS`.
 */
export const QuestionFormat = z.enum(['mcq', 'short', 'problem', 'essay']);
export type QuestionFormat = z.infer<typeof QuestionFormat>;

/** What the generator can actually produce today. The UI reads this, not a literal. */
export const GENERATABLE_FORMATS: readonly QuestionFormat[] = ['mcq'] as const;

export const FORMAT_LABELS: Record<QuestionFormat, string> = {
  mcq: 'Multiple choice',
  short: 'Short answer',
  problem: 'Problem solving',
  essay: 'Essay',
};

export const Blueprint = z.object({
  id: z.string().min(1),
  /** The notebook this blueprint plans an exam over. */
  notebookId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  /** Filenames the blueprint was inferred from, for the provenance line. */
  sources: z.array(z.string().min(1)).default([]),
  topics: z.array(BlueprintTopic).min(BLUEPRINT_LIMITS.minTopics),
  /** Format → percent. Same normalisation contract as topic weights. */
  formatMix: z.record(QuestionFormat, z.number().min(0).max(100)),
  /** ISO 8601. When the blueprint was generated or last edited. */
  updatedAt: z.string().min(1),
  /**
   * Whether the user has touched it. A blueprint the user edited must not be
   * silently regenerated over — that would discard the one input the model
   * cannot infer.
   */
  edited: z.boolean().default(false),
});
export type Blueprint = z.infer<typeof Blueprint>;

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Total weight across topics. Not assumed to be 100 — it is 100 only after
 * `rebalance`, and the UI shows the live total precisely so an editing user can
 * watch it drift.
 */
export function totalWeight(topics: readonly BlueprintTopic[]): number {
  let sum = 0;
  for (const topic of topics) sum += topic.weight;
  return sum;
}

/**
 * Scale every weight so the set sums to 100, preserving proportions.
 *
 * **Largest-remainder, not naive rounding.** Rounding each share independently
 * lets a set of five topics sum to 99 or 101, and a blueprint that says "100%"
 * above a column summing to 99 is the kind of detail that makes a reviewer stop
 * trusting the rest of the screen. Largest-remainder gives the rounding error to
 * the topics that lost the most to it, so the column sums to exactly 100 and the
 * proportions are as close as integers allow.
 */
export function rebalance(topics: readonly BlueprintTopic[]): BlueprintTopic[] {
  if (topics.length === 0) return [];

  const total = totalWeight(topics);
  // Every weight at zero carries no proportion to preserve, so the only
  // defensible normalisation is an equal split.
  if (total <= 0) return distributeEvenly(topics);

  const exact = topics.map(topic => (topic.weight / total) * 100);
  const floored = exact.map(value => Math.floor(value));
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);

  // Indices ordered by the fractional part they lost, largest first.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const bonus = new Set<number>();
  for (const entry of order) {
    if (remainder <= 0) break;
    bonus.add(entry.index);
    remainder -= 1;
  }

  return topics.map((topic, index) => ({
    ...topic,
    weight: (floored[index] ?? 0) + (bonus.has(index) ? 1 : 0),
  }));
}

function distributeEvenly(topics: readonly BlueprintTopic[]): BlueprintTopic[] {
  const share = Math.floor(100 / topics.length);
  let remainder = 100 - share * topics.length;
  return topics.map(topic => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...topic, weight: share + extra };
  });
}

/**
 * How many questions each topic gets in an exam of `questionCount`.
 *
 * Largest-remainder again, for the same reason and with one addition: a topic
 * carrying real weight must not round to zero questions. A blueprint that lists
 * ecology at 6% and then produces an exam containing no ecology question has
 * quietly broken its own promise, so every weighted topic is floored at one
 * question — funded by taking from the largest allocation, which can afford it.
 *
 * Returns entries in the input order, so the UI can render them beside the rows
 * they came from.
 */
export function allocateQuestions(
  topics: readonly BlueprintTopic[],
  questionCount: number,
): { topicId: string; questions: number }[] {
  if (topics.length === 0 || questionCount <= 0) return [];

  const total = totalWeight(topics);
  if (total <= 0) return topics.map(topic => ({ topicId: topic.id, questions: 0 }));

  const exact = topics.map(topic => (topic.weight / total) * questionCount);
  const counts = exact.map(value => Math.floor(value));
  let remainder = questionCount - counts.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const entry of order) {
    if (remainder <= 0) break;
    counts[entry.index] = (counts[entry.index] ?? 0) + 1;
    remainder -= 1;
  }

  // Rescue topics rounded out of existence, but only while there is somewhere to
  // take from — with more weighted topics than questions, some genuinely cannot
  // appear and pretending otherwise would produce more questions than asked for.
  for (let i = 0; i < counts.length; i += 1) {
    if ((counts[i] ?? 0) > 0) continue;
    if ((topics[i]?.weight ?? 0) <= 0) continue;

    let richest = -1;
    let richestCount = 1;
    for (let j = 0; j < counts.length; j += 1) {
      if ((counts[j] ?? 0) > richestCount) {
        richest = j;
        richestCount = counts[j] ?? 0;
      }
    }
    if (richest === -1) break;
    counts[richest] = richestCount - 1;
    counts[i] = 1;
  }

  return topics.map((topic, index) => ({
    topicId: topic.id,
    questions: counts[index] ?? 0,
  }));
}

/**
 * Whether a citation is grounded in a named source, or is only an assertion.
 *
 * The UI renders these two cases differently and must not blur them: a claim
 * traced to a file the user uploaded can be checked, and a claim standing on its
 * own cannot. Every generated citation should be grounded — a generator that
 * emits bare claims is one prompt change away from confabulating, and this
 * predicate is what makes that visible on the screen instead of invisible in a
 * log.
 */
export function isGrounded(
  evidence: TopicEvidence,
): evidence is TopicEvidence & { source: string } {
  return typeof evidence.source === 'string' && evidence.source.length > 0;
}

/**
 * How many of a topic's citations point at real material.
 *
 * Returned as a pair rather than a ratio so the UI can say "3 of 4" — a
 * proportion hides the difference between one weak citation and forty.
 */
export function groundedCount(topic: BlueprintTopic): {
  grounded: number;
  total: number;
} {
  let grounded = 0;
  for (const item of topic.evidence) if (isGrounded(item)) grounded += 1;
  return { grounded, total: topic.evidence.length };
}

/**
 * Whether a blueprint is coherent enough to generate an exam from.
 *
 * Returns the reasons it is not, so the UI can list them rather than disabling a
 * button with no explanation. An empty array means it is ready.
 */
export function blueprintProblems(blueprint: Blueprint): string[] {
  const problems: string[] = [];

  if (blueprint.topics.length === 0) {
    problems.push('A blueprint needs at least one topic.');
  }
  if (blueprint.topics.length > BLUEPRINT_LIMITS.maxTopics) {
    problems.push(`At most ${BLUEPRINT_LIMITS.maxTopics} topics.`);
  }

  const total = totalWeight(blueprint.topics);
  if (blueprint.topics.length > 0 && total !== 100) {
    problems.push(`Topic weights sum to ${total}%, not 100%.`);
  }

  const names = new Set<string>();
  for (const topic of blueprint.topics) {
    const key = topic.name.trim().toLowerCase();
    if (key.length === 0) problems.push('A topic has no name.');
    else if (names.has(key)) problems.push(`Two topics are both called "${topic.name}".`);
    names.add(key);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Deriving a blueprint from the user's own material (DS3 task 3)
// ---------------------------------------------------------------------------

/**
 * What the blueprint needs to know about one of the user's topics.
 *
 * Structurally the client's `TopicWithCounts`, restated here so this module
 * keeps its promise of importing nothing: `blueprint.ts` is pure and has no
 * data layer, and a `queries.ts` import would drag React Query into it.
 */
export type TopicMaterial = {
  id: string;
  name: string;
  cardCount: number;
};

/** The id the "Unfiled" bucket carries. Not a uuid — nothing can be filed under it. */
export const UNFILED_TOPIC_ID = 'unfiled';

/**
 * A blueprint computed from what the user actually has.
 *
 * ── What a computed weight *means*, which is a real decision ──────────────
 *
 * **Weight is a topic's share of the user's active cards.** A generated
 * blueprint's weights are an inference from the material — the model reading
 * page counts and repeated headings — and there is no such generator yet
 * (that is Phase C). What exists instead is the card distribution the
 * ingestion pipeline already produced: chunks that said more about networking
 * yielded more networking cards, so card share is a *measurement* of how much
 * of the user's material each topic occupies.
 *
 * It is a weaker claim than a generated blueprint makes and it is an honest
 * one. The alternative definitions were considered and rejected:
 *
 * - **Equal weights** say nothing and would be a fixture with extra steps.
 * - **Weight by weakness** (mastery-derived) conflates two things `blueprint.ts`
 *   deliberately keeps apart: `TopicDifficulty` is a property of the material,
 *   mastery bands are a property of the learner. An exam blueprint that
 *   reweighted itself as you improved would not describe the exam any more.
 *
 * The UI says which definition is in force, because "24%" computed from card
 * share and "24%" inferred by a model are different claims wearing the same
 * glyph.
 *
 * ── Difficulty is `medium`, uniformly, and the UI must say so ─────────────
 *
 * Nothing in the database estimates how hard *the material* is. FSRS difficulty
 * is per-user and per-card — how hard this learner finds this card — which is
 * the learner-property this module refuses to conflate with a material-property.
 * So every derived topic gets `medium`: a neutral placeholder the user can
 * change, not a claim. Inventing a spread from card counts would be exactly the
 * plausible-wrong-number DS3 §7 warns about.
 *
 * ── Evidence is empty, and that is the whole point of the field ───────────
 *
 * `TopicEvidence` is what the model saw and where it saw it. No model saw
 * anything here; these weights are counted. An empty `evidence` array is
 * already the shape for "the user added this topic", and `Citation.tsx` renders
 * it as such rather than borrowing someone else's provenance. Fabricating a
 * citation for a counted weight would be the precise failure the field exists
 * to prevent.
 *
 * ── Topics with no cards are dropped ──────────────────────────────────────
 *
 * A topic reconciled from a document whose cards were all deleted carries zero
 * weight, and a zero-weight row in a blueprint is noise: `allocateQuestions`
 * gives it no questions and the meter renders empty. It stays in the user's
 * topic list — this drops it from *this blueprint*, not from their data.
 *
 * Returns `null` when there is nothing to describe, so the caller renders an
 * empty state rather than a blueprint of zero topics. `Blueprint.topics` has a
 * `min(1)` on it, so a zero-topic blueprint cannot be constructed anyway.
 */
export function blueprintFromTopics(
  input: {
    notebookId: string;
    title: string;
    topics: readonly TopicMaterial[];
    /** Active cards carrying no topic. Becomes the "Unfiled" row. */
    unfiledCards: number;
    sources?: readonly string[];
    updatedAt?: string;
  },
): Blueprint | null {
  const rows: { id: string; name: string; cardCount: number }[] = input.topics
    .filter(topic => topic.cardCount > 0)
    .map(topic => ({ id: topic.id, name: topic.name, cardCount: topic.cardCount }));

  /*
   * The "Unfiled" bucket. **Counted, not dropped** — the alternative silently
   * makes every other weight too large, because a share of the topiced cards
   * presented as a share of the exam is a plausible wrong number.
   *
   * Last in the list rather than sorted by size: it is a residue, not a topic,
   * and putting it at the top when it happens to be the largest bucket would
   * read as the user's main subject.
   */
  if (input.unfiledCards > 0) {
    rows.push({
      id: UNFILED_TOPIC_ID,
      name: 'Unfiled',
      cardCount: input.unfiledCards,
    });
  }

  if (rows.length === 0) return null;

  const totalCards = rows.reduce((sum, row) => sum + row.cardCount, 0);

  /*
   * Raw shares first, then `rebalance` to make them integers summing to exactly
   * 100. Reusing it rather than rounding here is the point: largest-remainder
   * is already the answer to "these must sum to 100 and stay proportional", and
   * a second rounding rule in this file is how a column starts summing to 99.
   */
  const topics: BlueprintTopic[] = rebalance(
    rows.map(row => ({
      id: row.id,
      name: row.name,
      weight: (row.cardCount / totalCards) * 100,
      // A property of the material, which nothing here measures. See above.
      difficulty: 'medium' as const,
      // Counted, not inferred. Nothing was read, so nothing is cited.
      evidence: [],
    })),
  );

  return {
    id: `derived-${input.notebookId}`,
    notebookId: input.notebookId,
    title: input.title,
    sources: [...(input.sources ?? [])],
    topics,
    /*
     * The format mix is not derived, because nothing measures it. It is the
     * blueprint's one remaining authored value, set to what the generator can
     * actually produce today (`GENERATABLE_FORMATS` is `['mcq']`) rather than
     * to a plausible spread across formats no generator will honour.
     */
    formatMix: { mcq: 100, short: 0, problem: 0, essay: 0 },
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    edited: false,
  };
}
