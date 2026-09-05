# P8 — AWS foundation

The first AWS phase. It deploys **one trivial thing end to end** — a Lambda behind a
function URL that returns its own version — and wraps it in everything every later phase
will inherit: two CDK stacks, a GitHub Actions role assumed by OIDC with no long-lived
keys, budgets, alarms, log retention, tracing and cost-allocation tags.

Nothing about the product changes. `dev` still runs on Supabase and Vercel and still
works, exactly as [AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md) §12 requires until a later
plan says otherwise.

**Reference:** the brief's D7 (CDK from the first resource), D8 (Actions + OIDC), D9
(observability ships first), §6 (cost), §8 constraints 3 and 4.

**Done when:** `npm run verify` is green with `infra/` in the repo; a push to the branch
runs CDK synth in CI without any AWS secret in the repository; the owner can run one
deploy command and reach a live URL that returns JSON; and the AWS console shows a
dashboard, a budget, an alarm, and a log group with a retention that is not
"never expire".

**Why this phase exists at all, given it ships no feature.** The brief's D9 is the whole
argument: governance cannot be retrofitted honestly. A dashboard added after the first
incident is a worse artifact than a dashboard the first deploy had, and a budget added
after a surprise bill is not a budget. This is also the phase that proves the deployment
path works while the thing being deployed is trivial enough that a failure is
unambiguous — every later phase gets to debug its own logic rather than its pipeline.

---

## Preconditions

```bash
git branch --show-current      # dev, or the long-lived AWS branch created in task 1
git status                     # clean
npm run verify                 # green before anything is added
```

- **`origin/dev` is in sync.** The brief's §9 recorded local `dev` as 16 commits ahead
  with nothing pushed; that is **resolved** — `origin/dev` is at `45af283` and
  `git rev-list --left-right --count origin/dev...dev` reports `0 0`. The brief's §9 and
  §8 constraint 7 are satisfied on the git half.

- **The Vercel half of §9 is not, and it does not block this phase.** Vercel has still
  never been connected, so there is no deployed "before". The brief wants one and the
  owner's list below carries it, but Phase 0 touches no frontend and no Vercel
  configuration, so it is a parallel errand rather than a gate. **Phase A must not start
  without it** — that is where "before and after" stops being decorative and starts being
  the only way to tell whether the migration lost anything.

- **Owner-only, and this phase cannot finish without all four.** None of these are things
  a session can do:

  | #   | What                                                                                                                                                                        | Why it is the owner's                                     |
  | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
  | 1   | An AWS account with billing configured and the SBGL credits applied                                                                                                         | Account creation, payment method, credit redemption       |
  | 2   | A named region, decided once and written into this plan. **`us-east-1` unless the owner says otherwise** — every figure in the brief's §6 is on-demand `us-east-1`           | A region change reprices the whole project                |
  | 3   | AWS CLI installed and a profile configured locally. **`aws` is not on PATH on this machine** — verified 2026-09-05                                                           | Credentials                                                |
  | 4   | An email for budget and alarm notifications, and confirmation of the SNS subscription (AWS sends a link that must be clicked)                                                | Nobody else can click it                                   |

  Task order below is arranged so that everything a session can do — the whole CDK
  codebase, the workflow, the tooling integration — lands and typechecks **before** any of
  these are needed. Only tasks 8 and 9 actually call AWS.

- **Node 24, as CI uses.** CDK v2 supports it. `npx cdk --version` resolves 2.1140.0 on
  this machine, but the version that matters is the one pinned in `infra/package.json` by
  task 2 — do not depend on the globally resolved one.

---

## Out of scope — do not build these here

The failure mode of a foundation phase is building the second phase inside it. Each of
these is real work that belongs somewhere specific:

- **RDS, Cognito, API Gateway, VPC.** All Phase A. This phase deploys one Lambda with a
  function URL and **no VPC at all** — which is deliberate, because a VPC without a NAT
  Gateway needs endpoints, and endpoint selection is a Phase A decision made against real
  data paths rather than guessed at here.
