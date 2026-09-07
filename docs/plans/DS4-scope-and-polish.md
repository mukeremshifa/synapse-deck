# DS4 — Notebook scope, then the surface

Phase 4 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md): *"UI/UX, motion, mobile, and the
differentiating features. Judged on how it demos."*

**Reference:** [DS3 §7](DS3-real-blueprint-exam.md#7-what-went-unverified) (what it left
undone and why), [ADR 0008](../adr/0008-application-level-tenancy.md) (any new query),
[ADR 0009](../adr/0009-topic-reconciliation-by-name.md) (why topics fragment), SPEC §4.6
(what is still inert), [ADR 0005](../adr/0005-no-test-suite.md) (there are no tests).

**Done when:** a blueprint describes *its own notebook* rather than everything the user
owns, every screen DS3 rewrote has been looked at in a browser, and the product survives
being demoed on a phone.

---

## 0. The finding that shapes this phase

**DS3 left one known correctness bug, and it is first because it is not polish.**

```
grep -n "deck_id" services/api/migrations/0004_topics.sql   # no matches
```

`useTopics` returns **every topic the user owns**, and `BlueprintPage` renders them as
"what an exam over *this notebook* should weigh". With one notebook those are the same set,
which is why nothing looked wrong. With two, a blueprint for the biology notebook lists the
AWS topics, weights them, and allocates exam questions to them.

This is not a UI defect and it is not fixable in a component. `topics` has no `deck_id`:
topics are per-user by construction, deliberately, because [ADR 0009](../adr/0009-topic-reconciliation-by-name.md)
reconciles them across *all* of a user's documents so that five uploads about one subject do
not produce five topic sets. **The fix must not undo that**, which is what makes it a design
task rather than an `alter table`.

Task 1 decides the shape. The three candidates, so the session does not re-derive them:

| Option | Shape | Cost |
| ------ | ----- | ---- |
| **A. Derive scope from cards** | `GET /topics?deckId=` filters to topics *having a card in that deck*, counting only that deck's cards | No schema change. A topic can appear in two notebooks, which is correct — it is the same topic |
| **B. `topics.deck_id`** | Topics belong to a notebook | Breaks ADR 0009's cross-document reconciliation outright. **Reject unless A fails** |
| **C. A join table** | `deck_topics(deck_id, topic_id)` | Correct and redundant: `cards` already records exactly this relation |

**A is the recommendation.** It is a `where exists` on a query that already joins `cards`,
it changes no schema, and it keeps a topic shared across the notebooks whose material
touches it — which is the property ADR 0009 exists to protect. Record the decision in §6
whichever way it goes.

