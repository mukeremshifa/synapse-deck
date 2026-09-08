# FR0 — The contract and the fake

**Status:** ✅ **Executed 2026-09-08.** Decisions in §6, the FR7 build list in §6.3.
**Parent:** [FE-REARCHITECTURE-BRIEF.md](FE-REARCHITECTURE-BRIEF.md) — read it first; this
plan executes its §2 and encodes its §1.
**Then:** [CLAUDE.md](../../CLAUDE.md) and [AGENTS.md](../AGENTS.md).
**Hands off to:** [FR1](FR1-design-system.md). FR1-FR7 were planned on 2026-09-07 at
contract altitude; [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md) is how they stay true.

> **FR0 is the whole bet.** If the contract is right, FR1–FR6 are ordinary work. If it is
> wrong, everything after inherits it — which is exactly what happened to the current
> frontend. Spend the time here.

**This phase changes nothing a user can see.** It builds `src/lib/api/`, removes Supabase,
and leaves every existing screen running against the live AWS API exactly as it does today.
That constraint is what makes it safe to land in one go.

---

## 0. The one thing to understand before starting

The brief says "put a fake behind the real client seam". **There is no such seam.** The
current one is verb-shaped, not entity-shaped:

```ts
// src/lib/api-client.ts:94
export const api = {
  get: <T>(path: string, signal?: AbortSignal) => …,
  post: <T>(path: string, body?: unknown) => …,
  …
};
```

`api.get<T>('/decks')` takes a string and a caller-asserted type parameter. Nothing can
implement that interface *differently* in a way TypeScript checks — a fake would have to
parse URL strings and guess what `T` was meant to be, and the compile-error guarantee the
brief's §2.2(1) rests on would not exist.

**So the first real task is to invent the seam, not to fill it.** `contract.ts` defines an
`ApiClient` interface of ~30 named methods with typed arguments and typed returns;
`client.ts` and `fake.ts` are two implementations of that one interface. That is what makes
drift a compile error.

Read the four tasks in order before starting any of them. Tasks 1 and 2 are the bet; tasks
3–5 are mechanical.

---

## 1. Preconditions

```bash
git branch --show-current    # aws-native (a topic branch off dev) or dev
git status --short           # clean, apart from docs/
npm run check                # passes
```

`aws-native` is 69 commits ahead of `dev` and 0 behind, fully pushed. It is the working
branch for this line of work; staying on it is correct. **`main` is frozen — do not touch
it, do not offer to.**

Verify the two claims this plan is built on, because everything below assumes them:

```bash
# Exactly four hooks use Supabase. Expect: useReviewHistory, useDueForecast,
# useCardStates, useRetention — and nothing else.
grep -n "supabase" src/lib/queries.ts

# Every other 'supabase' hit in src/ is a historical comment, not a call.
grep -rn "supabase" --include="*.ts" --include="*.tsx" src/ | grep -v "^src/lib/queries.ts"
```

If either turns up something this plan does not name, **stop and re-scope** — do not
improvise around it.

## 1b. Reconcile — first, before any code

**Mandatory, and it applies even to FR0.** Read [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md). Its
first three rows were written by the planning session and two of them change this plan's
task order — they are already folded in below, but read them so you know why §0 exists.

FR0 is the only phase with no predecessor to reconcile against. What it does have is the
brief, and **the brief is the thing to re-read** before task 1.

---

## 2. Out of scope

Belongs to a later phase. Not "if it's quick" — later.

| Tempting | Where it goes |
| --- | --- |
| Any component, page, route or CSS change | FR1–FR6 |
| Deleting `DashboardPage`, `routes.tsx`, `/create/*`, `SourcesRail` | FR2/FR3 — they must keep working through FR0 |
| Re-pointing `queries.ts` hooks at `contract.ts` shapes | FR2+ |
| Palette, tokens, primitives, `react-resizable-panels`, `@tanstack/react-virtual` | FR1 |
| Touching `services/api/`, `infra/`, or any migration | **FR7.** Brief §5 |
| Writing tests, adding a runner | Never, unless the owner asks ([ADR 0005](../adr/0005-no-test-suite.md)) |
| Deciding chat persistence, note-editor forking, regeneration semantics | Brief §6 — open, and deliberately so |

