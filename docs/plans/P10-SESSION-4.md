# P10, session 4 — the frontend rebuild, and holding task 10 open

Written 2026-09-06, at the owner's instruction, before a **large frontend rewrite**
(new dashboard, new workflow). Bedrock quota is expected back at an unknown later date.

This file exists to answer one question: **when the quota lands, what do I do?**

---

## Where P10 actually stands

Sessions 1–3 did tasks 1–9 and 11. `P10-SESSION-3.md` is one session behind the branch —
it recommends tasks 7, 8 and 11 as "next", and all three are done. Trust this file for
status and that one for the pipeline's design reasoning, which is still accurate.

| Task | State |
| ---- | ----- |
| 1–6 | Done (sessions 1–2) |
| 7 topics, 8 quota, 9 `/create/text`, 11 `demo:seed` | Done (session 3) |
| **10 Bedrock** | **Blocked on model access. The subject of this file** |
| 12 RDS checkpoint | Not started. The one deploy. Owner's call, ~$14/mo |
| 13 Write P11 | Not started, and should be last |

Two known-red things, both deliberate and neither caused by the quota:

- **`readDocumentText` does not parse PDFs** — reads objects as UTF-8. Acceptance
  criterion 2 stays red until a parser is chosen. That function is the seam.
- **`demo:seed` cannot sign in.** The pool enables `ADMIN_USER_PASSWORD_AUTH`, the script
  calls the unauthenticated flow. Needs SigV4 signing or a pool change. Deferred, not broken.

---

## The quota, as measured on 2026-09-06

Every model is `NOT_AUTHORIZED` and every on-demand rate quota is **0** — including
third-party models (Qwen, Kimi, GPT-OSS), which rules out an Anthropic-specific policy.

`synapsedeck-cli` holds `AdministratorAccess`, so **IAM is not the constraint**. A live
invoke returns `ValidationException: Operation not allowed`, which is the entitlement
gate — a quota problem says `ThrottlingException` instead.

### Re-check, cheaply

```bash
export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
aws bedrock get-foundation-model-availability --region us-east-1 \
  --model-id amazon.nova-lite-v1:0
```

`authorizationStatus: AUTHORIZED` is the green light. Then confirm the rate quota moved,
because access and quota are separate gates:

```bash
aws service-quotas get-service-quota --service-code bedrock \
  --region us-east-1 --quota-code L-E386A278   # Nova Lite, on-demand RPM
```

The console path is Bedrock → **Model access** (not Service Quotas) → Amazon Nova Lite.

**Anthropic will likely stay blocked regardless.** Calls originate from `217.165.20.44`
(UAE) and Bedrock refuses the country for Anthropic models. That is a policy, not a grant.
**Nova is the realistic first provider**, and D6's interface exists so that is not a
lock-in.

---

## What the frontend rewrite may and may not touch

The rewrite is safe with respect to the pipeline, because the coupling is narrow and
HTTP-shaped. **Keep it that way** and task 10 stays a backend-only change.

**The contract, all of it:**

| Route | Used by |
| ----- | ------- |
| `POST /jobs` | `useUploadDocument`, `/create/text` |
| `GET /jobs/{jobId}` | `useJobProgress` — polls with backoff, 1s → 8s |
| `GET /jobs?deckId=…` | `useDeckJob` |
| `POST /decks/{id}/cards`, `finish-gate` | the review gate |

Everything goes through `src/lib/api-client.ts` (`api.get`/`post`/…) and the hooks in
`src/lib/queries.ts`. **Do not let a new dashboard call `fetch` directly** — that is the
one change that would couple the UI to the pipeline's wire format and make task 10 a
two-sided edit.

**Three things the new UI must keep**, because they are the stub's safety net and the
whole point of the phase (see `stub.ts`, defences 1–4):

1. **The stub warning on the upload page and the review gate.** They warn when a job's
   providers include `stub`. A redesign that drops the warning ships fake cards silently.
   The cards also say `[STUB CARD — not real content]` in their own text; do not filter
   that out for looking untidy.
2. **The partial-failure reporting at the review gate** — what did not make it into the
   deck. Task 6 built it; it has never been populated by a real job.
3. **`deck_status = 'draft'`** is the only marker of a resumable deck, and is *different*
   from the removed `card_status` `'draft'`. A grep-and-replace that takes both breaks the
   way back into the review gate, silently.

`src/lib/schemas.ts` is the one Zod definition per concept, shared with the API. Card
shapes are not redefined in a component (`CLAUDE.md`), and card content is untrusted LLM
output — render as text, `dangerouslySetInnerHTML` stays blocked.

---

## Task 10, when the quota lands

The seam is ready: `services/api/src/lib/providers/` has `types.ts` (the interface),
`stub.ts`, and `index.ts` whose `resolveProvider()` already **throws** on `bedrock` with a
message pointing at this task. Nothing needs redesigning — fill in the implementation.

**In order:**

1. **`bedrock.ts`** implementing `CardProvider`. Return `ProviderRetryableError` for
   timeouts, throttles and 5xx **only** — a malformed response is not retryable, because
   re-asking gets the same malformed answer and burns the budget for nothing.
2. **Delete the `case 'bedrock'` throw** in `index.ts`. Leave `groq`'s in place.
3. **Add the IAM permission.** ⚠ **This does not exist yet.** There is no
   `bedrock:InvokeModel` grant anywhere in `infra/lib/pipeline-stack.ts` — the generate
   Lambda currently has no Bedrock access at all, because nothing has ever needed it.
   Scope it to the specific model ARN, not `*`.
4. **Token and cost accounting into DynamoDB.** `GenerateChunkResult` already carries
   `inputTokens` / `outputTokens`, and the stub returns `null` rather than fabricating
   numbers — so the field is honest today and must stay that way. This is what makes
   "$0.45 per full loop" measured rather than estimated.
5. **The blueprint cache seam** (§6 cost control 2). Built here or Phase C retrofits it.
6. **Switch the deployment**: `-c cardProvider=bedrock`. Default stays `stub`.

**Do not weaken the four stub defences to make a demo look better.** The stub being
impossible to mistake for real output is the reason it was safe to build the pipeline
without a model.

### Verifying it, once a model answers

The pipeline has **never run in AWS** — no Lambda, no state machine execution, no
DynamoDB write, no presigned URL used. So the first real model call and the first real
pipeline run will probably arrive together, and a failure could be either. Prove the
model call **on its own first** (a direct `invoke-model`, then the provider in isolation),
then run the pipeline. Otherwise a broken retry policy looks like a broken provider.

Check the synthesised template for the retry trap when adding any state:
`LambdaInvoke` adds a *silent, per-task* default `MaxAttempts: 6`, which stacked on the
explicit 3-attempt policy would allow **18 model calls for one chunk**. Session 2 set
`retryOnServiceExceptions: false`; the default is per-task and will come back.

---

## Still true

- **`main` is frozen.** `dev` and topic branches are yours; PRs and `main` are the owner's.
- **Do not deploy RDS** until task 12's trigger. `cdk deploy SynapseDeck-Api-dev` creates
  it as a side effect. `ALERT_EMAIL` must be set for any deploying `cdk` command.
- **There are no tests** (ADR 0005). Say "typechecks and builds", never "works", unless
  you ran it — and then say what you ran.
- Credits: $140, expiring 2027-03-03, **$0 spent**.
- `cdk synth` into the default `infra/cdk.out` fails with `EPERM` on this machine. It is
  environmental and pre-existing: use `npx cdk synth --output /tmp/cdkout`.
- `npm run dev` silently taking port 5174 breaks CORS. Free 5173 rather than accepting it.
