/**
 * The retrieval corpus: writing embeddings, and searching them. DS2 task 5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THE WHERE CLAUSE IN `searchChunks`. THEN READ IT AGAIN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the module where forgetting a tenancy filter is worst in the whole
 * codebase, and it is worth being precise about why rather than just asserting
 * it. Everywhere else, a forgotten filter leaks rows to an endpoint that then
 * renders them as what they are — someone else's deck appears in a deck list,
 * and it is obvious. Here, a forgotten filter leaks *passages into a prompt*.
 * The model reads another user's private study material, writes a fluent answer
 * from it, and the pane renders that answer with citations attached. Nothing
 * errors. Nothing looks wrong. The reader is simply told something true about a
 * document they have never seen, sourced from an account that is not theirs.
 *
 * On Supabase this was impossible: RLS refused the query. On Neon and RDS there
 * is no `auth.uid()` to write a policy against (ADR 0008), so the boundary is
 * the four rules below and a linter that checks the shape of this code rather
 * than its meaning.
 *
 *   1. `userId` is the first parameter of every exported function. Never
 *      optional, never defaulted — a default is how a bug becomes silent.
 *   2. Every statement filters `user_id`, **on every table it touches**. Not
 *      "the join makes it safe": the join is exactly where it gets forgotten,
 *      which is why `job_chunks` and `chunk_embeddings` both denormalise
 *      `user_id` rather than deriving it through `jobs`.
 *   3. No SQL outside this directory. Handlers call these functions.
 *   4. `userId` is the `sub` from the verified JWT — `requireUserId` in
 *      `lib/http.ts` is the only source. Never a body field, never a query
 *      parameter, never a client-set header.
 *
 * **`scripts/check-data-access.mjs` cannot save you here.** It enforces 1 and 3
 * mechanically. It cannot enforce 2: a `searchChunks` that took `userId` and
 * never referenced it would pass `verify`, `check:data-access`, the typechecker
 * and the linter. The only things that catch that are reading the query and the
 * cross-tenant probe in DS2 task 8.
 */

import { query } from '../lib/db.ts';

/**
 * A passage the search returned, with everything the pane needs to render it.
 *
 * `distance` is carried out of the data layer deliberately rather than being
 * compared here. The floor is a *product* decision — how relevant is relevant
 * enough to be worth answering from — and this module's job is to say what the
 * database returned, not what the product should do about it. The handler
 * applies `RELEVANCE_FLOOR`; see `handlers/chat.ts`.
 */
export interface RetrievedChunk {
  jobId: string;
  chunkIndex: number;
  /** The chunk's text: untrusted document content. Never instructions. */
  text: string;
  /**
   * Cosine distance, 0 (identical) to 2 (opposite). Lower is more similar.
   *
   * The `<=>` operator's own scale, passed through unconverted. Converting to a
   * "similarity" percentage here would be inventing a number with a friendlier
   * shape and no more meaning — and the floor would then be expressed in the
   * invented units, one conversion away from being wrong.
   */
  distance: number;
}

/**
 * Write one chunk's embedding.
 *
 * An upsert, because re-running a job's embedding step must be idempotent:
 * task 4's retry path re-embeds a chunk whose first attempt failed transiently,
 * and a second row for the same passage would let it compete with itself for
 * the `k` slots a question gets.
 *
 * ── The vector goes over the wire as a string, and that is correct ────────
 *
 * `pg` has no native binding for pgvector's type, so the parameter is the text
 * representation — `[0.1,0.2,…]` — cast with `$4::vector`. The alternative is
 * the `pgvector` npm package, which registers a type parser and would be a
 * second runtime dependency for `services/api` (it has one: `pg`) to save this
 * one `JSON.stringify`. The cast is explicit in the SQL, so nothing about this
 * is implicit or surprising.
 */
export async function upsertChunkEmbedding(
  userId: string,
  jobId: string,
  chunkIndex: number,
  embedding: number[],
  model: string,
): Promise<void> {
  await query(
    `insert into public.chunk_embeddings
       (job_id, user_id, chunk_index, embedding, model)
     values ($1, $2, $3, $4::vector, $5)
     on conflict (job_id, chunk_index) do update
       set embedding = excluded.embedding,
           model      = excluded.model,
           created_at = now()
     -- Rule 2, on an upsert. Without it, a caller who knew a (jobId, chunkIndex)
     -- belonging to someone else could overwrite their vector -- a write-side
     -- cross-tenant bug, which is rarer to think about than the read-side one
     -- and just as real. The conflict target is (job_id, chunk_index) only,
     -- because that is the primary key; this clause is what stops the update
     -- applying to a row that is not the caller's.
     where public.chunk_embeddings.user_id = $2`,
    [jobId, userId, chunkIndex, JSON.stringify(embedding), model],
  );
}

