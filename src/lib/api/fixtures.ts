import type {
  Artifact,
  Attempt,
  Card,
  NoteBlock,
  Notebook,
  Profile,
  Question,
  Review,
  Source,
} from './contract';

/**
 * Hypothetical data, rich enough to design against.
 *
 * ── Not one tidy notebook ─────────────────────────────────────────────────
 *
 * The current app is weakest exactly where its data is tidiest: "Generate
 * cards" is the only enabled CTA because every other control is
 * `disabled={!hasCards}`, and nobody designing against a full notebook ever
 * sees that. So these fixtures are deliberately uneven — an empty notebook, a
 * notebook missing kinds, a failed source, a dangling source id, readiness
 * spanning all three states. **Every awkward case here is a screen someone has
 * to design, and a case with no fixture is a case nobody will design.**
 *
 * ── At FR7 this becomes the seed script ───────────────────────────────────
 *
 * These are the shapes the real API must return (brief §2.2(4)). Keep them
 * honest: nothing here may be a shape the backend could not produce.
 *
 * ── Dates are relative to load, and deliberately ──────────────────────────
 *
 * A fixture with hardcoded 2026 dates reads as "3 months overdue" the moment
 * the machine's clock moves past it, and every heatmap built against it is
 * designed around a wrong picture. `daysAgo`/`daysAhead` mean a fixture set
 * loaded today always looks like an account in mid-use.
 */

const now = Date.now();
const DAY_MS = 86_400_000;

