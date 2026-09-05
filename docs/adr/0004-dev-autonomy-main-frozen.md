# 4. Agents own `dev`; `main` is frozen production

**Status:** Accepted · **Date:** 2026-09-05 · **Amends:** [ADR 0003](0003-branching-model.md)

## Context

ADR 0003 set the branching model and inherited a rule from `CLAUDE.md`: merging, pushing,
and PRs are the owner's alone, on every branch. That rule was written when one person
typed every commit, and it was correct then — it kept a solo project from acquiring
accidents.

It stopped being correct once agents did most of the work. Every session ended the same
way: work committed locally, an accurate summary, and a branch that only moved when the
owner ran a push by hand. The owner became a message queue for an operation neither party
had reservations about. Worse, the ceremony was **uniform** — pushing a docs typo to `dev`
required the same approval as touching production, which teaches that the approval means
nothing.

Two things have since changed that make a different rule safe:

1. **CI runs `verify` on every push** to both branches — typecheck, repo-wide lint, all
   359 tests, production build, and (as of this change) the Deno Edge Function check.
   Broken work reaching `dev` is now caught by a machine within about a minute.
2. **`main` is protected server-side** — required status checks, one approving review,
   admin enforcement. It is no longer defended only by an instruction in a Markdown file
   that a sufficiently confident session might reason its way around.

Meanwhile the AWS-native work in `AWS-NATIVE-BRIEF.md` is about to generate a lot of
commits across many sessions. Whatever the rule is, it is about to be exercised hard.

## Decision

Split the freedom by branch instead of applying one rule to both.

**`dev` — agents act without asking.** Commit, push, merge topic branches, delete them
when merged. No permission, and no offering either: an agent that asks "shall I push?"
after every task has reproduced the friction this removes.

**`main` — nothing, ever.** Frozen at `0bdc858` (v1 plus the AWS brief). It moves only
when the owner moves it, only at a checkpoint. Not a merge, not a push, not an offer, not
a question. If work appears to need `main` to move, the session says so and stops.

**PRs stay with the owner.** A PR is a human review surface. An agent opening a PR and
merging it has produced a paper trail of a review that never happened, which is worse than
no PR because it looks like process.

**History rewriting on `dev` stays owner-only.** Force-pushing a shared branch can destroy
another session's work, and unlike a bad commit it is not recoverable from the remote. A
topic branch the session created itself is exempt — nothing else is built on it.

## Consequences

Sessions finish work instead of finishing and then waiting. `dev` becomes a genuine
integration branch that reflects current state, rather than a local branch that happens to
be ahead of its remote most of the time.

The safety story moves from "a human approves each write" to "a machine verifies each
write, and production is a separate decision." That is a stronger guarantee for the case
that actually matters, because a human approving twenty pushes is not reading twenty
diffs, whereas CI genuinely runs all 359 tests every time.

**The real cost:** bad work now reaches the shared `dev` branch, where previously it
stopped at the local one. CI catches what is testable; it does not catch a bad
abstraction or a design that will need reverting. Reverting on `dev` is cheap and this is
an acceptable trade — but it is a trade, and the answer if `dev` becomes unreliable is to
tighten the gate rather than to reinstate a human as the queue.

**A second cost, worth naming:** by removing the friction, the standing prohibition on
`main` is now the *only* git rule a session must hold. That is deliberate. One absolute
rule with nothing competing for attention is more likely to be respected than seven rules
of graded severity, where a session that has internalised "ask before pushing to dev" as
theatre may generalise that instinct to the rule that matters.

The freeze on `main` is temporary in principle: it lifts at the first checkpoint of the
AWS work, when the owner decides production should move. Until then, `main` and `dev`
having diverged is the expected state, not drift to be reconciled.
