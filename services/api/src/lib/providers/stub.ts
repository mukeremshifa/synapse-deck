/**
 * A provider that calls no model. P10 task 5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS PRODUCES FAKE CARDS. READ THIS BEFORE USING IT FOR ANYTHING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It exists because the pipeline had to be buildable while **no model provider
 * was reachable**: Bedrock refuses the caller's country for Anthropic models and
 * has no grant for Nova, and `GROQ_API_KEY` has only ever been a Supabase Edge
 * Function secret, not something a Lambda can read. Without this, the Map state,
 * the retry policy, the job records and the polling endpoint would all have been
 * written against a call that had never once succeeded — exactly the failure
 * mode the phase's preconditions exist to prevent.
 *
 * ── The danger, stated plainly ────────────────────────────────────────────
 *
 * A fake that returns plausible output is the kind of thing that quietly becomes
 * the thing everyone tests against, until someone ships a demo full of cards
 * that say "Sample question about paragraph 3". Three defences, all deliberate:
 *
 * 1. **It refuses to run unless explicitly selected.** `CARD_PROVIDER=stub` must
 *    be set. There is no fallback path that reaches this by accident, and
 *    `resolveProvider()` throws rather than defaulting here.
 * 2. **Its output is unmistakably fake.** The cards say so, in the card text, in
 *    the language a user would see. No lorem ipsum that could pass for content.
 * 3. **It names itself on every chunk record.** `provider: 'stub'` is written to
 *    DynamoDB with the cards, so any card it produced stays identifiable after
 *    the fact rather than becoming anonymous once stored.
 *
 * It is deterministic — same chunk in, same cards out — because a pipeline test
 * that produces different output on every run cannot tell a bug from noise.
 */

import type { CardPayload, QuestionPayload } from '../schemas.ts';
import type {
  CardProvider,
  GenerateChunkRequest,
  GenerateQuestionsRequest,
  GenerateQuestionsResult,
  GenerateChunkResult,
} from './types.ts';

/** A tiny deterministic hash, so the same chunk always yields the same cards. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** The first sentence-ish fragment of a chunk, for a recognisable card face. */
function excerpt(text: string, limit = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit).trimEnd()}…`;
}

export class StubProvider implements CardProvider {
  readonly name = 'stub' as const;

  generateChunk(request: GenerateChunkRequest): Promise<GenerateChunkResult> {
    const seed = hash(request.text);
    const snippet = excerpt(request.text);
    const cards: CardPayload[] = [];

    // Never more than was asked for, and never zero for a non-empty chunk --
    // a provider that returns nothing is a *failure* case, and the pipeline
    // should exercise the success path here.
    const count = Math.max(1, Math.min(request.cardCount, 3));

    for (let i = 0; i < count; i += 1) {
      // Rotate through the kinds actually requested, so a job asking for cloze
      // cards exercises the cloze path rather than always the basic one.
      const kind = request.kinds[(seed + i) % request.kinds.length] ?? 'basic';

      if (kind === 'cloze') {
        cards.push({
          kind: 'cloze',
          // The `{{c1::…}}` marker is what src/lib/schemas.ts requires of a
          // cloze card, so this exercises the real parser rather than sidestepping it.
          text: `[STUB CARD — not real content] This came from a placeholder provider, not a language model: {{c1::no model was called}}.`,
        });
      } else if (kind === 'mcq') {
        cards.push({
          kind: 'mcq',
          stem: `[STUB CARD — not real content] Which provider generated this card? (source: "${snippet}")`,
          options: [
            { text: 'A placeholder provider that calls no model', correct: true },
            { text: 'Amazon Bedrock', correct: false },
            { text: 'Groq', correct: false },
          ],
        });
      } else {
        cards.push({
          kind: 'basic',
          front: `[STUB CARD — not real content] Placeholder card ${i + 1} for: "${snippet}"`,
          back: 'No language model was called. Set CARD_PROVIDER to a real provider to generate real cards.',
        });
      }
    }

    return Promise.resolve({
      cards,
      // Named like the cards are named: a stub topic must not be mistakable for
      // an extracted one once it is reconciled into the user's topic list,
      // where it would otherwise sit alongside real topics with nothing marking
      // it. Deterministic on the seed so repeated runs reconcile onto the same
      // row instead of accumulating new ones.
      topics: [`[STUB TOPIC — not real content] Placeholder topic ${seed % 5}`],
      provider: this.name,
      // Null rather than a fabricated number: a made-up token count would flow
      // into cost accounting (task 10) and quietly corrupt the one figure the
      // phase is supposed to measure honestly.
      inputTokens: null,
      outputTokens: null,
    });
  }

  /**
   * Placeholder questions — one of every kind that was asked for.
   *
   * **It rotates through `request.kinds` for the same reason `generateChunk`
   * does**: a stub that only ever produced MCQs would let a bug in the
   * matching or ordering path reach a real generation unexercised, which is
   * precisely what the stub exists to prevent.
   *
   * Every one is labelled, and the label is not decoration: stub content that
   * cannot be told apart from generated content is worse than no stub at all.
   */
  generateQuestions(
    request: GenerateQuestionsRequest,
  ): Promise<GenerateQuestionsResult> {
    const seed = hash(request.text);
    const snippet = excerpt(request.text);
    const questions: QuestionPayload[] = [];

    const count = Math.max(1, Math.min(request.questionCount, 6));
    const label = '[STUB QUESTION — not real content]';

    for (let i = 0; i < count; i += 1) {
      const kind = request.kinds[(seed + i) % request.kinds.length] ?? 'mcq';

      switch (kind) {
        case 'msq':
          questions.push({
            kind: 'msq',
            stem: `${label} Which of these are placeholders? Select all that apply. (source: "${snippet}")`,
            options: [
              { text: 'This question', correct: true },
              { text: 'These options', correct: true },
              { text: 'A real language model', correct: false },
              { text: 'An extracted fact', correct: false },
            ],
          });
          break;
        case 'true_false':
          questions.push({
            kind: 'true_false',
            statement: `${label} This question was written by a language model.`,
            answer: false,
          });
          break;
        case 'numeric':
          questions.push({
            kind: 'numeric',
            stem: `${label} How many language models were called to produce this question?`,
            answer: 0,
            tolerance: 0,
          });
          break;
        case 'matching':
          questions.push({
            kind: 'matching',
            stem: `${label} Match each term to its meaning.`,
            pairs: [
              { left: 'Stub', right: 'A placeholder that calls no model' },
              { left: 'Groq', right: 'A real inference provider' },
              { left: 'Chunk', right: 'A section of the source document' },
            ],
          });
          break;
        case 'ordering':
          questions.push({
            kind: 'ordering',
            stem: `${label} Put the pipeline stages in order.`,
            items: ['Upload', 'Split', 'Generate', 'Finalise'],
          });
          break;
        default:
          questions.push({
            kind: 'mcq',
            stem: `${label} Which provider generated this question? (source: "${snippet}")`,
            options: [
              { text: 'A placeholder provider that calls no model', correct: true },
              { text: 'Amazon Bedrock', correct: false },
              { text: 'Groq', correct: false },
            ],
          });
      }
    }

    return Promise.resolve({
      questions,
      topics: [`[STUB TOPIC — not real content] Placeholder topic ${seed % 5}`],
      provider: this.name,
      // Null rather than a fabricated number, as above.
      inputTokens: null,
      outputTokens: null,
    });
  }
}