**Second finding: nothing DS3 built has been seen.** Its §7 says so plainly — no screen was
rendered, no route was driven over HTTP, no browser was opened. Four screens were rewritten
against the API and every one of them is typechecked and unobserved. Task 2 is not "check
DS3's work"; it is the first time this phase's own subject — *how it demos* — has been
looked at at all.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` green | `npm run verify` |
| Neon reachable, 0009 applied | `npm run db:migrate:status` — nothing pending |
| **Two notebooks with different topics exist** | The whole of task 1 is invisible with one. Ingest two documents about different subjects |
| **The dev API can be reached from a browser** | See below — this blocked DS3 |

**The precondition that actually blocks: a way to sign in locally.** DS3 could not drive
anything over HTTP because `scripts/dev-api.mjs` verifies real Cognito tokens and this
machine has no `DEMO_EMAIL` / `DEMO_PASSWORD`. **A phase judged on how it demos cannot be
executed without running the app.** So before task 2, either:

1. the owner supplies demo credentials in `.env.local` (`scripts/seed-demo.mjs` documents
   what they are), **or**
2. a real account is created through the app's own signup against the live Cognito pool.

Option 2 needs nothing from the owner and is the default. **If neither works, stop and say
so** — the alternative is another phase of unobserved UI work, which is how DS3's two bugs
survived to be found late.

**Not a precondition: DS2's embedding key.** Still absent, chat still unproven. If the chat
pane is on screen during this phase's polish pass, **do not make it look finished** — see
[DS2 §7](DS2-grounded-chat.md#7-what-went-unverified).

---

## 2. Out of scope

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| Vercel, the API host, the seeded demo account, the rehearsal | **DS5.** All of it |
| Exam question generation from the user's cards | **Phase C.** DS3 deferred it on purpose; it is model work and it is not surface |
| Blueprint-aligned generation (weights into a job) | Still the generation pipeline's, still not this |
| Persisting blueprint edits | Needs an endpoint and a table. Tempting because the screen looks like it should save — say so on screen instead, as it already does |
| "Generate cards from misses" | `answers` exists now, so this is finally *possible*. It is a generator feature, not a surface one. **Do not start it** |
| Improving topic reconciliation | ADR 0009 stands. Needs embeddings |
| A test suite | ADR 0005 stands |

**The temptation with a name.** This is the phase where everything looks like it is one
small change from finished, because the loop finally works end to end. Every item above is
half a day and none of them is what a reviewer sees. **The demo is judged on the path
through the product, and DS5 has to rehearse it on infrastructure that does not exist yet** —
a DS4 that overruns takes its budget from there.

---

## 3. The rule this phase runs under

**Polish makes what is true easier to see. It never makes what is false look true.**

DS2 §3 and DS3 §3 both forbade fixtures presented as real data. The surface-level version of
that failure is different and easier to commit by accident:

1. **A loading state is not a success state.** A skeleton that looks like content, a chart
   that animates in from zero, a number that counts up — each of these renders "we do not
   know yet" as "here is your data".
2. **An inert control must stay visibly inert.** SPEC §4.6 tabulates four affordances that
   explain themselves when pressed. Polishing one into looking primary and finished is
   exactly the lie the table exists to prevent. **The four rows are the spec; check them.**
3. **Motion is subject to `prefers-reduced-motion`, and this codebase already does it
   right** — `PracticeSession` uses `motion-safe:`, and `PipelineStages` has a comment
   explaining that a reduced-motion block disables `animate-spin` wholesale. Anything added
   follows that, and nothing added may convey information *only* through motion.

---

## 4. Tasks

Ordered so the correctness bug lands before anything is polished around it, and so the
app builds and runs after every one.

### Task 1 — Scope topics to a notebook

§0's finding. Decide between A, B and C, record it in §6, and implement it.

- If A: `listTopicsWithCounts(userId, deckId?)` gains an optional deck filter — **`userId`
  stays the required first parameter** (ADR 0008 rule 1, and `check:data-access` enforces
  the shape). `where exists (select 1 from cards where topic_id = t.id and deck_id = $2 and
  user_id = $1)`, and the counts narrow to that deck too. A topic with no cards in *this*
  notebook is not in *this* blueprint.
- `countUnfiledCards` narrows the same way, or the "Unfiled" row counts another notebook's
  loose cards into this one's weights.
- `GET /topics?deckId=` — a query parameter, so the unscoped read survives for anything
  that wants every topic. **`deckId` is not a capability**: the filter is `user_id` first,
  and a deck id belonging to someone else must return nothing rather than 403.
- `useTopics(deckId?)` and its query key take the scope, or two notebooks share one cache
  entry and the second shows the first's topics.

**Then look at it with two notebooks.** This bug is invisible with one, which is precisely
how it survived DS3.

Files: `services/api/src/data/topics.ts`, `services/api/src/handlers/topics.ts`,
`src/lib/queries.ts`, `src/features/blueprint/BlueprintPage.tsx`,
`src/features/plan/DiagnosticPage.tsx`.

### Task 2 — Open the app and walk every screen DS3 touched

**Not a review task. The first observation of four rewritten screens.**

Sign in (see §1), then, with a fresh account *and* a populated one:

1. **Blueprint** — empty state, loading state, populated. Edit a weight; rebalance; check
   the total. Confirm the "Unfiled" row appears and is marked.
2. **Diagnostic** — empty state, cards-but-no-exams (the common case), and after an exam.
   **Read the banner in each**: it makes three different claims and only one can be right.
3. **Exam** — the sample notice is on the setup screen. Sit one; submit; confirm the
   attempt lands (`select count(*) from answers`) and the diagnostic notices.
4. **Every other screen**, because DS3 changed `useCards`' type and `queries.ts` broadly.

**Write down what breaks.** DS1, DS2 and DS3 each found bugs here that no `verify` could
see; assume this one does too, and fix what you find before polishing over it.

Files: whatever breaks.

### Task 3 — Mobile

The demo may be given on a phone, and nothing has been checked below `sm`.

- Every screen at 375px. The blueprint's topic row is the likely casualty: it puts a name,
  a three-way control, a number input, a count and a delete button on one line.
- The notebook shell's rails, and the exam runner's navigator.
- **Touch targets and the focus-mode exam.** A timed exam on a phone with a mis-sized tap
  target loses an attempt.

### Task 4 — The surface pass

Only now, and against §3's rule.

- **Loading, empty and error states, consistently.** DS3 wrote three sets by hand; make
  them one vocabulary. `EmptyState` exists and nine screens use it.
- **The differentiating screens first.** The brief (§2) names the blueprint's provenance
  drawer and the diagnostic's divergence callout as what separates this from "AI makes
  flashcards". Those two are worth more attention than the rest of the app combined.
- **Motion where it explains something** — a weight changing, a card scheduling forward —
  and nowhere else. `motion-safe:` throughout.
- **The four inert affordances stay legibly inert** (§3.2).

### Task 5 — Accessibility, at the level this has held so far

Not a new standard: this codebase already labels meters, marks decorative icons
`aria-hidden`, and uses real `<label>`s. Keep that true for anything added, and check
keyboard traversal of the exam runner and the blueprint's editing controls, since both are
new interaction surfaces this phase touches.

### Task 6 — Run it, twice, again

The same shape as DS3 task 7, because it keeps working:

1. **A fresh account through the whole product** — signup, ingest, review gate, practice,
   exam, diagnostic, blueprint. Nothing may 500 and nothing may show another user's data.
2. **The two-notebook check** for task 1, which is the whole reason task 1 exists.
3. **The cross-tenant probe on any endpoint this phase changed.** `check-data-access.mjs`
   checks shape, not meaning.
4. **On a phone, or a 375px viewport.**

### Task 7 — Documentation

1. **SPEC §4.6** — the four affordances, still honest.
2. **The five-variable seam grep**, comments only:
   ```
   grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER\|EMBEDDING_PROVIDER' \
     src/ services/api/src/handlers/
   ```
3. **An ADR if task 1 went to B or C** — a schema change to `topics` needs its reasoning
   recorded against ADR 0009, which it partly contradicts.
4. **The board** — DS4 complete, DS5 next.
5. **Write DS5's plan.** It is the last task of every plan, and DS5 is the one that must not
   be rushed: a demo path never walked on the deployed thing is the most common way a
   finished product fails in the room.

---

## 5. Acceptance criteria

1. **A blueprint for one notebook contains only topics with cards in that notebook**,
   observed with two notebooks that have different topics.
2. **Every screen DS3 wrote has been opened in a browser**, in both its empty and populated
   states, and what broke is written down.
3. An exam sat in the browser lands in `answers`, counted in the database.
4. Every screen is usable at 375px.
5. No loading state resembles a success state; the four inert affordances still explain
   themselves.
6. Motion respects `prefers-reduced-motion`, and nothing conveys information by motion alone.
7. `npm run verify` green, including `check:data-access` and `check:routes`.
8. The five-variable seam grep returns nothing but comments.
9. `JOB_STORE=dynamo` and `PIPELINE_RUNNER=sfn` still typecheck; `jobs-dynamo.ts` and
   `pipeline-sfn.ts` still byte-identical to what P10 wrote.

---

## 6. Decisions to record

### Task 1 — **option A**, scope derived from `cards`

Implemented 2026-09-07 in `d0f3b6a`. `listTopicsWithCounts(userId, deckId?)` gains an
optional deck filter; `countUnfiledCards(userId, deckId?)` narrows with it; `GET
/topics?deckId=` passes it through; `useTopics(deckId?)` and the query key carry the scope.

**No schema change, so ADR 0009 is untouched** — topics stay per-user and reconciliation
still matches a name across every document the user owns. B was rejected because
`topics.deck_id` breaks that outright; C because `cards` already records the deck↔topic
relation and a join table would be a second copy of it to keep in step.

Two consequences worth stating, because neither is obvious:

- **A topic can appear in two notebooks, and that is correct.** It is the same topic; what
  differs per notebook is its card count, and so its weight.
- **The `left join` had to become an `inner join` at the same time.** Narrowing only the
  counts leaves every other notebook's topics on the blueprint at zero cards — present,
  named, and weighted 0%. That reads as deliberate, which makes it a worse lie than the bug
  it replaces.

`deckId` is **not** a capability: `user_id` is still `$1` in every statement, so a foreign
deck id matches none of this user's cards and yields an empty list rather than a 403 that
would confirm the deck exists.

**Verified against live Neon, through the real handler**, with two seeded notebooks
(`Cell biology`: Glycolysis, Krebs cycle — `AWS architecture`: VPC networking, IAM
policies):

| Request | Topics returned | `unfiledCards` |
| ------- | --------------- | -------------- |
| `GET /topics` | all four — **this is the DS3 bug** | 5 |
| `GET /topics?deckId=<biology>` | Glycolysis, Krebs cycle | 1 |
| `GET /topics?deckId=<aws>` | VPC networking, IAM policies | 1 |
| `GET /topics?deckId=<not this user's>` | none, 200 | 0 |

