import { z } from 'zod';

/**
 * The single definition of what a card is.
 *
 * SPEC §9: this module is imported by the client *and* by the Edge Function, so
 * the same schema validates LLM output, form input, and anything read back from
 * the database. If you are tempted to write a second card type somewhere else,
 * add it here instead.
 */

// ---------------------------------------------------------------------------
// Card payloads (discriminated union on `kind`)
// ---------------------------------------------------------------------------

export const CLOZE_MARKER = /\{\{c(\d+)::([^}]*)\}\}/g;

export const BasicPayload = z.object({
  kind: z.literal('basic'),
  front: z.string().trim().min(1, 'Front is required').max(1000),
  back: z.string().trim().min(1, 'Back is required').max(2000),
});

export const ClozePayload = z.object({
  kind: z.literal('cloze'),
  text: z
    .string()
    .trim()
    .min(1, 'Text is required')
    .max(2000)
    .refine(value => countClozeGroups(value) > 0, {
      message: 'Needs at least one {{c1::…}} deletion',
    })
    // SPEC §5.3: v1 stores one deletion group per card. Multi-group notes are
    // split at ingest, so anything reaching validation must already be split.
    .refine(value => countClozeGroups(value) === 1, {
      message: 'Only one deletion group per card — split multi-group notes first',
    }),
  hint: z.string().trim().max(200).optional(),
});

export const McqPayload = z.object({
  kind: z.literal('mcq'),
  stem: z.string().trim().min(1, 'Question is required').max(1000),
  options: z
    .array(
      z.object({
        text: z.string().trim().min(1, 'Option cannot be empty').max(500),
        correct: z.boolean(),
      }),
    )
    .min(3, 'At least 3 options')
    .max(5, 'At most 5 options')
    .refine(options => options.filter(option => option.correct).length === 1, {
      message: 'Exactly one option must be correct',
    })
    .refine(
      options =>
        new Set(options.map(option => option.text.toLowerCase())).size === options.length,
      { message: 'Options must be distinct' },
    ),
  explanation: z.string().trim().max(1000).optional(),
});

export const CardPayload = z.discriminatedUnion('kind', [
  BasicPayload,
  ClozePayload,
  McqPayload,
]);

export type BasicPayload = z.infer<typeof BasicPayload>;
export type ClozePayload = z.infer<typeof ClozePayload>;
export type McqPayload = z.infer<typeof McqPayload>;
export type CardPayload = z.infer<typeof CardPayload>;
export type CardKind = CardPayload['kind'];

export const CARD_KINDS = [
  'basic',
  'cloze',
  'mcq',
] as const satisfies readonly CardKind[];

// ---------------------------------------------------------------------------
// Cloze helpers
// ---------------------------------------------------------------------------

/** Distinct deletion group numbers in a cloze string: `{{c1::x}} {{c1::y}}` is 1 group. */
export function countClozeGroups(text: string): number {
  const groups = new Set<string>();
  for (const match of text.matchAll(CLOZE_MARKER)) {
    const group = match[1];
    // Reject `{{c1::}}` — an empty deletion has nothing to recall.
    if (group !== undefined && match[2] !== undefined && match[2].trim() !== '') {
      groups.add(group);
    }
  }
  return groups.size;
}

/**
 * Split a multi-group cloze note into one string per deletion group, keeping the
 * targeted group's markers and unwrapping every other group to plain text. This
 * is what makes the §5.3 one-group-per-card simplification safe: a model that
 * emits `{{c1::…}} … {{c2::…}}` yields two independently reviewable cards rather
 * than being rejected.
 */
export function splitClozeGroups(text: string): string[] {
  const groups = [...new Set([...text.matchAll(CLOZE_MARKER)].map(match => match[1]))]
    .filter((group): group is string => group !== undefined)
    .sort((a, b) => Number(a) - Number(b));

  if (groups.length <= 1) return [text];

  return groups.map(keep =>
    text.replace(CLOZE_MARKER, (whole, group: string, content: string) =>
      group === keep ? whole : content,
    ),
  );
}

/** Segments for rendering: `blank: true` is the part the learner must recall. */
export type ClozeSegment = { text: string; blank: boolean };

export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CLOZE_MARKER)) {
    const start = match.index;
    const content = match[2];
    if (start === undefined || content === undefined) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), blank: false });
    segments.push({ text: content, blank: true });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), blank: false });
  return segments;
}

// ---------------------------------------------------------------------------
// Decks and profile settings
//
// Same rule as cards: one definition, used by the form, the mutation, and any
// later server-side caller. The bounds mirror the check constraints in
// supabase/migrations — a value the database would reject should fail in the
// form, not after a round trip.
// ---------------------------------------------------------------------------