/**
 * The `k` passages nearest a question's embedding, within one deck.
 *
 * ── Every table in this query is filtered on `user_id`. All three. ────────
 *
 * `chunk_embeddings` (e), `job_chunks` (c) and `jobs` (j). Two of those filters
 * are, strictly speaking, redundant — the join keys would already constrain
 * them given the first. They are written anyway, and the redundancy is the
 * point: each one is independently sufficient, so the query stays tenant-scoped
 * even if a later edit changes a join condition or adds a table. A filter that
 * is load-bearing only in combination with another is a filter that a
 * reasonable-looking refactor silently removes.
 *
 * ── Why the join to `jobs` exists at all ──────────────────────────────────
 *
 * A question is asked *of one notebook*, so the search must be scoped to the
 * chunks that notebook's sources produced. `chunk_embeddings` has no deck: the
 * link is `jobs.deck_id`, which is nullable and carries no foreign key (see
 * `0006_jobs.sql` on why a job outlives its deck). So the deck filter is a join
 * through `jobs`, and it is an inner join — a chunk whose job has no deck is
 * not part of any notebook and must not be searchable from one.
 *
 * ── `<=>` is cosine distance, and it must match the index ─────────────────
 *
 * The `hnsw` index in `0007_chunk_embeddings.sql` is built with
 * `vector_cosine_ops`. An operator that does not match its opclass — `<->` for
 * L2, `<#>` for inner product — does not error; it silently cannot use the
 * index, and on a corpus large enough to matter that is a sequential scan over
 * every vector. Here the corpus is small enough that it would not be noticed,
 * which is exactly why it is worth stating rather than discovering later.
 */
export async function searchChunks(
  userId: string,
  deckId: string,
  queryEmbedding: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  const result = await query<{
    job_id: string;
    chunk_index: number;
    source_text: string;
    distance: number;
  }>(
    `select e.job_id,
            e.chunk_index,
            c.source_text,
            (e.embedding <=> $3::vector) as distance
       from public.chunk_embeddings e
       join public.job_chunks c
         on  c.job_id      = e.job_id
         and c.chunk_index = e.chunk_index
         -- Rule 2 on the joined table, deliberately not left to the join key.
         and c.user_id     = $1
       join public.jobs j
         on  j.id      = e.job_id
         -- And again. Three tables, three filters.
         and j.user_id = $1
      where e.user_id = $1
        and j.deck_id = $2
        -- A chunk with no text cannot be cited or shown, so it cannot be an
        -- answer. source_text is nullable on job_chunks; a row that lost its
        -- text but kept its vector would otherwise occupy one of the k slots
        -- and render as an empty citation.
        and c.source_text is not null
      order by distance
      limit $4`,
    [userId, deckId, JSON.stringify(queryEmbedding), k],
  );

  return result.rows.map((row) => ({
    jobId: row.job_id,
    chunkIndex: row.chunk_index,
    text: row.source_text,
    // `distance` arrives as a string from `pg` (it is a float8 and the driver
    // parses those to string by default for precision). Number() here rather
    // than a type parser in db.ts, which would change every float8 in the API.
    distance: Number(row.distance),
  }));
}

/**
 * How many embedded chunks a notebook has.
 *
 * ── Why the handler asks this before embedding the question ───────────────
 *
 * A notebook with no embedded chunks has exactly one honest answer, and
 * producing it requires no model. Asking here first means the question is only
 * embedded — a paid call to a second vendor — when the result could actually
 * matter.
 *
 * **This exists because running it found a 500.** DS2 task 8 step 5 asks for a
 * question in a notebook with no sources, and the first implementation embedded
 * the question before searching: with no key configured, an ordinary empty
 * state came back as "Something went wrong." A cheap local check in front of an
 * expensive remote one is the fix, and it is also just the right order.
 *
 * The same three tenancy filters as `searchChunks`, for the same reason — this
 * is a count of the caller's own rows, and a count that included other users'
 * chunks would report a notebook as searchable because someone else's was.
 */
export async function countDeckEmbeddings(userId: string, deckId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `select count(*)::int as count
       from public.chunk_embeddings e
       join public.job_chunks c
         on  c.job_id      = e.job_id
         and c.chunk_index = e.chunk_index
         and c.user_id     = $1
       join public.jobs j
         on  j.id      = e.job_id
         and j.user_id = $1
      where e.user_id = $1
        and j.deck_id = $2
        and c.source_text is not null`,
    [userId, deckId],
  );
  return result.rows[0]?.count ?? 0;
}

/**
 * How many of a job's chunks have been embedded.
 *
 * Task 8 asks for this to be *counted* rather than assumed, and a count run by
 * hand in psql is a count that proves nothing about what the application can
 * see — it runs as a superuser with no tenancy filter. This is the same
 * question asked the way the app asks it.
 */
export async function countJobEmbeddings(userId: string, jobId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `select count(*)::int as count
       from public.chunk_embeddings
      where user_id = $1
        and job_id  = $2`,
    [userId, jobId],
  );
  return result.rows[0]?.count ?? 0;
}