### Task 2 onwards — **not executed. §1's precondition failed.**

**No screen was opened, because this session could not sign in.** Recorded here rather than
in §7 because it is a decision about what the phase did *not* do, and it invalidates the
claims tasks 2–6 exist to make.

`scripts/dev-api.mjs` verifies real Cognito tokens against the live JWKS and has no local
bypass — deliberately (its header says so). Both of §1's routes were tried:

1. **Owner-supplied credentials** — `.env.local` has no `DEMO_EMAIL` / `DEMO_PASSWORD`, so
   `demo:seed` cannot run either.
2. **Signup through the live pool** — a real account was created
   (`ds4-demo@example.com`, sub `04b8c468-…`) and Cognito returned `UserConfirmed: false`,
   mailing a code to a mailbox this session cannot read. `autoVerify: { email: true }` in
   `infra/lib/auth-stack.ts` sends the code; it does not skip confirmation. The account
   **exists and is unconfirmed** — see the handoff for the one command that finishes it.

`admin-confirm-sign-up` would have closed the gap and was refused by this session's
permission layer. Per §1's own instruction — *"if neither works, stop and say so"* — tasks
2–6 were left undone rather than executed blind.

### Anything deliberately left rough

Nothing was polished, so nothing was left deliberately rough. Task 1 shipped complete
because its correctness is checkable in SQL; everything downstream of a browser stopped.

