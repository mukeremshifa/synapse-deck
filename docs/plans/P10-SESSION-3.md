# P10, session 3 — take off from here

> **⚠ Superseded for status by [P10-SESSION-4.md](P10-SESSION-4.md).** Tasks 7, 8, 9 and 11
> are done; the "your first move" list below is stale. The pipeline design reasoning here
> is still accurate and still worth reading.

The handover from session 2 (2026-09-06). Session 2 did tasks 2, 3, 4, 5 and 6, applied a
destructive migration, and closed criterion 7. Read this, then
[P10-ingestion.md](P10-ingestion.md).

---

## The one-paragraph version

The pipeline exists end to end in code: S3 upload → job in DynamoDB → Step Functions Map
over chunks → per-chunk retry → job polling → the review gate, which now reports what
failed. **None of it has ever run in AWS**, nothing is deployed, and **no model has ever
been called** — the provider behind D6's interface is a deliberate stub. Your job is tasks
7 onward, and the biggest open question is not a task at all: it is whether a real model
provider can be reached.

---

## Get the backend up

```bash
pg_isready                    # PG 18 on :5432
npm run db:migrate:status     # expect: 3 applied, 0 pending
npm run dev:api               # the API on :8787
npm run dev                   # the SPA on :5173
```

If `db:migrate:status` fails with a SASL/password error, the runner needs the standard
names exported — `.env.local` deliberately carries `LOCAL_PGPASSWORD` so that loading it
does not repoint every psql in your shell:

```bash
export PGUSER=synapsedeck_app PGHOST=localhost PGPORT=5432 PGDATABASE=synapsedeck
export PGPASSWORD="$(grep '^LOCAL_PGPASSWORD=' .env.local | cut -d= -f2-)"
```

The AWS CLI is at `C:\Program Files\Amazon\AWSCLIV2` and a shell opened before it was
installed will not see it. Prepend it rather than concluding it is missing.

**`npm run dev` will pick port 5174 if 5173 is taken, and that silently breaks CORS** — the
API and the upload bucket both allow `localhost:5173` only. Free the port rather than
accepting the new one.

---

## ⚠ The blocker, restated because it now blocks more than it did

**No model provider is reachable, and this is the thing to resolve before task 10.**

| Provider | Status as of 2026-09-06 | Who can clear it |
| -------- | ----------------------- | ---------------- |
| Bedrock — Anthropic | `ValidationException`: country not supported. Calls originate from the UAE (`217.165.20.44`) | **Owner's decision.** Not a code or IAM change |
| Bedrock — Nova | `NOT_AUTHORIZED` — an ordinary model-access grant, never requested | **Owner**, one click in the Bedrock console |
| Groq | `GROQ_API_KEY` has only ever been a **Supabase Edge Function secret**. P2 explicitly required it never appear in `.env.local`, and README:26 says the Edge Function has never been deployed with one | **Owner** — and it needs P2's policy revisited |

