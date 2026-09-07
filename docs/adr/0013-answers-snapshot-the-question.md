# 13. An exam answer snapshots the question and references the card

**Status:** Accepted · **Date:** 2026-09-07 · **Implements:** [DS3](../plans/DS3-real-blueprint-exam.md) task 4 · **Constrained by:** [ADR 0008](0008-application-level-tenancy.md)

## Context

`src/lib/mastery.ts` computes topic mastery from two signals it keeps deliberately apart:
FSRS retention — can you recall this when prompted — and exam accuracy — can you apply it
under time. It refuses to average them, because a topic where they *disagree* is the most
informative case the product can surface.

The retention signal has had a real source since P1: `cards` and `reviews`. **The exam
signal had none.** `MasteryAnswer` was a shape fed entirely by `sampleMasteryAnswers`; an
exam was sat in the browser, graded in the browser, and forgotten when the tab closed. So
the diagnostic's headline finding was computed over data belonging to nobody.

DS3 task 4 gives it a table. The question this ADR answers is not whether to store answers.
It is **what an answer is a record of** — because the obvious normalised design quietly
destroys the thing an answer is for.

Three options were available:

1. **Reference the card only.** `card_id references cards on delete cascade`, and fetch the
   stem through a join when displaying history.
2. **Store the question text only.** A flat record of what was asked and how it went, with
   no link back to the material.
3. **Both**, with one of them designated the authority.

## Decision

**Option 3: store `question_text` *and* reference `card_id`, with the snapshot as the
authority and the reference as a nullable pointer.**

```sql
question_text text not null,                          -- never updated
card_id  uuid references cards  on delete set null,   -- a pointer, not the meaning
topic_id uuid references topics on delete set null,
topic_name text                                       -- snapshotted beside the reference
```

**Option 1 was rejected because an answer would silently change meaning.** A card can be
edited after the fact — `CardEditor` exists and the review gate actively encourages it — so
"you got this wrong" starts pointing at a question the user was never asked. There is no
error, no gap, nothing a reader could notice. And `on delete cascade` would mean a user
tidying their deck erases their own exam history, with the mastery map shifting for no
visible reason.

**Option 2 was rejected because it severs the answer from the material.** "Generate cards
from my misses" (SPEC §4.6) needs to know which card a miss came from, and so does any
future "review this again". A record you cannot act on is a weaker record.

Two consequences follow, and both are decisions rather than implementation:

**The topic name is snapshotted but the live name wins on read.** `listAnswers` reads
`coalesce(t.name, a.topic_name)`. This is deliberately the *opposite* rule from
`question_text`, which is never re-derived. A stem is evidence of what was asked; a topic
name is a label on a grouping, and a renamed topic showing its old label beside its new one
would split one topic into two rows on the mastery map — the fragmentation
[ADR 0009](0009-topic-reconciliation-by-name.md) exists to prevent, arriving through a
different door. The snapshot is what survives a *deleted* topic.

**A client-supplied reference is nulled, not rejected.** `card_id` and `topic_id` arrive
from the browser and are foreign keys into per-user tables, so `recordAnswers` resolves each
against the caller's own rows and drops anything that is not theirs. Rejecting the whole
submission would lose a real record of something that genuinely happened over a stale id;
inserting it unchecked would let one user attach answers to another's topics, corrupting
their mastery map invisibly. This is the same guard `assignCardsToTopic` uses, for the same
reason.

## Consequences

**A stem is duplicated per answer.** Twenty questions sat five times is a hundred copies of
twenty strings. That is the cost, it is bounded by `char_length <= 4000`, and it buys a
record that still means what it meant.

**Append-only, with exactly one exception — and the first version got that wrong.**
`0008` declared the table append-only with a trigger refusing *every* update, described as
"stricter than the reviews equivalent". Postgres implements `on delete set null` as an
UPDATE on the referencing row, so that trigger made deleting an examined card impossible —
contradicting, three paragraphs above it in the same file, the argument that an answer must
survive exactly that. `0009` narrows it: an update may only *clear* `card_id` or `topic_id`,
never change any other column and never repoint either id.

**This was found by running it, not by reading it.** There is no test suite
([ADR 0005](0005-no-test-suite.md)) and nothing else would have caught it before a user
deleted a deck. It is the second time in three phases that the "run the thing" task found a
bug no `verify` could see, which is the argument for keeping that task in every plan.

**Grading remains client-side.** `correct` is computed by `gradeAttempt` and trusted. There
is no server-side exam to re-grade against, and the only consumer of a falsified answer is
the falsifier's own study plan. Phase C moves the answer key server-side and grading follows
it.

**`attempt_id` is a client-generated uuid with no `exams` table behind it.** An exam is
currently assembled in the browser and has no server-side existence, so the id groups a
sitting rather than addressing a resource — which is why the route is `POST /exams/answers`
and not `POST /exams/{id}/answers`. It is not a capability: every read filters `user_id`
as well.