---

## 7. What went unverified

**§1's precondition failed, and it is said first and loudest because it invalidates most of
this phase's claims.** The last bullet below was written before the phase ran, as a warning.
It is now the headline.

### Still unobserved, exactly as DS3 left it

- **No screen has been opened in a browser.** Tasks 2–6 did not run. Every screen DS3
  rewrote — blueprint, diagnostic, exam, and everything touched by `useCards`' changed type
  — remains typechecked and unseen, now across two phases rather than one.
- **`BlueprintPage` and `DiagnosticPage` were edited in this phase and not rendered.** The
  change is one argument to a hook and the server behind it is proven, but "the query
  returns the right rows" is not "the screen draws them".
- **No exam has been sat in a browser**, so nothing has confirmed an attempt reaches
  `answers` through the UI. `answers` is still empty: `select count(*) → 0`.
- **Mobile, motion and accessibility were not touched at all.** Not "checked at one
  viewport" — not checked.

### What *was* verified, and how far it goes

- **Task 1 is proven at the API boundary**, against live Neon through the real handler, with
  two notebooks holding different topics (§6's table). That is a stronger check than a
  browser would have given for this specific bug — but it says nothing about the blueprint
  *screen*, which is where the wrong topics were being rendered.
- **The cross-tenant probe passed** for the endpoint this phase changed: a deck id that is
  not the caller's returns an empty list, not another tenant's topics. Consistent with
  ADR 0008 rule 2, and still a discipline rather than a guarantee.
- **`verify` is green**, `check:data-access` and `check:routes` included; the five-variable
  seam grep returns comments only; `jobs-dynamo.ts` and `pipeline-sfn.ts` are byte-identical
  to `46a80ec`, and `JOB_STORE=dynamo PIPELINE_RUNNER=sfn` typechecks. Criteria 7, 8 and 9
  hold. **This proves the code builds, not that it works** (ADR 0005).

### The seeded data is not the pipeline's output

The two notebooks that made task 1 observable were **written directly to Postgres by a
throwaway script**, not generated by the ingestion pipeline. The rows are shaped like real
ones — `reconcileTopics`' own upsert and slug rule, and `cards_state_consistency` satisfied
rather than worked around — but no model wrote them. They are live rows in the dev database
and DS5 should expect to see `Cell biology` and `AWS architecture` there.

### Standing, unchanged from the plan as written

- **"It demos well" is a judgement, not a measurement** — and this phase did not even make
  the judgement.
- **DS2's chat is still unproven**; no embedding key, no question ever answered.
