# 7. Cognito for identity

**Status:** Accepted · **Date:** 2026-09-06 · **Implements:** [AWS-NATIVE-BRIEF.md](../plans/AWS-NATIVE-BRIEF.md) D4

## Context

Supabase Auth goes away with Supabase. Something has to replace it, and unlike most
choices in this migration the decision is close to irreversible: **switching identity
providers later means re-migrating every user**, because a user's identity *is* the
foreign key that every row in the database points at. Getting this wrong is expensive in a
way that getting the compute layer wrong is not.

Three candidates were real: Cognito, Auth0, and Clerk. Any OIDC provider integrates the
same way — an API Gateway JWT authorizer verifying a token — so the integration work is
close to identical whichever is chosen. That is what makes this a decision about
constraints rather than about APIs.

**Clerk has materially better developer experience.** This is not a close call and
pretending otherwise would be dishonest: better SDKs, better documentation, better
prebuilt components, a far nicer dashboard. If this were a product decision optimising for
time-to-ship, Clerk would win.

## Decision

**Cognito**, used as a plain OIDC provider behind the application's own screens.

Two grounds decide it, and neither is developer experience:

1. **It removes a vendor from the diagram in a project whose entire point is being
   AWS-native.** The brief's §1 sets the acceptance criterion: at least one major division
   genuinely AWS-native, where a division owns its data, its identity, its deployment and
   its observability. Identity is named in that list. A backend whose auth is Clerk is a
   backend with someone else's identity system in it, and a reviewer looking for
   AWS-native work will notice.
2. **Free to 10,000 monthly active users.** Auth0 and Clerk both have free tiers that this
   project would sit inside too, so this is not decisive on cost today — it matters because
   it means there is never a billing reason to migrate later, and migration is the
   expensive event this decision is trying to avoid ever needing.

**`sub` becomes `userId` everywhere.** The Cognito `sub` claim is the Postgres `user_id`
column, the DynamoDB partition key, and the S3 object prefix. One identifier, three
stores. Existing identities migrate by id so current rows still join.

**The hosted UI is not used.** It is dated and it would be the most visible part of the
product. The app already has its own auth screens built on its own design system
(`src/features/auth/`), and those stay — Cognito sits behind them as an OIDC provider.
This is the mitigation for the one real cost of the decision.

## Consequences

**Good.** The identity story is entirely inside AWS, which is what the brief's §1 asks
for. Free to a user count this project will not reach. JWT verification at the API Gateway
edge is a legible, demonstrable security control — and per [D2](../plans/AWS-NATIVE-BRIEF.md),
with RLS retired, the verified `sub` becomes the *only* source of `userId`. It is never
read from a request body.

**Bad, and it should be expected rather than discovered.** Cognito's developer experience
is the worst of the three. Its documentation is uneven, its error messages are poor, its
console is awkward, and several common flows have sharp edges that Clerk smooths over.
Budget real time for this in Phase A; the plan should not assume auth is a quick task
because the app already has auth screens.

**The security boundary now rests on application code.** This is the consequence that
matters most and it is not really about Cognito — it is D2. Today Postgres RLS makes
cross-user access impossible. After Phase A, a query that leaks is *possible to write*,
and what prevents it is a data-access layer that takes `userId` as a required parameter
sourced only from the verified token.

**That replacement is unverified and currently unverifiable.** The brief's own amendment
calls this the most important unbuilt thing in the document: the cross-tenant tests that
were meant to guard it cannot be written, because [ADR 0005](0005-no-test-suite.md)
deleted the runner. Phase A must either schedule that testing capability before the
cutover or state explicitly what is being accepted instead — and that is the owner's
decision, not a plan's.
