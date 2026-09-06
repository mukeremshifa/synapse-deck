/**
 * Splitting a document into chunks the model can work on. P10 task 5.
 *
 * The Map state fans out over whatever this returns, so the shape of a chunk is
 * the shape of one unit of work: one model call, one retry budget, one entry in
 * the job's per-chunk progress, and one thing that can fail without taking the
 * rest of the document with it.
 *
 * ── Why chunk on paragraphs rather than on a character count ──────────────
 *
 * A fixed-width slice cuts sentences in half. The model then writes a card from
 * a fragment whose subject is in the previous chunk, which produces a card that
 * is confidently wrong rather than obviously broken — the worst failure mode
 * for a study tool, because nothing about it looks like an error.
 *
 * So chunks are assembled from paragraphs and never split one unless it is
 * itself larger than the budget. The size below is a *target*, not a limit: a
 * chunk stops at the last paragraph that fits.
 *
 * ── The overlap, and why it is small ──────────────────────────────────────
 *
 * Consecutive chunks share a little trailing context, so a definition stated at
 * the end of one chunk is still visible when the next chunk uses the term. The
 * cost of overlap is duplicate cards from the shared region, which the review
 * gate makes the user's problem to reject — so it is deliberately kept to one
 * paragraph rather than a generous window.
 */

/**
 * Target characters per chunk.
 *
 * Roughly 3-4k characters is about 1k tokens, which leaves plenty of room in a
 * Haiku-class context window for the system prompt and the response. Bigger
 * chunks mean fewer, slower calls and coarser progress; smaller chunks mean more
 * calls, more cost, and more places to fail. This is the middle.
 */
export const CHUNK_TARGET_CHARS = 3500;

/**
 * A paragraph longer than this is split on sentence boundaries rather than kept
 * whole. Rare in practice — it takes a wall of text with no blank lines — but a
 * single 50k-character "paragraph" would otherwise become one chunk that
 * exceeds the context window and fails every retry.
 */
export const MAX_PARAGRAPH_CHARS = CHUNK_TARGET_CHARS * 2;

/**
 * Hard ceiling on chunks per job.
 *
 * This is a cost control, not a formatting choice (brief §6). Each chunk is a
 * model call, so an uncapped document is an uncapped bill — a 500-page PDF would
 * otherwise fan out into hundreds of concurrent invocations. A document over the
 * cap is truncated and the job records that it was, rather than silently
 * costing more than anyone expected.
 */
export const MAX_CHUNKS_PER_JOB = 40;

export interface Chunk {
  index: number;
  text: string;
}

export interface ChunkResult {
  chunks: Chunk[];
  /** True when the document was longer than `MAX_CHUNKS_PER_JOB` allows. */
  truncated: boolean;
}

/** Split an over-long paragraph on sentence ends, falling back to a hard cut. */
function splitLongParagraph(paragraph: string): string[] {
  // Sentence-ish: a terminator followed by whitespace. Not a real sentence
  // tokeniser, and it does not need to be — this only runs on text that has no
  // paragraph breaks at all, where the alternative is a hard character cut.
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current !== '' && current.length + sentence.length + 1 > CHUNK_TARGET_CHARS) {
      out.push(current);
      current = '';
    }
    // A single sentence over the budget: cut it. At this point the text has no
    // paragraph breaks and no sentence terminators, so there is nothing left to
    // respect.
    if (sentence.length > CHUNK_TARGET_CHARS) {
      for (let i = 0; i < sentence.length; i += CHUNK_TARGET_CHARS) {
        out.push(sentence.slice(i, i + CHUNK_TARGET_CHARS));
      }
      continue;
    }
    current = current === '' ? sentence : `${current} ${sentence}`;
  }

  if (current !== '') out.push(current);
  return out;
}

/**
 * Split document text into chunks.
 *
 * Returns at least one chunk for any non-empty input, so the caller never has to
 * handle "a document that produced no work" as a separate case — the text path
 * (task 9) relies on this, because a short pasted passage is a one-chunk job
 * through exactly the same machinery.
 */
export function chunkDocument(text: string): ChunkResult {
  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (normalised === '') return { chunks: [], truncated: false };

  // Blank-line separated. Anything a PDF text layer produces has these; text
  // pasted from a webpage usually does too.
  const paragraphs = normalised
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');

  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_PARAGRAPH_CHARS) {
      pieces.push(...splitLongParagraph(paragraph));
    } else {
      pieces.push(paragraph);
    }
  }

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ index: chunks.length, text: current.join('\n\n') });
    // The overlap: the last paragraph of this chunk opens the next one. Skipped
    // when the chunk is a single paragraph, because repeating the whole of it
    // would make the next chunk start with a duplicate of everything just sent.
    const last = current.length > 1 ? current[current.length - 1] : undefined;
    current = last === undefined ? [] : [last];
    currentChars = last === undefined ? 0 : last.length;
  };

  for (const piece of pieces) {
    if (currentChars > 0 && currentChars + piece.length > CHUNK_TARGET_CHARS) {
      flush();
      if (chunks.length >= MAX_CHUNKS_PER_JOB) {
        return { chunks: chunks.slice(0, MAX_CHUNKS_PER_JOB), truncated: true };
      }
    }
    current.push(piece);
    currentChars += piece.length;
  }
  flush();

  if (chunks.length > MAX_CHUNKS_PER_JOB) {
    return { chunks: chunks.slice(0, MAX_CHUNKS_PER_JOB), truncated: true };
  }
  return { chunks, truncated: false };
}