function daysAgo(days: number, hour = 9): string {
  const date = new Date(now - days * DAY_MS);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function daysAhead(days: number, hour = 9): string {
  return daysAgo(-days, hour);
}

// ---------------------------------------------------------------------------
// Ids
//
// Readable rather than uuid-shaped, because a fixture id appears in a URL bar
// during development and `nb-pharm` says more than `a3f9…`. `fake.ts` mints
// uuids for anything created at runtime, so nothing depends on this shape.
// ---------------------------------------------------------------------------

export const IDS = {
  /** Full: every artifact kind, real history, the dangling source. */
  pharmacology: 'nb-pharm',
  /** Sparse: sources but only one artifact, one of them still processing. */
  neuroanatomy: 'nb-neuro',
  /** Empty: no sources, no artifacts. The empty state, in full. */
  statistics: 'nb-stats',
  /** Half-built: sources ready, nothing generated, one source failed. */
  biochem: 'nb-biochem',

  /**
   * **The deleted source.** Nothing in `sources` has this id — it was removed —
   * but `art-deck-abx.sourceIds` still names it, and its `sourcesSnapshot`
   * still describes it.
   *
   * This is the fixture that exists to be awkward. A dangling `sourceId` is a
   * valid state (brief §1.2(7)), and any screen that resolves ids to sources
   * without handling a miss will throw on it. That is the point: it throws
   * during FR3, not in production.
   */
  deletedSource: 'src-pharm-deleted',
} as const;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const profile: Profile = {
  id: 'user-fixture',
  displayName: 'Sam',
  // Not UTC, on purpose: a day boundary that happens to match UTC hides every
  // timezone bug in the heatmap and the forecast.
  timezone: 'Europe/Berlin',
  dailyNewLimit: 20,
  fsrsParams: null,
  createdAt: daysAgo(240),
};

// ---------------------------------------------------------------------------
// Notebooks
//
// `readiness` and `counts` are recomputed by `fake.ts` on every read, the way a
// real API computes them in SQL. The values here are the initial state and are
// deliberately not maintained by hand — see `fake.ts`'s `projectNotebook`.
// ---------------------------------------------------------------------------

export const notebooks: Notebook[] = [
  {
    id: IDS.pharmacology,
    title: 'Pharmacology — antimicrobials',
    description: 'Second-year block. Beta-lactams through to antifungals.',
    createdAt: daysAgo(64),
    updatedAt: daysAgo(1),
    readiness: { state: 'ready', detail: '' },
    counts: { sources: 0, artifacts: 0, dueCards: 0 },
  },
  {
    id: IDS.neuroanatomy,
    title: 'Neuroanatomy',
    description: 'Tracts, nuclei, and the blood supply.',
    createdAt: daysAgo(21),
    updatedAt: daysAgo(3),
    readiness: { state: 'partial', detail: '' },
    counts: { sources: 0, artifacts: 0, dueCards: 0 },
  },
  {
    id: IDS.biochem,
    title: 'Biochemistry — metabolism',
    description: null,
    createdAt: daysAgo(9),
    updatedAt: daysAgo(9),
    readiness: { state: 'none', detail: '' },
    counts: { sources: 0, artifacts: 0, dueCards: 0 },
  },
  {
    /**
     * **The empty notebook, and it is the important one.** It has no sources
     * and no artifacts, so every Studio entry is empty, chat has nothing to
     * ground in, and the overview has nothing to aggregate. That is four empty
     * states on one screen, and the current app has a disabled button where
     * each of them should be.
     */
    id: IDS.statistics,
    title: 'Statistics',
    description: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    readiness: { state: 'none', detail: '' },
    counts: { sources: 0, artifacts: 0, dueCards: 0 },
  },
];

// ---------------------------------------------------------------------------
// Sources
//
// Note what is NOT here: IDS.deletedSource. See the note on that id.
// ---------------------------------------------------------------------------

export const sources: Source[] = [
  {
    id: 'src-pharm-lecture',
    notebookId: IDS.pharmacology,
    kind: 'document',
    title: 'Beta-lactams — lecture handout.pdf',
    status: 'ready',
    error: null,
    sizeBytes: 1_842_000,
    createdAt: daysAgo(64),
    topicNames: ['Beta-lactams', 'Resistance mechanisms', 'Pharmacokinetics'],
  },
  {
    id: 'src-pharm-notes',
    notebookId: IDS.pharmacology,
    kind: 'text',
    title: 'My notes on aminoglycosides',
    status: 'ready',
    error: null,
    sizeBytes: 4_210,
    createdAt: daysAgo(40),
    topicNames: ['Aminoglycosides', 'Toxicity'],
  },
  {
    id: 'src-pharm-review',
    notebookId: IDS.pharmacology,
    kind: 'url',
    title: 'Antifungal therapy — a review',
    status: 'ready',
    error: null,
    sizeBytes: null,
    createdAt: daysAgo(12),
    topicNames: ['Antifungals', 'Resistance mechanisms'],
  },
  {
    id: 'src-neuro-atlas',
    notebookId: IDS.neuroanatomy,
    kind: 'document',
    title: 'Brainstem atlas — chapter 4.pdf',
    status: 'ready',
    error: null,
    sizeBytes: 8_100_000,
    createdAt: daysAgo(21),
    topicNames: ['Brainstem', 'Cranial nerves'],
  },
  {
    /**
     * Still processing. A source that is real and listable but **not yet usable
     * as generation input** — the generate modal must exclude it and say why,
     * rather than offering it and failing after submission.
     */
    id: 'src-neuro-vascular',
    notebookId: IDS.neuroanatomy,
    kind: 'document',
    title: 'Cerebral vasculature.pdf',
    status: 'processing',
    error: null,
    sizeBytes: 3_400_000,
    createdAt: daysAgo(0, 8),
    topicNames: [],
  },
  {
    id: 'src-biochem-glycolysis',
    notebookId: IDS.biochem,
    kind: 'text',
    title: 'Glycolysis — pasted summary',
    status: 'ready',
    error: null,
    sizeBytes: 6_800,
    createdAt: daysAgo(9),
    topicNames: ['Glycolysis', 'Regulation'],
  },
  {
    /**
     * **A failed source.** The pipeline could not read it — a scanned PDF with
     * no text layer is the ordinary cause. It stays in the list carrying its
     * reason, because silently dropping it leaves the user wondering where
     * their upload went.
     */
    id: 'src-biochem-scan',
    notebookId: IDS.biochem,
    kind: 'document',
    title: 'Krebs cycle — scanned slides.pdf',
    status: 'failed',
    error: 'No text could be extracted. This looks like a scan without a text layer.',
    sizeBytes: 12_900_000,
    createdAt: daysAgo(8),
    topicNames: [],
  },
];

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const artifacts: Artifact[] = [
  {
    /**
     * **The artifact with the dangling source id.** `src-pharm-deleted` is in
     * `sourceIds` and in `sourcesSnapshot`, and is not in `sources`.
     *
     * A provenance line that renders from `sourcesSnapshot` shows all three
     * sources and is correct. One that resolves `sourceIds` against
     * `listSources` shows two and a crash. That is the whole reason this
     * fixture exists.
     */
    id: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    kind: 'deck',
    title: 'Antibiotics — mechanisms and coverage',
    sourceIds: ['src-pharm-lecture', IDS.deletedSource],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-lecture', title: 'Beta-lactams — lecture handout.pdf', kind: 'document' },
      { sourceId: IDS.deletedSource, title: 'Cephalosporin generations (deleted)', kind: 'text' },
    ],
    status: 'ready',
    readiness: { state: 'ready', detail: '' },
    createdAt: daysAgo(60),
    payload: { kind: 'deck', cardCount: 0, dueCount: 0, newCount: 0 },
  },
  {
    id: 'art-deck-antifungal',
    notebookId: IDS.pharmacology,
    kind: 'deck',
    title: 'Antifungals',
    sourceIds: ['src-pharm-review'],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-review', title: 'Antifungal therapy — a review', kind: 'url' },
    ],
    status: 'ready',
    readiness: { state: 'none', detail: '' },
    createdAt: daysAgo(11),
    payload: { kind: 'deck', cardCount: 0, dueCount: 0, newCount: 0 },
  },
  {
    /** Many decks per notebook (§1.2(1)) — this is the third. */
    id: 'art-quiz-abx',
    notebookId: IDS.pharmacology,
    kind: 'quiz',
    title: 'Antibiotic coverage — quick check',
    sourceIds: ['src-pharm-lecture', 'src-pharm-notes'],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-lecture', title: 'Beta-lactams — lecture handout.pdf', kind: 'document' },
      { sourceId: 'src-pharm-notes', title: 'My notes on aminoglycosides', kind: 'text' },
    ],
    status: 'ready',
    readiness: { state: 'partial', detail: '' },
    createdAt: daysAgo(30),
    payload: { kind: 'quiz', questionCount: 0, answeredCount: 0 },
  },
  {
    id: 'art-notes-resistance',
    notebookId: IDS.pharmacology,
    kind: 'noteset',
    title: 'Resistance mechanisms — summary',
    sourceIds: ['src-pharm-lecture', 'src-pharm-review'],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-lecture', title: 'Beta-lactams — lecture handout.pdf', kind: 'document' },
      { sourceId: 'src-pharm-review', title: 'Antifungal therapy — a review', kind: 'url' },
    ],
    status: 'ready',
    readiness: { state: 'partial', detail: '' },
    createdAt: daysAgo(18),
    payload: { kind: 'noteset', origin: 'generated', blockCount: 0, readBlockCount: 2 },
  },
  {
    /**
     * A note set with `origin: 'chat'` — the one thing §1.2(4) commits chat to.
     * Saved from a response, so it has one source (the one the answer cited)
     * rather than the generation's full selection.
     */
    id: 'art-notes-from-chat',
    notebookId: IDS.pharmacology,
    kind: 'noteset',
    title: 'Why vancomycin needs trough monitoring',
    sourceIds: ['src-pharm-notes'],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-notes', title: 'My notes on aminoglycosides', kind: 'text' },
    ],
    status: 'ready',
    readiness: { state: 'ready', detail: '' },
    createdAt: daysAgo(5),
    payload: { kind: 'noteset', origin: 'chat', blockCount: 0, readBlockCount: 0 },
  },
  {
    id: 'art-exam-block',
    notebookId: IDS.pharmacology,
    kind: 'exam',
    title: 'Block exam — mock paper 1',
    sourceIds: ['src-pharm-lecture', 'src-pharm-notes', 'src-pharm-review'],
    sourcesSnapshot: [
      { sourceId: 'src-pharm-lecture', title: 'Beta-lactams — lecture handout.pdf', kind: 'document' },
      { sourceId: 'src-pharm-notes', title: 'My notes on aminoglycosides', kind: 'text' },
      { sourceId: 'src-pharm-review', title: 'Antifungal therapy — a review', kind: 'url' },
    ],
    status: 'ready',
    readiness: { state: 'ready', detail: '' },
    createdAt: daysAgo(7),
    payload: {
      kind: 'exam',
      config: {
        questionCount: 4,
        durationMinutes: 20,
        shuffleQuestions: true,
        shuffleOptions: true,
        focusMode: true,
      },
      // The blueprint belongs to the exam (§1.2(9)), and carries an Unfiled row
      // because real material is not all topiced.
      blueprint: {
        basis: 'card-counts',
        weights: [
          { topicId: 'top-pharm-beta', topicName: 'Beta-lactams', questions: 2 },
          { topicId: 'top-pharm-resist', topicName: 'Resistance mechanisms', questions: 1 },
          { topicId: null, topicName: 'Unfiled', questions: 1 },
        ],
      },
      questionCount: 0,
      attemptCount: 0,
    },
  },
  {
    /**
     * **A failed artifact.** Generation ran and produced nothing usable. The row
     * stays so the user can see what happened and retry — the alternative is a
     * generate button that appears to do nothing.
     */
    id: 'art-deck-neuro-failed',
    notebookId: IDS.neuroanatomy,
    kind: 'deck',
    title: 'Cranial nerves',
    sourceIds: ['src-neuro-atlas'],
    sourcesSnapshot: [
      { sourceId: 'src-neuro-atlas', title: 'Brainstem atlas — chapter 4.pdf', kind: 'document' },
    ],
    status: 'failed',
    readiness: { state: 'none', detail: '' },
    createdAt: daysAgo(2),
    payload: { kind: 'deck', cardCount: 0, dueCount: 0, newCount: 0 },
  },
  {
    id: 'art-deck-neuro-tracts',
    notebookId: IDS.neuroanatomy,
    kind: 'deck',
    title: 'Ascending and descending tracts',
    sourceIds: ['src-neuro-atlas'],
    sourcesSnapshot: [
      { sourceId: 'src-neuro-atlas', title: 'Brainstem atlas — chapter 4.pdf', kind: 'document' },
    ],
    status: 'ready',
    readiness: { state: 'partial', detail: '' },
    createdAt: daysAgo(20),
    payload: { kind: 'deck', cardCount: 0, dueCount: 0, newCount: 0 },
  },
];

