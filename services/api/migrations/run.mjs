#!/usr/bin/env node
/**
 * The migration runner. `npm run db:migrate` / `npm run db:migrate:status`.
 *
 * Plain SQL files applied in filename order, which is the same convention
 * `supabase/migrations/` used — so the habit transfers even though the tool
 * does not. P9 task 3 says explicitly not to reach for a migration framework
 * for five files, and this is what that looks like: about two hundred lines,
 * one dependency (`pg`, which the API needs anyway), no DSL, no down-migrations.
 *
 * See README.md in this directory for why, and for the operational rules.
 *
 * ── What this actually guarantees ─────────────────────────────────────────
 *
 * Four things, and it is worth being precise because nothing else in this
 * repository checks the schema at all:
 *
 *   1. **One transaction per file.** A migration that fails leaves the database
 *      on the last good one, never half-applied. Postgres does transactional
 *      DDL, which is the whole reason this is only a few lines.
 *   2. **An advisory lock** around the run, so CI and a laptop cannot interleave
 *      and apply the same file twice.
 *   3. **A ledger** (`schema_migrations`) of what has been applied.
 *   4. **Checksums.** An already-applied file that has since been edited is a
 *      hard error. This is the closest thing to a test that exists on the SQL,
 *      and it catches the specific mistake the rule "never edit an applied
 *      migration" exists to prevent — quietly, on the next run, rather than as
 *      a schema drift discovered months later.
 *
 * What it does NOT guarantee is that the SQL is correct. Nothing does, since
 * ADR 0005. Read it yourself.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * One arbitrary but fixed 64-bit key. Any two runners using the same number
 * serialise against each other; the value itself is meaningless.
 */
const ADVISORY_LOCK_KEY = 8_531_204_771_003_441n;

const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/** `--status` lists and exits without applying anything. */
const statusOnly = process.argv.includes('--status');

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Standard PG* environment variables, which is what `pg` reads by default and
 * what psql reads too — so a connection that works in one works in the other.
 *
 * SSL is required unless the host is local. RDS refuses unencrypted connections
 * anyway, but stating it here means the failure is a clear message rather than
 * a confusing handshake error.
 *
 * `rejectUnauthorized: false` is a real weakening and is called out rather than
 * hidden: it encrypts the connection but does not verify RDS's certificate
 * chain, so it stops passive eavesdropping and not an active man-in-the-middle.
 * The fix is shipping the RDS root CA bundle and verifying against it. Inside a
 * VPC with no internet gateway the exposure is small — an attacker would
 * already need to be inside the VPC — which is why this is a Phase F hardening
 * item rather than a blocker now.
 */
function connectionConfig() {
  const host = process.env.PGHOST ?? 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  return {
    host,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'synapsedeck',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    // A migration that hangs should fail rather than block a deploy forever.
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * Created outside the per-migration transaction, and `if not exists`, so a
 * first run on an empty database works the same as every later one.
 *
 * `checksum` is what makes "never edit an applied migration" enforceable rather
 * than merely stated.
 */
const LEDGER_DDL = `
  create table if not exists public.schema_migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
  );
  comment on table public.schema_migrations is
    'Applied migrations. Managed by services/api/migrations/run.mjs.';
`;

function checksum(sql) {
  // Newlines normalised so a file that round-trips through a Windows checkout
  // does not read as edited. Git's autocrlf makes this a real possibility on
  // this project, which is developed on Windows and runs in CI on Linux.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

async function readMigrations() {
  const entries = await readdir(HERE);
  const files = entries.filter((f) => MIGRATION_PATTERN.test(f)).sort();

  // A .sql file that does not match the naming convention is a mistake worth
  // catching: it would be silently skipped, and a migration that never runs is
  // the hardest kind of bug to see.
  const strays = entries.filter((f) => f.endsWith('.sql') && !MIGRATION_PATTERN.test(f));
  if (strays.length > 0) {
    throw new Error(
      `Not named like a migration, so they would be silently skipped: ${strays.join(', ')}\n` +
        'Expected NNNN_lower_snake_case.sql',
    );
  }

  return Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(join(HERE, filename), 'utf8');
      return { filename, sql, checksum: checksum(sql) };
    }),
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const migrations = await readMigrations();
  if (migrations.length === 0) {
    console.log('No migrations found.');
    return;
  }

  const client = new pg.Client(connectionConfig());
  await client.connect();

  try {
    // Serialise concurrent runners. Session-scoped, so it is released when the
    // connection closes even if this process is killed.
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY.toString()]);

    await client.query(LEDGER_DDL);

    const { rows: applied } = await client.query(
      'select filename, checksum, applied_at from public.schema_migrations',
    );
    const appliedByName = new Map(applied.map((r) => [r.filename, r]));

    // ── Drift check, before anything is applied ────────────────────────────
    //
    // Deliberately checked for ALL applied migrations up front rather than
    // lazily per file: finding out that 0001 was edited only after 0002 has
    // been applied is finding out too late.
    const drifted = migrations.filter((m) => {
      const record = appliedByName.get(m.filename);
      return record !== undefined && record.checksum !== m.checksum;
    });

    if (drifted.length > 0) {
      throw new Error(
        `These migrations were already applied but their contents have changed:\n` +
          drifted.map((m) => `  - ${m.filename}`).join('\n') +
          '\n\nNever edit an applied migration; add a new one. If the edit was ' +
          'intentional and the database really does match, update the checksum ' +
          'in public.schema_migrations by hand and record why.',
      );
    }

    // A migration recorded in the ledger but missing from disk means someone
    // deleted a file that has run. Not fatal — the database is still correct —
    // but it makes the ledger a lie, so say so.
    const orphans = applied.filter(
      (r) => !migrations.some((m) => m.filename === r.filename),
    );
    for (const orphan of orphans) {
      console.warn(`⚠ ${orphan.filename} is applied but no longer on disk.`);
    }

    const pending = migrations.filter((m) => !appliedByName.has(m.filename));

    // ── Status ────────────────────────────────────────────────────────────
    console.log(`\n${client.database} on ${client.host}\n`);
    for (const m of migrations) {
      const record = appliedByName.get(m.filename);
      console.log(
        record
          ? `  ✓ ${m.filename}  applied ${record.applied_at.toISOString()}`
          : `  · ${m.filename}  PENDING`,
      );
    }

    if (statusOnly) {
      console.log(
        `\n${pending.length} pending, ${applied.length} applied. Nothing was changed.`,
      );
      return;
    }

    if (pending.length === 0) {
      console.log('\nUp to date.');
      return;
    }

    // ── Apply ─────────────────────────────────────────────────────────────
    console.log(`\nApplying ${pending.length} migration(s)...\n`);

    for (const migration of pending) {
      // One transaction per file. Postgres does transactional DDL, so a
      // migration either lands whole or not at all — including its ledger row,
      // which is inserted inside the same transaction so the two can never
      // disagree.
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into public.schema_migrations (filename, checksum) values ($1, $2)',
          [migration.filename, migration.checksum],
        );
        await client.query('commit');
        console.log(`  ✓ ${migration.filename}`);
      } catch (error) {
        await client.query('rollback');
        console.error(`  ✗ ${migration.filename} — rolled back`);
        throw error;
      }
    }

    console.log(`\n✓ ${pending.length} migration(s) applied.`);
  } finally {
    // Releases the advisory lock with the session.
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n✗ Migration failed.\n\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
