# P10, session 2 — take off from here

The handover from session 1 (2026-09-06). Session 1 did tasks 1 and 1b of
[P10-ingestion.md](P10-ingestion.md) and stopped there deliberately, because two owner
decisions arrived that change what the rest of the phase builds.

Read this, then [P10-ingestion.md](P10-ingestion.md). **Two things in that plan are now
settled and this file supersedes them** — they are called out below, not buried.

---

## The one-paragraph version

Tasks 1 and 1b are done: the local backend runs, all 18 routes were driven with a real
Cognito token, and that found and fixed a timestamp bug that would have broken FSRS in
Safari. Your job is task 2 onward — DynamoDB job state, then S3 upload, then the pipeline.
**But Bedrock is blocked for reasons no amount of code will fix**, and the owner has ruled
that `cards.status = 'draft'` is to be cut. Both are settled decisions; act on them rather
than re-opening them.

---

## Get the backend up — three commands

```bash
pg_isready                    # PG 18 on :5432
npm run db:migrate:status     # expect: 2 applied, 0 pending
npm run dev:api               # the API on :8787
npm run dev                   # the SPA on :5173
```

`.env.local` now carries **`LOCAL_PGPASSWORD`** (not `PGPASSWORD`) for the
`synapsedeck_app` role, and `dev-api.mjs` bridges it — deliberately, so that loading that
file does not repoint every psql in your shell. If you run the migration runner directly,
export the standard names yourself:

```bash
export PGUSER=synapsedeck_app PGHOST=localhost PGPORT=5432 PGDATABASE=synapsedeck
export PGPASSWORD="$(grep '^LOCAL_PGPASSWORD=' .env.local | cut -d= -f2-)"
```

The AWS CLI is on the machine PATH (`C:\Program Files\Amazon\AWSCLIV2`) but a shell opened
before it was installed will not see it. Prepend it rather than concluding it is missing.

---

## ⚠ Bedrock is blocked. This is the big one.

**P10-ingestion.md's preconditions say to check model access before writing Bedrock code.
That check has now been run, and it failed — twice, for two independent reasons.**

Both were found by actually invoking, not by reading status fields. That distinction
matters: `get-foundation-model-availability` reports Haiku 4.5 as
`authorizationStatus: AUTHORIZED`, `entitlementAvailability: AVAILABLE`, and the model is
listed by `list-foundation-models`. **All of that is true and none of it means you can call
it.**

### 1. Anthropic models refuse the caller's country

```
$ aws bedrock-runtime invoke-model --region us-east-1 \
    --model-id anthropic.claude-haiku-4-5-20251001-v1:0 ...

ValidationException: Access to Anthropic models is not allowed from unsupported
countries, regions, or territories.
```

The requests originate from the UAE (`217.165.20.44`, Ras Al Khaimah — consistent with the
`Asia/Dubai` timezone P9 seeded). This is a `ValidationException` on the *request*, not an
IAM or entitlement problem, so **no policy change, no model grant, and no CDK code fixes
it.** It is about where the call comes from.

### 2. The account is unverified, which blocks *every* provider

```
$ aws bedrock-runtime invoke-model --region us-east-1 --model-id amazon.nova-lite-v1:0 ...

AccessDeniedException: Your account is currently being verified. Verification normally
takes less than 2 hours.
```

Amazon Nova is not an Anthropic model and it failed *differently* — so this is a second,
independent blocker sitting underneath the first. It may well have cleared by the time you
read this; **re-run the Nova invoke to find out** before assuming anything.

### ⟳ Re-tested 2026-09-06 (session 2). One blocker cleared, one did not.

**Account verification is done.** Nova no longer returns `AccessDeniedException: Your
account is currently being verified`. That blocker is gone.

**What replaced it is smaller and is the owner's to clear.** Nova now fails with:

```
ValidationException: Operation not allowed
```

and `get-foundation-model-availability` explains it — `authorizationStatus: NOT_AUTHORIZED`,
with `agreementAvailability: AVAILABLE`. That is an ordinary **model access grant** that
has not been requested: Bedrock console → Model access → enable Amazon Nova. It needs the
console, not code, and it is not a decision — just a click the owner has to make.

**The Anthropic restriction is unchanged and is not a grant problem.** Both
`anthropic.claude-haiku-4-5-…` and the `us.` inference profile still return:

```
ValidationException: Access to Anthropic models is not allowed from unsupported
countries, regions, or territories.
```

Calls still originate from `217.165.20.44` (UAE). Haiku 4.5 additionally shows
`agreementAvailability: NOT_AVAILABLE` / `authorizationStatus: NOT_AUTHORIZED`, but the
country check fires first, so granting access would not change the outcome.

