# `infra/` — CDK stacks

The AWS side of the project. TypeScript CDK, two stacks (`dev` and `prod`), deployed by
hand or by a manually-triggered GitHub Actions workflow.

Executed against [docs/plans/P8-aws-foundation.md](../docs/plans/P8-aws-foundation.md).
The decisions behind it are in [AWS-NATIVE-BRIEF.md](../docs/plans/AWS-NATIVE-BRIEF.md) —
D7 (CDK from the first resource), D8 (Actions + OIDC), D9 (observability ships first).

---

## ⚠ Nothing here is tested, and CDK typechecking proves less than it looks like

There is no test suite ([ADR 0005](../docs/adr/0005-no-test-suite.md)), and CDK is not an
exception. `npm run check` proves this code **compiles**. It does not prove the
synthesised CloudFormation template is correct, that an IAM policy is scoped the way the
comment above it claims, or that an alarm will ever fire.

CDK's own assertion library (`aws-cdk-lib/assertions`) is the natural tool for that and it
needs a test runner, which ADR 0005 forbids adding. So the guard is procedural:

> **`cdk diff` before every deploy, read rather than skimmed.**

Treat `cdk deploy` the way `CLAUDE.md` treats `supabase db push` — a sharp tool with no
second opinion behind it.

**`cdk destroy` deletes real infrastructure.** It is owner-only, as is anything touching
the `prod` stack.

---

## Commands

Run from the repository root:

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `npm run infra:synth`      | Synthesise both stacks to `infra/cdk.out/`. No credentials needed |
| `npm run infra:diff`       | Diff against what is deployed. **Read this before deploying**     |
| `npm run infra:deploy`     | Deploy the **dev** stack                            |
| `npm run infra:deploy:prod`| Deploy the **prod** stack — owner only              |

`npm run check` and `npm run verify` already cover this directory: `infra/tsconfig.json` is
a project reference from the root `tsconfig.json`, and `eslint.config.js` has an
`infra/**/*.ts` block. That is deliberate — a second TypeScript codebase that neither gate
covers is exactly the gap that let the Edge Function break CI while `verify` stayed green
locally.

**`cdk synth` is not in `verify`.** It belongs in CI (`.github/workflows/infra.yml`), because
adding ~10s to the local gate for something a push checks anyway is the wrong trade.

### Deploying for real

```bash
npm run infra:diff
npm run infra:deploy -- -c alertEmail=you@example.com -c gitSha=$(git rev-parse HEAD)
```

Without `alertEmail` the stack still synthesises — that is what lets CI run synth with no
secrets — but it creates **no budgets and no alarm delivery**, and warns as it does so.

---

## What is in the stack

One trivial deployed thing, wrapped in the governance every later phase inherits.

| Resource                   | Why                                                              |
| -------------------------- | ---------------------------------------------------------------- |
| Lambda (`…-version`)       | Returns the deployed git SHA. Makes the deploy path falsifiable   |
| Function URL, `authType: NONE` | The **only** unauthenticated resource in the project          |
| Log group, explicit 7-day retention | Lambda's own default is never-expire — D9's third trap   |
| DLQ + alarm                | Nothing should ever land in it, which is what makes the alarm mean something |
| 3 alarms → SNS             | Errors, p99 duration, DLQ depth                                   |
| CloudWatch dashboard       | 4 widgets. A dashboard nobody reads is worse than none            |
| 4 budgets ($2/$5/$10/$15)  | ACTUAL **and** FORECASTED at each                                 |
| X-Ray active tracing       | D9                                                                |

**No VPC, deliberately.** A VPC without a NAT Gateway needs interface endpoints, and
endpoint selection is a Phase A decision made against real data paths. The brief's §6 trap
1 is a ~$32/mo NAT Gateway; the way not to pay it is not to create the VPC until something
needs one.

### Region: `us-east-1`

Decided 2026-09-05 with the owner working from the UAE, and considered rather than
defaulted past. `me-central-1` (Dubai) would cut ~300 ms of round-trip latency and lost on
one argument: **Bedrock model availability is materially broader in `us-east-1`**, and D6
makes Bedrock the primary provider. Every cost figure in the brief's §6 is also priced
there. The accepted cost lands almost entirely on asynchronous pipeline work where it is
invisible.

**AWS Budgets is a global service and always lives in `us-east-1` regardless of where the
rest of the stack goes.** That currently looks like a coincidence. It is not — if a later
phase moves the stack, the budget stays. Do not "fix" it to follow `config.region`.

