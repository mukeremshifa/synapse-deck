/**
 * The state machine's first step: turn a job into a list of chunks. P10 task 5.
 *
 * Invoked by Step Functions, not by API Gateway, so it takes and returns plain
 * JSON rather than an HTTP event. Its return value is what the Map state
 * iterates over — which is why the chunks come back as an array of small
 * objects rather than as one large blob: Step Functions carries state between
 * steps as JSON with a **256 KB limit**, and putting a whole document's text in
 * there is the classic way to exceed it.
 *
 * So the chunk *text* is written to DynamoDB and the Map state carries only
 * `{ userId, jobId, chunkIndex }`. Each worker reads its own chunk back. That
 * costs one extra read per chunk and makes the payload size independent of the
 * document's size, which is the trade worth making.
 *
 * No SQL and no direct datastore call here — everything goes through `data/`.
 */

import { chunkDocument } from '../lib/chunking.ts';
import { putChunkText, updateJobStatus } from '../data/jobs.ts';

export interface SplitInput {
  userId: string;
  jobId: string;
  text: string;
  cardCount: number;
  kinds: string[];
  depth: string;
}

export interface SplitOutput {
  userId: string;
  jobId: string;
  chunkCount: number;
  truncated: boolean;
  /** What the Map state iterates. Deliberately tiny — see the header. */
  chunks: Array<{ userId: string; jobId: string; chunkIndex: number }>;
}

export async function handler(input: SplitInput): Promise<SplitOutput> {
  const { userId, jobId } = input;

  const { chunks, truncated } = chunkDocument(input.text);

  if (chunks.length === 0) {
    // An empty document is a failed job, not a job with zero chunks that
    // "succeeds" having produced nothing. The distinction matters at the review
    // gate, which would otherwise show an empty deck with no explanation.
    await updateJobStatus(userId, jobId, 'failed', {
      error: 'The document had no readable text. A scanned PDF cannot be read.',
      chunkCount: 0,
    });
    return { userId, jobId, chunkCount: 0, truncated: false, chunks: [] };
  }

  // Chunk text is stored before the fan-out starts, so a worker never races the
  // splitter for its own input.
  await Promise.all(
    chunks.map((chunk) => putChunkText(userId, jobId, chunk.index, chunk.text)),
  );

  await updateJobStatus(userId, jobId, 'running', {
    chunkCount: chunks.length,
    truncated,
  });

  return {
    userId,
    jobId,
    chunkCount: chunks.length,
    truncated,
    chunks: chunks.map((chunk) => ({ userId, jobId, chunkIndex: chunk.index })),
  };
}