- **Step Functions, S3 ingestion, Bedrock, DynamoDB.** Phases B and C. The per-job cost
  table (D9's last bullet) needs a job before it can account for one.
- **Any schema work.** `topics`, `questions`, `exams` are D11 and land in B and C. No
  migration is written here, and none is pushed.
- **Anything touching `src/`.** The frontend does not learn that AWS exists in this phase.
  If a task here seems to need a React change, it is the wrong task.
- **The repo restructure into `web/` and `services/`.** D1 wants it eventually; doing it
  now means one commit that moves every file in the project and makes the diff of every
  later phase unreadable against history. `infra/` is added alongside `src/`; the rest of
  the move happens when there is a `services/` with something in it. **Recorded as a
  decision below** so the next planner does not read the omission as forgetting.
- **CDK Pipelines** (D8's "interesting later addition"). A self-mutating pipeline is a good
  artifact and a bad first step — it wants a working plain deployment to mutate.
- **Deleting anything Supabase or Vercel.** Phase F, and not before.

---

## What already exists, and should be used rather than rebuilt

| Thing                                       | Where                                        | Note                                                                                                    |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The two-gate model                          | `scripts/check.mjs`, `scripts/verify.mjs`    | `infra/` joins these; it does not get a third gate of its own                                            |
| `tsc -b` project references                 | `tsconfig.json` → `.app.json`, `.node.json`  | `infra/tsconfig.json` becomes the third reference, which is what makes one `npm run check` cover it      |
| Whole-repo lint                             | `eslint.config.js`                           | Already flat config. `infra/` needs a block, because the base block sets `globals.browser`               |
| The CI split into two jobs                  | `.github/workflows/verify.yml`               | Branch protection requires each context separately — a deploy workflow is a **third file**, not a job    |
| The `spawnSync(process.execPath, …)` idiom  | `scripts/check.mjs` header comment           | Solves win32 `.cmd` shims and DEP0190. Any new script copies it rather than reaching for `npx`            |
| `.env.example` as the list a deploy needs   | repo root                                    | Extend it; do not start a second file that says the same thing differently                               |
| ADR format                                  | `docs/adr/0001-…`                            | Task 10 writes two of them                                                                               |

---

## Tasks

Ordered so the repo builds after every one, and so all the AWS-free work happens before
the first call that needs credentials.

### ✅ 1. Create the long-lived branch — no files

Per D1 and [ADR 0003](../adr/0003-branching-model.md) clause 2, this work spans many
sessions and gets a branch:

```bash
git switch -c aws-native dev
git push -u origin aws-native
```

`dev` keeps working throughout (§8 constraint 2). Every task below commits here. Merging
back to `dev` is a decision for the end of Phase F, not this phase — but the branch is
pushed from the first task so CI runs on it and the work is never only on one machine.

### ✅ 2. The CDK workspace — `infra/`

A **separate npm workspace**, not new dependencies in the root `package.json`. The frontend
does not need `aws-cdk-lib` in its lockfile resolution, and the root `package.json` is the
file every frontend session reads.

```
infra/
  package.json          aws-cdk-lib, constructs, aws-cdk (pinned exactly, no ^)
  tsconfig.json         composite: true; CDK wants node module resolution
  cdk.json              app: "node --experimental-strip-types bin/app.ts"
  bin/app.ts            stack instantiation, dev + prod
  lib/
    config.ts           per-environment configuration; the one place a magic number lives
    tags.ts             the three cost-allocation tags (D9)
    foundation-stack.ts the stack itself
```

Pin CDK versions **exactly**. A caret on `aws-cdk-lib` means the synthesised template can
change between a local synth and a CI synth, which is the one property this phase exists to
make trustworthy.

`cdk.json` runs the app through Node's native TypeScript stripping rather than adding
`ts-node` — the repo already uses `--experimental-strip-types` in `demo:seed`, and it is one
fewer dependency. **Verify this actually works with the pinned CDK before building on it**;
if CDK's bootstrapping fights it, `ts-node` is the fallback and the reason goes in a comment.

### ✅ 3. Configuration and tagging — `infra/lib/config.ts`, `infra/lib/tags.ts`

Two environments, `dev` and `prod`, differing in name and in nothing else yet. That is
correct and worth stating: **the point is that the difference is expressed in one place from
the first day**, so Phase A adds an instance size to a structure that exists rather than
inventing the structure while also inventing RDS.

```ts
export interface EnvConfig {
  readonly envName: 'dev' | 'prod';
  readonly account: string; // from CDK_DEFAULT_ACCOUNT, never hardcoded
  readonly region: string; // us-east-1 unless the owner said otherwise
  readonly logRetention: RetentionDays; // 7 days dev, 14 prod — D9
  readonly budgetThresholdsUsd: readonly number[]; // [2, 5, 10, 15] — D9
  readonly alertEmail: string; // from context, not committed
}
```

`tags.ts` applies `project`, `env` and `owner` at the **App** level via `Tags.of(app)`, so
every resource in every stack inherits them and no future resource can forget. D9 asks for
this; it is the cheapest thing in the phase to get right and the most annoying to retrofit —
untagged resources are invisible in Cost Explorer forever after.

The alert email comes from CDK context (`-c alertEmail=…`) or an environment variable, and
**is not committed**. A personal email in a public repo is a spam magnet, and the repo is
the owner's public portfolio piece.

### ✅ 4. The trivial deployed thing — `infra/lib/foundation-stack.ts`

One Node.js Lambda with a function URL, returning JSON: the stack's environment name, the
CDK version it was synthesised with, and the git SHA passed in at build time.

It exists to make the deployment path falsifiable. A version endpoint that answers with the
SHA you just pushed proves the whole chain — synth, assume-role, deploy, invoke — in one
`curl`, and it stays useful for the rest of the project as the answer to "which build is
actually live".

- `NodejsFunction` or a plain `Function` with inline code — **prefer plain inline**, since
  `NodejsFunction` pulls esbuild into the deploy path for eight lines of handler.
- Architecture `arm64` (Graviton — cheaper, and the default worth establishing now).
- `tracing: Tracing.ACTIVE` (D9, X-Ray).
- `logGroup` constructed **explicitly** with the retention from config. Letting Lambda
  create its own log group is exactly how the never-expire default creeps in — D9's third
  trap, and the one that silently costs money.
- Function URL with `authType: NONE`. It returns a version string and nothing else. Note in
  a comment that this is the _only_ resource in the project with unauthenticated access and
  that Phase A's API Gateway is not to copy it.

### ✅ 5. Observability — in the same stack, not a later one

D9's list, all of it, in this phase:

- **A CloudWatch dashboard** with the Lambda's invocations, errors, duration p50/p99, and
  throttles. Four widgets is enough; a dashboard nobody reads is worse than none.
- **Alarms** on error count and on p99 duration, both to an **SNS topic** the owner's email
  subscribes to. The subscription confirmation is owner item 4 above.
- **A DLQ** on the Lambda, with an alarm on `ApproximateNumberOfMessagesVisible > 0`. D9
  asks for "a deliberate story for what lands in it" — for a version endpoint the honest
  story is _nothing ever should_, which is precisely why an alarm on it is meaningful
  rather than noise.
- **Log retention** from config on every log group. The stack should have no `LogGroup`
  without an explicit retention; if that is not enforceable in code, it goes in the ADR as
  a review rule.

### ✅ 6. Budgets — `infra/lib/foundation-stack.ts` or its own construct

`AWS::Budgets::Budget` at **$2 / $5 / $10 / $15** (D9), notifying the same SNS topic and the
owner's email. Both `ACTUAL` and `FORECASTED` at each threshold — forecast is what gives
warning while there is still time to act, which is the entire point at these amounts.

**Budgets are global (`us-east-1`) regardless of where the rest of the stack lives.** If the
owner picks a different region in precondition 2, the budget construct still targets
`us-east-1` and that asymmetry needs a comment, or the next session will "fix" it.

§8 constraint 4 requires this to exist **before the first billable resource**. Since the
Lambda in task 4 is billable, the deploy in task 9 is the first time anything costs money
and the budget goes up in the same `cdk deploy`. Deploying the Lambda in one session and the
budget in the next violates the constraint even though both land in this phase.

### ✅ 7. Tooling integration — the repo's gates must cover `infra/`

This is the task that is easy to skip and expensive to skip. **`npm run check` and
`npm run verify` must typecheck and lint `infra/`**, or the CDK code is a second codebase
nothing gates — the exact situation that made the Edge Function break CI while `verify`
stayed green locally (see the comment in `verify.mjs`).

- `tsconfig.json` — add `{ "path": "./infra" }` to `references`. `infra/tsconfig.json` needs
  `composite: true` for a project reference to work.
- `eslint.config.js` — add a block for `infra/**/*.ts` with `globals.node`. The base block
  sets `globals.browser`, so without this every `process` reference is a lint error. **Do
  not** add `infra` to the top-level `ignores`; that is the tempting fix and it is the wrong
  one.
- `scripts/check.mjs` — `lintable()` already accepts any `.ts` outside `supabase/functions/`,
  so changed CDK files are picked up with no change. **Verify this rather than assuming it**,
  since the whole task is about not having an unlinted second codebase.
- Root `package.json` — add `"workspaces": ["infra"]` and scripts: `infra:synth`,
  `infra:diff`, `infra:deploy` (dev), `infra:deploy:prod`. Keep them thin — they shell into
  `infra` and nothing more.
- Confirm `npm run verify` still runs in roughly its current time. If CDK synth is added to
  `verify` it will not; **synth belongs in CI (task 8), not in the local gate.**

`npm run build` must be unaffected — Vite still builds only `src/`.

### ✅ 8. CI — `.github/workflows/infra.yml`, a new file

A **separate workflow**, for the same reason `typecheck-edge-function` is a separate job:
branch protection requires contexts independently, and `verify.yml`'s comment says
deployment is deliberately not in it.

Two jobs:

1. **`synth`** — runs on every push to the branch and on PRs. `npm ci`, then `cdk synth` for
   the dev stack. **No AWS credentials needed** for synth as long as the stacks are
   environment-agnostic or account/region come from context. If synth turns out to need a
   lookup that requires credentials, that is a signal the stack is doing something Phase 0
   should not — remove the lookup rather than adding credentials.
2. **`deploy-dev`** — `workflow_dispatch` only, at least in this phase. Assumes a role via
   **OIDC** (`permissions: id-token: write`), never a stored access key. D8 is explicit, and
   it is a real security talking point precisely because the alternative is so common.

The IAM role, its trust policy scoped to this repository and branch, and the GitHub OIDC
identity provider are **owner-created via CDK bootstrap plus a one-time manual step** — a
role that grants deployment permissions cannot bootstrap itself from a workflow that does
not yet have permissions. Document the exact trust policy in `infra/README.md`, including
the `sub` condition pinning it to
`repo:mukeremshifa/synapse-deck:ref:refs/heads/aws-native` rather than a wildcard. **A
wildcard `sub` on a public repository is the whole vulnerability.**

**Automatic deploy on push stays off in this phase.** The brief keeps `main` frozen and
deployment human-triggered; a self-deploying branch is a Phase F conversation once there is
something worth continuously delivering.

### ✅ 9. The first deploy — done 2026-09-06

Deployed to account `513774291123`, `us-east-1`, stack `SynapseDeck-Foundation-dev`.
Bootstrapped, deployed, and verified against AWS rather than against the source:

| Check | Result |
| ----- | ------ |
| Version endpoint returns the deployed SHA | ✅ matches `aws-native` HEAD exactly |
| Log retention, read from AWS | ✅ 7 days |
| Budgets | ✅ all four ($2/$5/$10/$15), ACTUAL + FORECASTED |
| Tags on the deployed Lambda | ✅ `project`, `env`, `owner` |
| SNS subscription | ✅ confirmed by the owner |
| **Error alarm actually fires and delivers** | ✅ 3 deliberate failures → ALARM, email sent, reset to OK |

**Still open, and neither is a session's to close:** cost-allocation tag *activation*
(AWS rejects activation until it has observed the keys in a billing cycle — retry after
2026-09-07), and the first real cost figure, which needs the same billing lag.

The function URL and account id are deliberately not repeated here; they are in the
owner's notes and in the CloudFormation outputs.

<details>
<summary>Original task text</summary>

The first call that spends money. In order:

```bash
npx cdk bootstrap aws://<account>/<region>     # owner, once per account+region
npm run infra:synth                            # session — no credentials needed
npm run infra:diff                             # session — read it, do not skim it
npm run infra:deploy                           # owner, or session with credentials present
```

Then, and this is the acceptance evidence rather than a formality:

- `curl` the function URL; it returns the SHA that was just deployed.
- Confirm the SNS subscription from the owner's inbox. Nothing alarms until this is done —
  an unconfirmed subscription fails silently, which is the worst possible property for an
  alerting system.
- Check the log group's retention **in the console**, not in the CDK source. The point is to
  verify the deployed reality, and this is the one D9 trap that looks fine in code.
- Force one alarm into ALARM state deliberately (invoke the Lambda with a payload that
  throws) and confirm the email arrives. **An alarm nobody has ever seen fire is a
  hypothesis, not an alarm.**
- Check the budget appears in the Billing console with all four thresholds.

Record the function URL and the account ID **in the owner's notes, not the repository.** An
account ID in a public repo is not a credential, but it is free reconnaissance.

</details>

### ✅ 10. Two ADRs — `docs/adr/0006-…`, `docs/adr/0007-…`

§8 constraint 6 requires two ADRs **before the code they justify**. Both are about Phase A
decisions, which is why they are written here — Phase A should open with the reasoning
already settled:

- **`0006-rds-dynamodb-split.md`** — D3. The access-pattern analysis: why the study loop is
  relational (due-cards-by-date across decks, review aggregation over time windows,
  `20260812210000_progress_stats.sql` as the existing evidence) and why job state is not.
  Include why _not_ Aurora Serverless v2 (ACU floor vs free tier) and why not Supabase
  Postgres (fails the brief's §1 division test). The brief calls this "the first thing a
  reviewer will ask to have justified".
- **`0007-cognito-for-identity.md`** — D4. Why Cognito over Clerk/Auth0 despite worse DX:
  removing a vendor from an AWS-native diagram, free to 10k MAU, and auth being the one
  component where switching later means re-migrating every identity. Record the mitigation —
  plain OIDC provider behind the app's own screens, not the hosted UI — and that `sub`
  becomes `userId` in Postgres, DynamoDB partition keys and S3 prefixes.

A third ADR for D11's schema is listed as conditional in the brief; **defer it to Phase B**,
where the schema is actually written and the contention (if any) is visible.

### ✅ 11. Documentation — the parts that would otherwise drift

- **`docs/plans/README.md`** — add the P8 row to the board and mark the AWS row as started.
  The board is the first thing a fresh session reads.
- **`infra/README.md`** — how to synth, diff and deploy; the OIDC trust policy in full; the
  region decision and why budgets are pinned to `us-east-1` regardless; and a plain
  statement that **`cdk deploy` costs money and `cdk destroy` deletes things**, in the same
  spirit as `CLAUDE.md`'s treatment of `db:push`.
- **`.env.example`** — the AWS-side variables that exist after this phase. Keep it as the
  single list of what a deploy needs.
- **`CLAUDE.md`** — add a short AWS section: `infra/` is CDK; `cdk deploy` is allowed on the
  dev stack the way `db:push` is allowed; `cdk destroy` and anything touching the prod stack
  are **owner-only**; no AWS credential ever enters the repository.

  **`CLAUDE.md`'s "RLS is the entire security boundary" line is not touched here.** It is
  still true — the live database still enforces it. D2 and §8 constraint 5 require it to be
  rewritten _by the phase that retires RLS_, which is Phase A. Rewriting it now would make
  the rulebook describe a system that does not exist yet, which is the same drift in the
  other direction.

- **`SPEC.md` is not touched.** §8 constraint 9 ties the §1 rewrite to the commit that first
  implements the new product loop; this phase implements none of it.

### ✅ 12. Write the next plan — `docs/plans/P9-aws-slice.md`

Per the convention, the last task of every plan writes the next. Phase A is the brief's
biggest and riskiest phase (5–8 sessions, D12's vertical slice), and it must be planned
against the CDK codebase this phase actually produced rather than the one it intended.

The P9 plan must open by settling, in writing:

- **Which tables and routes are on which backend, at every point** (D12's first bullet).
  This is the artifact that keeps the two-backend split from becoming permanent.
- **How D2's replacement authorisation is built and how it is checked.** The brief's own
  amendment calls this "the most important unbuilt thing in this document": the cross-tenant
  tests it depends on cannot be written, because there is no test runner (ADR 0005). **P9
  must either schedule the testing capability before the cutover, or state explicitly what
  is being accepted instead — and that is a decision to put to the owner, not one to settle
  inside a plan.**
- **The Lambda-in-VPC cold-start measurement** the brief's §6 flags as "a measurement for
  Phase A, not an assumption".
- Open questions 1, 4 and 5 from the brief's §7, all of which block Phase A or B.

---

## Acceptance criteria

Observable, in order of what they prove:

1. `npm run verify` is green on the `aws-native` branch with `infra/` present, and its
   runtime has not materially changed.
2. `npm run check` on a change to a file under `infra/` **lints and typechecks that file** —
   verified by deliberately introducing an unused variable there and watching it fail.
3. `.github/workflows/infra.yml`'s synth job passes on a push, **with no AWS secret
   configured in the repository.**
4. `cdk diff` against the deployed dev stack is empty after the deploy.
5. `curl <function-url>` returns the git SHA of the deployed commit.
6. The CloudWatch log group for the Lambda shows a retention of 7 days, read from the
   console.
7. A deliberately triggered alarm **delivers an email**.
8. The Billing console shows the budget with four thresholds, actual and forecasted.
9. Cost Explorer shows the resources tagged `project`, `env`, `owner`. (Tags can take up to
   24 hours to appear and must be activated as cost-allocation tags in the Billing console
   first — a manual step that is easy to miss and makes the tags useless until done.)
10. `docs/adr/0006` and `0007` exist and are linked from the board.
11. `dev` is untouched and the app still runs against Supabase.

---

## Decisions to record

Written back into this file or `SPEC.md` by the executing session, so the next one inherits
them rather than re-deriving them:

1. ✅ **Region: `us-east-1`**, settled 2026-09-05 with the owner working from the UAE.
   `me-central-1` (Dubai) was considered rather than defaulted past — it would cut ~300 ms
   of round-trip latency and lost on **Bedrock model availability**, which is materially
   broader in `us-east-1` and which D6 makes the project depend on. The brief's §6 costs
   hold unchanged. Two UAE-specific notes that do not change the decision: AWS charges 5%
   UAE VAT on the bill, and credits generally cover the service charge rather than the tax,
   so a small real charge inside the credit window is expected rather than a misfire. Tax
   settings go in the Billing console. Recorded in `infra/lib/config.ts` and
   `infra/README.md`.
2. ✅ **`--experimental-strip-types` drives `cdk.json` cleanly**, verified on Node 24.19.0
   against `aws-cdk-lib` 2.268.0 — no `ts-node`. **One constraint follows and it is now a
   rule in `CLAUDE.md`: nothing in `infra/` may _declare_ a TypeScript `enum`**, because
   strip-only mode rejects it with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. _Consuming_ CDK's
   own enums is fine (`aws-cdk-lib` ships compiled JS), which is the distinction that makes
   this liveable. Escape hatch if it is ever needed: `--experimental-transform-types`, also
   verified working. A second finding: `infra/tsconfig.json` needs
   `allowImportingTsExtensions`, for the same reason `tsconfig.app.json` does — a runtime
   that does not bundle needs the real `.ts` specifier.
3. ✅ **CDK pinned exactly**: `aws-cdk-lib` 2.268.0, `constructs` 10.8.1, `aws-cdk` 2.1140.0.
   No carets, so a local synth and a CI synth cannot produce different templates. Cadence:
   move it deliberately at a phase boundary, never incidentally.
4. **The repo restructure is deferred** (D1's `infra/` `services/` `web/`): `infra/` lands
   now; the rest waits for a `services/` with content. Record this so the next planner reads
   it as a decision rather than an oversight.
5. **The OIDC trust policy's `sub` condition** as actually deployed, and whether it is pinned
   to the branch or the repository.
6. ✅ **The DLQ story**, in one sentence: nothing should ever land in the version endpoint's
   DLQ, because the function has no dependencies and no async invoker — which is exactly
   what makes an alarm at `> 0` meaningful rather than noise. Phase B inherits the shape
   (queue + alarm on depth) and will have a real story to put in it.
7. **Anything the first deploy cost**, actually observed. The brief's §6 is estimates; the
   first real number is worth more than all of them and is the beginning of the cost
   case-study artifact D9 wants. **Not readable yet** — billing data lags roughly a day.
   Check Cost Explorer from 2026-09-07 and record the figure here.

8. ✅ **Stack descriptions — and any string CDK round-trips — are ASCII.** An em dash in the
   stack description came back from the Windows console as `?` when `cdk diff` read the
   deployed template, so every diff reported a phantom change. Cosmetic in the cloud and
   corrosive here: `cdk diff` is the only correctness guard behind CDK (ADR 0005), and a
   diff that is never empty is a diff nobody reads.

9. ✅ **Pin the deploy SHA to a named ref, never `HEAD`.** Found the hard way — another
   session switched the checkout mid-deploy and `git rev-parse HEAD` resolved to a different
   branch's commit, which would have stamped the version endpoint with unrelated work. Use
   `git rev-parse aws-native`. This is a standing hazard of the long-lived-branch model
   (ADR 0003 clause 2) rather than a one-off, and it applies to every later phase that
   deploys.

---

## What went unverified

There are no tests (ADR 0005), so this section replaces "tests to write" per the convention.
Everything below is unguarded, and this list is where the owner should look by hand:

- **The whole of `infra/`.** `tsc` proves the CDK code compiles; **nothing proves the
  synthesised template is correct.** CDK's own assertion library (`aws-cdk-lib/assertions`)
  is the natural tool and it needs a test runner, which ADR 0005 forbids adding. So the
  guard here is `cdk diff` read carefully by a human before every deploy. **Say this plainly
  in `infra/README.md`** — a future session will otherwise assume "CDK typechecks" means
  something stronger than it does.
- **The IAM trust policy.** A too-permissive `sub` condition typechecks perfectly and lints
  clean. This is the single highest-consequence unverified thing in the phase, and it wants
  the owner's eyes on the deployed policy, in the console, once.
- **Alarm delivery**, which is why acceptance criterion 7 forces one to fire rather than
  accepting that it was configured.
- **Budget thresholds.** Nothing tests that a budget notifies; the only proof is the console
  and, eventually, an email that arrives when spend crosses $2.
- **Log retention on log groups CDK did not create.** If any AWS service creates its own log
  group later, it defaults to never-expire and this phase's config does not reach it. A
  recurring thing to check, not a one-time fix.

---

## Sessions

2–3, per the brief's §5. Tasks 1–7 are one session of unglamorous plumbing; task 8 is a
second; tasks 9–12 are a third that needs the owner present for the parts only they can do.
