# DS4b — The surface pass DS4 could not run

Phase 4 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md), resumed. **This is
[DS4](DS4-scope-and-polish.md) tasks 2–6, unchanged in substance.** DS4 shipped its task 1
— the notebook-scoping bug — and stopped at its own §1 precondition: no way to sign in, so
no screen could be opened.

**Reference:** [DS4 §6](DS4-scope-and-polish.md#6-decisions-to-record) (what task 1 decided
and proved), [DS4 §7](DS4-scope-and-polish.md#7-what-went-unverified) (what is still
unobserved), [DS3 §7](DS3-real-blueprint-exam.md#7-what-went-unverified), SPEC §4.6 (what is
still inert), [ADR 0005](../adr/0005-no-test-suite.md) (there are no tests).

**Done when:** every screen DS3 and DS4 rewrote has been looked at in a browser, what broke
is written down, and the product survives being demoed on a phone.

---

## 0. Read this first — the blocker, and the one command that clears it

**Two phases have now written frontend code that nobody has seen.** DS3 rewrote four
screens without opening one; DS4 edited two of them and could not open one either. That is
the single most important fact about this plan, and the reason task 1 below is not "polish"
but "look at it".

`scripts/dev-api.mjs` verifies **real Cognito tokens** against the live JWKS and has no
local bypass — deliberately, and its header says so. So the app cannot be driven without an
account that can actually sign in.

**An account already exists and is one command from working.** DS4 created it through the
live pool's own signup:

```
email:  ds4-demo@example.com
sub:    04b8c468-f0d1-7007-4764-f69cb10936db
state:  UNCONFIRMED  ← the whole blocker
```

Cognito mailed a verification code to an address nobody reads. `autoVerify: { email: true }`
in `infra/lib/auth-stack.ts` *sends* the code; it does not skip confirmation. So:

```bash
# The owner runs this once. Then set a password that survives, and record it.
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_8byyB8D2H \
  --username ds4-demo@example.com \
  --region us-east-1
```

Then put the credentials in `.env.local`, which is also what `demo:seed` reads:

```
DEMO_EMAIL=ds4-demo@example.com
DEMO_PASSWORD=<the password>
```

DS4 attempted `admin-confirm-sign-up` and its permission layer refused it. **If this session
is refused too, stop and say so — do not start task 4.** A third consecutive phase of
unobserved UI work is how DS3's two bugs survived to be found late, and it is worse the
third time because there is more unseen code to hide in.

