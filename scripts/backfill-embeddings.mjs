#!/usr/bin/env node
/**
 * Embed chunks that have no vector. DS2 task 4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SCRIPT SPENDS MONEY. IT IS NOT A MIGRATION AND MUST NEVER BECOME ONE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every chunk it processes is a paid API call to the embedding vendor. That is
 * why it lives in `scripts/` and not in `services/api/migrations/`: a migration
 * runs automatically, in CI, on a deploy, and on anyone's machine that types
 * `npm run db:migrate`. A file that costs money per row must be run
 * deliberately, by someone who meant to.
 *
 * It prints what it would do and asks for `--apply` before doing it.
 *
 * ── Two jobs, and the second is the one that lasts ────────────────────────
 *
 * 1. **Pre-DS2 chunks.** Everything ingested before migration 0007 has no
 *    vector, so those notebooks are invisible to chat. On the machine that
 *    wrote DS2 that was ten chunks from four abandoned DS1 test jobs belonging
 *    to Cognito accounts that no longer exist — not worth embedding, and DS2 §6
 *    records that pre-DS2 notebooks were not backfilled. Another environment
 *    may have a real corpus, which is why the script exists rather than the
 *    decision being hardcoded.
 *
 * 2. **Repairing recorded failures**, which is the durable reason. A chunk
 *    whose cards generated and whose embedding failed is a usable chunk that is
 *    not searchable (`handlers/pipeline-generate.ts` records exactly that, and
 *    does not fail the chunk over it). This script is how that gap is closed
 *    without regenerating the cards. The upsert in `data/chunks.ts` makes it
 *    idempotent, so running it twice costs money and changes nothing.
 *
 * ── It reads the seam rather than reimplementing it ───────────────────────
 *
 * `resolveEmbeddingProvider()` is imported, not bypassed. A script that built
 * its own `fetch` to the vendor would be a second definition of which model
 * embeds this corpus, free to disagree with the one the API uses — and a corpus
 * holding two models' vectors is silently broken, with no error and no symptom
 * except wrong answers.
 *
 *     node --env-file=.env.local scripts/backfill-embeddings.mjs
 *     node --env-file=.env.local scripts/backfill-embeddings.mjs --apply
 */

import pg from 'pg';

const APPLY = process.argv.includes('--apply');

/**
 * How many chunks are embedded per API call.
 *
 * Twenty. The vendor charges and rate-limits per request, so batching is what
 * makes a few hundred chunks a handful of calls rather than a few hundred. The
 * ceiling is the vendor's per-request token limit — twenty chunks of ~3,500
 * characters is roughly 17,000 tokens, comfortably inside it.
 */
const BATCH = 20;

const client = new pg.Client({
  host: process.env['PGHOST'],
  port: Number(process.env['PGPORT'] ?? 5432),
  database: process.env['PGDATABASE'],
  user: process.env['PGUSER'],
  password: process.env['PGPASSWORD'],
  ssl:
    process.env['PGHOST'] === 'localhost' ? false : { rejectUnauthorized: false },
});

await client.connect();

/*
 * ── This query is not tenant-scoped, and that is the one place it is right ──
 *
 * Every rule in ADR 0008 says a statement filters `user_id`. This one does not,
 * because it is not serving a request: it is an operator running a maintenance
 * pass over the whole corpus from a shell, with the database credentials in
 * hand. There is no `sub` to scope it to and no user on whose behalf it runs.
 *
 * It is also why this file is in `scripts/` rather than `services/api/src/data/`
 * — `check-data-access.mjs` would rightly reject it there, and an exception
 * carved into that lint to accommodate a maintenance script is how the lint
 * stops meaning anything. The `user_id` it writes comes from the chunk's own
 * row, so the rows it creates stay correctly scoped even though the read is not.
 */
const { rows } = await client.query(`
  select c.job_id, c.user_id, c.chunk_index, c.source_text
    from public.job_chunks c
    left join public.chunk_embeddings e
      on  e.job_id      = c.job_id
      and e.chunk_index = c.chunk_index
   where e.job_id is null
     and c.source_text is not null
   order by c.job_id, c.chunk_index
`);

if (rows.length === 0) {
  console.log('✓ Every chunk with text already has an embedding. Nothing to do.');
  await client.end();
  process.exit(0);
}

const jobs = new Set(rows.map((r) => r.job_id));
console.log(
  `${rows.length} chunk(s) across ${jobs.size} job(s) have text and no embedding.`,
);

if (!APPLY) {
  console.log(
    '\nThis is a dry run. Nothing was called and nothing was written.\n' +
      `Embedding these costs ${Math.ceil(rows.length / BATCH)} API call(s) against ` +
      'your embedding vendor.\n\nRe-run with --apply to do it.',
  );
  await client.end();
  process.exit(0);
}

const { resolveEmbeddingProvider } = await import(
  '../services/api/src/lib/embeddings/index.ts'
);
const embedder = resolveEmbeddingProvider();
console.log(`Embedding with ${embedder.name} / ${embedder.model}...\n`);

let done = 0;
let failed = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  try {
    const vectors = await embedder.embed(batch.map((r) => r.source_text));

    for (const [n, row] of batch.entries()) {
      await client.query(
        `insert into public.chunk_embeddings
           (job_id, user_id, chunk_index, embedding, model)
         values ($1, $2, $3, $4::vector, $5)
         on conflict (job_id, chunk_index) do update
           set embedding = excluded.embedding,
               model      = excluded.model,
               created_at = now()`,
        [
          row.job_id,
          row.user_id,
          row.chunk_index,
          JSON.stringify(vectors[n]),
          embedder.model,
        ],
      );
      done += 1;
    }
    console.log(`  ✓ ${done}/${rows.length}`);
  } catch (error) {
    // One batch failing must not abandon the rest: the run is resumable by
    // construction (it only ever selects chunks with no embedding), so the
    // useful behaviour is to get as far as it can and report the gap.
    failed += batch.length;
    console.error(`  ✗ batch at ${i}: ${error.message}`);
  }
}

console.log(
  `\n${done} embedded, ${failed} failed. ` +
    (failed > 0 ? 'Re-run to retry the failures — it is idempotent.' : ''),
);

await client.end();
