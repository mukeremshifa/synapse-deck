# ADR 0017 — An artifact's payload stores only what cannot be derived

**Status:** Accepted
**Date:** 2026-09-09
**Phase:** [FR7](../plans/FR7-backend-rebuild.md) §6.2
**Related:** [ADR 0015](0015-artifact-as-one-kind-tagged-noun.md) — decided that an artifact
is one kind-tagged noun. This decides what its row physically holds.

---

## Context

ADR 0015 settled the modelling question — one `artifacts` table tagged by kind, not four
parallel tables — and FR7 §6.2 asks the question it deliberately left open: **what the
physical row looks like.** Specifically, whether `ArtifactPayload` becomes columns, a
payload blob, or per-kind side tables.

The contract's payload is a discriminated union, and every arm carries counts:

```ts
deck     { cardCount, dueCount, newCount }
quiz     { questionCount, answeredCount }
noteset  { origin, topicCount, completedTopicCount, completedAt }
exam     { config, blueprint, questionCount, attemptCount }
```

Two facts about those fields decide this, and they point in opposite directions:

1. **Most of them are counts of rows in other tables.** `cardCount` is
   `count(*) from cards where artifact_id = …`; `completedTopicCount` is the same over
   `note_topics where completed_at is not null`. They are questions about the database, not
   facts the artifact knows.
2. **A few of them are genuinely inputs.** A note set's `origin` records whether it was
   generated from sources or saved from a chat response — nothing can recompute that. An
   exam's `config` and `blueprint` are what the user asked for.

The third option — per-kind side tables (`artifact_decks`, `artifact_exams`, …) — was
considered and rejected: it reintroduces the four-table shape ADR 0015 refused, one join
away, and buys nothing, because the fields it would hold are either derivable or two
scalars.

## Decision

**`payload` is a `jsonb` column holding only what cannot be derived. Every count is
computed on read.**

So the stored payloads are, in full:

```
deck     {}
quiz     {}
noteset  { origin }
exam     { config, blueprint }
```

and `services/api/src/data/artifacts.ts` reassembles the contract's shape by joining five
grouped aggregates — cards, questions, note blocks, attempts, and distinct answered
questions — onto the artifact row.

A `check` constraint enforces the non-derivable half structurally
(`artifacts_payload_shape`): a note set must carry `origin`, an exam must carry `config`
and `blueprint`. Zod at the API boundary does the real validation; the constraint exists so
a bad direct INSERT cannot land a row the reader cannot interpret.

## Why not store the counts

**A stored count drifts the first time a write fails halfway**, and nothing would report
it. The failure mode is specific and bad: a deck says "12 cards" and opens to nine. The
count is the thing the user reads before deciding whether to click, so a wrong one is worse
than a slow one.

Keeping them derived means the number on the screen and the rows in the table cannot
disagree, because they are the same query.

The cost is real and bounded: every artifact read pays for five aggregate joins.
**FR6 §8.4 named the shape that would make this expensive** — the fake recomputes readiness
per artifact by walking its cards, and `listArtifacts` does that per row, which in SQL is a
correlated subquery per artifact. That is a table scan at scale. So the implementation
joins aggregates *grouped by `artifact_id`* instead, each covered by an index
(`cards_artifact_status_idx`, `questions_artifact_idx`, `note_blocks_artifact_idx`,
`attempts_artifact_idx`). One row per artifact crosses the wire, and the aggregate is
computed once per group rather than once per row.

If that ever stops being fast enough, the answer is a materialised counter updated in the
same transaction as the write — **not** a counter updated by application code after it,
which is the drift this decision is avoiding.

## Consequences

- **The contract's shape is assembled in one place**, `handlers/mappers.ts`, so a kind's
  counts cannot be computed differently by two callers.
- **Adding a kind is a new enum value and a new arm** in `artifactPayload` and
  `artifactReadiness`. No migration adds a table.
- **`payload` is merged, never replaced, on update.** `updateArtifact` writes
  `payload || jsonb_build_object('blueprint', …)` so reweighting an exam cannot silently
  drop its `config`.
- **A payload field that is neither derivable nor an input does not belong here.** If one
  appears, it is probably a column on the artifact — `status`, `title` and `error` already
  are, because they are neither computed from children nor supplied per kind.

## What is unverified

Nothing here is tested ([ADR 0005](0005-no-test-suite.md)). The aggregate queries were
exercised end to end against real Postgres at FR7 — a notebook with two decks, a quiz, a
note set and an exam, 18 cards and 79 reviews, with the rendered counts checked against the
database by hand — but **no test asserts that a count stays right after a partial write**,
which is the exact failure this decision exists to prevent. The argument is structural: the
count cannot drift because it is not stored, so there is no state to get out of step.


## Revisited 2026-09-09 — `completedAt` is a column, and it belongs on the row

SPEC §4.2's revision gave a note set a completion the student presses at the end.
It looks like a payload field and it is not one: **`artifacts.completed_at` is a
real column.**

That is this ADR applied rather than an exception to it. `completedTopicCount` is
a count of rows in another table, so it is derived on read like every other count.
`completedAt` cannot be derived from anything — not from the topics (ticking them
all does not press the button), not from the artifact, not from any other table.
By this ADR's own test it is an input, and inputs are stored.

It sits on the row rather than inside `payload` because a nullable timestamp with
a meaning is exactly what a column is for: it is queryable, it is typed, and
readiness reads it directly. `origin` stays in `payload` because it is an enum of
two values with no query behind it. The rule is unchanged — **store what cannot be
derived, derive the rest** — and this is what following it looks like when the
thing that cannot be derived happens to be a timestamp.
