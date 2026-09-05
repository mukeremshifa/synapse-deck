/**
 * The connection pool, and nothing else.
 *
 * ── Why a module-scope pool ───────────────────────────────────────────────
 *
 * Lambda reuses the execution context between invocations, so anything created
 * at module scope survives until the container is recycled. A `pg.Pool` created
 * here is therefore reused across warm invocations and paid for once per cold
 * start — which matters more than usual on RDS: `db.t4g.micro` has a
 * `max_connections` in the low hundreds, and a pool per invocation would
 * exhaust it under trivial load.
 *
 * `max: 2` rather than the default 10. One Lambda invocation handles one
 * request and issues at most a handful of statements, several of which run
 * concurrently (`Promise.all` in the queue reads). Two connections covers that;
 * ten would multiply by the number of warm containers for no benefit.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 *
 * Standard `PG*` environment variables, exactly as `services/api/migrations/run.mjs`
 * reads them — so a connection string that works for the migration runner works
 * here. The API stack sets them from SSM (host, port, name) and from the
 * generated secret (user, password), resolved at deploy time so no Lambda makes
 * a Secrets Manager call and the VPC needs no interface endpoint for one. See
 * `infra/lib/data-stack.ts` for why that matters ($7.20/mo per AZ).
 *
 * `rejectUnauthorized: false` carries the same caveat the migration runner
 * documents: it encrypts but does not verify RDS's certificate chain, so it
 * stops passive eavesdropping and not an active man-in-the-middle. Inside a VPC
 * with no internet gateway an attacker would already have to be inside the VPC.
 * Shipping the RDS root CA bundle is the fix and is a Phase F hardening item.
 */

import pg from 'pg';

/**
 * Timestamps leave this API as ISO 8601, in UTC, with Postgres's full
 * microsecond precision.
 *
 * Two constraints meet here and only one shape satisfies both.
 *
 * **The client parses these with `new Date()`.** `src/lib/fsrs.ts` reads
 * `card.due` and `card.last_review` to compute the next interval, and
 * `src/lib/queue.ts` reads `due` to order the session. Postgres's own output
 * format — `2026-09-06 03:43:16.065206+04`, a space instead of `T` — is
 * **not** a format the ECMAScript specification requires any engine to parse.
 * V8 accepts it, so it works in Chrome and in Node; that is a property of the
 * engine, not a guarantee, and it has historically failed in Safari. A date
 * that silently becomes `Invalid Date` in one browser is a wrong FSRS interval,
 * which is the kind of bug that looks like the algorithm is broken.
 *
 * **`updated_at` is the optimistic-concurrency token.** The client sends it
 * back and `review_card` compares it as `$5::timestamptz` — a timestamp
 * comparison, not a string one, so the format may change but the *instant* must
 * survive exactly. Postgres stores microseconds; `Date` holds milliseconds. So
 * parsing to a `Date` and re-serialising would truncate `.065206` to `.065`
 * and every rating would start failing with PT409.
 *
 * Hence a pure string transform on the wire text: the offset is applied to the
 * date and time, and the fractional seconds are carried across untouched. No
 * `Date` is constructed for the fraction, so nothing is truncated, and
 * Postgres re-parses the result to the identical instant.
 *
 * 1184 is `timestamptz`, 1114 is `timestamp`. Set once at module scope,
 * before any pool exists.
 */
const PG_TIMESTAMPTZ =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/;

export function pgTimestampToIso(value: string): string {
  const match = PG_TIMESTAMPTZ.exec(value);
  // Anything unrecognised is handed through rather than mangled: returning the
  // original is always at least as good as returning a guess.
  if (!match) return value;

  const [, date, time, fraction = '', offsetHours, offsetMinutes = '00'] = match;
  const sign = offsetHours!.startsWith('-') ? 1 : -1;
  const shiftMinutes =
    sign * (Math.abs(Number(offsetHours)) * 60 + Number(offsetMinutes));

  // Seconds and coarser only — the fraction is never part of this arithmetic,
  // which is what keeps the microseconds intact.
  const utc = new Date(`${date}T${time}Z`);
  utc.setUTCMinutes(utc.getUTCMinutes() + shiftMinutes);

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}` +
    `T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}` +
    `${fraction}Z`
  );
}

pg.types.setTypeParser(1184, pgTimestampToIso);
// `timestamp` without a zone carries no offset to apply. No column in this
// schema is one; the parser is set so that adding one cannot silently
// reintroduce the space-separated format.
pg.types.setTypeParser(1114, (value: string) =>
  value.includes(' ') ? `${value.replace(' ', 'T')}Z` : value,
);

/**
 * `int8` (count(*)) parses to a string by default, because a 64-bit integer
 * does not fit a JS number. Every count in this application is a row count in
 * the thousands, so a number is both safe and what the callers expect.
 */
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const host = process.env['PGHOST'] ?? 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  pool = new pg.Pool({
    host,
    port: Number(process.env['PGPORT'] ?? 5432),
    database: process.env['PGDATABASE'] ?? 'synapsedeck',
    user: process.env['PGUSER'],
    password: process.env['PGPASSWORD'],
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 2,
    // A Lambda has a hard timeout of its own; a connection that has not
    // arrived in five seconds will not arrive before the function is killed.
    connectionTimeoutMillis: 5_000,
    // Well under RDS's own idle timeout, so a stale socket is discarded here
    // rather than surfacing as a mid-query connection reset.
    idleTimeoutMillis: 30_000,
    // No statement in this API is a report. Anything past ten seconds is a
    // bug, and failing fast leaves an error in the log instead of a timeout.
    statement_timeout: 10_000,
  });

  // A pool that emits `error` with no listener crashes the process. An idle
  // client dropped by RDS is routine, not fatal: the pool discards it and the
  // next acquire makes a new one.
  pool.on('error', (error: Error) => {
    console.error(
      JSON.stringify({ level: 'error', msg: 'idle pool client error', error: error.message }),
    );
  });

  return pool;
}

/** Every query in the data layer goes through here. */
export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/**
 * Run several statements as one transaction.
 *
 * Used by the writes that touch more than one row and must not half-apply —
 * `finishReviewGate` in particular, which updates a deck and a generation row
 * together.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    // A rollback that itself fails must not mask the error that caused it.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