**A real signup through the app's own `/signup` form is the equally good alternative** — it
needs no owner and no AWS call, provided the email is a mailbox this session can read the
code from. Either route ends the same way: a token, and a browser.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` green | `npm run verify` |
| Neon reachable, nothing pending | `npm run db:migrate:status` |
| **An account that can sign in** | §0. **This is the phase. Do not proceed without it** |
| API up | `node --experimental-strip-types --env-file=.env.local scripts/dev-api.mjs`, then `curl localhost:8787/topics` → 401, not a connection error |
| Vite up | `npm run dev` |

**Two notebooks with different topics already exist** in the dev database, seeded by DS4 so
that task 1's fix was observable:

| Notebook | Topics |
| -------- | ------ |
| `Cell biology` | Glycolysis (2 cards), Krebs cycle (1) — plus 1 unfiled |
| `AWS architecture` | VPC networking (1), IAM policies (1) — plus 1 unfiled |

They belong to user `447804a8-70d1-70a6-c08d-3475b5aa7d84`. **They were written directly to
Postgres, not generated** (DS4 §7). If the account you sign in as is a *different* user,
these are invisible to it — which is correct, and means you must ingest two documents to
recreate the condition. **Say which user you actually observed.**

**Not a precondition: DS2's embedding key.** Still absent, chat still unproven. If the chat
pane is on screen during the polish pass, **do not make it look finished**.

---

## 2. Out of scope

Unchanged from [DS4 §2](DS4-scope-and-polish.md#2-out-of-scope), which still governs. The
short version, plus what DS4 settled:

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| Vercel, the API host, the seeded demo account, the rehearsal | **DS5** |
| Exam question generation from the user's cards | **Phase C** |
| Blueprint-aligned generation | The generation pipeline |
| Persisting blueprint edits | Needs an endpoint and a table. The screen already says it does not save |
| "Generate cards from misses" | A generator feature. `answers` existing makes it possible, not in scope |
| Improving topic reconciliation | ADR 0009 stands |
| A test suite | ADR 0005 stands |
| **Re-litigating task 1** | **Done and proven** (DS4 §6). If a blueprint shows another notebook's topics, that is a *new* bug in the screen, not the old one |

**DS5's budget is the thing being spent here.** A demo path never walked on deployed
infrastructure is the most common way a finished product fails in the room, and DS5 is the
phase that walks it. Every hour DS4b overruns comes out of that.

---

## 3. The rule this phase runs under

Unchanged from [DS4 §3](DS4-scope-and-polish.md#3-the-rule-this-phase-runs-under):

**Polish makes what is true easier to see. It never makes what is false look true.**

1. **A loading state is not a success state.** No skeleton that reads as content, no chart
   animating in from zero, no number counting up.
2. **An inert control must stay visibly inert.** SPEC §4.6's four affordances explain
   themselves when pressed; all four still did at DS4. **The four rows are the spec.**
3. **Motion respects `prefers-reduced-motion`** — `PracticeSession` uses `motion-safe:` and
   `PipelineStages` documents its reduced-motion block. Nothing may convey information by
   motion alone.

---

## 4. Tasks

### Task 1 — Open the app and walk every screen

**The first observation of code from two phases.** Not a review task.

With a fresh account *and* the populated one:

1. **Blueprint** — empty, loading, populated. Edit a weight; rebalance; check the total.
   Confirm the "Unfiled" row appears and is marked.
   **And the reason this phase exists: open the blueprint for `Cell biology`, then for
   `AWS architecture`, and confirm each lists only its own topics.** DS4 proved this at the
   API; nobody has seen the screen do it.
2. **Diagnostic** — empty, cards-but-no-exams (the common case), after an exam.
   **Read the banner in each**: it makes three different claims and only one can be right.
3. **Exam** — the sample notice is on the setup screen. Sit one; submit; confirm the attempt
   lands (`select count(*) from answers` — **it is 0 today**, so any row is new) and the
   diagnostic notices.
4. **Every other screen**, because DS3 changed `useCards`' type and `queries.ts` broadly.

**Write down what breaks.** DS1, DS2 and DS3 each found bugs here that no `verify` could
see. Assume this one does too, and fix what you find before polishing over it.

### Task 2 — Mobile

Nothing has been checked below `sm`, and the demo may be given on a phone.

- Every screen at 375px. **The blueprint's topic row is the likely casualty**: a name, a
  three-way control, a number input, a count and a delete button on one line.
- The notebook shell's rails, and the exam runner's navigator.
- **Touch targets and the focus-mode exam.** A timed exam with a mis-sized tap target loses
  an attempt.

### Task 3 — The surface pass

Only after tasks 1 and 2, and against §3.

- **Loading, empty and error states, consistently.** DS3 wrote three sets by hand; make them
  one vocabulary. `EmptyState` exists and nine screens use it.
- **The differentiating screens first** — the blueprint's provenance drawer and the
  diagnostic's divergence callout are what the brief (§2) names as separating this from "AI
  makes flashcards". Worth more attention than the rest of the app combined.
- **Motion where it explains something** — a weight changing, a card scheduling forward —
  and nowhere else.
- **The four inert affordances stay legibly inert.**

### Task 4 — Accessibility

Not a new standard: this codebase already labels meters, marks decorative icons
`aria-hidden`, and uses real `<label>`s. Keep that true, and check keyboard traversal of the
exam runner and the blueprint's editing controls — both are new interaction surfaces.

### Task 5 — Run it, twice

1. **A fresh account through the whole product** — signup, ingest, review gate, practice,
   exam, diagnostic, blueprint. Nothing may 500; nothing may show another user's data.
2. **The two-notebook check**, in the browser this time.
3. **The cross-tenant probe on anything this phase changes.** `check-data-access.mjs` checks
   shape, not meaning.
4. **At 375px.**

### Task 6 — Documentation

1. **SPEC §4.6** — the four affordances, still honest.
2. **The five-variable seam grep**, comments only:
   ```
   grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER\|EMBEDDING_PROVIDER' \
     src/ services/api/src/handlers/
   ```
3. **The board** — DS4b complete, DS5 next.
4. **Write DS5's plan.** The last task of every plan. DS5 must not be rushed.

---

## 5. Acceptance criteria

1. **Every screen DS3 and DS4 wrote has been opened in a browser**, in both empty and
   populated states, and what broke is written down.
2. **A blueprint for one notebook shows only that notebook's topics, observed on screen**
   with two notebooks that have different topics.
3. An exam sat in the browser lands in `answers`, counted in the database. It is 0 now.
4. Every screen is usable at 375px.
5. No loading state resembles a success state; the four inert affordances still explain
   themselves.
6. Motion respects `prefers-reduced-motion`; nothing conveys information by motion alone.
7. `npm run verify` green, including `check:data-access` and `check:routes`.
8. The five-variable seam grep returns nothing but comments.
9. `JOB_STORE=dynamo` and `PIPELINE_RUNNER=sfn` still typecheck; `jobs-dynamo.ts` and
   `pipeline-sfn.ts` still byte-identical to `46a80ec`.

---

## 6. Decisions to record

- **What task 1 found**, itemised. **This is the phase's most valuable output** and it will
  be tempting to summarise it away once fixed. DS4 could not produce it at all.
- **Which user and which notebooks were actually observed** — the seeded pair, or two you
  ingested.
- **Anything deliberately left rough**, and why it was right against DS5's budget.

---

## 7. What will go unverified

- **"It demos well" is a judgement, not a measurement.** One person's reading of one path.
- **Mobile is one viewport width, not a device matrix.**
- **Accessibility is a keyboard pass and a reading of the markup**, not an audit.
- **There are still no tests** (ADR 0005). `verify` proves the code builds. Say "typechecks
  and builds", never "tested".
- **Whatever could not be signed into stays unobserved** — and if §0 failed again, say that
  first and loudest, because it invalidates most of this phase's claims.

---

## 8. What this phase actually found — executed 2026-09-07

**The blocker in §0 was not real, and that is the first finding.** No
`admin-confirm-sign-up` was needed and no owner was involved. The account was already
`CONFIRMED`; what DS4 hit was narrower than "cannot sign in":

> `scripts/seed-demo.mjs` authenticates with **`USER_PASSWORD_AUTH`**, which
> `infra/lib/auth-stack.ts` deliberately does not enable (it enables `userSrp` +
> `adminUserPassword`, and its comment says why: USER_PASSWORD_AUTH sends the password in
> the clear inside TLS). So the *script* was blocked, and the **app never was.**

Signing in the way the browser does — SRP via `amazon-cognito-identity-js`, already a
dependency — worked first try and returns `sub 04b8c468-f0d1-7007-4764-f69cb10936db`.
**A phase blocked on "no way to sign in" was actually blocked on one script's auth flow.**

**Observed as `ds4-demo@example.com` (`04b8c468…`), not the seeded user.** The notebooks DS4
seeded belong to `447804a8…`, whose password nobody has, so the two-notebook condition was
**rebuilt for the signed-in user** through the API (`POST /decks`, `POST /decks/{id}/cards`)
and filed under topics through the data layer's own `reconcileTopics` + `assignCardsToTopic`
— the review gate's path, `userId` first, no hand-written SQL. Result: `Cell biology`
(Glycolysis 2, Krebs cycle 1, +1 unfiled) and `AWS architecture` (IAM policies 1, VPC
networking 1, +1 unfiled).

### The five defects — none of which `verify` can see

| # | Defect | Where | Why it mattered |
| - | ------ | ----- | --------------- |
| 1 | **Every shell screen scrolled horizontally to 499px at 375px.** The header's three children (fixed lockup, nav, `shrink-0` account menu) plus `gap-6` exceeded the viewport by ~124px | `AppShell.tsx`, `AccountMenu.tsx`, `Logo.tsx` | The demo may be given on a phone. 7 of 10 screens affected |
| 2 | **Blueprint topic names truncated to "Gly", "Kre", "Unf"** at 375px — the name lost every contest for space against the difficulty control, weight input, count and delete button on one row | `BlueprintPage.tsx` | Predicted by [§4 task 2](#task-2--mobile) as "the likely casualty", and it was. A blueprint whose topics cannot be read is not a blueprint |
| 3 | **The diagnostic contradicted itself.** Its banner said "You have sat 6 exam questions…" while the plan panel below said "Sit an exam to get a second signal" | `StudyPlanView.tsx` | `DiagnosticPage` already computed `hasUnattributedExams` for the banner; the empty state simply never asked and hardcoded the never-sat wording. Its own comment said the banner "must not tell someone who just finished an exam that they have never sat one" — the panel below it did exactly that |
| 4 | **An inert control named a blocker that no longer existed.** "Generating an exam from this blueprint needs the ingestion pipeline" — the pipeline has run since DS1 | `BlueprintPage.tsx` | §3's rule cuts both ways: an inert control that misstates *why* is the same dishonesty as one that pretends to work |
| 5 | **An empty state understated the product.** "Generating them from text arrives in the next phase", beside a notebook studio with a working `Generate cards` action | `NotebookCardsPage.tsx` | The mirror of overselling, and it reads as a stale product |

**Defects 1, 2, 4 and 5 were all in code DS3 or DS4 wrote and never opened.** That is the
argument for this phase existing, and the argument against a sixth unobserved one.

### What was checked and found already correct

- **Two-notebook scoping, on screen** — each blueprint listed only its own topics. DS4's fix
  holds in the browser, not only at the API.
- **An exam sat end to end in the browser**: 6 questions answered, submitted, scored 1/6
  (17%), broken down by topic. `answers` went **0 → 6 rows**, one attempt, `correct` = 1,
  owned by the signed-in user — matching the screen exactly.
- **The diagnostic noticed**, and stayed honest: it reports the 6 questions *and* that they
  came from the sample exam so none can be attributed to a topic.
- **Weight editing and rebalance**: total tracks to 120%, turns red, an `Edited` badge
  appears, `Generate exam` disables, and an explicit "Topic weights sum to 120%, not 100%."
  appears. Nothing false is made to look true.
- **All four inert affordances** still explain themselves when pressed.
- **Keyboard traversal** of the blueprint is complete and in visual order; `Rebalance to
  100%` is correctly skipped while `disabled`.
- **Accessibility**: no unlabelled controls on any screen walked, meters carry real
  `aria-label`s and values, one `h1` per page, decorative SVGs `aria-hidden`.
- **Reduced motion**: with `prefers-reduced-motion: reduce`, animations collapse to ~0s.
- **Cross-tenant probe** (task 5.3): as `04b8c468…` against `447804a8…`'s rows — deck 404s,
  cards and topics return 0 rows, while a control read of an own deck returns 4. Matches ADR
  0008's documented behaviour.
- **Zero console errors** across every screen, both viewports, empty and populated.

### Deliberately left rough

- **The exam runner's option letters are inside `sr-only` radios with visible labels.** Good
  markup; not re-styled.
- **Empty states were already one vocabulary** (`EmptyState`, nine screens) — task 3's
  "make them one vocabulary" needed no work beyond the two copy fixes above.
- **The chat pane was left exactly as it is.** DS2's embedding key is still absent; per §1
  it was not made to look finished.
- **375px only**, not a device matrix. No tablet breakpoint was checked.