// ---------------------------------------------------------------------------
// Cards
//
// Enough of them, across enough states, that progress.ts / mastery.ts /
// study-plan.ts have something real to aggregate at FR6: due, overdue, new,
// suspended, learning and review, with stability and difficulty that vary.
// ---------------------------------------------------------------------------

type CardSeed = {
  id: string;
  artifactId: string;
  notebookId: string;
  topicId: string | null;
  payload: Card['payload'];
  fsrsState: Card['fsrsState'];
  dueDays: number;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  status?: Card['status'];
};

const cardSeeds: CardSeed[] = [
  {
    id: 'card-abx-1',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-beta',
    payload: {
      kind: 'basic',
      front: 'What is the mechanism of action of beta-lactam antibiotics?',
      back: 'They bind penicillin-binding proteins and block the transpeptidation that cross-links peptidoglycan, so the cell wall fails under osmotic stress.',
    },
    fsrsState: 'review',
    dueDays: -3,
    stability: 21.4,
    difficulty: 4.9,
    reps: 6,
    lapses: 1,
  },
  {
    id: 'card-abx-2',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-beta',
    payload: {
      kind: 'cloze',
      text: 'Beta-lactamase inhibitors such as {{c1::clavulanic acid}} have little antibacterial activity of their own.',
      hint: 'Paired with amoxicillin.',
    },
    fsrsState: 'review',
    dueDays: -1,
    stability: 12.8,
    difficulty: 6.1,
    reps: 4,
    lapses: 0,
  },
  {
    id: 'card-abx-3',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-resist',
    payload: {
      kind: 'mcq',
      stem: 'Which resistance mechanism most commonly defeats methicillin in Staphylococcus aureus?',
      options: [
        { text: 'Altered penicillin-binding protein (PBP2a)', correct: true },
        { text: 'Beta-lactamase hydrolysis', correct: false },
        { text: 'Efflux pump upregulation', correct: false },
        { text: 'Porin channel loss', correct: false },
      ],
      explanation: 'mecA encodes PBP2a, which has low affinity for beta-lactams.',
    },
    fsrsState: 'review',
    dueDays: 0,
    stability: 9.2,
    difficulty: 7.4,
    reps: 3,
    lapses: 2,
  },
  {
    id: 'card-abx-4',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-resist',
    payload: {
      kind: 'basic',
      front: 'Why does an extended-spectrum beta-lactamase (ESBL) organism resist ceftriaxone?',
      back: 'ESBLs hydrolyse third-generation cephalosporins as well as penicillins, so the beta-lactam ring is cleaved before it reaches its target.',
    },
    fsrsState: 'learning',
    dueDays: 0,
    stability: 1.1,
    difficulty: 8.0,
    reps: 1,
    lapses: 0,
  },
  {
    id: 'card-abx-5',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: null,
    payload: {
      kind: 'basic',
      front: 'What is the usual oral bioavailability of amoxicillin?',
      back: 'Roughly 75–90%, which is why it is preferred over ampicillin by mouth.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
  {
    id: 'card-abx-6',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: null,
    payload: {
      kind: 'basic',
      front: 'Which beta-lactam class is safest in a patient with a documented type I penicillin allergy?',
      back: 'Aztreonam, a monobactam — it shows minimal cross-reactivity with penicillins.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
  {
    /** Suspended: out of the queue without losing its history. */
    id: 'card-abx-7',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-beta',
    payload: {
      kind: 'basic',
      front: 'What is the half-life of benzylpenicillin?',
      back: 'About 30 minutes.',
    },
    fsrsState: 'review',
    dueDays: 4,
    stability: 30.0,
    difficulty: 3.2,
    reps: 8,
    lapses: 0,
    status: 'suspended',
  },
  {
    id: 'card-abx-8',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-pk',
    payload: {
      kind: 'cloze',
      text: 'Time above MIC is the pharmacodynamic parameter that predicts efficacy for {{c1::beta-lactams}}.',
    },
    fsrsState: 'review',
    dueDays: 6,
    stability: 26.5,
    difficulty: 4.1,
    reps: 5,
    lapses: 0,
  },
  {
    id: 'card-abx-9',
    artifactId: 'art-deck-abx',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-pk',
    payload: {
      kind: 'basic',
      front: 'Which antibiotic class shows concentration-dependent killing with a post-antibiotic effect?',
      back: 'Aminoglycosides — which is the rationale for once-daily dosing.',
    },
    fsrsState: 'relearning',
    dueDays: -2,
    stability: 2.3,
    difficulty: 8.6,
    reps: 7,
    lapses: 3,
  },
  {
    /** A whole deck of new cards: readiness `none`, and nothing due. */
    id: 'card-af-1',
    artifactId: 'art-deck-antifungal',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-antifungal',
    payload: {
      kind: 'basic',
      front: 'What is the mechanism of the azole antifungals?',
      back: 'They inhibit lanosterol 14-alpha-demethylase, blocking ergosterol synthesis in the fungal membrane.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
  {
    id: 'card-af-2',
    artifactId: 'art-deck-antifungal',
    notebookId: IDS.pharmacology,
    topicId: 'top-pharm-antifungal',
    payload: {
      kind: 'basic',
      front: 'Why is amphotericin B nephrotoxic?',
      back: 'It binds mammalian cholesterol as well as fungal ergosterol, damaging renal tubular membranes.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
  {
    id: 'card-af-3',
    artifactId: 'art-deck-antifungal',
    notebookId: IDS.pharmacology,
    topicId: null,
    payload: {
      kind: 'cloze',
      text: 'The echinocandins inhibit synthesis of {{c1::beta-1,3-glucan}} in the fungal cell wall.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
  {
    id: 'card-neuro-1',
    artifactId: 'art-deck-neuro-tracts',
    notebookId: IDS.neuroanatomy,
    topicId: 'top-neuro-brainstem',
    payload: {
      kind: 'basic',
      front: 'Where does the lateral corticospinal tract decussate?',
      back: 'At the pyramidal decussation, in the caudal medulla.',
    },
    fsrsState: 'review',
    dueDays: -1,
    stability: 14.2,
    difficulty: 5.5,
    reps: 4,
    lapses: 1,
  },
  {
    id: 'card-neuro-2',
    artifactId: 'art-deck-neuro-tracts',
    notebookId: IDS.neuroanatomy,
    topicId: 'top-neuro-brainstem',
    payload: {
      kind: 'basic',
      front: 'Which sensory modality travels in the dorsal column–medial lemniscus pathway?',
      back: 'Fine touch, vibration and proprioception.',
    },
    fsrsState: 'review',
    dueDays: 2,
    stability: 19.7,
    difficulty: 4.4,
    reps: 5,
    lapses: 0,
  },
  {
    id: 'card-neuro-3',
    artifactId: 'art-deck-neuro-tracts',
    notebookId: IDS.neuroanatomy,
    topicId: null,
    payload: {
      kind: 'basic',
      front: 'What deficit follows a lesion of the spinothalamic tract?',
      back: 'Contralateral loss of pain and temperature, beginning a segment or two below the lesion.',
    },
    fsrsState: 'new',
    dueDays: 0,
    stability: null,
    difficulty: null,
    reps: 0,
    lapses: 0,
  },
];

export const cards: Card[] = cardSeeds.map(seed => ({
  id: seed.id,
  artifactId: seed.artifactId,
  notebookId: seed.notebookId,
  topicId: seed.topicId,
  payload: seed.payload,
  sourceExcerpt: null,
  status: seed.status ?? 'active',
  fsrsState: seed.fsrsState,
  due: seed.dueDays >= 0 ? daysAhead(seed.dueDays) : daysAgo(-seed.dueDays),
  stability: seed.stability,
  difficulty: seed.difficulty,
  reps: seed.reps,
  lapses: seed.lapses,
  lastReviewedAt: seed.reps > 0 ? daysAgo(Math.max(1, seed.reps)) : null,
  createdAt: daysAgo(55),
  updatedAt: seed.reps > 0 ? daysAgo(Math.max(1, seed.reps)) : daysAgo(55),
}));

// ---------------------------------------------------------------------------
// Reviews
//
// A year's worth, thinned out, so the heatmap has streaks and gaps rather than
// a uniform block — and so `streaks()` has a real answer to compute. Generated
// rather than listed: 300 hand-written rows would be noise.
// ---------------------------------------------------------------------------

function buildReviews(): Review[] {
  const built: Review[] = [];
  const pharmCards = cardSeeds.filter(seed => seed.notebookId === IDS.pharmacology);
  const neuroCards = cardSeeds.filter(seed => seed.notebookId === IDS.neuroanatomy);
  let n = 0;

  for (let day = 120; day >= 0; day--) {
    // A deterministic, uneven pattern: some days off, some heavy. Not random —
    // a fixture that differs between reloads makes a layout bug look
    // intermittent.
    const intensity = [0, 0, 3, 7, 0, 12, 5, 1, 0, 9][day % 10] ?? 0;
    // A two-week gap 40 days back, so "longest streak" is not just "all of it".
    const onHoliday = day <= 54 && day >= 41;
    const count = onHoliday ? 0 : intensity;

    for (let i = 0; i < count; i++) {
      const pool = day % 3 === 0 && neuroCards.length > 0 ? neuroCards : pharmCards;
      const seed = pool[(day + i) % pool.length];
      if (!seed) continue;
      const rating = ([3, 3, 4, 2, 3, 1, 3, 4] as const)[(day + i) % 8] ?? 3;
      built.push({
        id: `rev-${n++}`,
        cardId: seed.id,
        notebookId: seed.notebookId,
        rating,
        stateBefore: seed.fsrsState === 'new' ? 'new' : 'review',
        stabilityAfter: seed.stability,
        difficultyAfter: seed.difficulty,
        durationMs: 3_000 + ((day * 7 + i * 13) % 9_000),
        reviewedAt: daysAgo(day, 8 + (i % 10)),
        undoneAt: null,
      });
    }
  }

  return built;
}

export const reviews: Review[] = buildReviews();

// ---------------------------------------------------------------------------
// Questions — for the quiz and the exam
// ---------------------------------------------------------------------------

export const questions: Record<string, Question[]> = {
  'art-quiz-abx': [
    {
      id: 'q-quiz-1',
      topicId: 'top-pharm-beta',
      topicName: 'Beta-lactams',
      payload: {
        kind: 'mcq',
        stem: 'Which organism is NOT reliably covered by ceftriaxone?',
        options: [
          { text: 'Pseudomonas aeruginosa', correct: true },
          { text: 'Streptococcus pneumoniae', correct: false },
          { text: 'Neisseria meningitidis', correct: false },
          { text: 'Haemophilus influenzae', correct: false },
        ],
        explanation: 'Antipseudomonal cover needs ceftazidime or cefepime.',
      },
    },
    {
      id: 'q-quiz-2',
      topicId: 'top-pharm-resist',
      topicName: 'Resistance mechanisms',
      payload: {
        kind: 'mcq',
        stem: 'A carbapenem-resistant Enterobacterales isolate most likely carries which enzyme?',
        options: [
          { text: 'A carbapenemase such as KPC', correct: true },
          { text: 'A narrow-spectrum penicillinase', correct: false },
          { text: 'An aminoglycoside acetyltransferase', correct: false },
        ],
      },
    },
    {
      id: 'q-quiz-3',
      topicId: null,
      topicName: null,
      payload: {
        kind: 'mcq',
        stem: 'Which of these requires therapeutic drug monitoring in routine practice?',
        options: [
          { text: 'Vancomycin', correct: true },
          { text: 'Cefazolin', correct: false },
          { text: 'Azithromycin', correct: false },
          { text: 'Doxycycline', correct: false },
        ],
      },
    },
  ],
  'art-exam-block': [
    {
      id: 'q-exam-1',
      topicId: 'top-pharm-beta',
      topicName: 'Beta-lactams',
      payload: {
        kind: 'mcq',
        stem: 'Which beta-lactam has the broadest Gram-negative coverage?',
        options: [
          { text: 'Meropenem', correct: true },
          { text: 'Cefazolin', correct: false },
          { text: 'Benzylpenicillin', correct: false },
          { text: 'Flucloxacillin', correct: false },
        ],
      },
    },
    {
      id: 'q-exam-2',
      topicId: 'top-pharm-beta',
      topicName: 'Beta-lactams',
      payload: {
        kind: 'mcq',
        stem: 'Flucloxacillin is preferred over benzylpenicillin for staphylococcal infection because it:',
        options: [
          { text: 'Resists staphylococcal penicillinase', correct: true },
          { text: 'Has better CSF penetration', correct: false },
          { text: 'Covers Pseudomonas', correct: false },
        ],
      },
    },
    {
      id: 'q-exam-3',
      topicId: 'top-pharm-resist',
      topicName: 'Resistance mechanisms',
      payload: {
        kind: 'mcq',
        stem: 'Porin loss in Gram-negative bacteria confers resistance by:',
        options: [
          { text: 'Reducing drug entry into the periplasm', correct: true },
          { text: 'Hydrolysing the beta-lactam ring', correct: false },
          { text: 'Altering the ribosomal target', correct: false },
        ],
      },
    },
    {
      id: 'q-exam-4',
      topicId: null,
      topicName: null,
      payload: {
        kind: 'mcq',
        stem: 'Which adverse effect is most characteristic of aminoglycosides?',
        options: [
          { text: 'Ototoxicity', correct: true },
          { text: 'Hepatotoxicity', correct: false },
          { text: 'Photosensitivity', correct: false },
          { text: 'Agranulocytosis', correct: false },
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Note blocks
// ---------------------------------------------------------------------------

export const noteBlocks: Record<string, NoteBlock[]> = {
  'art-notes-resistance': [
    { type: 'heading', level: 1, text: 'Resistance mechanisms' },
    {
      type: 'paragraph',
      text: 'Bacteria defeat beta-lactams in four broad ways. Knowing which one an organism uses predicts which agent will still work.',
    },
    { type: 'heading', level: 2, text: 'Enzymatic hydrolysis' },
    {
      type: 'paragraph',
      text: 'Beta-lactamases cleave the beta-lactam ring before it reaches its target. The spectrum of the enzyme decides the spectrum of the resistance.',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        'Narrow-spectrum penicillinases — defeated by flucloxacillin.',
        'ESBLs — hydrolyse third-generation cephalosporins.',
        'Carbapenemases (KPC, NDM, OXA-48) — the broadest, and the hardest.',
      ],
    },
    {
      type: 'quote',
      text: 'The presence of an ESBL should be treated as resistance to all penicillins and cephalosporins, whatever the reported MIC.',
      sourceId: 'src-pharm-lecture',
    },
    { type: 'heading', level: 2, text: 'Target modification' },
    {
      type: 'paragraph',
      text: 'MRSA carries mecA, which encodes PBP2a — a penicillin-binding protein with low affinity for beta-lactams, so cross-linking continues.',
    },
    {
      /**
       * A quote whose source has been deleted. **The dangling case again**, in
       * the one other place a source id is stored, so a notes reader that
       * resolves citations hits it too.
       */
      type: 'quote',
      text: 'Cephalosporin generations broadly trade Gram-positive cover for Gram-negative as the number rises.',
      sourceId: IDS.deletedSource,
    },
  ],
  'art-notes-from-chat': [
    { type: 'heading', level: 2, text: 'Vancomycin trough monitoring' },
    {
      type: 'paragraph',
      text: 'Vancomycin has a narrow therapeutic window: too little fails against MRSA, too much is nephrotoxic. Clearance is renal and varies with the patient, so a fixed dose does not give a predictable concentration.',
    },
    {
      type: 'quote',
      text: 'Monitoring targets an AUC/MIC ratio; trough concentration is the practical surrogate most units still use.',
      sourceId: 'src-pharm-notes',
    },
  ],
};

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export const attempts: Attempt[] = [
  {
    id: 'att-quiz-1',
    notebookId: IDS.pharmacology,
    artifactId: 'art-quiz-abx',
    artifactKind: 'quiz',
    outcome: 'submitted',
    startedAt: daysAgo(9, 19),
    submittedAt: daysAgo(9, 20),
    score: 2 / 3,
    answers: [
      {
        questionId: 'q-quiz-1',
        questionText: 'Which organism is NOT reliably covered by ceftriaxone?',
        topicId: 'top-pharm-beta',
        topicName: 'Beta-lactams',
        selectedOption: 0,
        correct: true,
        flagged: false,
        elapsedMs: 21_000,
      },
      {
        questionId: 'q-quiz-2',
        questionText: 'A carbapenem-resistant Enterobacterales isolate most likely carries which enzyme?',
        topicId: 'top-pharm-resist',
        topicName: 'Resistance mechanisms',
        selectedOption: 1,
        correct: false,
        flagged: true,
        elapsedMs: 44_000,
      },
      {
        questionId: 'q-quiz-3',
        questionText: 'Which of these requires therapeutic drug monitoring in routine practice?',
        topicId: null,
        topicName: null,
        selectedOption: 0,
        correct: true,
        flagged: false,
        elapsedMs: 12_000,
      },
    ],
  },
  {
    /**
     * **An in-progress quiz attempt.** Quizzes are resumable (§1.2(3)), so the
     * runner must handle rejoining one — two of three answered, no
     * `submittedAt`, no score.
     */
    id: 'att-quiz-2',
    notebookId: IDS.pharmacology,
    artifactId: 'art-quiz-abx',
    artifactKind: 'quiz',
    outcome: 'in-progress',
    startedAt: daysAgo(0, 21),
    submittedAt: null,
    score: null,
    answers: [
      {
        questionId: 'q-quiz-1',
        questionText: 'Which organism is NOT reliably covered by ceftriaxone?',
        topicId: 'top-pharm-beta',
        topicName: 'Beta-lactams',
        selectedOption: 0,
        correct: true,
        flagged: false,
        elapsedMs: 18_000,
      },
    ],
  },
  {
    /** An exam that ran out of time. `expired`, and scored on what was answered. */
    id: 'att-exam-1',
    notebookId: IDS.pharmacology,
    artifactId: 'art-exam-block',
    artifactKind: 'exam',
    outcome: 'expired',
    startedAt: daysAgo(4, 14),
    submittedAt: daysAgo(4, 15),
    score: 0.5,
    answers: [
      {
        questionId: 'q-exam-1',
        questionText: 'Which beta-lactam has the broadest Gram-negative coverage?',
        topicId: 'top-pharm-beta',
        topicName: 'Beta-lactams',
        selectedOption: 0,
        correct: true,
        flagged: false,
        elapsedMs: 62_000,
      },
      {
        questionId: 'q-exam-2',
        questionText: 'Flucloxacillin is preferred over benzylpenicillin for staphylococcal infection because it:',
        topicId: 'top-pharm-beta',
        topicName: 'Beta-lactams',
        selectedOption: 0,
        correct: true,
        flagged: false,
        elapsedMs: 40_000,
      },
      {
        questionId: 'q-exam-3',
        questionText: 'Porin loss in Gram-negative bacteria confers resistance by:',
        topicId: 'top-pharm-resist',
        topicName: 'Resistance mechanisms',
        selectedOption: 2,
        correct: false,
        flagged: true,
        elapsedMs: 95_000,
      },
      {
        // Never answered — the timer expired. `selectedOption: null` is a real
        // value and the results screen must render it as "not answered", not 0.
        questionId: 'q-exam-4',
        questionText: 'Which adverse effect is most characteristic of aminoglycosides?',
        topicId: null,
        topicName: null,
        selectedOption: null,
        correct: false,
        flagged: false,
        elapsedMs: null,
      },
    ],
  },
];
