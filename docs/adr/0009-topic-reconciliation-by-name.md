# 9. Topics reconcile by normalised name, not by meaning

**Status:** Accepted · **Date:** 2026-09-06 · **Implements:** [AWS-NATIVE-BRIEF.md](../plans/AWS-NATIVE-BRIEF.md) D11 · **Constrained by:** [ADR 0008](0008-application-level-tenancy.md)

## Context

D11 makes `topics` the join that the blueprint, the mastery map and the diagnostic all read:

```
topics ─────┬── cards (FSRS scheduled) ──── reviews
            │
            └── questions (exam pool) ───── answers
```

Phase C cannot start without it, which is why the table lands in Phase B rather than in the
phase that consumes it.

**The failure mode is specific, and it is not "the schema is wrong".** It is that a user
studying one subject across five uploads gets five overlapping topic sets. The mastery map
over near-duplicate topics is not a degraded map — it is a meaningless one, because
"Krebs cycle" at 40% and "The Krebs Cycle" at 70% describe one thing and tell the user
nothing. So the question this ADR answers is not where topics come from. The model names
them while it writes the cards (D11 is explicit that this is one call, not a second pass
over the same text). The question is **how a topic from today's document is recognised as
one the user already has.**

Three options were available:

1. **Exact name match.** Trivially cheap, and wrong often enough to be useless: model
   output varies in case and whitespace between calls on the same input.
2. **Normalised name match.** Case-folded, whitespace-collapsed, Unicode-normalised. Catches
   the common case; blind to synonyms.
3. **Semantic match by embedding.** Correct in the way the problem actually demands —
   "Krebs cycle" and "Citric acid cycle" are one topic — and requires pgvector, an embedding
   model call per topic, and a similarity threshold nobody has tuned.

## Decision

**Reconcile by normalised name (option 2). Do not build embeddings in this phase.**

The normalisation is `normaliseSlug` in `services/api/src/data/topics.ts`: NFKC, then
lower-case, then collapse whitespace, then trim. It is stored in `topics.slug` and the
database enforces `unique (user_id, slug)`.

Two details that are decisions rather than implementation:

**The unique constraint is per-user, not global.** Two users may each own "Krebs cycle" and
neither may see the other's. A global unique index would be a cross-tenant collision that
leaks the existence of another user's topic through a constraint violation — the exact class
of leak ADR 0008 made possible by retiring RLS.

**The insert resolves the race, rather than a read-then-write.** Chunks are fanned out by
Step Functions and run in parallel, so two chunks naming the same topic arrive
simultaneously; a select-then-insert would have both find nothing and both insert, and the
unique constraint would turn a routine collision into a failed chunk. `on conflict (user_id,
slug) do update set updated_at = now()` returns the row either way.

**Reconciliation happens at the review gate, not at generation.** Topic names ride on the
DynamoDB chunk record as raw strings and become rows only when the user accepts the cards.
A job the user abandons must leave nothing behind in their topic list.

## Consequences

**What this buys.** The common case works: the same document uploaded twice, or two
documents on the same subject that name topics the same way, reconcile into one set. Phase C
is unblocked. No embedding infrastructure, no threshold to tune, no Phase G pulled forward.

**What it costs, stated plainly.** *This is a weaker match than the problem deserves.*
"Krebs cycle" and "Citric acid cycle" are the same topic to a biologist and two rows here.
So are "WWII" and "World War II", and "MI" and "Myocardial infarction". A user whose
documents use different vocabulary for the same subject **will** see their topic list
fragment, and the mastery map will be correspondingly less useful. The phase accepts this
knowingly rather than discovering it later.

**Why accepting it is right anyway.** Pulling pgvector forward from Phase G to improve topic
matching would mean standing up an extension, an embedding provider and a similarity
threshold in the phase whose actual job is ingestion — and doing it while **no model provider
is reachable at all** (P10 session 3: Bedrock's on-demand quotas are zero account-wide and
Anthropic refuses the caller's country). A semantic matcher that cannot call an embedding
model is not a better matcher; it is an unrunnable one. Name matching works offline, which
is the only thing that works today.

**The upgrade path is open and cheap.** `slug` stays as the fast exact-match path. Phase G
adds an embedding column and a similarity search consulted *only when the slug misses*, so
semantic matching becomes a fallback layered on top rather than a rewrite. Nothing here has
to be undone.

**What was actually run.** There are no tests (ADR 0005), but this was not left on
reasoning alone. Migration 0004 was rehearsed inside `begin; … rollback;` and then applied
to local Postgres 18, and the real `data/topics.ts` was exercised against it from a throwaway
script: slug normalisation (case, whitespace, non-breaking space, full-width letters),
reconciliation creating then matching, the display name surviving a lower-case match,
within-batch duplicates collapsing, blank names dropped, and `on delete set null` leaving
cards unfiled rather than deleted. Four cross-tenant probes: `getTopic` refusing another
user's id, two users independently owning the same slug, a card filed under another user's
topic landing `null` instead of poisoning their mastery map, and `assignCardsToTopic`
refusing a topic that is not the caller's.

The concurrency claim above was measured rather than assumed: **eight parallel
`reconcileTopics` calls naming the same two topics produced zero rejections, one row per
topic, and exactly one caller reporting `created`.**

**Still unverified.** Nothing here has run in AWS — no Lambda, no Step Functions Map, no
RDS. Local Postgres 18 is the same major as the RDS instance, but it is not that instance.
And the reconciliation has never seen a *model's* topic names, because no provider is
reachable (P10 session 3): every topic above was one a human typed into a probe.
