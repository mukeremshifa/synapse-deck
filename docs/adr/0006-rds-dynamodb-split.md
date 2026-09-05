# 6. Two data stores: RDS Postgres for the study loop, DynamoDB for pipeline state

**Status:** Accepted · **Date:** 2026-09-06 · **Implements:** [AWS-NATIVE-BRIEF.md](../plans/AWS-NATIVE-BRIEF.md) D3

## Context

The AWS-native build replaces Supabase Postgres. The obvious question a reviewer asks
first is why the answer is *two* stores rather than one, since "we used both" is also the
shape of a résumé-driven architecture — and the brief's §1 explicitly warns that service
collection is the failure mode of this kind of project.

So this decision needs to survive the test the brief sets: a step earns its place by
demonstrating **design · deploy · observe · secure · cost-govern · operate**, not by
appearing in a technology list.

The project has two workloads with genuinely different access patterns, and that is the
whole argument. It is worth being precise about them rather than asserting it.

**The study loop is relational, and the evidence is already in the repository.**

- Due cards are fetched by date *across decks* — a range scan over an indexed column with
  a join to deck metadata.
- `/progress` aggregates review history over time windows. That aggregation was expensive
  enough in application code that P3 pushed it into the database:
  `supabase/migrations/20260812210000_progress_stats.sql` exists precisely because doing it
  any other way was worse.
- FSRS scheduling reads and writes per-card state that is queried by user, by deck, by due
  date, and by review recency — four access paths onto the same rows.
- Phase D's mastery model joins `reviews` and `answers` by topic. That is a join in the
  ordinary sense, over two tables that grow independently.

Modelling that in DynamoDB means either denormalising every one of those access paths into
its own item collection and keeping them consistent on write, or maintaining a second
system for aggregates. Both are real costs paid to avoid a database that is free on the
12-month tier and that the schema already targets.

**Pipeline state is not relational.** Job status and per-chunk progress are read and
written by job id. There is no aggregation, no join, and no query that is not "give me the
state of job X" or "give me the chunks of job X". The item is written many times as the
job advances and read by one poller. It is also *ephemeral* in a way study data is not:
once a job's drafts are accepted into Postgres, the job record is history.

## Decision

**RDS Postgres (`db.t4g.micro`)** holds users, profiles, decks, cards, reviews, FSRS
scheduling state, progress aggregates, topics, questions, exams, attempts and answers —
and later the pgvector embeddings.

**DynamoDB** holds job status, per-chunk state, draft cards before acceptance, and
per-job token and cost accounting.

**The seam between them is acceptance.** Drafts live in DynamoDB; accepting a draft writes
it to Postgres through one audited path. That seam is deliberate and is the thing to keep
clean — the brief's §7 open question 4 exists because fifteen scattered write paths would
make it meaningless.

### Why RDS and not Aurora Serverless v2

RDS `db.t4g.micro` is on the **12-month free tier** at 750 hours a month, which covers the
runway. Aurora Serverless v2 bills continuously against an ACU floor even at idle, and
this workload is idle almost all the time — it is a portfolio project with one user and
occasional demos. The earlier `AWS-MIGRATION.md` rejected Aurora on cost too, but for a
partly wrong reason; the right reason is the idle profile, not the peak price.

### Why not Supabase Postgres, which would work fine

It fails the brief's §1. Compute in AWS writing its state to a database somewhere else is
a coprocessor attached to someone else's product, not an AWS-native division. Since the
stated acceptance criterion is that one major division is *genuinely* AWS-native, keeping
the database outside AWS defeats the purpose of the exercise. This is the one place where
the portfolio goal legitimately overrides the lower-risk engineering choice, and it is
worth saying so plainly rather than inventing a technical justification.

### Why not DynamoDB for everything

Single-table design would handle the key-access paths well and the aggregation paths
badly. `progress_stats` is the proof: the product already needed an aggregate the database
could compute, and DynamoDB's answer to that is a second system (streams into an aggregate
table, or an analytics store). That is more moving parts, not fewer.

## Consequences

**Good.** Each store does what it is good at, the access-pattern analysis is itself the
artifact a reviewer wants, and the free tier covers both — DynamoDB's 25 GB and 25
RCU/WCU are *always* free, not 12 months. The split also demonstrates cost-governance
reasoning rather than just service usage.

**Bad, and worth stating.** Two stores is two things to operate, two backup stories, two
sets of IAM policy, and one consistency seam that has to be got right. A single store
would be simpler. The judgement is that the aggregation workload makes Postgres
non-optional, and once Postgres is there, putting high-write ephemeral job state in it is
the worse of the two remaining options.

**The RDS instance is the project's only always-on cost.** After the 12-month free tier it
is roughly $12/month plus storage, which dominates everything else in the brief's §6.
A reserved instance cuts that ~40% if the project outlives the tier.

**Unverified, and this is the important part.** [ADR 0005](0005-no-test-suite.md) deleted
the suite, so nothing checks that this split holds in practice — not the access patterns,
not the acceptance seam, not the consistency between a DynamoDB draft and the Postgres row
it becomes. The PGlite harness that would have tested the Postgres half is gone. This ADR
records reasoning; it is not evidence that the implementation matches it.
