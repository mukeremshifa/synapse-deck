# 8. Application-level tenancy, replacing RLS

**Status:** Accepted · **Date:** 2026-09-06 · **Implements:** [AWS-NATIVE-BRIEF.md](../plans/AWS-NATIVE-BRIEF.md) D2 · **Follows from:** [ADR 0007](0007-cognito-for-identity.md)

## Context

ADR 0007 ended by naming this decision and explicitly declining to make it:

> Phase A must either schedule that testing capability before the cutover or state
> explicitly what is being accepted instead — and that is the owner's decision, not a
> plan's.

This ADR is that decision, taken on 2026-09-06, having been shown what it costs.

**What exists today.** `supabase/migrations/20260811090100_rls.sql` is 15 policies across
five tables, plus `force row level security` on every one of them. `authenticated` is a
Postgres role, `auth.uid()` is the verified JWT subject, and every policy is evaluated by
Postgres on every row. The property this buys is total and it is worth stating precisely:

> A query that forgets `where user_id = …` returns **nothing**, because the database
> refuses.

**Why it cannot come along.** RLS is not a Postgres feature the migration happens to leave
behind — it is a feature the *architecture* leaves behind. The policies depend on
`auth.uid()`, which is a Supabase function reading a Supabase-issued JWT, and on
`authenticated`, which is a Supabase role. On RDS there is no `auth` schema, no JWT
reaching Postgres at all, and one application database user shared by every request.

Reproducing RLS on RDS would mean either issuing a Postgres role per user (unworkable —
connection pooling, and thousands of roles), or setting a session variable per request
(`set local app.user_id`) and writing policies against it. The second is genuinely
possible and was considered rather than dismissed. It loses on one point: **the session
variable is set by the same application code that would otherwise write the `where`
clause.** A layer that forgets `set local` fails exactly as openly as a layer that forgets
`where user_id = $1`, so it moves the discipline without adding a guarantee — while adding
a pooling hazard where a leaked session variable would mean a *wrong* tenant rather than
no rows.

## Decision

**RLS is retired. Tenancy moves into application code**, in `services/api/src/data/`.

The boundary does not disappear; it moves, and it gets weaker. After this:

> That same forgetful query returns **every user's rows**.

Four mechanisms compensate — structurally, not with tests, because
[ADR 0005](0005-no-test-suite.md) means there are none. Each was chosen because it fails
closed and none depends on a human remembering something:

1. **`userId` is a required first parameter** on every data-access function. Not optional,
   not inferred, not defaulted. A caller that forgets does not compile.
2. **No route handler may build a query.** Handlers call the data layer; the data layer is
   the only place that writes SQL. This is what makes mechanism 1 auditable by reading one
   directory.
3. **The RPCs filter on `p_user_id` in SQL.** `review_card` and `undo_last_review` were
   `security invoker` *because RLS was the boundary* — `review_card` never filtered by
   `user_id` at all. Retiring RLS silently converts them into functions that will review a
   stranger's card, and this was the sharpest edge in the phase.
4. **A `verify`-time lint** (`scripts/check-data-access.mjs`) fails the build on a query in
   a handler, or a data-access export whose first parameter is not `userId`.

**`userId` comes only from the verified JWT** — the `sub` claim, read from the API Gateway
authorizer context. Never a request body, never a query parameter, never a client-set
header.

## Consequences

**This is weaker than what it replaces, and saying so is part of the decision.** RLS was a
guarantee enforced by the database. This is a discipline enforced by a linter. A rulebook
that oversells its own guarantees is how a later session takes a shortcut it believes is
safe, so the honest summary is:

> The boundary became more legible to a reviewer and less absolute in fact.

**Good.** The security boundary is now readable by opening one directory, which RLS was
not — understanding the old model meant reading 15 policies and knowing how `auth.uid()`
behaved under three different roles. It is also portable: the same `userId`-first
discipline covers DynamoDB and S3 prefixes in later phases, where RLS never applied.
Queries are ordinary SQL against one connection, so there is no per-row policy evaluation
and no pooling constraint.

**Bad, and unguarded.** Cross-tenant isolation was previously guaranteed by Postgres and
tested by `rls.test.ts`. It is now guaranteed by convention and checked once, by hand, at
the end of P9. **Every table added after this inherits the risk and not the check.**

**The lint checks shape, not meaning.** It verifies that a `userId` parameter exists and
that handlers hold no SQL. It cannot verify the parameter is used in the query. *A
function that takes `userId` and ignores it passes every gate in this repository.* That is
the honest limit and it is why this is a mitigation rather than a replacement.

**The blast radius of a SQL injection grew.** RLS was never injection protection, but it
did cap what a successful injection could reach. That cushion is gone, which is why
parameterised queries throughout are non-negotiable rather than stylistic.

**Referential integrity to users is gone too**, as a side effect rather than a choice:
`user_id references auth.users on delete cascade` becomes a plain `uuid not null`, because
`auth.users` does not exist on RDS. The database can no longer verify a `user_id`
corresponds to a real account, and deleting a Cognito user no longer cascades their data
away. Both become application responsibilities.

**This should be the first thing revisited when a test suite returns.** Not the tenth. The
cross-tenant test is the one ADR 0005 was most expensive to delete, and this ADR is the
reason.