Account verification (session 1's second blocker) **has cleared**. Nova's remaining blocker
is a grant, not a policy question — that is the cheapest path to a real model, and it is a
console click.

**Re-check before assuming:**

```bash
export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
aws bedrock get-foundation-model-availability --region us-east-1 --model-id amazon.nova-lite-v1:0
```

### The stub, and why it must not become permanent

`CARD_PROVIDER=stub` generates **placeholder cards**. Four defences keep it visible, and
they were verified rather than assumed:

1. `resolveProvider()` has **no default** and throws on unset, empty, a bogus name, and on
   both `bedrock` and `groq` (not yet implemented). There is no path that reaches the stub
   without naming it.
2. Cards say `[STUB CARD — not real content]` in text a user reads.
3. Every chunk record carries `provider: 'stub'`.
4. **Both the upload page and the review gate warn** when a job's providers include it.

Do not weaken any of these to make a demo look better. The point of the stub is that it is
impossible to mistake for real output.

---

## What session 2 built

Five commits on `aws-native` (`a1a9b59..f26826b`), all pushed.

| Commit | What |
| ------ | ---- |
| `4457c03` | DynamoDB job state, keyed by owner. Task 2 |
| `5181686` | Task 2 write-up + Bedrock re-test |
| `0c683e7` | S3 presigned upload, `/create/document`. Task 3 |
| `ca9fb99` | **`cards.status = 'draft'` removed, migration applied.** Task 4 |
| `f26826b` | Step Functions fan-out, job polling. Task 5 |

Task 6 and this handover are uncommitted at the time of writing; they land together.

### The three things most worth knowing

**1. A retry trap was found by reading the synthesised template.** The brief's §6 trap 4 is
literally "a Step Functions retry loop calling Bedrock". CDK's `LambdaInvoke` adds a
*default* retry of `MaxAttempts: 6` on Lambda service errors — stacked on the explicit
3-attempt policy, one chunk could have made **up to 18 model calls**. `retryOnServiceExceptions:
false` removes it. **When you add a state to this machine, check the synth for the same
thing**; the default is silent and it is per-task.

**2. Chunk text does not travel through the state machine.** Step Functions caps a payload
at 256 KB, and a 40-chunk document is ~140 KB of text before the Map duplicates context per
iteration — so the obvious design works on small documents and fails on exactly the large
ones the pipeline exists for. Text lives in DynamoDB; the Map carries
`{userId, jobId, chunkIndex}`. Do not "simplify" this back.

**3. The `draft` migration is applied and irreversible.** `card_status` is now
`active,suspended,archived` on RDS. `deck_status` **keeps** its own `'draft'` — a different
meaning ("generation finished, gate not passed"), still reachable, and now the only thing
marking a deck resumable. A grep for `'draft'` that takes the deck one with it will break
the way back into the review gate silently.

### The divergence you must not "fix"

`src/types/database.ts` is generated from **Supabase**, which keeps `'draft'` until Phase F.
It will report four `card_status` members while RDS has three. **This is expected.** It is
documented in `services/api/src/lib/rows.ts` next to the type it disagrees with. Do not
hand-edit a generated file to make them agree, and do not run `db:types` expecting it to
change.

---

## What is proven, and what is emphatically not

**Proven — actually executed:**

- All 18 P9 routes, with a real Cognito token (session 1), plus criterion 7 closed by the
  owner in a browser.
- The chunker, on nine input shapes: empty, whitespace, one short paragraph, 3/10/30
  paragraphs, a 30k-character paragraph with no breaks at all, one with sentences, and a
  document past the 40-chunk cap. Indexes contiguous, the cap truncating at exactly 40, and
  the overlap confirmed by tagging paragraphs and reading them back.
- The provider seam: all five unsafe `CARD_PROVIDER` values refuse.
- A 12-paragraph document through the stub: 6 chunks, 18 cards, **all 18 validating against
  the real `CardPayload` schema**, deterministic across runs.
- The data-access lint, in four directions, twice — after task 2 it knew DynamoDB only, and
  an `SFNClient` in a handler passed every gate until task 5 generalised it.
- Migration 0003, rehearsed twice inside `begin; … rollback;` before being applied — the
  happy path, and the refusal (a row set to `'draft'` makes it fail loudly rather than
  silently rewriting someone's unreviewed cards to `'active'`).

**Not proven — and it is most of the interesting part:**

- **Nothing is deployed.** The state machine has never executed. No Lambda has run in AWS.
  No DynamoDB write, no S3 read, no presigned URL ever used, no CORS rule ever exercised by
  a browser.
- The retry policy, the catch, the Map concurrency, and the idempotent execution name are
  **read from the synthesised template, never observed behaving**.
- `POST /jobs`, `GET /jobs`, `GET /jobs/{jobId}` have never served a request beyond
  returning 401 without a token.
- No real job has populated the partial-failure reporting. The logic was exercised against
  the response shape the handler builds, not a job that ran.

Say "typechecks and builds" for all of the above unless you run it yourself (ADR 0005).

---

## Two deliberate gaps, both recorded

1. **`readDocumentText` does not parse PDFs.** It reads the object as UTF-8 — fine for a
   `.txt` upload, noise for a real PDF. This is the same deferred dependency as task 3's
   scanned-PDF check: both need a PDF parser on the client or the server, and the owner
   chose not to take it in the session that built the upload path. **That function is the
   seam a parser slots into.** Acceptance criterion 2 is red because of it.
2. **`/create/text` still calls the Edge Function.** Task 9 moves it, and that is the commit
   where `src/lib/sse.ts` and `src/lib/ndjson.ts` get deleted —
   `supabase/functions/_shared/ingest.ts` re-exports them, so it is coordinated, not early.

---

## Your first move

1. **Re-check the Nova grant** (command above). If it is authorised, task 10 becomes
   reachable and is the highest-value thing you can do — it replaces the stub with a real
   model and turns a pipeline that compiles into one that works.
2. **If it is still `NOT_AUTHORIZED`, say so and pick a task that needs no model.** Tasks 7,
   8 and 11 are all reachable. Do not write Bedrock code you cannot execute — that is the
   failure mode this phase's preconditions exist to prevent, and session 2 held that line.

### Then, in the order I would take them

**Task 7 — topics.** The one with a real dependency behind it: D11 needs it and **Phase C
cannot start without it**. It is also the one that deserves an ADR, per the brief. Note the
constraint from `CLAUDE.md`: `topics` is a new table on RDS, so it needs a data-access
module with **all four rules on the day it is created** — a new table without one is a
cross-tenant leak, not a TODO. It needs a model for extraction, so it is partly blocked;
the *reconciliation* logic is the actual work and is testable without one.

**Task 8 — quota.** A product decision the plan says is yours, not the code's: what does a
document cost? "One document = 12 units" is the brief's illustration, not a decision. Two
constraints worth holding: charge by work done, not by button press; and the quota must be
checkable **before** the job starts, because refusing at chunk 30 of 40 after spending the
money is the worst version of it. It also moves `generations` off Supabase — update the
split table in `P9-aws-slice.md` when it moves.

**Task 10 — Bedrock behind the interface.** Blocked on model access; the seam is ready and
`services/api/src/lib/providers/` has the shape to fill in.

**Task 12 — the RDS checkpoint.** The one deploy this phase makes, and it is the moment all
of "not proven" above becomes provable. Worth planning deliberately rather than drifting
into: `cdk deploy SynapseDeck-Api-dev` creates RDS as a side effect (~$14/mo), so it is the
point where the credits start being spent.

---

## Still true, and still constraints

- **`main` is frozen.** `dev` and topic branches are yours; PRs and `main` are the owner's.
- **Do not deploy RDS until task 12's trigger.** `cdk deploy SynapseDeck-Api-dev` creates it
  as a side effect — `cdk diff` shows this plainly.
- **`ALERT_EMAIL` must be set** for any deploying `cdk` command, or P8's four budgets and
  the alert subscription are destroyed. It shows up in `cdk diff` as `[-]` lines.
- **A destructive migration needs the owner asked first**, every time. 0003 was approved
  explicitly; that approval does not extend to the next one.
- **There are no tests** (ADR 0005). "Typechecks and builds", never "tested" or "works",
  unless you ran it — and if you ran it, say what you ran.
- Credits: $140, expiring 2027-03-03. **$0 spent.** Sessions 1 and 2 added no billable
  resources.

### An environment quirk, so you do not chase it

`cdk synth` into the default `infra/cdk.out` fails on this machine with an `EPERM` renaming
a bundling temp directory. It is **pre-existing and environmental** — confirmed identical on
a clean tree at `a1a9b59` — and not a fault in any stack. `--output` to another directory
works fine:

```bash
npx cdk synth --output /tmp/cdkout
```
