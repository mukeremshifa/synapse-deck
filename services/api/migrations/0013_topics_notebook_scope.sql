-- FR7 — topics are unique per notebook, not per user.
--
-- ── The bug this fixes ────────────────────────────────────────────────────
--
-- Migration 0010 added `topics.notebook_id` and a partial unique index on
-- `(user_id, notebook_id, slug)`, intending topics to be notebook-scoped —
-- the fix for the live cross-notebook bug, where two notebooks studying the
-- same subject shared one topic row and contaminated each other's mastery.
--
-- What it left in place is `topics_user_slug_key`, a **full** unique constraint
-- on `(user_id, slug)` from migration 0004. That constraint makes the intended
-- scoping impossible to express: the same topic name in two notebooks is
-- exactly what it forbids. Generation failed with
--
--     duplicate key value violates unique constraint "topics_user_slug_key"
--
-- the moment a second notebook named a topic the user already had. Found by
-- driving the real API twice against the real database — the first run created
-- the topics, the second collided with them.
--
-- ── What changes, and what it costs ───────────────────────────────────────
--
-- The old constraint is dropped and replaced by a **partial** unique index over
-- the rows it still governs: those with no notebook, written before FR7. So:
--
--   notebook_id is null      unique per (user_id, slug)      -- unchanged
--   notebook_id is not null  unique per (user_id, notebook_id, slug)
--
-- **This is a widening, not a loss.** It permits rows the database previously
-- refused and deletes nothing; every existing row remains valid under whichever
-- index now governs it, which was checked before this migration was written
-- (no duplicates in either partition). Dropping a constraint on a live table is
-- still worth naming as what it is rather than burying.
--
-- The pre-FR7 rows keep their guarantee because the reconciliation that writes
-- them (`reconcileTopics`, per user) is unchanged and still targets the same
-- key shape. The two writers do not collide: each targets the index that
-- governs its own partition.

alter table public.topics
  drop constraint topics_user_slug_key;

-- The legacy partition's guarantee, preserved as an index rather than a
-- constraint because a constraint cannot be partial.
create unique index topics_user_slug_legacy_key
  on public.topics (user_id, slug)
  where notebook_id is null;

comment on index public.topics_user_slug_legacy_key is
  'Pre-FR7 rows: one topic per (user, slug). Superseded for notebook-scoped '
  'rows by topics_notebook_slug_key -- see 0013 for why both exist.';
