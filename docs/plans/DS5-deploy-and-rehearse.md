# DS5 — Deploy, and walk the path

Phase 5 of [DEMO-SPRINT-BRIEF.md](DEMO-SPRINT-BRIEF.md), and the last of the demo sprint.
**Everything before this ran on `localhost`.** The product typechecks, builds, and — as of
DS4b — has been seen working in a browser against a local API and a Neon branch. None of
that is the thing a reviewer will open.

**Reference:** [DS4b §8](DS4b-surface-pass.md#8-what-this-phase-actually-found--executed-2026-09-07)
(what the first browser run found), [the brief §7](DEMO-SPRINT-BRIEF.md) (why DS5 is last
and must not be *later* than it sounds), [ADR 0005](../adr/0005-no-test-suite.md) (there are
no tests), [ADR 0008](../adr/0008-application-level-tenancy.md) (tenancy is a discipline now,
not a guarantee), `CLAUDE.md` (what this session may and may not deploy).

**Done when:** a URL exists that a stranger can open, sign up on, and walk from signup to
exam without touching a terminal — and someone has actually walked it, twice, and written
down what happened.

---

## 0. Read this first — the one decision this phase turns on

**`SynapseDeck-Api-dev` has never been deployed, and deploying it creates the project's
first billable line.** `infra/lib/api-stack.ts` puts its Lambdas in the isolated subnets of
`data-stack.ts` so they can reach RDS, which means deploying the API stack deploys **RDS**.
P9 deferred that deliberately: Cognito is free, the API stack is not.

So DS5 opens with a fork, and **the owner picks it — this is a decision, not a task:**

| Route | What ships | Cost | What it proves |
| ----- | ---------- | ---- | -------------- |
| **A. Full AWS** | `npm run infra:deploy` — Foundation, Auth, Data, Api on `dev` | An RDS instance, running | The architecture the whole AWS-native brief is about |
| **B. Frontend only** | Vercel serves the SPA; the API stays local | £0 | The product, but only on the demoer's machine |
| **C. Frontend + a hosted API that is not Lambda** | Vercel + the handlers behind any always-on host pointed at Neon | Small | The demo path, without RDS |

**Recommendation: A, if the owner is willing to pay for an RDS instance for the demo
window; otherwise C.** B is not a deploy — it is a laptop with a public front end, and it
fails the phase's own "done when" the moment the laptop sleeps.

**Do not deploy anything under route A without `cdk diff` first**, and do not run
`infra:deploy:prod` at all — that is owner-only, as is anything touching `main`
(`CLAUDE.md`). `infra:deploy` on **dev** is this session's to run once the route is chosen.

**If the owner has not chosen when this plan is picked up: stop and ask.** Every task below
except task 1 depends on the answer, and guessing wrong spends either money or the phase.

---

## 1. Preconditions

| Must be true | How to check |
| ------------ | ------------ |
| On `aws-native`, clean tree | `git status --porcelain` prints nothing |
| `verify` green | `npm run verify` |
| Neon reachable, nothing pending | `npm run db:migrate:status` |
| The app runs locally end to end | DS4b did this; re-confirm with one sign-in |
| **The route in §0 is chosen** | **Ask the owner. Do not infer it** |
| An AWS identity that can deploy | `aws sts get-caller-identity` — only for route A |

**A sign-in works and needs no owner.** DS4b established this and it is the single most
useful fact to inherit:

```
email:    ds4-demo@example.com   (CONFIRMED)
sub:      04b8c468-f0d1-7007-4764-f69cb10936db
flow:     SRP, via amazon-cognito-identity-js — the app's own path
```

`scripts/seed-demo.mjs` **still uses `USER_PASSWORD_AUTH`, which this pool refuses by
design.** That is what made DS4 believe it was blocked. Task 5 fixes the script; until then,
sign in the way the browser does.

That account owns two notebooks with distinct topics (`Cell biology`, `AWS architecture`),
built by DS4b through the API. They are on the **Neon dev branch** — under route A they do
not exist on RDS, and task 3 is where that is dealt with.

---

## 2. Out of scope

| Not this phase | Where it belongs |
| -------------- | ---------------- |
| Exam question generation from the user's cards | **Phase C** |
| Blueprint-aligned generation | The generation pipeline |
| "Generate cards from misses" | A generator feature |
| DS2's embedding key and grounded chat | Still unproven, still must not be made to look finished |
| A test suite | ADR 0005 stands |
| `main`, PRs, `infra:deploy:prod` | **Owner only**, always |
| A device matrix | DS4b checked 375px. One more width is not this phase's job |
| Re-polishing what DS4b fixed | It was observed. Leave it |

**This phase's budget is the rehearsal.** Tasks 1–5 exist to make task 6 possible; if
something overruns, cut scope from the deploy (route C over route A), never from the walk.

---

## 3. The rule this phase runs under

DS4b's rule still governs — **polish never makes what is false look true** — plus one that
belongs to deployment:

**A deployed thing that has not been opened is not deployed.** Every task below that ships
something ends with opening it in a browser, not with a green CLI. DS3 and DS4 wrote four
screens nobody looked at and DS4b found five defects in them; the same failure mode applies
to a stack whose `cdk deploy` succeeded.

---

## 4. Tasks

### Task 1 — Decide, and write the decision down

Take §0's fork to the owner if it is not already answered. Record the choice and the reason
in this file's §6 **before** deploying anything, so the next session inherits why the
architecture looks the way it does.

Under route A, run `npm run infra:diff` first and **read what it lists**. There is no test
suite behind CDK; `check` proving it compiles says nothing about the template.

### Task 2 — Ship the frontend

Vercel, per `vercel.json` (already correct: Vite framework, SPA rewrite, immutable asset
caching).

- `VITE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` as project env vars.
- **No secret key reaches the client.** `src/lib/env-schema.ts` refuses to boot on one and
  that refusal is now the only thing enforcing it (ADR 0005). Do not weaken it.
- The deployed origin must be added to the API's CORS allowlist, wherever the API ends up.
  DS4b hit the local version of this: `dev-api.mjs` hardcodes `http://localhost:5173`, and a
  second Vite on `:5174` would have failed every request.

**Then open the deployed URL and sign in.** Not the preview build — the real one.

### Task 3 — The database the demo runs on

Under **route A**, RDS is empty: migrations have never run there, and the demo account's
notebooks are on Neon.

1. `services/api/migrations/run.mjs` against the RDS connection string. Read
   `npm run db:migrate:status` output before and after.
2. Seed the demo account (task 5), or accept a signup-and-ingest walk as the demo.
3. **Say which database the demo is pointed at, in §6.** A demo running on Neon while the
   architecture diagram says RDS is a thing that gets noticed in the room.

Under **route C**, this is one connection string and nothing else changes — which is D2's
whole point (`PG*` names, nothing knows which Postgres it is talking to).

### Task 4 — Walk it cold

**The task the phase exists for.** On the deployed URL, in a browser with no session:

1. **Sign up as a new user** through the app's own form, and confirm the account.
2. **Ingest a document** — a real one, through `/create/document` or `/create/text`.
3. **The review gate** — accept cards.
4. **Practice** — rate a few.
5. **Exam** — sit one, submit, confirm the attempt lands.
6. **Diagnostic and blueprint** — confirm they reflect what just happened.

**Nothing may 500. Nothing may show another user's data.** Write down every rough edge, even
the ones you do not fix; DS4b's §8 table is the format.

**Then do it again on a phone**, at the real viewport, on the real URL. DS4b fixed four
mobile defects at 375px in Chrome's emulator — an emulator is not a phone.

### Task 5 — Fix `seed-demo.mjs`, or delete it

It cannot authenticate against this pool (§1). Two honest options:

- **Fix it**: `AdminInitiateAuth` with SigV4-signed credentials (the pool enables
  `ADMIN_USER_PASSWORD_AUTH` for exactly this), or SRP via the dependency the app already
  uses.
- **Delete it**, and make task 4's cold walk the way the demo account gets its data.

Do not leave it as it is. A script whose failure message misdiagnoses the problem cost DS4 a
whole phase — that is the concrete harm, and it is already in the record.

### Task 6 — Rehearse

Walk the path a second time **as a demo**, out loud, against the clock:

- What is said while a generation job runs — the pipeline is the slowest step and the most
  impressive one.
- **Where the product is inert, say so plainly.** SPEC §4.6's four affordances explain
  themselves when pressed; the demoer should reach them deliberately, not stumble into one.
- **Grounded chat has no embedding key.** Either set one before the demo or do not open the
  chat pane. Do not let it look finished (DS2, DS4b §1).

Write the path down as a numbered list someone else could follow.

### Task 7 — Documentation

1. **SPEC** — what is deployed, where, and what it costs.
2. **The board** — DS5 complete, and the demo sprint closed.
3. **An ADR if route A was taken**: RDS going live is an architectural fact, not a config
   change.
4. **What comes after the demo.** The sprint ends here; the AWS-native brief does not. Say
   which of its phases is next and why, or say the project pauses — but say something, so
   the next session is not guessing.

---

## 5. Acceptance criteria

1. A URL exists that a stranger can open and sign up on, without a terminal.
2. **The full path — signup → ingest → gate → practice → exam → diagnostic → blueprint —
   has been walked on that URL by a person**, and what broke is written down.
3. It has been walked once on a real phone.
4. Nothing 500s; no screen shows another user's data. The cross-tenant probe from
   [DS4b §8](DS4b-surface-pass.md#what-was-checked-and-found-already-correct) is re-run
   against the deployed API.
5. Which database the demo runs on is written down, and it matches what the demo claims.
6. `seed-demo.mjs` either works or is gone.
7. `npm run verify` green, including `check:data-access` and `check:routes`.
8. A written demo path a second person could follow.
9. Under route A only: `cdk diff` was read before deploying, and no `prod` stack was touched.

---

## 6. Decisions to record

- **Which route in §0 was taken, and why.** The cost trade-off is the interesting half.
- **Which database the demo runs on**, and whether that matches the architecture story.
- **What the cold walk found** — itemised, in DS4b §8's format. This is the phase's most
  valuable output and it will be tempting to summarise away once fixed.
- **What `seed-demo.mjs` became.**
- **What happens after the demo.**

---

## 7. What will go unverified

- **A rehearsal is not a demo.** The room asks different questions.
- **One phone, one browser.** Not a device matrix.
- **There are still no tests** (ADR 0005). `verify` proves the code builds. Say "typechecks
  and builds", never "tested".
- **Cross-tenant isolation is a discipline with a linter behind it** (ADR 0008), and
  `check-data-access.mjs` checks the shape of the code, not its meaning. A probe passing
  proves those paths, not the property.
- **Cold start in a VPC is still unmeasured** under route A — `api-stack.ts` has said so
  since P9, and deploying it is the first chance to find out.
- **Whatever is not walked stays unobserved.** DS4b is the evidence: five defects in code
  two phases had shipped, all found by opening a browser, none catchable by `verify`.