**The hardest one to hold:** `fixtures.ts` will make you want to see it on screen. Don't.
FR2 is one phase away and a screen built before FR1's design system is a screen built twice.

---

## 3. The rule this phase runs under

> **`fake.ts` may not have capabilities a real API could not have.**

From brief §2.2. It is unguarded — a fake that lies typechecks perfectly — so it is a
discipline enforced by reading. Concretely, three things it forbids:

1. **No pre-joined graphs.** `getNotebook()` returns a notebook, not a notebook with its
   sources and artifacts and their cards nested inside. If a screen needs three things, it
   makes three calls, because that is what it will do at FR7.
2. **No synchronous returns for things that are jobs.** `createArtifact()` returns a
   `Job`, not an `Artifact`. Generation takes seconds to minutes and involves a model; a
   fake that returns the finished deck designs a UI with no progress surface, and FR4 then
   has to invent one against a backend that always needed it.
3. **No computing across tenants or ignoring pagination.** If a list would be paginated at
   FR7, it is paginated here.

**Readiness (brief §1.3) is the honest exception, and it is worth naming.** It is computed,
not stored — that is precisely why brief §2.1 rejected `json-server`. A real API *can*
compute a roll-up server-side, so `fake.ts` computing it is legitimate. What it must not do
is compute it from data the client would not have.

---

## 4. Tasks

Ordered so the app builds and runs after each one.

### Task 1 — `contract.ts`: the nouns

**Files:** `src/lib/api/contract.ts` (new).

The brief's §1.1 noun list as Zod schemas plus inferred types. This is the phase's
deliverable; the rest is plumbing.

Entities: `Notebook`, `Source`, `Artifact`, `Topic`, `Attempt`, `Review`, `Card`, `Job`,
plus `Profile` (which survives unchanged from today).

Non-negotiables, each from a settled decision in brief §1.2 — **do not relitigate them**:

- **`Artifact` is one kind-tagged table**, not four types:
  `{ id, notebookId, kind, title, sourceIds[], sourcesSnapshot, status, createdAt }`.
  `kind` is a `z.enum(['deck','quiz','noteset','exam'])`. Model the kind-specific payload
  as a discriminated union on `kind` *within* the artifact schema, so a `NoteSet`'s blocks
  and an `Exam`'s blueprint each have a home without four parallel tables.
- **`sourcesSnapshot` sits beside `sourceIds[]`** and is the reason artifacts survive
  source deletion (§1.2(7)). **A dangling `sourceId` is a valid state, not an error.**
  Say so in the schema's doc comment — every consumer through FR6 must handle it, and the
  comment is the only place that will be read.
- **`NoteSet` content is structured blocks, never one string** (§1.2(2)). A blob makes the
  later editor a migration. Also carries `origin: 'generated' | 'chat'` (§1.2(4)).
- **Quiz and exam are separate kinds** (§1.2(3)) — different delivery, different state,
  different records. Not one kind with a `timed` flag.
- **The blueprint belongs to the exam artifact** (§1.2(9)), not the notebook.
- **`Readiness = { state: 'ready'|'partial'|'none', detail: string }`** on artifacts, and a
  roll-up on notebooks (§1.3).
- **Reuse, do not redefine.** The `basic`/`cloze`/`mcq` `CardPayload` union in
  [`schemas.ts`](../../src/lib/schemas.ts) earns its place (brief §1.4) — **import it**.
  CLAUDE.md's "one Zod definition per concept" is the rule most often broken by a session
  that did not look first, and this task is exactly where it would break.

