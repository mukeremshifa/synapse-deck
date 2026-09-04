# 1. Record architecture decisions

**Status:** Accepted · **Date:** 2026-09-05

## Context

`docs/SPEC.md` records product decisions and `docs/plans/` records execution, but there
is no home for the third kind: an architectural choice that is expensive to reverse and
whose _reasoning_ matters more than its outcome.

Through v1 this was fine. SPEC §2 has a "Decisions locked" table and the phases were
small enough that the code explained itself. The AWS work ahead is not that. Choosing
Aurora over DynamoDB, or Cognito over keeping Supabase Auth, is a decision that shapes
everything after it — and the argument gets lost while the consequence remains.

There is a second reason, specific to how this repo is built. Most work here is done by
an agent in a session with no memory of the last one. A decision that lives only in a
transcript is a decision that will be re-litigated, or silently contradicted, by the next
session. Written-down reasoning is the only thing that survives.

## Decision

Use Architecture Decision Records — one Markdown file per decision, in `docs/adr/`,
numbered sequentially, in the format of this file. Nygard's original convention.

Write one when:

- choosing between two viable designs, and the loser was genuinely plausible
- the reason will not be obvious from the code in six months
- reversing it would require a migration or a rewrite

Do not write one for a decision that documents itself in code.

An ADR is immutable once accepted. If a later decision reverses it, write a new ADR and
mark the old one `Superseded by NNNN` — the wrong turn is often the most useful part of
the record.

## Consequences

Decisions get an explicit home, and each carries its reasoning rather than only its
outcome. The next session inherits the argument instead of guessing at it.

The cost is discipline: an ADR written after the fact is usually a rationalisation, so it
has to be written when the decision is made. The status field is what keeps it honest —
`Proposed` is a real state, and a decision still being argued should sit there rather
than being backdated to `Accepted`.
