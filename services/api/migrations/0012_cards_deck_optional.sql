-- FR7 — a card may belong to an artifact instead of a deck.
--
-- ── The bug this fixes ────────────────────────────────────────────────────
--
-- Migration 0010 added `cards.artifact_id` so a card could belong to a deck
-- *artifact*, and left `deck_id` alone so every existing row stayed valid. What
-- it missed is that `deck_id` is `not null`: a card parented by an artifact has
-- no deck to name, so every FR7 deck generation failed with
--
--     null value in column "deck_id" of relation "cards" violates not-null
--
-- while quiz, note set and exam generation — which write to `questions` and
-- `note_blocks` — succeeded. Found by driving the real API against the real
-- database, not by the type checker: no TypeScript type describes a Postgres
-- constraint, and there is no test suite to catch it (ADR 0005).
--
-- ── Why nullable rather than backfilled ───────────────────────────────────
--
-- The two parentages coexist for the length of the transition. A card written
-- before FR7 has a `deck_id` and no artifact; a card written after has an
-- artifact and no deck. Making `deck_id` nullable is what lets both be true at
-- once without rewriting live rows.
--
-- **A card must still have exactly one parent**, and the check constraint below
-- is what says so. Without it "nullable" would mean a card could have neither,
-- which is an orphan no query would ever return and nothing would report.
alter table public.cards
  alter column deck_id drop not null;

comment on column public.cards.deck_id is
  'The pre-FR7 parent. Null for cards created under the notebook model, which '
  'carry artifact_id instead. Exactly one of the two is set -- see '
  'cards_one_parent.';

-- Exactly one parent: the old one or the new one, never both and never neither.
--
-- `not valid` so the constraint applies to new rows immediately without
-- scanning the existing table, then validated separately below. On a table this
-- size the difference is academic; the pattern is deliberate because it is the
-- one that stays correct when the table is large, and a migration that only
-- works on a small table is a migration that fails later.
alter table public.cards
  add constraint cards_one_parent check (
    (deck_id is not null and artifact_id is null)
    or (deck_id is null and artifact_id is not null)
  ) not valid;

alter table public.cards validate constraint cards_one_parent;
