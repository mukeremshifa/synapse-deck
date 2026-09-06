# 10. Runtime seams at the data-access boundary

**Status:** Accepted · **Date:** 2026-09-07 · **Implements:** [DEMO-SPRINT-BRIEF.md](../plans/DEMO-SPRINT-BRIEF.md) D1, D4, D5, §6 · **Follows from:** [ADR 0008](0008-application-level-tenancy.md)

## Context

Bedrock model access was not granted and RDS was not worth paying for while the pipeline
could not call a model, so the demo sprint had to run the product on portable
infrastructure without discarding the AWS work
([DEMO-SPRINT-BRIEF.md](../plans/DEMO-SPRINT-BRIEF.md) §1). The owner's constraint was
stated verbatim: _"whatever i do shouldnt be redesigned and written when aws comes back
later."_

DS1 therefore needed four things to have two implementations at once — the model provider,
the job store, the fan-out runner, and the document store — with the AWS side kept rather
than deleted.

**The obvious implementation is the wrong one, and it is worth naming because it is what a
hurried session reaches for.** A flag consulted where the work happens:

```ts
// Not this.
if (process.env.USE_AWS) {
  await ddb.send(new PutCommand(…));
} else {
  await query('insert into public.jobs …');
}
```

That works immediately and fails slowly. The branch multiplies: every handler that touches
job state grows one, each is written slightly differently, and AWS's return becomes a hunt
through the codebase for branches rather than an edit to a configuration file. It also
puts a datastore call in a handler, which [ADR 0008](0008-application-level-tenancy.md)'s
rule 3 already forbids for SQL — and the reason generalises exactly, because the rule is
about *where the tenancy boundary is enforced*, not about which engine sits behind it.

## Decision

**A seam is a module in `services/api/src/data/` that resolves one of several
implementations from an environment variable, and there is no branching above it.**

Four seams exist:

| Seam | Variable | Implementations | Interface size |
| ---- | -------- | --------------- | -------------- |
| Model provider | `CARD_PROVIDER` | `providers/stub.ts`, `providers/groq.ts`, (`bedrock.ts`) | 1 method |
| Job store | `JOB_STORE` | `data/jobs-postgres.ts`, `data/jobs-dynamo.ts` | 8 functions |
| Fan-out runner | `PIPELINE_RUNNER` | `data/pipeline-local.ts`, `data/pipeline-sfn.ts` | **1 function** |
| Document store | `UPLOAD_STORE` | `data/uploads-local.ts`, `data/uploads-s3.ts` | 4 functions |

Three properties make this a decision rather than a naming convention.

**1. No seam has a default.** Every resolver throws when its variable is unset or
unrecognised. This is inherited from `resolveProvider()`, which refused to default because
defaulting means silently generating fake cards, and the argument generalises: a job
written to one store and polled from the other reports 404 forever, and a document
dispatched to the wrong runner appears to be generating and never is. Each of those
failures is remote from its cause and cheap to prevent.

**2. The implementations are structurally required to match.** `jobs.ts` and `pipeline.ts`
declare their implementation map as `Record<Name, typeof <awsImpl>>`, so a function added
to one side and forgotten on the other does not compile. `uploads.ts` declares the shared
interface explicitly instead, because the local store has one export S3 cannot have — the
asymmetry is documented in that file rather than papered over with a throwing stub.

**3. The check is mechanical.** No file outside `data/` may mention a seam variable:

```
grep -rn 'JOB_STORE\|PIPELINE_RUNNER\|UPLOAD_STORE\|CARD_PROVIDER' src/ services/api/src/handlers/
```

That must return nothing but comments. It is the audit
[DEMO-SPRINT-BRIEF.md](../plans/DEMO-SPRINT-BRIEF.md) §8 asks for at every phase boundary,
and it is one command.

## Consequences

**AWS's return is configuration.** Four variables and, for Bedrock, one new file
implementing an interface that already exists. The brief's §8 table stays true, which was
the constraint the whole approach was tested against.

**The two sides of a seam are not equally good, and the code says which.** This is the part
most likely to be forgotten, so each module states its own losses in its header rather than
leaving them to be discovered:

- `pipeline-local.ts` gives up **durability across a crash** and turns a declarative retry
  policy into code. A job whose process dies is swept to `failed` on read — a mitigation,
  not a replacement, because the work is still lost.
- `jobs-postgres.ts` turns `userId` from a **partition key into a filter**. On DynamoDB a
  read must name a partition and the only one it names is the caller's; on Postgres a
  statement that forgets `where user_id = $1` returns every user's rows. That is ADR 0008's
  admitted weakness applied to two more tables.
- `uploads-local.ts` turns a **signed constraint into a check**. S3 enforces the size limit
  because it is signed into the URL; locally the route checks the bytes it received.

**A seam built to be temporary became the shape of the system, and that is the point.** The
provider seam was built for the eval harness, not for portability; the data-access boundary
was drawn for tenancy, not for swapping datastores. Both paid out for a purpose neither was
designed for, which is the argument for drawing boundaries at the place where
responsibility changes rather than where today's requirement happens to fall.

**What none of this proves.** Nothing verifies that the two sides of a seam behave
identically. `JOB_STORE=dynamo` typechecking is not `JOB_STORE=dynamo` working, and neither
DynamoDB nor Step Functions was reachable to try. The structural typing prevents signature
drift; it says nothing about semantics. Under [ADR 0005](0005-no-test-suite.md) there is no
suite to close that gap, and it should be closed deliberately when one is written.