Where `schemas.ts` already has the right shape (`Grade`, `CardPayload`, `ExamConfig`,
`GENERATION_LIMITS`), import it. Where it has a shape built on the old model
(`DeckInput`, `StartJobRequest`'s `deckTitle`), define the new one here and **leave the old
one alone** — it is still serving the running app until FR7.

**Acceptance:** `contract.ts` compiles, exports every noun in brief §1.1, and imports
`CardPayload` rather than redefining it.

---

### Task 2 — `contract.ts`: the `ApiClient` interface

**Files:** `src/lib/api/contract.ts`.

The seam that does not exist yet (§0). One interface, named methods, typed both ways:

```ts
export interface ApiClient {
  listNotebooks(): Promise<Notebook[]>;
  getNotebook(id: string): Promise<Notebook>;
  createNotebook(input: CreateNotebookInput): Promise<Notebook>;
  …
  listSources(notebookId: string): Promise<Source[]>;
  addSource(notebookId: string, input: AddSourceInput): Promise<Job>;
  …
  listArtifacts(notebookId: string, filter?: { kind?: ArtifactKind }): Promise<Artifact[]>;
  createArtifact(notebookId: string, input: CreateArtifactInput): Promise<Job>;
  …
  getJob(id: string): Promise<Job>;
}
```

Three shapes to get right, because they are where the current model failed:

1. **Every notebook-scoped method takes `notebookId` as its first parameter.** Not
   optional, not defaulted, not inferred. This is the API-surface expression of brief §1's
   "a surface that cannot name its notebook is not a valid surface", and it deliberately
   rhymes with CLAUDE.md's data-access rule 1 — a default is how a bug becomes silent, on
   either side of the wire.
2. **`addSource` and `createArtifact` return `Job`, never the finished thing** (§3(2)).
3. **Errors are part of the contract.** Define the error type — the code union at minimum
   (`quota_exceeded`, `rate_limited`, `not_found`, `unauthorized`, `internal`, …) —
   because FR4 designs against it. Today's `ApiError` in `api-client.ts` is the starting
   point; the `StreamEvent` error codes in `schemas.ts:391` are the vocabulary already in
   use.

Write the doc comment that says **this interface is the FR7 backend's specification**.
That sentence is the whole reason the phase exists, and the session that rebuilds the
backend will arrive at this file cold.

**Acceptance:** the interface compiles and covers every call the brief's §3 surfaces need
(home, notebook three panes, four runners, overview). Walk §3 screen by screen and check
each one's data need has a method. A screen with no method is a hole in the contract, and
finding it now costs nothing.

---

### Task 3 — `fake.ts` and `fixtures.ts`

**Files:** `src/lib/api/fixtures.ts`, `src/lib/api/fake.ts` (both new).

`fixtures.ts` — hypothetical data rich enough to design against. Not one tidy notebook:

- **several notebooks**, including an empty one and a full one (empty states are where the
  current app is weakest — brief §0's "Generate cards is the only enabled CTA");
- **every artifact kind** present, plus a notebook missing some kinds;
- **a dangling `sourceId`** — an artifact whose source was deleted (§1.2(7)). If no fixture
  exercises it, nothing built through FR6 will handle it, and it is a *valid* state;
- readiness spanning `ready`, `partial` and `none`;
- enough cards and reviews that `progress.ts`, `mastery.ts` and `study-plan.ts` have
  something real to aggregate at FR6.

`fake.ts` — an in-memory `ApiClient`. Beyond correctness, one property matters:

> **Latency, errors and empty states must be dialable.** Brief §2.2(2).

A module-level knob — `fake.configure({ latencyMs, failNext: 'quota_exceeded' })` or
similar — is how FR4 designs the generation and error surfaces properly. A fake with only a
happy path is `json-server` with extra steps.

**Jobs are the hard part and the reason this design was chosen.** `createArtifact` returns
a queued `Job`; successive `getJob` calls advance it through stages over wall-clock time
and it eventually produces the artifact. Model it on what the pipeline actually reports —
`PipelineStages.tsx:25` is explicit that every stage maps one-to-one onto a field the job
reports, and that constraint is worth carrying forward. **Do not invent stages the
pipeline could not report.**

**Acceptance:** `fake.ts` implements `ApiClient` with no `as`, no `@ts-expect-error`, and
no `any`. Type-level conformance is the whole point — if it needs a cast, the contract is
wrong, not the fake.

---

### Task 4 — `client.ts`, `index.ts`, and the mode switch

**Files:** `src/lib/api/client.ts`, `src/lib/api/index.ts` (new);
`src/lib/env-schema.ts`, `src/lib/env.ts`, `.env.example`.

`client.ts` wraps today's `api-client.ts` transport (fetch + Cognito token + `ApiError`)
and implements `ApiClient` against the **real, current** routes in `scripts/dev-api.mjs`.

**Expect this to be lossy, and say where.** The live API has no notebooks, no sources, no
artifacts and no exams — brief §0 is the audit that established it. So parts of
`client.ts` cannot be implemented against today's backend.

**Do not fake it in `client.ts`.** A live client that quietly invents an artifact list is
the same lie as a lying fake, in the more dangerous place. Throw a clearly-worded
`not_implemented` and **tabulate every such method in §7**, so FR7 inherits an explicit
list of what it must build rather than discovering it.

`index.ts` picks an implementation from `VITE_API_MODE` (`'fake' | 'live'`), defaulting to
`'fake'`.

**The env work is not optional, and it is a real trap.** `VITE_API_URL`,
`VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID` are currently *required* by
`ClientEnv`, and `env.ts` **throws at startup** when they are missing. A fresh session
cloning the repo to work on FR1–FR6 has none of them, so `npm run dev` would die on boot —
defeating brief §2.2(3), "no second process, `npm run dev` works". Make the AWS vars
**required only when `VITE_API_MODE === 'live'`** (a Zod `superRefine` or a discriminated
parse). Update `.env.example` and say which vars each mode needs.

**Acceptance:** `npm run dev` boots with **no** `.env.local` at all, in fake mode.
Check this by actually moving the file aside — it is the criterion most likely to be
assumed rather than observed, and the one a fresh session will hit first.

---

### Task 5 — Remove Supabase

**Files:** `src/lib/queries.ts`, `src/lib/supabase.ts` (delete), `src/lib/env-schema.ts`,
`src/lib/env.ts`, `.env.example`, `package.json`, `src/types/database.ts`.

Brief §2.3: carrying a second backend into a re-architecture is how "two backends, for one
phase" becomes permanent.

Four hooks, and only four: `useReviewHistory`, `useDueForecast`, `useCardStates`,
`useRetention` (`queries.ts:878–1046`). They feed `/progress`. Options, in preference
order:

1. **Re-point at `ApiClient`** if the contract has a home for them (it should — FR6's
   overview needs exactly these aggregates, notebook-scoped). In `live` mode they then
   throw `not_implemented` and `/progress` degrades to an error state until FR7. That is
   honest and it is temporary.
2. **Delete the hooks and let `/progress` show an empty state**, if re-pointing drags in
   contract surface FR6 has not settled. Simpler, and `/progress` is superseded by the
   notebook overview anyway (brief §3.4).

Either is defensible; **pick one, do it consistently, and record which in §6.** Do not do
half of each.

Then:

- delete `src/lib/supabase.ts`;
- `npm uninstall @supabase/supabase-js`;
- remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `env-schema.ts`,
  `env.ts` and `.env.example`;
- **`src/types/database.ts` is the generated Supabase schema type.** Nothing should import
  it once `supabase.ts` is gone — `grep -rn "types/database" src/` and delete it only if
  that comes back empty.

> ### ⚠️ The one thing in this task that is a security invariant
>
> **Removing the Supabase env vars removes the `sb_secret_…` refusal with them.**
>
> `env-schema.ts`'s three `.refine` calls on `VITE_SUPABASE_PUBLISHABLE_KEY` are the only
> thing standing between a secret key and a shipped bundle — the test that proved that
> refusal was deleted with the suite ([ADR 0005](../adr/0005-no-test-suite.md)), and
> CLAUDE.md, AGENTS.md §7 and the brief §2.3 each say separately: **do not weaken it.**
>
> Deleting the variable it guards is not weakening it — there is nothing left to guard, and
> a refusal on a variable no longer read is dead code. But it *looks* identical to
> weakening it in a diff, and this is the change most likely to be misread later.
>
> **So: state it explicitly in the commit message and in §6.** "The secret-key refusal was
> removed because the variable it validated no longer exists; it was not relaxed." If any
> Supabase variable survives for any reason, **its refusal survives with it, unchanged.**

Do not touch `supabase/migrations/` or `supabase/functions/` — that is FR7's business, and
the Supabase project is still live.

**Acceptance:** `grep -rn "supabase" src/` returns only historical comments;
`@supabase/supabase-js` is gone from `package.json`; `npm run verify` passes.

---

### Task 6 — Documentation, and write FR1

**Files:** `docs/plans/README.md`, `docs/SPEC.md`, `docs/adr/`, `docs/plans/FR1-*.md`.

- **Board row** for FR0 in `docs/plans/README.md`, marked with what actually happened.
- **`SPEC.md`** — the noun list (brief §1.1) is a scope change and belongs there. Do not
  let code and spec drift; that is CLAUDE.md's standing instruction.
- **An ADR is warranted here** and should be written: *the frontend runs against a typed
  in-repo fake, and `contract.ts` is the backend's specification.* It is expensive to
  reverse, non-obvious in six months, and exactly what `docs/adr/` exists for
  ([AGENTS.md §6](../AGENTS.md)). A second ADR for **`Artifact` as one kind-tagged noun**
  is also justified — it is the central modelling move and the one a future session is
  most likely to try to "simplify" back into four tables.
- **Update `FR1-design-system.md` rather than writing it.** It already exists — FR1-FR7
  were planned ahead at contract altitude on 2026-09-07. Your job is to reconcile FR1's
  §1b assumptions against what you actually built, and fix them.
- **Append to [FR-DRIFT-LOG.md](FR-DRIFT-LOG.md)**, and update any later plan you
  invalidated. This is the mechanism that makes planning seven phases ahead defensible; a
  session that skips it hands the next one fiction.

---

## 5. Acceptance criteria — as met, 2026-09-08

Observable, not vibes. Every one checked; how, where it is not obvious.

| # | Criterion | Result |
| --- | --- | --- |
| 1 | `src/lib/api/` has all five files | ✅ |
| 2 | Both implementations satisfy `ApiClient` — **no cast, no `any`, no `@ts-expect-error`** | ✅ `client.ts` parses `CardPayload` and `FsrsState` rather than asserting them, which is what the criterion is actually for |
| 3 | Every brief §1.1 noun has a Zod schema and a type | ✅ plus `Job`, `Question`, `NoteBlock`, `Blueprint`, `Profile`, `QuotaUsage`, the four aggregates and `GlobalSummary` |
| 4 | `CardPayload` **imported**, not redefined | ✅ with `McqPayload`, `ExamConfig`, `GradeSchema`, `GENERATION_LIMITS` |
| 5 | Every notebook-scoped method takes `notebookId` first, required | ✅ the sole exception is `getGlobalSummary`, which is scopeless by design (§6.4) |
| 6 | `addSource` and `createArtifact` return `Job` | ✅ |
| 7 | ≥3 notebooks, one empty, every kind, **≥1 dangling `sourceId`** | ✅ 4 notebooks; `nb-stats` empty; `src-pharm-deleted` dangles from `art-deck-abx` **and** from a note block's citation |
| 8 | Latency and errors configurable | ✅ `latencyMs`, `failNext`, `failAlways`, `jobDurationMs`, `failNextJob`, `truncateNextJob`; on `window.fakeApi` in dev |
| 9 | **`npm run dev` boots with no `.env.local`** | ✅ **observed.** The file was moved aside and the module graph loaded through Vite; `listNotebooks` returned four projected notebooks. That run also found a real bug — `window` at module scope in `index.ts` threw under SSR — now guarded |
| 10 | `grep -rn "supabase" src/` returns only comments; dependency gone | ✅ |
| 11 | The app still runs in `live` mode | ⚠️ **typechecks and builds; not run.** No screen was opened in `live` mode. The known give-up is the dashboard's streak card (§6.1) |
| 12 | `npm run verify` passes | ✅ |
| 13 | FR1 reconciled; drift log appended | ✅ FR1's three §1b assumptions all held and it says so; eight drift rows |

**On 11, be precise about what was and was not done.** `client.ts` is typed against
`ApiClient`, not against the API, and nothing exercised it over HTTP. A wrong path compiles
and 404s at runtime — see §7.3.

## 6. Decisions recorded

Written back on execution, 2026-09-08.

### 6.1 The four progress hooks — deleted, and the option list was wrong

**Neither of the plan's two options applied, because `/progress` does not exist.** It was
removed before this phase. So `useDueForecast`, `useCardStates` and `useRetention` had **no
consumer at all**, and `useReviewHistory` was read by `DashboardPage` for exactly one
number — the streak.

Option 1 (re-point at `ApiClient`) would have been four hooks with a new backend behind
them serving zero screens. So all four were **deleted**. Nothing is lost: the aggregates
they computed now live on `ApiClient` as `getReviewHistory`, `getDueForecast`,
`getCardStates` and `getRetention` — **notebook-scoped**, which is what FR6's overview
needs and what a global `/progress` could never be. FR6 builds against those.

`/progress` does nothing in either mode, because it is not a route.

**The dashboard's streak card was removed** rather than left rendering `value={null}`,
which is a permanent skeleton — a card that looks forever-loading is a worse lie than one
that is absent. It returns at FR2 from `getGlobalSummary().streakDays`.

### 6.2 The secret-key refusal

> **The `sb_secret_…` refusal was removed because the variable it validated no longer
> exists. It was not relaxed.**

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are gone from `env-schema.ts`,
`env.ts` and `.env.example`, with `src/lib/supabase.ts` and the `@supabase/supabase-js`
dependency. A `.refine` on a variable nothing reads is dead code, not a security boundary.

**If any Supabase variable is ever reintroduced, its refusal is reintroduced with it,
unchanged.** This is stated in the commit message, in `env-schema.ts`'s header, and in
`.env.example`, because in a diff it looks identical to a weakening.

### 6.3 Where `client.ts` throws `not_implemented` — **FR7's build list**

Every one of these is a method the contract requires and the live backend cannot serve.
None of them fakes a result.

| Method | Why the live backend cannot serve it |
| --- | --- |
| `listSources`, `getSource`, `addSource`, `deleteSource` | Sources are not persisted — they are `useState([])`. There is no table and no route. |
| `listArtifacts`, `getArtifact`, `createArtifact`, `updateArtifact`, `deleteArtifact` | No artifacts table. `decks` is one flat level; `POST /jobs` creates a *new deck* rather than an artifact within a notebook. |
| `listQuestions`, `startAttempt`, `saveAttemptProgress`, `submitAttempt`, `getAttempt`, `listAttempts` | `0008_answers.sql:89` — there is no `exams` table. Answers are recorded loose, grouped by a client-generated uuid. |
| `listNoteBlocks`, `markBlocksRead` | Note sets do not exist in any form. |
| `getReviewHistory`, `getDueForecast`, `getCardStates`, `getRetention` | These were the Supabase RPCs and table reads, removed here. The AWS API has no aggregate endpoints. |

Three more are implemented but **lossy**, and FR7 must fix rather than merely port them:

- **`getGlobalSummary`** returns `streakDays: 0` and `timeZone: 'UTC'` — `/summary` carries
  neither.
- **`ask`** accepts `sourceIds` and ignores it: retrieval runs over the whole notebook's
  chunks because sources are not entities. Its citations carry a *chunk* id where the
  contract wants a source id.
- **`listNotebooks` / `getNotebook`** synthesise `readiness` from card counts alone, and
  report `counts.sources: 0` — a known-wrong zero, not a measurement.

`client.ts` also carries a **synthetic artifact id**: a notebook's own id doubles as its
implicit deck's, so `listCards(notebookId, artifactId)` works only when they are equal.
FR7 deletes that translation.

### 6.4 What the brief did not settle, and FR0 decided

Named as decisions, because §1.2 is the owner's and these are not.

1. **Pagination is in the contract.** `Page<T>` and `PageRequest`; `listNotebooks`,
   `listSources`, `listArtifacts`, `listCards` and `listAttempts` return pages. FR0 §3(3)
   implies it but the brief's noun list does not. A list that would page at FR7 must page
   now, or every screen is designed having never seen a second page.
2. **`getGlobalSummary` is the one cross-notebook method**, for §3.5's global strip.
   Everything else is notebook-scoped. Its doc comment carries the rule that keeps it from
   becoming the `focus` guess again: **nothing on it may become a CTA**, because a button
   there would have to pick a notebook.
3. **`Job` is one noun for both `addSource` and `createArtifact`**, tagged by `kind`, with
   `result: { artifactId, sourceId }`. The brief implies two flows; one shape means FR4
   designs one progress surface.
4. **`Attempt` is one noun for quiz and exam**, tagged by `artifactKind`, with
   `outcome: 'in-progress'` for a resumable quiz. §1.2(3) separates the *runners*, and it
   does; what is recorded is the same thing either way.
5. **Errors are a closed union** (`ApiErrorCode`) rejected as `ApiClientError`. The brief
   asked only that errors be "part of the contract". Closed, so a surface can `switch` and
   TypeScript reports an unhandled code.
6. **`markBlocksRead` counts blocks**, which is how a note set contributes to readiness.
   §1.3 says "a note set unread sections" without saying how one becomes read.

### 6.5 Was any brief §6 open question forced early?

**One: q1, "does deleting a notebook delete its artifacts?"** `deleteNotebook` had to do
something, and doing nothing would have leaked orphans. Answered **yes**, which is the
brief's own "almost certainly" — an artifact has no existence outside its notebook (§1).
This does not contradict §1.2(7): surviving *a source's* deletion is a different question
from surviving *the notebook's*, and the ADR and the method's doc comment both say so.

**q2, q3 and q4 were not forced.** Regeneration is untouched (each generation is simply a
new artifact, which is §1.2(7)'s grain). The note editor is untouched — structured blocks
keep both options open, which is the point of §1.2(2). Chat history is not persisted and
chat is not a noun; only save-as-note is committed, through `AskResponse.id` and
`CreateArtifactInput`'s `fromResponseId`.

## 7. What will go unverified

There are no tests ([ADR 0005](../adr/0005-no-test-suite.md)). `check` and `verify` prove
this compiles, lints and builds. They prove nothing else. Report it as **"typechecks and
builds"** — never "tested", "verified" or "works".

Specifically unguarded after this phase:

1. **That the contract is right.** The phase's entire value is a modelling judgement and no
   gate can assess it. FR1–FR6 are the test, and they run one at a time.
2. **That `fake.ts` does not lie** (§3). It typechecks perfectly either way. The only
   defence is reading it against the rule.
3. **That `client.ts` maps to real routes correctly.** It is typed against `ApiClient`, not
   against the API — a wrong path compiles and 404s at runtime. `check-routes.mjs` polices
   `dev-api.mjs` against `infra/`, and **not this file.**
4. **That fake and live behave alike.** Nothing compares them. A screen developed entirely
   in fake mode has never touched the real backend, which is the deliberate trade of brief
   §2 and worth restating at FR7.
5. **The env-mode split.** A missing var in `live` mode is now a runtime failure where it
   used to be a startup one — the cost of making `dev` work without credentials.

---

## 8. Estimated shape

Roughly, so a session can pace itself:

| Task | Weight |
| --- | --- |
| 1–2 — the contract | **~half the phase.** This is the bet; think, don't type |
| 3 — fake and fixtures | Substantial but mechanical once 1–2 are right |
| 4 — client, index, env | Small, with one real trap (the env split) |
| 5 — Supabase removal | Small, with one thing that must not be got wrong |
| 6 — docs and FR1 | Two ADRs and a plan |

Commit per task ([AGENTS.md §3](../AGENTS.md)) — `npm run check` before each, `npm run
verify` before the last. **Never commit with a failing `check`.**

---

## 9. Handoff to FR1

State explicitly, at completion:

- **the `ApiClient` interface's shape** — FR1 does not consume it, but FR2 onward do, and
  this is where it gets described once;
- **what `fixtures.ts` contains** — how many notebooks, which kinds, where the dangling
  `sourceId` lives;
- **how the fake's latency and error injection are configured** — FR4 depends on it
  entirely and will be the first phase to find out if it is missing;
- **the task-5 decision** for the four progress hooks, which FR6 inherits;
- **anything in FR1-FR7's §1b assumptions you invalidated.**
