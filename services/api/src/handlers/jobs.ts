/**
 * `GET /jobs/{jobId}` — what replaces the SSE stream. P10 task 5.
 *
 * ── Why polling rather than a held-open connection ────────────────────────
 *
 * P2 streamed cards over SSE from an Edge Function, which worked because Deno
 * held the connection for the whole generation. That does not survive the move
 * to a fan-out: the work now happens across a Step Functions Map state and
 * several Lambdas, none of which is the process the browser is connected to.
 *
 * The brief calls polling "boring and probably correct". It is also the only
 * option that composes with an asynchronous pipeline — there is no connection
 * for a Map state to stream into.
 *
 * ── What this returns, and what it deliberately does not ──────────────────
 *
 * Status, per-chunk progress, the cards that have arrived so far, and an honest
 * count of what failed. **Not** the chunks' source text, which is an input
 * rather than a result and would multiply the response size for no purpose --
 * `getJobWithChunks` filters those out by sort-key prefix.
 *
 * Partial failure is reported rather than hidden (task 6): a job that produced
 * cards from 31 of 40 chunks says so. A deck that quietly contains three
 * quarters of a document is a product that lies.
 */

import {
  createJob,
  findJobForDeck,
  getJobWithChunks,
  type ChunkRecord,
  type JobRecord,
} from '../data/jobs.ts';
import { createDeck } from '../data/decks.ts';
import { createGeneration, readGenerationCounts } from '../data/generations.ts';
import { startIngestion } from '../data/pipeline.ts';
import { readDocumentText, assertOwnedKey } from '../data/uploads.ts';
import { chunkDocument } from '../lib/chunking.ts';
import {
  GENERATION_QUOTA,
  decideGeneration,
  monthWindow,
  rateWindowStart,
  remainingUnits,
  staleRunningBefore,
  unitsForChunks,
} from '../lib/quota.ts';
import {
  errorResponse,
  json,
  logRequest,
  noContent,
  pathParam,
  queryParam,
  readJsonBody,
  requireUserId,
  type ApiEvent,
  type ApiResponse,
} from '../lib/http.ts';
import { ApiError, notFound } from '../lib/rows.ts';
import { StartJobRequest } from '../lib/schemas.ts';
import { randomUUID } from 'node:crypto';

/**
 * One response shape for both routes, so the polling view and the review gate
 * cannot drift into describing the same job differently.
 *
 * `chunksSucceeded`/`chunksFailed` are derived from the chunk records when they
 * are available and fall back to the job's own counters when they are not — the
 * deck lookup deliberately does not read every chunk, because it only needs the
 * headline.
 */
function summarise(job: JobRecord, chunks: ChunkRecord[]) {
  const succeeded = chunks.filter((chunk) => chunk.status === 'succeeded');
  const failed = chunks.filter((chunk) => chunk.status === 'failed');

  return {
    jobId: job.jobId,
    status: job.status,
    deckId: job.deckId,
    chunkCount: job.chunkCount,
    chunksCompleted: job.chunksCompleted,
    // Null, not zero, when the chunk records were not read. The deck lookup
    // does not fetch them, and reporting a confident `0 failed` from data that
    // was never loaded is precisely the lie this task exists to prevent -- it
    // would render as "nothing went wrong" on a job where plenty did.
    chunksSucceeded: chunks.length > 0 ? succeeded.length : null,
    chunksFailed: chunks.length > 0 ? failed.length : null,
    truncated: job.truncated,
    error: job.error,
    // Cards from every chunk that has finished, in chunk order. The client
    // renders these as they arrive, which is what preserves the "watch cards
    // appear" feel the SSE stream used to give.
    cards: succeeded.flatMap((chunk) => chunk.cards),
    /**
     * Which providers produced these cards. Normally one name; it is an array
     * because a job retried after a provider change could legitimately hold
     * two, and because a response containing `"stub"` must be able to say so.
     */
    providers: [...new Set(succeeded.map((chunk) => chunk.provider).filter(Boolean))],
    /**
     * Topic names the model gave these chunks, deduplicated for display only
     * (P10 task 7).
     *
     * **Not reconciled and not topic ids.** Nothing has been written to
     * `public.topics` at this point: a job the user abandons must leave no
     * topics behind. The `?? []` covers chunk records written before migration
     * 0004, which have no `topics` attribute at all -- DynamoDB is schemaless,
     * so an older item simply lacks the field rather than carrying a null.
     */
    topics: [
      ...new Set(succeeded.flatMap((chunk) => chunk.topics ?? []).filter(Boolean)),
    ],
  };
}