export const DeckInput = z.object({
  title: z.string().trim().min(1, 'Give the deck a title').max(200),
  /**
   * `.nullish()`, not `.optional()`, and the difference is load-bearing.
   *
   * `decks.description` is a nullable column, and both the form and the API
   * client normalise an empty field to `null` (`deck.description || null`).
   * Under `.optional()` that `null` failed the parse — so creating or editing a
   * deck with no description returned a 400 saying "expected string, received
   * null", which the form had no field to attach to.
   *
   * P9 moved this parse to the server, which is what exposed it: on Supabase
   * the client parsed its own already-shaped object and PostgREST took the null
   * happily, so the mismatch existed but was never reached. Found on the first
   * local execution of the handlers (P9b), which is precisely what running the
   * code was meant to catch.
   */
  description: z.string().trim().max(2000).nullish(),
});
export type DeckInput = z.infer<typeof DeckInput>;

export const Credentials = z.object({
  email: z.string().trim().min(1, 'Email is required').email('That is not an email'),
  // Supabase enforces its own minimum server-side; matching it here turns a
  // round-trip error into an inline one. Nothing longer is imposed: password
  // rules that fight a password manager make passwords worse, not better.
  password: z.string().min(6, 'At least 6 characters'),
});
export type Credentials = z.infer<typeof Credentials>;