**This is exactly the branch the plan said to stop at.** Nova's blocker is a grant the
owner can click; Anthropic's is geographic and routing around it is a policy question, not
a coding one. So, unchanged and stated plainly:

| Provider | Status | Who clears it |
| -------- | ------ | ------------- |
| Amazon Nova | `NOT_AUTHORIZED` — needs a model-access grant | **Owner**, in the console |
| Anthropic | Country restriction, before any grant applies | **Owner's decision**, not a code change |

Until one of those moves, `GROQ_API_KEY` remains what keeps the pipeline demonstrable, and
D6's provider interface remains the reason that is a swap rather than a rewrite.

### The owner's decision, and what it means for you

**The owner has said to keep Bedrock in `us-east-1`.** The region is not the variable being
traded away, so do not "solve" this by moving regions or switching provider on your own
initiative.

What that leaves, and it is genuinely the whole list:

1. **Re-test both invokes at the start of your session.** Account verification is
   time-bounded and may simply be done. The Anthropic country restriction is not.
2. **If Nova now works but Anthropic still refuses**, the account is verified and the
   remaining blocker is purely geographic. That is a decision for the owner — routing a
   request through somewhere else is a policy question, not a coding one. **Say so and
   stop.**
3. **Build everything that does not need a live model.** This is not a small residue:
   tasks 2, 3, 4, 5, 6 and 8 are all reachable, and D6's provider interface exists
   precisely so the model behind it can be swapped. `GROQ_API_KEY` is the fallback provider
   the brief already names, and it is what keeps the pipeline demonstrable while Bedrock is
   unavailable.

**Do not write code that assumes a successful Bedrock call and leave it untested.** That is
the failure mode the plan's precondition existed to prevent, and it is now a certainty
rather than a risk.

The commands, so you do not have to reconstruct them:

```bash
export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
echo '{"messages":[{"role":"user","content":[{"text":"say ready"}]}],"inferenceConfig":{"maxTokens":16}}' > nova.json
aws bedrock-runtime invoke-model --region us-east-1 --model-id amazon.nova-lite-v1:0 \
  --body fileb://nova.json --cli-binary-format raw-in-base64-out out.json
```

---

## ✂ `cards.status = 'draft'` is cut. The owner has decided.

P10-ingestion.md task 4 left this open — *"decide whether `cards.status = 'draft'` still
means anything after this phase"*. **It does not. Remove it.**

The reasoning is the plan's own: if drafts live in DynamoDB and only accepted cards are
written to Postgres, then no row is ever inserted with `status = 'draft'`. An enum value
nothing can produce is worse than no enum value at all — it invites code that handles a
state which cannot occur.

### What this touches — the full list, so nothing is missed

Session 1 grepped this out. Eight sites, on both sides of the split:

| File | What is there |
| ---- | ------------- |
| `services/api/migrations/` | **A new migration.** `card_status` drops `'draft'` |
| `services/api/src/lib/rows.ts:24` | The `CardStatus` union |
| `services/api/src/data/cards.ts:37-45` | `listDraftCards()` — the whole function |
| `services/api/src/data/cards.ts:182-196` | `acceptDrafts()`'s `and status = 'draft'` guard |
| `services/api/src/data/decks.ts:59` | `draft_count` in the deck-list aggregate |
| `services/api/src/handlers/cards.ts:121-127` | The `?status=draft` branch |
| `src/lib/queries.ts:591-595` | `useDraftCards()` → repoint at the job's drafts |
| `src/types/database.ts` | Regenerated, **not hand-edited** |

Removing a route (the `?status=draft` branch) means `dev-api.mjs` and `api-stack.ts` both
change — `npm run check:routes` will tell you if you forget one.

### Three traps in doing it

1. **The migration is destructive, and CLAUDE.md says ask first.** Postgres has no
   `DROP VALUE`: removing an enum member means creating a new type, migrating the column,
   and dropping the old one — and it **fails if any row still holds `'draft'`**. Check
   first (`select count(*) from public.cards where status = 'draft'`) and agree with the
   owner what happens to any that exist. There are none locally today, but the Supabase
   project is still live and still has its own copy of this enum.

2. **`src/types/database.ts` is generated from Supabase, not from RDS.** `npm run db:types`
   regenerates it against the *Supabase* project, which keeps `'draft'` until Phase F. So
   the client's generated type and the RDS schema will legitimately disagree. That is
   expected, not a bug to paper over by hand-editing a generated file — say which side is
   authoritative in the commit message.

3. **`decks.status = 'draft'` is a different thing and stays.** The deck enum has its own
   `'draft'`, meaning "generation finished, the review gate has not been passed"
   (`supabase/functions/generate-cards/index.ts:475-499`). That is the resumable gate state
   and it is still meaningful. **Only `card_status` loses its value.** Do not let a grep
   for `'draft'` take the deck one with it.

