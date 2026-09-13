# History

Everything before 2026-09-13 was deleted from the working tree: 40 phase plans, 17 ADRs
and the phase board — about 18,000 lines of narrative describing how the product got here.

**Nothing was lost.** Git holds all of it at `fc4cdfc`:

```sh
git show fc4cdfc:docs/plans/README.md          # the phase board, P0 through FR7
git show fc4cdfc:docs/adr/0008-application-level-tenancy.md
git ls-tree fc4cdfc docs/plans/ docs/adr/      # everything that was there
```

It was deleted because it had stopped being read. Forty plans describing work that is
finished is not context, it is archaeology, and every session paid to scroll past it.

What follows is the part that is still true and still binds. Anything not written here is
history, and history lives in the SHA above.

---

## Decisions that still bind

### 1. There is no test suite, and there will not be one soon

The suite — 31 suites, 359 tests — was deleted on 2026-09-05. `npm run check` and
`npm run verify` prove the code compiles, lints and builds. They prove nothing about
behaviour.

**Say "typechecks and builds", never "tested", "verified" or "works".**

Do not add a test runner. Do not reach for `vitest` out of habit — it, `jsdom`,
`@testing-library/*` and `@electric-sql/pglite` were all removed deliberately.

### 2. Tenancy is application-level, and weaker than what it replaced

RDS has no `auth.uid()` and no `authenticated` role, so there are no RLS policies in
`services/api/migrations/`. The boundary moved into `services/api/src/data/`.

> On the old Supabase setup, a query that forgot `where user_id = …` returned **nothing**.
> Here, that same query returns **every user's rows**.

Four rules hold it up. All four are mandatory:

1. **`userId` is the required first parameter** of every exported data-access function.
   Never optional, never defaulted.
2. **Every statement includes `where user_id = $1`**, including single-row fetches by
   primary key. A card id is not a capability.
3. **No SQL outside `services/api/src/data/`.** Handlers read `sub` from the authorizer,
   call the data layer, map errors. They never build a query.
4. **`userId` comes only from the verified JWT.** Never a body, query parameter or header.

`scripts/check-data-access.mjs` enforces 1 and 3. It **cannot** enforce 2 or 4 — it checks
the shape of the code, not its meaning. A function that takes `userId` and ignores it
passes every gate in this repository.

**A new table without a data-access module following all four rules is a cross-tenant
leak, not a TODO.**

### 3. `contract.ts` is the specification

`src/lib/api/contract.ts` defines the nouns as Zod and the `ApiClient` interface. Two
implementations satisfy it with no cast: `fake.ts` (in-repo, typed, what the frontend
develops against) and `client.ts` (HTTP, what production uses). 43 methods, all 43 served.

Change the contract first, then both implementations. Never one side only.

### 4. An artifact is one kind-tagged noun

Decks, quizzes, notesets and exams are one `artifacts` table discriminated by `kind`, not
four tables. A generation produces a **new** artifact, never a replacement — which is why
a practice session's cards cannot change underneath it.

An artifact's `payload` stores only what cannot be derived. Every count is computed.

### 5. Card content is untrusted LLM output

Render it as text. `dangerouslySetInnerHTML` is blocked by an ESLint rule. Do not disable
it. Any markdown support must use a React renderer that emits elements, never raw HTML.

### 6. Runtime seams pick infrastructure, and none has a default

`CARD_PROVIDER`, `JOB_STORE`, `PIPELINE_RUNNER`, `UPLOAD_STORE`, `EMBEDDING_PROVIDER`.
Each throws when unset, because a job written to one store and polled from the other
reports 404 for ever.

`EMBEDDING_PROVIDER` is not like the others: switching it on a populated corpus requires
re-embedding every chunk, because two models occupy different vector spaces. It is a data
migration wearing a configuration variable's clothes.

**These seams are why [the roadmap](ROADMAP.md)'s vendor pivot is a configuration change
rather than a rewrite.** Do not collapse them.

### 7. Topics reconcile by normalised name, per notebook

Not by meaning. Reconciliation is scoped to one notebook — cross-notebook contamination
was a real bug, fixed at FR7.

### 8. Migrations are append-only

Plain SQL in `supabase/migrations` and `services/api/migrations`, applied in filename
order. **Never edit one that has been pushed; add a new one.**

Nothing verifies a migration before it reaches the live database. The PGlite harness that
did was deleted with the suite. Dry-run first, every time, and read your own SQL again.

---

## What is known-unfinished

Carried forward because it is true of the code today, not because it is a plan:

- **Grounded chat has never answered a question.** pgvector is applied, retrieval is
  written, the pane exists. No embedding key was ever supplied, so the path has not run.
- **Exam questions are a fixture.** The blueprint and diagnostic read real user data; the
  questions themselves do not. The UI says so.
- **`CardEditor` is orphaned** — 363 lines, fully implemented, zero imports. It was
  disconnected deliberately (editing mid-review is the worst moment to judge a card
  fairly), not by accident. See [ROADMAP.md](ROADMAP.md) for where it lands.
- **`createCard` does not exist** in the contract. Every card must be AI-generated.
- **Sources cannot be opened.** `getSource` exists and returns content; nothing calls it.
- **Nothing has been deployed.** The demo path has never been walked on real
  infrastructure.