export const SignupInput = Credentials.extend({
  display_name: z.string().trim().max(100).optional(),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const ProfileSettings = z.object({
  display_name: z.string().trim().max(100).optional(),
  /** An IANA zone name. It defines every day boundary in the app (SPEC §6). */
  timezone: z.string().trim().min(1, 'Pick a timezone'),
  daily_new_limit: z.coerce
    .number()
    .int('Whole cards only')
    .min(0, 'Cannot be negative')
    .max(500, 'At most 500 a day'),
});
export type ProfileSettings = z.infer<typeof ProfileSettings>;
/** What the *form* holds before coercion — a number input yields a string. */
export type ProfileSettingsInput = z.input<typeof ProfileSettings>;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Document upload (P10 task 3)
// ---------------------------------------------------------------------------

/**
 * What the browser may upload, and what the presigned URL will be issued for.
 *
 * **PDF only, for now.** The pipeline extracts a text layer; a .docx or .pptx
 * would need a different extractor, and accepting a file the pipeline cannot
 * read is a failure discovered after the upload rather than before it.
 */
export const UPLOAD_LIMITS = {
  /**
   * 20 MB. Large enough for a textbook chapter or a scanned-looking slide deck,
   * and small enough that a failed upload has not cost the user five minutes.
   *
   * Enforced in three places, deliberately: the browser (so the message is
   * immediate), the presign handler (because the client is not a security
   * boundary), and the presigned URL's own content-length condition (because
   * the URL is what S3 actually honours -- the handler's check alone would let
   * a caller who obtained a URL upload any size at all).
   */
  maxBytes: 20 * 1024 * 1024,
  contentTypes: ['application/pdf'],
  extensions: ['.pdf'],
} as const;

export const UploadRequest = z.object({
  /**
   * The user's own filename. Kept for display only -- it never becomes the S3
   * key, which is generated server-side. A filename is untrusted input and a
   * key built from one is a path-traversal bug waiting to be written.
   */
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(UPLOAD_LIMITS.contentTypes),
  sizeBytes: z.number().int().positive().max(UPLOAD_LIMITS.maxBytes),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** What the presign endpoint returns: where to PUT, and what to reference after. */
export const UploadTicket = z.object({
  uploadUrl: z.string().url(),
  /** The object key, to hand back when starting a job. Not a URL, and not secret. */
  objectKey: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

// Generation request / streamed response
// ---------------------------------------------------------------------------

export const GENERATION_LIMITS = {
  minChars: 100,
  maxChars: 20_000,
  minCards: 3,
  maxCards: 50,
} as const;

export const GenerateRequest = z.object({
  text: z.string().trim().min(GENERATION_LIMITS.minChars).max(GENERATION_LIMITS.maxChars),
  cardCount: z
    .number()
    .int()
    .min(GENERATION_LIMITS.minCards)
    .max(GENERATION_LIMITS.maxCards),
  kinds: z.array(z.enum(CARD_KINDS)).min(1),
  deckTitle: z.string().trim().min(1).max(200),
  depth: z.enum(['recall', 'balanced', 'deep']).default('balanced'),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;
/** What the *form* holds before defaults and coercion apply. */
export type GenerateRequestInput = z.input<typeof GenerateRequest>;

/**
 * One NDJSON line as emitted by the model (SPEC §7.3). Deliberately *not* the
 * same shape as a stored card: the model supplies content plus provenance, the
 * server supplies ids and scheduling state.
 */
export const GeneratedCard = z.object({
  card: CardPayload,
  source_excerpt: z.string().trim().max(2000).optional(),
});
export type GeneratedCard = z.infer<typeof GeneratedCard>;

/** SSE frames the Edge Function sends to the browser. */
export const StreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meta'),
    deckId: z.string().uuid(),
    generationId: z.string().uuid(),
    expected: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('card'),
    id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    payload: CardPayload,
    source_excerpt: z.string().optional(),
  }),
  z.object({
    type: z.literal('warn'),
    index: z.number().int().nonnegative(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    returned: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum([
      'quota_exceeded',
      'rate_limited',
      'input_too_long',
      'refused',
      'provider_error',
      'internal',
    ]),
    message: z.string(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

// ---------------------------------------------------------------------------
// Review grades
// ---------------------------------------------------------------------------

/** FSRS grades. Numeric values match ts-fsrs `Rating` and the DB check constraint. */
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Grade = (typeof Grade)[keyof typeof Grade];

export const GradeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// ---------------------------------------------------------------------------
// Exam questions, configuration and attempts
// ---------------------------------------------------------------------------

/**
 * **A question is not a card, and this is the seam that keeps it that way.**
 *
 * The brief's §2 lists `cards` fusing content with scheduling state as one of
 * exactly three things that block the exam loop: `cards_state_consistency`
 * requires any non-`new` card to carry `stability` and `difficulty`, and a
 * question answered once under time is not on an FSRS schedule at all. Forcing
 * questions into `cards` would mean nullable scheduling columns and a weakened
 * constraint — compromising the flashcard model to accommodate a different one.
 * D11 gives questions their own table; these are its client-side shapes.
 *
 * **Phase C owns the real definitions.** What is here is the shape the runner
 * needs to render and grade a question in the browser, written now because the
 * runner chrome is being built ahead of the backend. When Phase C writes the
 * schema, this is the definition it extends — not a second one it competes with.
 */

/** Free-text is deliberately absent: it needs a model and a rubric (§7 q8). */
export const QuestionPayload = z.discriminatedUnion('kind', [McqPayload]);
export type QuestionPayload = z.infer<typeof QuestionPayload>;
export type QuestionKind = QuestionPayload['kind'];

export const ExamQuestion = z.object({
  id: z.string().min(1),
  payload: QuestionPayload,
  /**
   * The topic this question tests. Optional because topics are Phase B (D11)
   * and the runner must work before they exist — not because a question without
   * one is fine. The diagnostic in Phase D is meaningless without it.
   */
  topicId: z.string().min(1).optional(),
  topicName: z.string().min(1).optional(),
});
export type ExamQuestion = z.infer<typeof ExamQuestion>;

/**
 * Exam length is capped, and the cap is a schema rule rather than a note.
 *
 * The brief's §6 lists three Bedrock cost controls and §8 constraint 10 requires
 * they be implemented rather than noted. This is the first: an uncapped
 * "generate a 200-question exam" is a ~$1 single request. Enforcing it here
 * means the client cannot ask for one, and Phase C's generation path shares this
 * definition rather than re-deriving the limit.
 */
export const EXAM_LIMITS = {
  minQuestions: 1,
  maxQuestions: 50,
  minMinutes: 1,
  maxMinutes: 240,
} as const;

export const ExamConfig = z.object({
  questionCount: z
    .number()
    .int()
    .min(EXAM_LIMITS.minQuestions)
    .max(
      EXAM_LIMITS.maxQuestions,
      `At most ${EXAM_LIMITS.maxQuestions} questions per exam`,
    ),
  /** Null means untimed. A timer is the point of exam mode, but not mandatory. */
  durationMinutes: z
    .number()
    .int()
    .min(EXAM_LIMITS.minMinutes)
    .max(EXAM_LIMITS.maxMinutes)
    .nullable(),
  /** Randomised question order — realism, and it makes a shared link less gameable. */
  shuffleQuestions: z.boolean(),
  /** Randomised option order within each question. */
  shuffleOptions: z.boolean(),
  /**
   * Focus mode: full-screen, locked navigation, auto-submit on expiry.
   *
   * **Never called anti-cheat, and the naming is deliberate** (brief §2, #5).
   * Browser-based lockdown is trivially defeated — alt-tab, a second device, a
   * phone camera — and real anti-cheat means proctoring. Claiming otherwise in a
   * portfolio piece invites a reviewer to poke it and win. This makes an exam
   * *feel* like an exam, which is worth building; it does not prevent anything.
   */
  focusMode: z.boolean(),
});
export type ExamConfig = z.infer<typeof ExamConfig>;

export const DEFAULT_EXAM_CONFIG: ExamConfig = {
  questionCount: 10,
  durationMinutes: 20,
  shuffleQuestions: true,
  shuffleOptions: true,
  focusMode: true,
};

export const Exam = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  config: ExamConfig,
  questions: z.array(ExamQuestion),
});
export type Exam = z.infer<typeof Exam>;

/**
 * One answer, as the runner holds it in memory.
 *
 * `selectedOption` indexes into the *presented* option order, which is why
 * shuffling is resolved once when the attempt starts rather than at render time
 * — an index into an order that changes on re-render grades the wrong option.
 */
export const ExamAnswer = z.object({
  questionId: z.string().min(1),
  selectedOption: z.number().int().min(0).nullable(),
  /** Flagged for review. Real exams have this and candidates rely on it. */
  flagged: z.boolean(),
  /** Wall-clock ms spent with this question on screen, summed across visits. */
  elapsedMs: z.number().int().min(0),
});
export type ExamAnswer = z.infer<typeof ExamAnswer>;

/** Why an attempt ended. `expired` is the timer; `abandoned` is Phase C's problem (§7 q9). */
export const AttemptOutcome = z.enum(['submitted', 'expired', 'abandoned']);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;