Write the decision into `SPEC.md` in the same commit — the plan asks for this, and it is a
change to what a "draft" is.

---

## What session 1 did, so you do not redo it

Four commits, pushed to `origin/aws-native` (`8622e12..5b82418`).

| Commit | What |
| ------ | ---- |
| `cb9cb4f` | `scripts/check-routes.mjs` — route parity, in `verify`. **Criterion 10 green** |
| `7048ea5` | `dev-api.mjs` bridges `LOCAL_PGPASSWORD` → `PGPASSWORD` |
| `c854e8e` | **Timestamps leave the API as ISO 8601.** The real bug |
| `5b82418` | Task 1 and 1b evidence written into the plan |

### The bug worth understanding before you touch the data layer

Every timestamp used to leave the API in Postgres's own format —
`2026-09-06 03:43:16.065206+04`, a space where ISO 8601 has a `T`. `src/lib/fsrs.ts` parses
`due` and `last_review` with `new Date()`. **That format is not one the ECMAScript
specification requires any engine to parse.** V8 accepts it, so Node and Chrome were fine
and nothing caught it; Safari has historically rejected it, where it becomes an
`Invalid Date` feeding the scheduler — which presents as FSRS being broken, not as a parse
error.

**The obvious fix is worse than the bug, and this is the part to remember.** `updated_at`
is the optimistic-concurrency token and `review_card` compares it as `$5::timestamptz`.
Postgres stores **microseconds**; a JS `Date` holds milliseconds. Parse-and-re-serialise
truncates `.065206` to `.065` and **every rating starts failing `PT409`**. So the
conversion in `services/api/src/lib/db.ts` is a pure string transform on the wire text that
carries the fraction across untouched. If you change anything there, the regression test is:
a rating with a millisecond-truncated token must still be refused with `PT409`.

### What is now proven that was not before

- **All 18 routes driven** with a real Cognito access token against `dev-api.mjs`.
- **Cross-tenant probes re-run as a real Cognito identity**, not P9's synthetic
  `1111…`/`2222…` users: `GET`, `PATCH`, `DELETE` and `POST …/cards` on another user's deck
  all return **404, never 403**; listing its cards returns `[]`.
- **Optimistic concurrency exercised for real**: stale token → `PT409`, millisecond-
  truncated token → `PT409`, correct token → the card graduates.
- **The row-shape mismatch task 1 predicted does not exist.** Every field `queries.ts`
  reads exists in the RDS schema with matching nullability; all five enums match
  member-for-member. Checked mechanically, not by eye.

### What is still not proven

- **A browser has still never rendered this.** Everything above ran from Node through
  `queries.ts` and `api-client.ts`. The network contract is evidence; React Query's cache
  keys, the optimistic updates in `useReviewCard`, and the forms are not. **Criterion 7 is
  deliberately left amber.** Ten minutes at `localhost:5173` closes it, and it is the last
  place a P9-era bug can hide.
- Everything deferred to the RDS checkpoint (task 12): API Gateway's routing and
  authorizer, PG 17 rather than 18, cold start.

---

## Your first move

1. **Re-run both Bedrock invokes** (commands above). The answer changes the shape of your
   session, so find out before planning it.
2. **Ten minutes in a browser** at `localhost:5173`, to close criterion 7 honestly.
3. **Then task 2** — DynamoDB job state, which needs no model and is where Phase B actually
   begins.

Task 2 is unaffected by both decisions above, which is why it is the right place to start
regardless of what Bedrock says. Its detail is in [P10-ingestion.md](P10-ingestion.md); the
parts worth repeating are that `userId` is the **partition key** (not a filter — it makes
tenancy a property of the key), that job records need a **TTL**, that DynamoDB needs a
**free gateway VPC endpoint** or SDK calls from a VPC Lambda hang until they time out, and
that `scripts/check-data-access.mjs` must be **extended to catch `DynamoDBClient` /
`send(` in a handler** — a DynamoDB call in a handler is exactly as wrong as SQL in one,
and the lint was never taught about it.

## Still true, and still constraints

- **`main` is frozen.** `dev` and topic branches are yours; PRs and `main` are the owner's.
- **Do not deploy RDS** until task 12's trigger. `cdk deploy SynapseDeck-Api-dev` creates it
  as a side effect — `cdk diff` shows this plainly.
- **`ALERT_EMAIL` must be set** for any deploying `cdk` command, or P8's four budgets and
  the alert subscription are destroyed. It shows up in `cdk diff` as `[-]` lines.
- **There are no tests** (ADR 0005). Say "typechecks and builds", never "tested" or "works",
  unless you actually ran it — and if you ran it, say what you ran.
- Credits: $140, expiring 2027-03-03. **$0 spent.** Session 1 added no billable resources.
