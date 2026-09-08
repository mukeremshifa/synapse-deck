# ADR 0014 — The frontend runs against a typed in-repo fake, and `contract.ts` is the backend's specification

**Status:** Accepted
**Date:** 2026-09-08
**Phase:** FR0 ([the plan](../plans/FR0-contract-and-fake.md), [the brief](../plans/FE-REARCHITECTURE-BRIEF.md) §2)
**Supersedes nothing.** Constrains FR1–FR7.

---

## Context

The frontend re-architecture ([the brief](../plans/FE-REARCHITECTURE-BRIEF.md)) is built
on a model the current backend cannot serve. There are no notebooks, no sources, no
artifacts and no exams — `decks` is one flat level with no parent column, sources are
`useState([])`, and `migrations/0008_answers.sql:89` says in as many words that there is no
`exams` table.

So the frontend has to be designed against a backend that does not exist yet, and the
backend rebuild (FR7) has to be built against a frontend that already knows what it wants.
Something has to hold the shape in between.

Three options were considered.

**A local `json-server`.** Rejected in brief §2.1. It cannot express a `POST` that produces
a job with progress — the hardest surface to design and the one most worth prototyping. It
returns stored rows, so it cannot compute the readiness roll-ups the model is built on. And
it is a second process, a second port, a proxy config, and a hand-maintained route table:
precisely the drift [`check-routes.mjs`](../../scripts/check-routes.mjs) exists to police.

**Build the backend first.** This is what the project did last time, and it is how the
current frontend ended up with eight nouns in the UI and four in the database. Designing
the surface against what the schema happens to allow is what produced a dashboard that
guesses which notebook the user meant.

**A typed in-repo fake behind the real client seam.** Chosen.

## Decision

`src/lib/api/` holds one interface and two implementations of it.

```
contract.ts     Zod schemas + TS types for every entity, and the ApiClient interface
client.ts       the real client — fetch + Cognito token, against the live API
fake.ts         an in-memory implementation of the same interface
fixtures.ts     hypothetical data — several notebooks, every artifact kind
index.ts        picks one, from VITE_API_MODE ('fake' | 'live'), defaulting to fake
```

**`contract.ts`'s `ApiClient` interface is the FR7 backend's specification.** Not a
description of it, not a guide to it — the specification. The session that rebuilds
`services/api/` is building the thing that satisfies that interface.

### The seam had to be invented, not filled

The brief said "put a fake behind the real client seam". **There was no such seam.** The
existing one was verb-shaped:

```ts
export const api = {
  get: <T>(path: string, signal?: AbortSignal) => …,
  post: <T>(path: string, body?: unknown) => …,
};
```

`api.get<T>('/decks')` takes a string and a caller-asserted type parameter. Nothing can
implement that interface *differently* in a way TypeScript checks — a fake would have to
parse URL strings and guess what `T` was meant to be. So the first task of FR0 was to
invent an entity-shaped seam: one interface of ~40 named methods with typed arguments and
typed returns.

That is what buys the property this decision rests on: **drift between the fake and the
real client is a compile error**, not a 404 found three phases later. Types solve for free
what `check-routes.mjs` solves with a linter.

### The rule that keeps it honest

> **`fake.ts` may not have capabilities a real API could not have.**

No pre-joined graphs no endpoint could produce. No synchronous returns for things that are
jobs — `createArtifact` returns a `Job`, because a fake that returned a finished deck would
design a UI with no progress surface, and FR4 would then have to invent one against a
backend that always needed it. No ignoring pagination: a list that would be paginated at
FR7 is paginated now.

The honest exception is **readiness**, which is computed rather than stored. A real API
computes a roll-up server-side in SQL — that is exactly why `json-server` was rejected — so
the fake computing it is legitimate. What it may not do is compute it from data the client
would not have.

### `client.ts` refuses rather than pretends

Most of the interface cannot be implemented against today's backend. Every such method
throws `not_implemented` with a sentence naming what is missing, and FR0 §6.3 tabulates
them.

**A live client that quietly invents an artifact list is the same lie as a lying fake, in
the more dangerous place** — it would be believed. The refusals are how FR7 inherits an
explicit build list instead of rediscovering it.

## Consequences

**Good.**

- FR1–FR6 are built without a backend, without credentials, and without a second process.
  `npm run dev` works on a fresh clone with no `.env.local` at all.
- Latency, errors and empty states are dialable — `fake.configure({ latencyMs, failNext, failNextJob })`.
  The generation surface, the quota refusal and the partial-failure states are the hardest
  things to design and a happy-path server never shows them.
- `fixtures.ts` becomes FR7's seed script. It is already the shape the real API must return.
- Every screen through FR6 is exercised against awkward data by default: an empty notebook,
  a failed source, a dangling `sourceId`, an attempt that expired with a question unanswered.

**Bad, and worth saying plainly.**

- **Nothing proves the fake does not lie.** A fake that lies typechecks perfectly. The rule
  above is a discipline enforced by reading, and there is no gate behind it — there are no
  tests at all ([ADR 0005](0005-no-test-suite.md)).
- **Nothing proves `client.ts` maps to real routes correctly.** It is typed against
  `ApiClient`, not against the API; a wrong path compiles and 404s at runtime.
  `check-routes.mjs` polices `dev-api.mjs` against `infra/` and does not look at this file.
- **Nothing compares fake and live.** A screen developed entirely in fake mode has never
  touched the real backend. That is the deliberate trade of brief §2 and it comes due at FR7.
- **The contract may be wrong.** The whole phase is a modelling judgement and no gate can
  assess it. FR1–FR6 are the test, and they run one at a time.

**A consequence that was paid knowingly.** Making the AWS variables conditional on
`VITE_API_MODE` means a missing variable in `live` mode is now a runtime failure where it
used to be a startup one. That is the price of a repository a new session can clone and run.

## Notes

The Supabase client was deleted in the same phase (brief §2.3). Carrying a second backend
into a re-architecture is how "two backends, for one phase" becomes permanent. The
`sb_secret_…` refusal in `env-schema.ts` went with the variable it guarded — **removed
because there was nothing left to guard, not relaxed.** If any Supabase variable is ever
reintroduced, its refusal is reintroduced with it, unchanged.