### No `enum`, anywhere in this directory

`cdk.json` runs the app under `node --experimental-strip-types`, which is strip-only: it
erases types and refuses syntax that would need code generated. A TypeScript `enum` is
exactly that.

Verified 2026-09-05 on Node 24.19.0, and the line is narrower than it first appears —
*consuming* CDK's enums (`RetentionDays.ONE_WEEK`, `Tracing.ACTIVE`) is fine, because
`aws-cdk-lib` ships compiled JavaScript. Only *declaring* one here fails. Use unions of
string literals instead. If a future session genuinely needs a declared enum, switch
`cdk.json` to `--experimental-transform-types` (also verified working) rather than
abandoning type stripping.

---

## One-time setup

### 1. Bootstrap the account — owner, once per account + region

```bash
npx cdk bootstrap aws://<account-id>/us-east-1
```

Creates the CDK staging bucket and roles. Nothing deploys before this.

### 2. The GitHub OIDC identity provider — owner, once per account

`.github/workflows/infra.yml` assumes a role rather than using stored access keys (D8), so
AWS needs to trust GitHub as an identity provider.

**IAM → Identity providers → Add provider → OpenID Connect:**

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 3. The deploy role — owner, once

Create a role with this trust policy. **The `sub` condition is the entire security boundary
of the CI pipeline** — a wildcard there means any repository on GitHub can assume this role.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:mukeremshifa/synapse-deck:ref:refs/heads/aws-native"
        }
      }
    }
  ]
}
```

Pinned to one branch on one repository, with `StringEquals` rather than `StringLike`.
When the branch changes (Phase F merges to `dev`), add the new `sub` to the list — do not
loosen the match to a wildcard.

Attach `AdministratorAccess` for now. That is broader than least privilege wants and is a
deliberate bootstrap trade-off: CDK needs wide permissions and narrowing it prematurely
means fighting permission errors instead of building. Narrowing it is legitimate later work.

Then in **GitHub → Settings → Secrets and variables → Actions:**

- **Variable** `AWS_DEPLOY_ROLE_ARN` — the role ARN. A variable, not a secret: an ARN is not
  a credential and is useless without the trust relationship above.
- **Secret** `ALERT_EMAIL` — the budget and alarm address.

### 4. Activate cost-allocation tags — owner, once ⏳ **still outstanding**

**Billing → Cost allocation tags** → activate `project`, `env`, `owner`.

Easy to miss, and until it is done the tags are present on every resource and useless for
reporting, which is a confusing state to debug.

**Attempted on 2026-09-06 and it is not yet possible.** Both the CLI
(`aws ce update-cost-allocation-tags-status`) and the console reject keys AWS has not yet
observed in a completed billing cycle:

```
ValidationException: Failed to update Cost Allocation Tag: Tag keys not found: owner,project,env
```

That is expected rather than broken — the tags exist on the resources (verified with
`aws lambda list-tags`), and AWS simply has not ingested them into billing yet. **Retry
from 2026-09-07.** Until then Cost Explorer cannot group by them, so the first cost figure
has to be read at the account level.

### 5. Confirm the SNS subscription — owner

AWS emails a confirmation link after the first deploy. **Until it is clicked, every alarm
fires into nothing and does so silently** — which is the worst possible property for an
alerting system. This is why the plan's acceptance criteria force an alarm to actually fire
rather than accepting that it was configured.

---

## Deploying from a long-lived branch: pin the SHA

```bash
npm run infra:deploy -- -c alertEmail=… -c gitSha=$(git rev-parse aws-native)
```

**`aws-native`, not `HEAD`.** Learned the hard way on the first deploy: another session
switched the checkout mid-command and `git rev-parse HEAD` resolved to a different
branch's commit, which would have stamped the version endpoint with unrelated work. The
whole value of the endpoint is that its answer is trustworthy, so the ref it reports must
be named explicitly. This applies to every later phase that deploys.

## Verifying a deploy

```bash
curl "$(aws cloudformation describe-stacks \
  --stack-name SynapseDeck-Foundation-dev \
  --query "Stacks[0].Outputs[?OutputKey=='VersionUrl'].OutputValue" \
  --output text)"
```

Returns the git SHA that is actually deployed. To prove the error alarm delivers, append
`?fail=1` — the handler throws on purpose, and an email should follow within a few minutes.
