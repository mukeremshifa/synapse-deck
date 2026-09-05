# `services/api/migrations/` — the RDS schema

Plain SQL, applied in filename order. Five tables and three functions, ported from
`supabase/migrations/` in P9 task 3.

**These live here rather than in `infra/` deliberately.** The schema and the data-access
layer that queries it (`services/api/src/data/`) mirror each other closely enough that
they should be read together — a column added here needs a query changed there, and the
distance between two directories is where that gets forgotten. `infra/` stays pure CDK.

---

## ⚠ There is no RLS in this schema

Read the header of [`0001_schema.sql`](0001_schema.sql) before changing anything. The
short version:

> The Supabase original had 15 policies and `force row level security` on every table.
> Postgres refused any row the caller did not own. **That is gone.** A query that forgets
> `where user_id = $1` used to return nothing; now it returns every user's rows.

The boundary moved into application code. It is weaker than what it replaced. See
[ADR 0008](../../../docs/adr/0008-application-level-tenancy.md) and
[docs/plans/P9-aws-slice.md](../../../docs/plans/P9-aws-slice.md).

**Adding a table? It needs a data-access module with the same discipline**, or its rows
are reachable without an ownership check and nothing in this repository will tell you.

---

## How migrations run

```bash
npm run db:migrate:status   # what is applied, what is pending. Read-only
npm run db:migrate          # apply everything pending, in one transaction each
```

Both need database credentials in the environment (see below). They talk to RDS directly
over the Postgres wire protocol — there is no `supabase db push` here and no CLI to
install.

### Why a plain runner and not a migration framework

The plan (task 3) says not to reach for one, and the reason holds up: five files do not
justify a dependency, a DSL, and a rollback mechanism nobody will exercise. What a
framework would give that [`run.mjs`](run.mjs) does not is down-migrations and squashing.
Down-migrations for a schema this size are a fiction anyway — reversing
`0001_schema.sql` is `drop schema public cascade`, and reversing a data migration
correctly is a bespoke problem every time.

What the runner does provide, because these are the parts that actually bite:

| Behaviour | Why |
| --------- | ---- |
| One transaction per file | A failure leaves the database on the last good migration, never half-way through one |
| An advisory lock | Two concurrent runs (CI and a laptop) cannot interleave |
| A `schema_migrations` ledger | Applied filenames, with a checksum and a timestamp |
| Checksum verification | An edited applied migration is an **error**, not a silent no-op |
| Filename-order application | Same rule as `supabase/migrations/`, so the convention transfers |

### The rule that carries over unchanged

**Never edit a migration that has been applied. Add a new one.** The runner enforces this
rather than trusting it: it stores a SHA-256 of each file when it applies it, and refuses
to run at all if a previously-applied file no longer matches. That check is the closest
thing this repo has to a test on the schema.

---

## Connecting

The runner reads standard Postgres environment variables:

```
PGHOST      RDS endpoint      -- SSM: /synapsedeck/<env>/db/host
PGPORT      5432              -- SSM: /synapsedeck/<env>/db/port
PGDATABASE  synapsedeck       -- SSM: /synapsedeck/<env>/db/name
PGUSER      synapsedeck_app
PGPASSWORD                    -- Secrets Manager: synapsedeck/<env>/db/credentials
```

**The database is in a VPC with no public route.** That is the whole point of the network
design (`infra/lib/data-stack.ts`), and it means these commands do not work from a laptop
without a tunnel. In practice migrations run from inside the VPC — the deployment path is
a decision for the session that wires up the API stack, and until then this runner is
exercised against a local Postgres.

`PGSSLMODE` defaults to `require` when `PGHOST` is not localhost. RDS presents a
certificate signed by an Amazon CA; verifying the full chain needs the RDS root bundle
shipped alongside, which is a Phase F hardening item rather than something to fake here.

---

## The unguarded part, stated plainly

**These migrations have never been executed.** Not against RDS, not against a local
Postgres, not against anything — they were written by porting
`supabase/migrations/`, read back, and committed. As of P9 tasks 1-3 nothing has been
deployed, so the first time this SQL runs will be the first time anyone finds out
whether it parses.

That is a deliberate decision (owner, 2026-09-06) rather than an oversight, and it is
recorded here because the person who runs `npm run db:migrate` for the first time
deserves to know it is a first execution and not a re-run. **Expect to debug it**, and
run `db:migrate:status` first.

**Nothing verifies these migrations before they reach a real database.** The PGlite
harness that used to run every migration in CI was deleted with the test suite
([ADR 0005](../../../docs/adr/0005-no-test-suite.md)). `npm run check` does not read SQL.

So the procedure is the same one `CLAUDE.md` prescribes for `supabase db push`:

1. **`npm run db:migrate:status` first, every time.** Read what it lists. If it names a
   migration you did not write, stop and ask.
2. **Read your own SQL again before applying it.** There is no second opinion.
3. **If it is destructive or you are unsure, ask the owner** rather than applying and
   finding out.

A migration that is wrong now has one fewer safety net than it did on Supabase, because
there is no policy layer left to refuse a mistake either.
