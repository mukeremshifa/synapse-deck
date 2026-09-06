import { Blueprint } from '@/lib/blueprint';
import type { MasteryAnswer, MasteryCard } from '@/lib/mastery';

/**
 * Sample blueprint and mastery data, so the blueprint, diagnostic and plan
 * screens can be built and demoed before the backend that produces them.
 *
 * **Scaffolding with a deletion date, exactly like `exam/fixtures.ts`.** The
 * brief's Phase B generates blueprints and Phase D the diagnostic; when the
 * hooks in this feature are wired to the API, this file goes, and the screens
 * should need no other change — which is the property it exists to prove.
 *
 * The blueprint is parsed through its schema at module load rather than merely
 * typed, so a fixture that drifts from the schema fails immediately and loudly
 * instead of rendering something subtly wrong.
 *
 * The material is the AWS certification content the owner is actually studying,
 * for the same reason the exam fixture uses it: a demo of a topic breakdown
 * needs topics that mean something to whoever is watching.
 */

const SAMPLE_BLUEPRINT = {
  id: 'sample-blueprint',
  notebookId: 'sample',
  title: 'AWS Solutions Architect Associate',
  sources: ['SAA-C03 study notes.pdf', 'Well-Architected Framework.pdf'],
  updatedAt: '2026-09-06T09:00:00.000Z',
  edited: false,
  topics: [
    {
      id: 'networking',
      name: 'Networking',
      weight: 24,
      difficulty: 'hard' as const,
      evidence: [
        'The longest section of the notes: 38 of 210 pages.',
        'VPC, subnets and endpoints recur across four chapters.',
        'Six of the eleven stated learning objectives mention connectivity.',
      ],
    },
    {
      id: 'storage',
      name: 'Storage',
      weight: 20,
      difficulty: 'medium' as const,
      evidence: [
        'S3 storage classes and lifecycle rules have a chapter each.',
        'Repeated comparison tables suggest the exam tests selection, not recall.',
      ],
    },
    {
      id: 'databases',
      name: 'Databases',
      weight: 18,
      difficulty: 'hard' as const,
      evidence: [
        'RDS, Aurora and DynamoDB are covered at comparable depth.',
        'Two sections are dedicated to choosing between them.',
      ],
    },
    {
      id: 'security',
      name: 'Security & IAM',
      weight: 16,
      difficulty: 'medium' as const,
      evidence: [
        'IAM policy evaluation appears in the notes three times.',
        'Explicitly listed as a learning objective.',
      ],
    },
    {
      id: 'resilience',
      name: 'Resilience',
      weight: 12,
      difficulty: 'medium' as const,
      evidence: ['Multi-AZ and failover patterns run through the framework document.'],
    },
    {
      id: 'cost',
      name: 'Cost management',
      weight: 10,
      difficulty: 'easy' as const,
      evidence: ['One chapter, mostly pricing-model definitions.'],
    },
  ],
  formatMix: { mcq: 70, short: 20, problem: 10, essay: 0 },
};

export const sampleBlueprint = Blueprint.parse(SAMPLE_BLUEPRINT);

/**
 * Cards and answers shaped for `topicMastery`.
 *
 * Deliberately constructed so the model produces something worth looking at:
 *
 * - **Networking is `fragile`** — high predicted recall, poor exam accuracy.
 *   That is the divergence case the mastery module treats as its most valuable
 *   finding, and the screens are pointless to build if nothing exercises it.
 * - **Cost management is weak on both signals**, so the plain case renders too.
 * - **Resilience is unmeasured**, so the dashed track and the "not weak, just
 *   unasked" path are visible rather than theoretical.
 */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function reviewedCards(
  topicId: string,
  topicName: string,
  count: number,
  stability: number,
  daysSince: number,
): MasteryCard[] {
  return Array.from({ length: count }, () => ({
    topicId,
    topicName,
    fsrs_state: 'review' as const,
    stability,
    difficulty: 5,
    last_reviewed_at: ago(daysSince),
  }));
}

export const sampleMasteryCards: MasteryCard[] = [
  // Recalled well when prompted — stability far exceeds elapsed time.
  ...reviewedCards('networking', 'Networking', 22, 40, 3),
  ...reviewedCards('storage', 'Storage', 18, 21, 6),
  ...reviewedCards('databases', 'Databases', 14, 12, 7),
  ...reviewedCards('security', 'Security & IAM', 12, 30, 4),
  // Overdue and shaky.
  ...reviewedCards('cost', 'Cost management', 8, 4, 9),
  // Generated but never reviewed: unmeasured, not weak.
  ...Array.from({ length: 6 }, () => ({
    topicId: 'resilience',
    topicName: 'Resilience',
    fsrs_state: 'new' as const,
    stability: null,
    difficulty: null,
    last_reviewed_at: null,
  })),
];

function answers(
  topicId: string,
  topicName: string,
  correct: number,
  wrong: number,
): MasteryAnswer[] {
  return [
    ...Array.from({ length: correct }, () => ({
      topicId,
      topicName,
      correct: true,
      answered_at: ago(2),
    })),
    ...Array.from({ length: wrong }, () => ({
      topicId,
      topicName,
      correct: false,
      answered_at: ago(2),
    })),
  ];
}

export const sampleMasteryAnswers: MasteryAnswer[] = [
  // The fragile case: strong retention above, weak application here.
  ...answers('networking', 'Networking', 3, 7),
  ...answers('storage', 'Storage', 7, 2),
  ...answers('databases', 'Databases', 5, 4),
  ...answers('security', 'Security & IAM', 8, 1),
  ...answers('cost', 'Cost management', 2, 4),
];