export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const { method } = event.requestContext.http;
  if (method === 'OPTIONS') return noContent();

  let userId: string | undefined;
  try {
    userId = requireUserId(event);
    logRequest(event, { userId });

    // POST /jobs — start an ingestion run for an already-uploaded document.
    if (method === 'POST') {
      const parsed = StartJobRequest.safeParse(readJsonBody(event));
      if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid job request.');
      }

      // Either an uploaded document or pasted text -- the schema guarantees
      // exactly one (task 9). From here down there is no difference: the same
      // chunker, the same quota, the same state machine, the same review gate.
      // That is the point of moving `/create/text` here rather than keeping a
      // second path that happens to share a schema.
      let text: string;
      if (parsed.data.objectKey !== undefined) {
        // **The object key is re-checked, not trusted.** It arrives in a request
        // body, so a caller could name another user's object; `assertOwnedKey`
        // rejects any key outside this user's own prefix. Rule 4: userId comes
        // from the verified JWT and nothing else decides what may be read.
        assertOwnedKey(userId, parsed.data.objectKey);
        text = await readDocumentText(userId, parsed.data.objectKey);
      } else {
        // Pasted text needs no ownership check -- it is the caller's own request
        // body, not a reference to something stored. Zod has already bounded its
        // length; nothing else about it is trusted, and it reaches the model as
        // document content rather than as instructions.
        text = parsed.data.text ?? '';
      }

      // ── The quota gate ───────────────────────────────────────────────────
      //
      // **Everything below this point costs money, and nothing above it does.**
      // The document is chunked here rather than inside the pipeline so the
      // price is known exactly -- one chunk is one model call is one unit --
      // before a deck exists, before a job record exists, and before Step
      // Functions is handed anything.
      //
      // Refusing at chunk 30 of 40 would leave the user charged for 30 calls
      // and holding a deck covering three quarters of a document. The whole job
      // is priced or none of it runs.
      //
      // The chunking is not wasted: `startIngestion` needs the same chunks, so
      // they are computed once and passed down rather than recomputed.
      const chunked = chunkDocument(text);
      const units = unitsForChunks(chunked.chunks.length);

      const now = new Date();
      const month = monthWindow(now);
      const counts = await readGenerationCounts(userId, {
        monthStart: month.start,
        monthEnd: month.end,
        windowStart: rateWindowStart(now),
        staleBefore: staleRunningBefore(now),
      });

      const decision = decideGeneration({
        usedThisMonth: counts.usedThisMonth,
        inWindow: counts.inWindow,
        running: counts.running,
        units,
        // Not the ceiling that applies here. `maxInputChars` bounds a single
        // assembled prompt, and a document is never sent as one -- each chunk
        // is its own call, and `CHUNK_TARGET_CHARS` keeps every one of them far
        // inside it. Passing the document's full length would refuse every
        // document over 28k characters, which is most of the ones worth
        // uploading. The real ceiling on a document is MAX_CHUNKS_PER_JOB.
        promptChars: 0,
      });

      if (!decision.allowed) {
        // 402, not 400: the request is well formed and would be accepted with a
        // larger allowance. The code travels so the client can tell a quota
        // refusal from a rate limit without parsing prose.
        throw new ApiError(402, decision.message, decision.code);
      }

      // The deck exists before the cards do, so the job has somewhere to put
      // them and the deck list can show that something is happening.
      const deck = await createDeck(userId, {
        title: parsed.data.deckTitle,
        description: null,
        source: parsed.data.objectKey !== undefined ? 'document' : 'text',
        status: 'generating',
      });

      // Written before the work starts, with `status = 'running'`, which is what
      // makes the concurrency limit real: three tabs opened at once each see the
      // others' rows. A row written on completion would count nothing while it
      // mattered most.
      await createGeneration(userId, {
        deckId: deck.id,
        source: parsed.data.objectKey !== undefined ? 'document' : 'text',
        // The provider is resolved per chunk inside the pipeline, so the model
        // is not known here. Recorded when the job finishes rather than guessed
        // now -- a wrong name in the cost trail is worse than a pending one.
        model: 'pending',
        inputChars: text.length,
        cardsRequested: parsed.data.cardCount,
        units,
      });

      const jobId = randomUUID();
      await createJob(userId, jobId, deck.id);
      await startIngestion(userId, {
        jobId,
        text,
        cardCount: parsed.data.cardCount,
        kinds: parsed.data.kinds,
        depth: parsed.data.depth,
      });

      return json(202, { jobId, deckId: deck.id, units });
    }

    if (method !== 'GET') throw new ApiError(405, `${method} is not allowed here.`);

    // `GET /quota` — what the upload and paste screens show before a user
    // commits to a job. Advisory: this endpoint reports, `POST /jobs` refuses,
    // and both read `src/lib/quota.ts` so they cannot disagree.
    if (event.requestContext.http.path.endsWith('/quota')) {
      const now = new Date();
      const month = monthWindow(now);
      const counts = await readGenerationCounts(userId, {
        monthStart: month.start,
        monthEnd: month.end,
        windowStart: rateWindowStart(now),
        staleBefore: staleRunningBefore(now),
      });
      return json(200, {
        used: counts.usedThisMonth,
        remaining: remainingUnits(counts.usedThisMonth),
        limit: GENERATION_QUOTA.monthlyUnits,
        resetsAt: month.end.toISOString(),
      });
    }

    // `GET /jobs?deckId=…` — the review gate's lookup (task 6). It knows the
    // deck it is showing and needs the job that produced it, so that it can say
    // what did *not* make it in. A deck cannot carry that itself: the sections
    // that failed left no rows behind.
    const deckId = queryParam(event, 'deckId');
    if (deckId !== undefined) {
      const found = await findJobForDeck(userId, deckId);
      // Null rather than 404: a deck with no job is the ordinary case for every
      // hand-made deck, not a missing resource.
      if (found === null) return json(200, null);

      // A second read for the chunk records. The gate's whole purpose here is to
      // report what failed, and that count only exists per chunk -- returning
      // the summary alone would leave it null and the gate silent.
      const { job, chunks } = await getJobWithChunks(userId, found.jobId);
      return json(200, job === null ? null : summarise(job, chunks));
    }

    const jobId = pathParam(event, 'jobId');
    const { job, chunks } = await getJobWithChunks(userId, jobId);

    // 404, never 403 — matching every other resource in this API. A 403 would
    // confirm the job exists, which is a disclosure a 404 avoids. `userId` is
    // the partition key here, so another user's job is not found rather than
    // filtered out.
    if (job === null) throw notFound('Job');

    return json(200, summarise(job, chunks));
  } catch (error) {
    return errorResponse(error, event.requestContext.requestId, userId);
  }
}
