# DS3 — The fixtures become real

Phase 3 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md): *"Blueprint, diagnostic and exam
runner off fixtures. Three impressive-but-fake screens become the loop."*

**Reference:** [ADR 0008](../adr/0008-application-level-tenancy.md) (every new table, all
four rules), [ADR 0009](../adr/0009-topic-reconciliation-by-name.md) (why topics match on a
slug and what that misses), [ADR 0010](../adr/0010-runtime-seams.md) + [0012](../adr/0012-embedding-provider-seam.md)
(five seams), SPEC §4.6 (the four inert affordances), [DS2](DS2-grounded-chat.md) §7 (what
its unproven half means for this phase's preconditions).

**Done when:** the blueprint, the diagnostic and the exam runner all read the signed-in
user's own cards, topics and review history — and a user with no history sees an honest
empty state rather than someone else's plausible numbers.

---

## 0. The finding that shapes this phase, checked before planning it

Two facts were checked against the tree while writing this plan, and both change the shape
of the work.

**1. Topics exist server-side and have never crossed the wire.**

```
grep -n "topic" src/lib/queries.ts      # no matches
```

`services/api/src/data/topics.ts` reconciles them, `cards.topic_id` is a real column, and
`reconcileTopics` runs at the review gate. But **no API route returns a topic and no client
hook asks for one.** Every screen that appears to group by topic is grouping fixture data
that carries `topicId` and `topicName` inline.

This is the phase's central task, and it is bigger than "swap an import": there is no
endpoint to swap *to*. Task 2 builds it.

**2. There is no `answers` table. The exam runner persists nothing.**

```
grep -rln "answers" services/api/migrations/*.sql   # only 0007, and only in prose
```

`MasteryAnswer` is a *shape* the mastery calculation reads (`src/lib/mastery.ts`), fed
entirely by `sampleMasteryAnswers`. An exam is sat in the browser, graded in the browser,
and forgotten when the tab closes. So "the diagnostic reads real exam signal" is not a
frontend change either — it requires a table, a write path, and a read path that do not
exist.

**The consequence for scope, and it is the main decision this plan makes.** Three screens
are on fixtures for two genuinely different reasons:

| Screen | Reads | What it actually needs |
| ------ | ----- | ---------------------- |
| Blueprint | `sampleBlueprint` | Topics on the wire, plus card counts per topic. **Data that exists.** |
| Diagnostic | `sampleMasteryCards` + `sampleMasteryAnswers` | Cards half exists; **the answers half needs a new table** |
| Exam runner | `SAMPLE_EXAM` | Questions generated from the user's own cards. **Generation work, not plumbing** |

They are not one task. Ordering them by what already exists is task 1's job.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` is green | `npm run verify` |
| Neon reachable, 0007 applied | `npm run db:migrate:status` — nothing pending |
| A notebook with real cards and topics exists | Ingest a document; confirm `select count(*) from topics` is non-zero |

**Not a precondition: DS2's embedding key.** DS3 touches no embedding and no chat. If
`OPENAI_API_KEY` is still absent, the chat pane stays broken and **that is not this phase's
problem to fix** — but do not let a green DS3 be read as DS2 working. See
[DS2 §7](DS2-grounded-chat.md#7-what-went-unverified).

**Read [ADR 0009](../adr/0009-topic-reconciliation-by-name.md) before task 2.** Topics match
on a normalised slug, so "Krebs cycle" and "Citric acid cycle" are two rows. That weakness
is *invisible* today because nothing displays topics; it becomes visible the moment a
blueprint groups by them, and a reviewer will notice it before you do.

---

## 2. Out of scope

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| UI/motion polish, mobile | **DS4** |
| Vercel, the API host, the seeded demo account | **DS5** |
| Making chat work end to end | **DS2's residue** — needs a key, not code |
| Blueprint-*aligned generation* (weights into a job) | Tempting and adjacent. It is a change to the generation pipeline, and this phase is about *reading* what exists. Only if tasks 1–6 land early |
| "Generate cards from misses" (SPEC §4.6) | Needs the `answers` table this phase may build. **Do not half-build it** — if task 4 lands, this becomes DS4's; if not, it stays inert and honest |
| Topic merging / better reconciliation | ADR 0009 accepted the weak match deliberately. Improving it needs embeddings, and the corpus for that is DS2's |
| A test suite | ADR 0005 stands |

**The temptation with a name.** These three screens look finished, because fixtures were
written to make them look finished. The failure mode is **shipping a screen that reads real
data for users who have some and silently falls back to fixtures for users who do not** —
which is exactly the demo account looking perfect and the reviewer's fresh account looking
identical. §3 exists to make that unwritable.

---

## 3. The rule this phase runs under

**A screen shows the user's own data or it shows an empty state. There is no third option,
and a fixture is never a fallback.**

This is DS2 §3's rule applied to a different surface, and the reasoning transfers exactly. A
fixture is a *stub with better production values*: `sampleBlueprint` names real AWS services
and plausible weights, so a blueprint rendered from it is indistinguishable from one computed
from the user's documents — except that it is about somebody else's exam.

Three corollaries, each a specific line you might otherwise write:

1. **No `?? sampleBlueprint`.** Not as a loading state, not for an empty account, not behind
   a flag. An account with no topics gets an empty state that says what to do.
2. **Fixtures do not survive the phase in application code.** When a screen stops reading
   one, the import goes. `src/features/*/fixtures.ts` may remain only if something other
   than a rendered screen reads it — and if nothing does, delete the file.
3. **An empty state is a first-class outcome**, designed, not an afterthought — the same
   argument DS2 made for "your sources don't cover this". A new user has no review history
   by definition, so the empty blueprint is the *most common* first view, not an edge case.

---

## 4. Tasks

Ordered so the app builds and runs after every one, and so the cheapest real data lands
first.

### Task 1 — Decide how far this phase goes, before writing any of it

§0 established that the three screens need three different amounts of new backend. Decide
**in this task** which of them DS3 actually takes off fixtures, and record it in §6.

> **The recommendation:** take the **blueprint and the diagnostic's card half** off fixtures
> (tasks 2–3), **build the `answers` table and the exam write path** (tasks 4–5) because the
> exam runner is unusable-but-honest without it, and **leave exam question *generation* on
> fixtures with the UI saying so** (task 6). Three screens is the brief's wording; three
> screens *fully real* is a different phase's worth of generation work, and half-doing it
> produces the §3 failure.
>
> If you overturn this, say why in §6. Shrinking it is legitimate — expanding it into
> generation is how DS4 and DS5 lose their budget.

Files: none. This task's output is what the next five are written against.

### Task 2 — Topics on the wire

**The blocking task, and the one with no shortcut.** `GET /topics` does not exist.

- `data/topics.ts` gains a read: the user's topics with a card count each. **All four
  tenancy rules** — `userId` first, `where user_id = $1` on every table in the join, no SQL
  outside `data/`, `userId` from the verified JWT only.
- A route, declared in **both** `scripts/dev-api.mjs` and `infra/lib/api-stack.ts`, or
  `check:routes` fails. If it fails, read it rather than silencing it.
- A hook in `src/lib/queries.ts` following the conventions already there.

**Include the count in the same query.** A topic list the client then counts by fetching
every card is the shape `listDecks` deliberately avoided — its comment says why, and the
reasoning is the same here.

**`cards.topic_id` is nullable and stays nullable.** Untopiced cards are an ordinary state
(hand-made cards have no topic, and a chunk whose model named none still produced good
cards). Decide what the blueprint does with them — **an "Unfiled" bucket is honest; dropping
them silently makes the weights wrong** — and say which in §6.

Files: `services/api/src/data/topics.ts`, `services/api/src/handlers/` (new or existing),
`scripts/dev-api.mjs`, `infra/lib/api-stack.ts`, `src/lib/queries.ts`.

### Task 3 — The blueprint reads topics; the diagnostic reads real cards

`BlueprintPage` imports `sampleBlueprint`; `DiagnosticPage` imports `sampleMasteryCards` and
`sampleMasteryAnswers`. This task removes the first two imports.

- **The blueprint's weights come from the user's own topic distribution.** What "weight"
  means when it is computed rather than authored is a real decision — card count per topic is
  the obvious one and it is defensible. Record it in §6.
- **`MasteryCard` already matches what the API can return** (`topicId`, `topicName`,
  `fsrs_state`, `stability`, `difficulty`, `last_reviewed_at`). Check whether `useCards`
  returns those fields; if it does not, widening it is part of this task.
- **`sampleMasteryAnswers` stays until task 4.** The diagnostic's exam signal has no source
  yet, and this is the seam where §3's rule gets tested: **do not blend real cards with
  fixture answers into one number that looks computed.** Either the exam signal is absent
  from the display and the UI says so, or task 4 lands first.

Files: `src/features/blueprint/BlueprintPage.tsx`, `src/features/plan/DiagnosticPage.tsx`,
`src/lib/queries.ts`.

### Task 4 — `answers`: the exam's write path

**A new table, so [ADR 0008](../adr/0008-application-level-tenancy.md)'s four rules apply in
full and a data-access module is mandatory.** Migration `0008_answers.sql`.

Shape it from what `MasteryAnswer` already needs, not from what an exam UI happens to hold —
the consumer is the mastery calculation.

- `user_id uuid not null`, and every index leads with it.
- A topic reference, nullable, `on delete set null` — matching `cards.topic_id`'s reasoning:
  deleting a topic must not delete the record that someone answered a question about it.
- Correctness, and enough of the question to be worth keeping. **Decide whether an answer
  stores the question text or references a card**, and say why in §6: a card can be edited or
  deleted after the fact, and an answer that silently changes meaning is worse than one that
  duplicates a stem.
- **Append-only, like `reviews`.** An exam result that can be rewritten is not evidence.
  `0001_schema.sql`'s reviews table is the precedent; follow it.

`npx supabase db push` is **not** how this is applied — that is the Supabase project.
`npm run db:migrate`, after `--dry-run`, after reading the SQL yourself. There is no test
suite behind a migration any more (ADR 0005).

Files: `services/api/migrations/0008_answers.sql`, `services/api/src/data/answers.ts`.

### Task 5 — The exam records what happened

The runner grades in the browser and forgets. Give it a write path and the diagnostic a real
signal.

- `POST /exams/{id}/answers` or equivalent — one round trip at submission, not one per
  question. Declared in both route files.
- The diagnostic's `sampleMasteryAnswers` import goes, replaced by the user's own.
- **A user who has never sat an exam has no answers, and that is the common case.**
  `src/lib/mastery.ts` must degrade to "retention known, application unknown" rather than
  computing a confident number from nothing. **Read what it does with an empty array before
  assuming it is safe** — a mastery score that reads 100% because nobody has been tested is
  the §3 failure with arithmetic in front of it.

Files: `services/api/src/handlers/`, `scripts/dev-api.mjs`, `infra/lib/api-stack.ts`,
`src/features/exam/`, `src/features/plan/DiagnosticPage.tsx`.

### Task 6 — The exam runner, and being honest about what is still fixture

`SAMPLE_EXAM` is a hand-written set of questions about cloud architecture. Generating an exam
from the user's own cards is model work — it is Phase C's substance, not a plumbing task —
and task 1 recommends **not** doing it here.

So this task makes the *state* honest rather than the content real:

- The runner sits a real exam **when there is one to sit**, and the questions come from the
  user's cards by whatever mechanism exists (MCQ cards are already questions; a deck of basic
  cards is not an exam and should say so).
- If generation is deferred, **the screen says the exam is a sample, in the UI, where a user
  reads it** — not in a comment. A sample exam a user can tell is a sample is a demo asset; a
  sample exam presented as theirs is the failure §3 names.
- `fixtures.ts` survives only if something reads it. Otherwise it goes.

Files: `src/features/exam/`, and `src/features/exam/fixtures.ts` (edit or delete).

### Task 7 — Run it. Every screen, twice.

DS1's §7 and DS2's found bugs that no `verify` could see, both times by running the thing.
This phase's version has a specific shape, because the failure mode is about *whose* data:

1. **A fresh account with nothing.** Sign up, open the blueprint, the diagnostic and the
   exam. **Nothing may render fixture content and nothing may 500.** This is the reviewer's
   view and it is the one most likely to be broken.
2. **An account with one ingested document.** Topics appear, weights are computed from real
   cards, and the numbers are *the user's*. Read them — a weight that looks plausible is not
   the same as a weight that is right.
3. **Sit an exam and check the row landed.** Count it in the database, do not assume.
4. **The cross-tenant probe, again, on every new endpoint.** Two accounts. Account A must not
   see B's topics, B's answers, or B's counts. `check-data-access.mjs` checks shape, not
   meaning — a function that takes `userId` and ignores it passes every gate here.
5. **Delete a topic that has cards and answers**, and confirm both survive unfiled rather
   than disappearing.

**Write down what happened, including what broke.** Under ADR 0005 that transcript is the
verification.

### Task 8 — Documentation

1. **SPEC §4.6's affordance table** — whichever rows this phase closed, closed; whichever
   remain, still stated honestly. **Do not mark a row done because the plumbing exists**;
   mark it done when a user sees their own data.
2. **SPEC §5** gets `answers` if task 4 built it, with the append-only reasoning.
3. **The five-variable seam grep** — comments only:
   ```
   grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER\|EMBEDDING_PROVIDER' \
     src/ services/api/src/handlers/
   ```
4. **An ADR if task 4's shape was a real decision** — how an answer references a question is
   the kind of thing a later phase will want the reasoning for.
5. **The board** — DS3 complete, DS4 next.
6. **Write DS4's plan**, per the convention. It is the last task of every plan.

---

## 5. Acceptance criteria

Observable, in order of what they prove:

1. **A fresh account with no cards sees an honest empty state on all three screens** — no
   fixture content, no 500, no confident number computed from nothing. The most important
   criterion here, for the same reason DS2's criterion 2 was.
2. The blueprint's topics and weights are computed from the signed-in user's own cards.
3. The diagnostic's card signal is the user's own review history.
4. An exam's answers are persisted and the diagnostic reads them (if tasks 4–5 landed), or
   the exam signal is visibly absent rather than faked (if they did not).
5. **No screen imports a fixture as a fallback.** Verified by reading the imports.
6. Every new endpoint filters `user_id` on every table it touches. Verified by reading the
   query, then by the two-account probe.
7. `npm run verify` is green, including `check:data-access` and `check:routes`.
8. The five-variable seam grep returns nothing but comments.
9. `JOB_STORE=dynamo` and `PIPELINE_RUNNER=sfn` still typecheck; `jobs-dynamo.ts` and
   `pipeline-sfn.ts` are still byte-identical to what P10 wrote.

---

## 6. Decisions recorded

**Written 2026-09-07, after execution.**

**How far this phase went (task 1).** The recommendation was taken unchanged: the blueprint
and the diagnostic came off fixtures, `answers` was built with a write path, and exam
*question generation* stayed deferred with the UI saying so. Nothing was added to that scope
and nothing was dropped from it.

**What a computed blueprint weight means: a topic's share of the user's active cards.**
There is no generator inferring weights from the material yet — that is Phase C — so what
exists instead is the distribution the ingestion pipeline already produced: chunks that said
more about networking yielded more networking cards. Card share is therefore a
*measurement* of how much of the user's material each topic occupies, which is a weaker
claim than a generated blueprint makes and an honest one. Two alternatives were rejected:
equal weights say nothing and would be a fixture with extra steps; weighting by *weakness*
conflates the two things `blueprint.ts` deliberately keeps apart, since `TopicDifficulty` is
a property of the material and mastery is a property of the learner — a blueprint that
reweighted itself as the student improved would stop describing the exam. The banner states
the definition on screen, because "24%" counted and "24%" inferred are different claims
wearing the same glyph. **Difficulty is uniformly `medium`** for the same reason: nothing
measures how hard the material is, and inventing a spread from card counts would be exactly
the plausible-wrong-number §7 warns about.

**Untopiced cards get an "Unfiled" bucket, counted rather than excluded.** Dropping them
would make every other weight too large: a share of the topiced cards presented as a share
of the exam is a plausible wrong number. It sorts last rather than by size — it is a
residue, not a topic, and putting it first when it happens to be the largest bucket would
read as the user's main subject. It carries the id `'unfiled'` rather than a uuid, so
nothing can mistake it for a topic it could file cards under.

**`answers` stores the question text *and* references the card, with the snapshot as the
authority.** Full reasoning in [ADR 0013](../adr/0013-answers-snapshot-the-question.md).
Briefly: referencing alone means an edited card silently changes what a past answer meant
and a deleted card erases exam history; storing the stem alone severs the answer from the
material that "generate cards from misses" needs. The topic *name* follows the opposite rule
from the stem — the live name wins where the topic still exists — because a stem is evidence
and a topic name is a label on a grouping.

**With no exam history the mastery calculation degrades correctly, and this was checked
rather than assumed.** `topicMastery` over an empty answers array returns `exam: null`,
`divergence: null`, and `score` falling back to retention alone. It does not compute a
confident number from nothing, and it does not read 100% because nobody has been tested. The
UI carries the other half: the banner says the exam signal is missing and that the scores
rest on recall alone, rather than letting the heading's promise of "your reviews and exams
together" stand over a retention-only number.

**One fixture survived: `src/features/exam/fixtures.ts`**, read by `ExamPage` for
`SAMPLE_EXAM`. `src/features/blueprint/fixtures.ts` was deleted outright — nothing read it
once the blueprint and diagnostic were wired. The surviving one is declared on screen:
`ExamSetup` takes an `isSample` prop and says the questions are not the user's own, and
`answersFromResult` nulls fixture topic ids rather than storing pointers to rows that do not
exist.

**One decision the plan did not anticipate: untopiced *answers* are excluded from the
mastery map.** Running it found that `topicMastery` buckets by `topicId ?? topicName`, so a
sample exam's answer carrying `topicName: 'Networking'` with a null id keys under the *name*
while the cards key under the *id* — rendering one topic as two rows, "Networking 0%" above
"Networking 97%", with `diagnosisFor` then headlining the 0%. Answers with no topic id are
therefore dropped from the mastery input. They are still recorded and still counted in
`total`, so the banner knows an exam was sat; they simply cannot name a weakness, because
they are not attached to anything with a name.

---

## 7. What went unverified

**Written 2026-09-07, after execution.** The plan predicted these; what follows is what
actually held and what did not.

**The blocking limitation, stated first: nothing was driven over HTTP.** `scripts/dev-api.mjs`
verifies real Cognito tokens against live JWKS, and this machine has no demo credentials
(`DEMO_EMAIL` / `DEMO_PASSWORD` are absent from `.env.local`), so no token could be minted.
The handlers were instead invoked directly with the event shape the API Gateway authorizer
produces. **Everything except JWT verification and API Gateway's own path routing ran for
real, against live Neon** — the data layer, the handlers, the status codes, the tenancy
filters. What is *not* proven: that the routes resolve, that CORS is right, and that a real
token's `sub` reaches `requireUserId`. The route tables are identical in both files
(`check:routes`, 28 routes), which is evidence about declaration rather than about
resolution.

**Nothing was verified in a browser.** No screen was rendered. The empty states, the
banners, the `isSample` notice and the blueprint's editing controls are typechecked and
argued for, not seen. Given that this phase's most important criterion is what a fresh
account *sees*, this is the largest gap in it.

**What was run, and it found two real bugs:**

- **The `on delete set null` deadlock.** `0008`'s append-only trigger refused every update,
  and Postgres implements `on delete set null` as an UPDATE — so deleting a card or topic
  that had been examined failed outright, contradicting the same migration's own argument.
  Fixed in `0009`. Nothing but running it would have found this before a user deleted a deck.
- **The split topic and the contradictory headline.** Untopiced answers bucketed by name
  while cards bucketed by id, rendering one topic as two rows and making `diagnosisFor`
  announce "Networking is the weakest topic at 0%" directly above a row reading 97%. Fixed
  by excluding untopiced answers from the mastery input; recorded in §6.
- **The arithmetic was checked, not eyeballed.** 12, 6, 2 and 3 unfiled cards over 23 gave
  52%, 26%, 9% and 13% against exact shares of 52.17%, 26.09%, 8.70% and 13.04%, summing to
  exactly 100 via largest-remainder. That is one distribution, not a proof of the rounding.
- **The cross-tenant probe passed on both new endpoints**, against live Neon: two users,
  each seeing only their own topics, counts and answers; user B posting an answer that named
  user A's topic id had it stored as null rather than attached. **It is a handful of paths,
  not a proof** — `check-data-access.mjs` checks shape, not meaning, and a function that
  takes `userId` and ignores it still passes every gate here.
- **Deleting a topic with cards and answers** left 12 cards unfiled and all 3 answers intact.
- **The append-only trigger refuses a real rewrite**, verified by attempting one (`PT403`).

**Still unverified, and named rather than implied:**

- **The empty states were verified by one empty account through the data layer**, not by
  looking at the screens they render.
- **The exam runner's questions remain a fixture**, and the UI's honesty about it is the
  only thing standing between a demo asset and a lie. That honesty is a prop and a paragraph
  no one has read on screen.
- **`useTopics` is not notebook-scoped.** It returns *all* the user's topics, while the
  blueprint claims to describe one notebook. With one notebook they coincide; with two, a
  blueprint will include topics whose cards live elsewhere. Noted here rather than fixed
  because scoping topics to a deck is a schema question — `topics` has no `deck_id` — and
  inventing one late in a phase is how a shape gets decided by accident. **DS4 takes this.**
- **Nothing checks that a weight is *right*, only that it is arithmetically consistent.**
  Whether card share is a good proxy for exam emphasis is a product judgement no test could
  settle.
