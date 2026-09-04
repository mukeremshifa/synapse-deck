# 3. Branching model: `dev` integrates, `main` releases, topic branches for risk

**Status:** Accepted · **Date:** 2026-09-05

## Context

`CLAUDE.md` already fixes the parts that matter most: work happens on `dev`, and merging,
pushing, PRs and anything touching `main` are the owner's alone. That has held for twenty
commits and is not in question here.

What was never written down is the shape underneath it. Through v1 every commit went
straight onto `dev` in a line, which worked because phases were sequential and there was
one worker. Two things now change that:

- **Parallel agents.** Multiple sessions may work at once. Two agents committing to `dev`
  in the same window produce a history where neither change can be reverted cleanly.
- **AWS migration work is speculative.** Some of it will be abandoned. Work that might be
  thrown away should not be interleaved with work that ships.

The question this ADR settles is when a topic branch is worth its overhead, not whether
the owner controls merges — that is already settled.

## Decision

Two permanent branches, and topic branches used by exception rather than by default.

```
main   ──●────────────────────────●──────────────▶   released; every commit deployable
          ╲                      ╱
dev    ────●──●──●──●──●────────●───────●──●───▶     integration; granular history
                    ╲          ╱
feat/x  ─────────────●──●──●──●                      risky or long-running work only
```

**`main`** — released. Vercel deploys it. Only the owner writes to it, only by merge from
`dev`, and only with `verify` green.

**`dev`** — integration. The default branch for all work. History here is allowed to be
granular; that is what it is for.

**Topic branches** — `feat/`, `fix/`, `chore/`, `docs/`, `spike/`, branched from `dev`.
Created when, and only when, one of these is true:

1. the work is speculative and may be discarded (`spike/`)
2. it spans more than a session or two and would leave `dev` half-finished
3. another agent is working on `dev` at the same time
4. the owner asks for one

Anything else goes straight to `dev`. A topic branch for a two-commit change costs more
in ceremony than it returns.

**`spike/` is special:** exempt from `verify`, expected to be deleted rather than merged.
A spike that turns out to be right gets rewritten as a normal branch. This is the
pressure valve that keeps the gates credible — without somewhere to be scrappy, the
temptation is to weaken the rules that apply everywhere else.

Commit messages: a concise imperative subject that says what changed and, where it is not
obvious, why. The existing history (`P2: stop the SSE heartbeat when the client vanishes
mid-enqueue`) is the reference. Conventional Commits is deliberately **not** adopted —
its value is automated changelogs and semver, neither of which a private product app
needs, and it would make twenty existing commits inconsistent with everything after them.

## Consequences

Most work still goes straight to `dev`, so day-to-day nothing slows down. Speculative AWS
work gets a place to fail without polluting the integration branch, and parallel agents
have a rule that prevents them tangling.

`main` gains a real invariant — every commit on it is deployable and has passed `verify`
in CI — which is what makes it safe for Vercel to track.

The cost is a judgement call at the start of each task: branch, or not? Getting it wrong
in the cheap direction (branching unnecessarily) wastes a little ceremony. Getting it
wrong in the expensive direction (not branching for work that sprawls) leaves `dev`
half-finished, which is the failure this is meant to prevent. When genuinely unsure,
branch — `git branch -d` is cheap and untangling `dev` is not.

The owner-only constraint on merges means topic branches can accumulate while waiting.
That is a real cost and it is accepted deliberately: it is the same constraint that has
kept `main` clean so far.
