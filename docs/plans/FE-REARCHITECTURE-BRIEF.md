# Frontend re-architecture — the brief

**Status:** proposed. **Nothing has been executed. No code has changed.**
Written 2026-09-07, after an audit of the current frontend against questions it could not
answer. Supersedes the surface direction of [P11](P11-notebook-shell.md),
[DS4](DS4-scope-and-polish.md) and [DS4b](DS4b-surface-pass.md).

**Read this first, then [CLAUDE.md](../../CLAUDE.md) and [AGENTS.md](../AGENTS.md).**

This is a *brief*, not a phase plan. It fixes the model, the sequence, and the constraints.
Phase plans (FR0…FR7) get written one at a time per [the convention](README.md), the last
task of each writing the next. **[FR0-contract-and-fake.md](FR0-contract-and-fake.md) was written
2026-09-07 and is the next thing to execute — start there, not in `src/`.**

---

## 0. Why this exists

The frontend is well-built file-by-file and heavily documented, which is what made the
problem hard to see. Every file justifies its local decision well. What no file says is that
**the UI is built around eight nouns and the data model has four.**

An audit traced nine questions to their source:

| Question | What the code actually does |
| --- | --- |
| Notebooks or cards — which is first-class? | Neither. URL says notebook, API says deck, pipeline says deck. [`PracticePage.tsx:16`](../../src/features/practice/PracticePage.tsx#L16) documents the rename "stopped at the wire". |
| Exam blueprint from home — whose notebook? | `focus.id` — *the notebook with the most cards due*, [silently guessed](../../src/features/dashboard/DashboardPage.tsx#L60-L70), never named on screen, changes as counts shift. |
| Diagnostic from home? | Same guess, same silence. |
| Where does "Add material" go? | To a flow that **creates a new notebook**. `POST /jobs` takes `deckTitle` and calls `createDeck`. There is no "add to this notebook". |
| Continue studying — which cardset? | Same guess. Also [`ReviewGatePage.tsx:297`](../../src/features/generate/ReviewGatePage.tsx#L297) navigates to `/practice/:deckId`, **a route that does not exist** — a 404 on the happy path. |
| How do sources connect to what is generated? | They do not. Sources are `useState([])` — session-local, gone on refresh. |
| One exam per notebook, or many? | **Zero.** [`0008_answers.sql:89`](../../services/api/migrations/0008_answers.sql#L89): *"there is no `exams` table, because an exam is currently assembled in the browser."* Loose answers grouped by a client-generated uuid. |
| Cards counted one-by-one — no decks? | Correct. `decks` has **no parent column**. A deck *is* the notebook, one flat level. Nothing sits between notebook and card. |
| Why is "Generate cards" the only CTA? | It is the only enabled control — everything else is `disabled={!hasCards}` — and it navigates *away*, to a new notebook. |

**The pattern:** only `cards`, `reviews`, `topics` and `answers` are real entities. Notebook,
source, exam, deck-as-a-set, quiz and note are views over decks and cards with no backing
identity. You cannot file an exam under a notebook because that relationship does not exist.

**Therefore this is not a component problem and cannot be fixed in `src/`.** A rebuild on the
current schema reproduces the same improvisations in cleaner components — the dashboard would
still guess a notebook, because there would still be nothing else to point at.

---

## 1. The model

> **The notebook is the only first-class citizen. Everything — sources, decks, quizzes,
> notes, exams, diagnostics — belongs to exactly one notebook and has no existence outside
> it.**

Every screen answers "which notebook?" from the route, never from a heuristic. **A surface
that cannot name its notebook is not a valid surface.**

### 1.1 The noun list

```
Notebook                          the only top-level object
├── Source            n           a PDF, a paste, (later) a URL — persisted, not session state
│     └── topics[]                 metadata from the chunking pipeline
├── Artifact          n           anything generated FROM sources. One table, kind-tagged:
│   ├── Deck                        a set of cards, many per notebook    → Practice
│   ├── Quiz                        untimed, one-per-page, reveal-on-answer → Quiz
│   ├── NoteSet                     generated notes, later editable      → Notes
│   └── Exam                        timed, simulated exam environment    → Exam simulator
├── Topic             n           notebook-scoped, reconciled from source metadata
├── Attempt           n           one sitting of a quiz or exam
└── Review            n           FSRS state, per card
```

**`Artifact` is the central move.** The owner's *"no central way for what is generated inside
a notebook"* is this table. Every generated thing is
`{id, notebookId, kind, title, sourceIds[], sourcesSnapshot, status, createdAt}`. That one
shape delivers, at once:

- **the central place** — one list, "what this notebook has produced", filterable by kind;
- **provenance** — `sourceIds[]` answers "generated from what?", which nothing can today;
- **readiness bundling** (§1.3);
- **extensibility** — "more coming features" is a new `kind`, not a new subsystem.

`Deck` becomes `Artifact(kind='deck')`. That demotion is what actually fixes the
deck/notebook confusion: a deck stops competing with the notebook for top billing and becomes
one of several things a notebook contains — and a notebook may hold many, which is the middle
layer the current schema lacks.

### 1.2 Settled decisions

All recorded 2026-09-07. The contract is written to these; do not relitigate them.

1. **Many decks per notebook.** A deck is a named set within a notebook.
2. **Notes are generated artifacts**, gaining user editing in a later phase. `NoteSet`
   therefore has `sourceIds[]` and a generation job from day one, and **its content must be
   structured blocks, not one text blob** — otherwise adding the editor becomes a migration.
3. **Quiz and exam are separate kinds with separate runners.** A quiz is training material:
   generated from chosen sources, **one question per page**, answer revealed when the user
   answers or presses reveal, no time limit, repeatable, resumable. An exam is a **timed,
   simulated real-exam environment**, recorded as one attempt. They differ in delivery, state
   and what they record. Not one kind with a flag.
4. **Chat organisation stays open** — chat is not a noun in this contract yet. One
   requirement only: **saving a single response as a note must be possible.** So `NoteSet`
   carries `origin: 'generated' | 'chat'` and a note may cite the response it came from.
   Nothing else about chat is designed in.
5. **Topics come from the chunking pipeline.** Each source carries topic metadata; a
   notebook's topics are reconciled from its sources'. Method stays by-name
   ([ADR 0009](../adr/0009-topic-reconciliation-by-name.md)); what changes is that
   reconciliation is **notebook-scoped**, fixing the live bug in §0.
6. **No cross-notebook sources.** An artifact draws only on sources in its own notebook.
7. **Artifacts are standalone once generated.** **Deleting a source does not delete or
   invalidate artifacts made from it.** This is why `Artifact` carries `sourcesSnapshot`
   alongside `sourceIds[]`: the ids may dangle, but the artifact still displays what it was
   built from. Same principle as
   [ADR 0013](../adr/0013-answers-snapshot-the-question.md) — a pointer is not the meaning.
   A dangling `sourceId` is an expected state, not an error, and every consumer must handle it.
8. **Cards are locked to their deck.** No moving cards between decks. Deck membership is
   fixed at generation.
9. **The blueprint belongs to an exam, not the notebook.** Per-exam. This is what finally
   gives a blueprint something to blueprint.

### 1.3 Readiness is a bundle, not a card count

Today "18 due" is a raw card count and the only signal. Replace with per-artifact readiness,
rolled up:

```
Artifact.readiness  →  { state: 'ready' | 'partial' | 'none', detail: string }
Notebook.readiness  →  roll-up, e.g. "2 decks · 1 quiz ready"
```

Practice means "work this bundle", not "drill N cards". A deck contributes due cards, a quiz
contributes unsat questions, a note set unread sections. A new artifact kind extends
readiness without touching the home screen — the property the card-count model lacks.

### 1.4 What earns its place

Nothing survives by default. Assessed against the new model:

**Keeps its place — pure logic, model-independent:**
[`fsrs.ts`](../../src/lib/fsrs.ts), [`day.ts`](../../src/lib/day.ts),
[`queue.ts`](../../src/lib/queue.ts) (scheduling maths, no entity assumptions);
[`progress.ts`](../../src/lib/progress.ts), [`mastery.ts`](../../src/lib/mastery.ts),
[`study-plan.ts`](../../src/lib/study-plan.ts) (aggregates — re-point at new shapes);
the `basic`/`cloze`/`mcq` payload union in [`schemas.ts`](../../src/lib/schemas.ts);
[`cognito.ts`](../../src/lib/cognito.ts) and
[`env-schema.ts`](../../src/lib/env-schema.ts) — **do not weaken the secret-key refusal.**

**Earns its place with rework:** `CardFace`, `ClozeText`, `McqOptions`, `RatingButtons`,
`ExamRunner`, `useExamTimer` — good components wired to the wrong parents.

**Does not survive:** `DashboardPage` (built on the `focus` guess); `routes.tsx` (three
frames because the model had no centre); `NotebookPage`'s deck→notebook hand-mapping;
`SourcesRail`'s `useState([])`; `exam/fixtures.ts`; the entire `/create/*` page family
(replaced by modals, §3.2); the two-backend split in `queries.ts`.

---

## 2. Detaching the backend

**Goal:** the frontend gets designed without the backend limiting it. Agreed. The mechanism
below is a refinement of "a local JSON server", for reasons that matter.

### 2.1 Why not literal `json-server`

- It cannot express `POST /notebooks/:id/artifacts` producing a **job with streaming
  progress** — the hardest surface to design and the one most worth prototyping.
- Readiness roll-ups (§1.3) are computed, not stored. `json-server` returns stored rows.
- It is a second process, a second port, a proxy config, and a hand-maintained route table —
  precisely the drift [`check-routes.mjs`](../../scripts/check-routes.mjs) exists to police.

### 2.2 Instead: a typed in-repo fake behind the real client seam

```
src/lib/api/
  contract.ts     Zod schemas + TS types for every entity and endpoint. THE CONTRACT.
  client.ts       the real client — fetch + Cognito token (today's api-client.ts)
  fake.ts         an in-memory implementation of the same interface
  fixtures.ts     hypothetical data — several notebooks, sources, every artifact kind
  index.ts        picks one, from VITE_API_MODE ('fake' | 'live')
```

Components talk to TanStack Query hooks; hooks talk to `api`, which is one of the two.
Switching is an env var.

Why this is better here:

1. **One contract, typechecked.** `fake.ts` implements the same TS interface as `client.ts`,
   so drift is a *compile error* rather than a 404 found later. Types solve for free what
   `check-routes.mjs` solves with a linter.
2. **Latency, errors and empty states are dialable.** A fake that can be told "return 402
   quota exceeded" or "take 4 seconds" is how the generation and error surfaces get designed
   properly. `json-server` gives the happy path only.
3. **No second process.** `npm run dev` works, including for a fresh session.
4. **It becomes the seed script.** At FR7 `fixtures.ts` is already the shape the real API
   must return.

> **The rule that keeps this honest:** `fake.ts` may not have capabilities a real API could
> not have. No pre-joined graphs no endpoint could produce, no synchronous returns for
> things that must be jobs. A fake that lies designs a frontend the backend cannot serve —
> today's failure, arrived at from the other side. **Note this is unguarded: a fake that
> lies typechecks perfectly.** It is a discipline, not a test.

### 2.3 What happens to the existing backend

**Nothing is deleted.** `services/api/`, `infra/`, and `services/api/migrations/` stay
untouched through FR0–FR6. The rebuilt backend is FR7, and its spec is `contract.ts`.

**Supabase goes at FR0.** `@supabase/supabase-js`, `src/lib/supabase.ts`, `supabase/` client
usage, and the two `VITE_SUPABASE_*` vars exist only for four `/progress` stats hooks. Under
the fake they have no reason to exist, and carrying a second backend into a re-architecture
is how *"two backends, for one phase"* becomes permanent. **Keep** `src/lib/env-schema.ts`'s
secret-key refusal — it is a security invariant, not Supabase plumbing
([CLAUDE.md](../../CLAUDE.md)).

---

## 3. The surface

### 3.1 Routing — one home, one notebook, modals over pages

```
/                                        Home — notebooks first-class
/notebooks/:id                           The notebook. Sources | Workspace | Studio
/notebooks/:id/overview                  The notebook's centre (§3.4)
/notebooks/:id/decks/:deckId/practice    full-screen runner
/notebooks/:id/quizzes/:quizId           full-screen runner, untimed, reveal-on-answer
/notebooks/:id/exams/:examId             full-screen runner, timed
/notebooks/:id/notes/:noteSetId          reader (editor later)
/settings, /login, /signup, /auth/callback
```

Gone: `/home` **and** `/dashboard` as separate destinations (no two main pages);
`/create/text`, `/create/document`, `/create/review/:deckId` as pages; the `/decks/*` legacy
redirects.

**Every runner route names its artifact.** That is what makes "many decks, many quizzes, many
exams" expressible, and the direct fix for *"the exam button opens an exam and nobody knows
where it came from"*.

### 3.2 Modals, not pages

> A **modal** configures or creates. A **route** is a place you can be, link to, and return to.

- Add a source → modal from the Sources rail.
- Generate any artifact → modal: kind, source selection, count, depth.
- Card editor, notebook settings, blueprint editing → modal.
- Practice, quiz, exam → **full-screen routes** (long-lived, resumable, linkable).
- The review gate → modal over the notebook.

This deletes the `/create/*` family and with it the flow that creates a notebook when the
user meant to add to one.

### 3.3 The notebook page

- **Sources (left)** — the persisted list. **"+ Add source" is the primary CTA here**, not a
  row in the Studio rail. Adding a source is the notebook's defining act, and this is the
  owner's fix for "more sources shouldn't be another row".
- **Workspace (centre)** — grounded chat over selected sources.
- **Studio (right)** — five entries: **Quiz · Cards · Notes · Exam simulator · Diagnostics**.
  Each opens a *generate* modal when empty, and **lists that notebook's artifacts of that
  kind** when not. This is where "many exams per notebook" becomes visible and navigable.

### 3.4 The notebook overview — the central place

`/notebooks/:id/overview`, scoped to **one** notebook, which is what makes it honest where a
global dashboard was not:

- the artifact list — everything generated, by kind, with source provenance;
- readiness (§1.3) — the bundle, not a card count;
- diagnostics — topic mastery, `mastery.ts` re-pointed;
- the review heatmap, notebook-scoped;
- the study plan, `study-plan.ts` re-pointed.

Per-exam blueprints (§1.2(9)) live with their exam, not here.

### 3.5 Home

Notebooks first-class: a grid of notebook cards carrying per-notebook readiness, plus a
genuinely global strip (total due, streak, reviewed today). **No `focus` guess, ever** —
every action either names its notebook or lives on a notebook card.

### 3.6 The UI library — assessed with a rewrite on the table

The owner is fine with a rewrite and has released every brand token except **the tone of the
brand colour** (the hue family, not the exact value). So this was re-examined, not defended.

**What the app demands:** a three-pane resizable shell; heavy modal/sheet use; three
keyboard-driven full-screen runners; rendering of **untrusted LLM output, never as HTML**
([CLAUDE.md](../../CLAUDE.md)); a data-dense overview (heatmap, mastery, forecast, plan);
long virtualised lists; a precise identity in both themes.

**Candidates.** *MUI* — largest set, but Material is a strong opinion that reads as "Google
admin console", and emotion sits awkwardly beside Tailwind v4. *Mantine* — excellent DX,
genuinely richer (spotlight, notifications, hooks), but owns its theming layer and carries
the same generic-SaaS risk. *Radix + Tailwind composed by hand (= shadcn/ui)* — most work per
component, total identity control, no opinion to fight. *Park/Ark, Base UI* — credible but
younger; not worth the risk on the critical path.

**Recommendation: stay with shadcn/ui.** The palette argument is now void — the owner has
released those tokens — so the case rests on two things that survive it:

1. **The distinctive surfaces ship with no library.** The exam runner, the quiz reveal, the
   three-pane shell, the review gate. A library's value is components you *don't* write; here
   the ones that matter must be written regardless.
2. **shadcn is source-in-repo, not a dependency.** For an app whose identity is the point,
   owning the source is the correct trade.

**The honest counter-argument, recorded so it is not lost:** Mantine would reach a
professional surface faster, and its rich components are real. If speed mattered more than
identity, it would win. The judgement here is that the app's problem was never missing
components — it was eleven good components arranged around an incoherent model, which no
library fixes.

**What changes in the design system (FR1), given the token freedom:**

- **Everything except the brand hue is open.** Re-derive the full palette — neutrals,
  surfaces, borders, and **the FSRS grade colours** (today's four-stop ramp is not
  preserved). Only the brand tone carries over, and its exact value may change.
  Consumers to re-point: [`grade-tokens.ts`](../../src/lib/grade-tokens.ts),
  `Meter.tsx`, `RatingButtons.tsx`, `DiagnosticPage.tsx`.
- **One constraint worth carrying forward regardless of palette:** contrast must be
  *checked*, and the grade ramp must vary in **lightness, not only hue** — a red-to-green
  sweep is the axis deuteranopia flattens. That is a property to re-earn, not a token to keep.
- **Complete the primitive set:** `dialog`, `sheet`, `dropdown-menu`, `tabs`, `tooltip`,
  `progress`, `separator`, `avatar`, `scroll-area`, `command`, `popover`, `alert`,
  `resizable`, `toggle-group`, `table`.
- **Extend tokens beyond colour** — the current file is colour-only. Add spacing, radius,
  elevation, and **motion** (durations, easings). Ad-hoc animation is the most common reason
  a competent app still reads as amateur.
- **A layout vocabulary** — `Page`, `PaneGroup`, `Rail`, `Toolbar`, `EmptyState`,
  `SectionHeader` as real components, so no screen hand-rolls padding again.
- **One documented state set** — loading (skeleton, not spinner), empty, error, and
  **generating**, applied identically everywhere.
- **A typography rule.** Three faces are loaded with no documented rule for when each is
  used. Decide, write it down, enforce it. Faces themselves may change.
- **Keep** the `prefers-reduced-motion` block in `globals.css` (SPEC §8.4) — an
  accessibility requirement, not a style choice.

Two new dependencies, the genuine gaps: `react-resizable-panels` (three-pane shell) and
`@tanstack/react-virtual` (long card/question lists). Both compose with the existing system.

---

## 4. Sequence

Ordered so the app runs after every phase, and so the model is settled before any pixel is
designed against it.

| # | Phase | Delivers |
| --- | --- | --- |
| **FR0** | Contract & fake | `src/lib/api/` — the nouns as Zod + types, `fake.ts`, `fixtures.ts` with several notebooks and every artifact kind. Supabase removed. Nothing visual. |
| **FR1** | Design system | Palette re-derived from the brand tone; primitives completed; tokens beyond colour; layout vocabulary; state set. Reviewed on a real screen before it carries a feature. |
| **FR2** | Shell & routing | New route table (§3.1), home (§3.5), the modal system (§3.2). |
| **FR3** | The notebook | Three panes; Sources as persisted entities with the CTA; Studio listing artifacts. |
| **FR4** | Generation | The generate modal for every artifact kind, job progress, review gate as a modal. |
| **FR5** | Study surfaces | Four runners by artifact id: practice (FSRS), quiz (untimed, reveal-on-answer), notes (reader), exam (timed). Quiz and exam are separate runners per §1.2(3). |
| **FR6** | The overview | §3.4 — artifacts, readiness, diagnostics, heatmap, plan. |
| **FR7** | Backend rebuild | `services/api/` and the schema rewritten to serve `contract.ts`. Flip `VITE_API_MODE`. |

**FR0 is the whole bet.** If the contract is right, FR1–FR6 are ordinary work. If it is
wrong, everything after inherits it — which is exactly what happened to the current frontend.

---

## 5. Constraints — these bind every phase

From [CLAUDE.md](../../CLAUDE.md); repeated because a fresh session executing FR3 will not
re-read it.

- **`main` is frozen.** Owner only. Do not merge, push, or offer to. `dev` is yours — commit
  and push there without asking. Topic branches off `dev` are yours.
- **PRs are the owner's.** Merge into `dev` directly.
- **There are no tests, and none get written** ([ADR 0005](../adr/0005-no-test-suite.md)).
  Do not reach for `vitest`. `npm run check` before every commit; `npm run verify` at a
  checkpoint. **Never commit with a failing `check`.**
- **Report honestly: "typechecks and builds", never "tested" or "works".** Through FR0–FR6
  the fake makes this sharper — a fake that lies typechecks perfectly.
- **Card content is untrusted LLM output.** Render as text. `dangerouslySetInnerHTML` is
  ESLint-blocked; do not disable it. This binds the notes reader and chat especially, where
  rendering markdown will be tempting — use a renderer that produces elements, never HTML.
- **One Zod definition per concept.** After FR0 that home is `src/lib/api/contract.ts`. Do
  not redefine a card, artifact or notebook shape anywhere else.
- **TypeScript strict, `noUncheckedIndexedAccess`.**
- **No AWS credential enters the repo.** Nothing in FR0–FR6 should need one.
- **Do not touch `services/api/`, `infra/`, or the migrations before FR7.**

---

## 6. Open questions — none blocking FR0

1. **Does deleting a notebook delete its artifacts?** Almost certainly yes (they have no
   existence outside it, §1) — but confirm against §1.2(7)'s standalone principle, which
   deliberately does *not* extend to the notebook itself.
2. **Can a quiz or exam be regenerated in place, or is each generation a new artifact?**
   New-artifact is simpler and matches §1.2(7). Surfaces in FR4.
3. **Does a note set's later editor fork the artifact or edit in place?** Surfaces when the
   editor is built; §1.2(2)'s structured-blocks requirement is what keeps both open.
4. **Is chat history persisted per notebook?** Deliberately undecided (§1.2(4)). Only
   save-as-note is committed.

---

## 7. What this brief does not do

- **It changes no code.** Nothing here has been executed.
- **It does not touch `main`.**
- **It writes no tests.** Verification through FR0–FR7 is `check`/`verify` — typechecks and
  builds. Nothing proves behaviour.
- **It does not delete the live backend.** `services/api/`, `infra/` and the migrations are
  untouched until FR7.
- **It does not re-open §1.2.** Those nine decisions are the owner's and are settled.
