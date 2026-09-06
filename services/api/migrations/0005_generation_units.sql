-- Quota in units rather than requests. P10 task 8.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A COLUMN RATHER THAN COUNTING ROWS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Quota has always been *counted from this table* rather than tracked in a
-- mutable counter (SPEC §5.5): a counter drifts the first time a write fails
-- halfway, a count cannot, and these rows are already the cost and audit trail.
-- That principle is unchanged. What changes is the arithmetic.
--
-- Until P10 one row was one generation was one model call, so `count(*)` was
-- the answer. Document ingestion breaks that: a document fans out into up to 40
-- chunks and **each chunk is its own model call**, so one row may now represent
-- one call or forty. Counting rows would charge the same for both -- the "one
-- upload = one generation" pricing the brief names as the unfair version.
--
-- So the row records what it cost, and quota becomes `sum(units)` rather than
-- `count(*)`. This is still counted from the table and still has no counter to
-- drift; it is the same principle over a different column.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT DEFAULT 1 AND BACKFILL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `not null default 1` would be the tidy-looking choice and it is wrong here.
-- Every existing row predates document ingestion, so it genuinely represents
-- one model call and one unit -- the default is *correct* for history. But
-- leaving the default in place afterwards means a future insert that forgets to
-- pass `units` silently costs 1 no matter how many chunks it ran, which is the
-- same under-charging bug this migration exists to fix, reintroduced quietly.
--
-- So: add with a default (history is priced correctly), then drop the default
-- (new writes must say what they cost). The column stays `not null`, so an
-- insert that omits it fails loudly rather than under-charging.
alter table public.generations
  add column units int not null default 1 check (units >= 1);

comment on column public.generations.units is
  'What this generation cost: one unit per chunk, one chunk per model call. '
  'Quota is sum(units) over the calendar month, never count(*).';

-- History is priced. From here on the writer must be explicit.
alter table public.generations
  alter column units drop default;

-- The quota read is `sum(units) where user_id = … and created_at in month`.
-- `generations_user_time_idx` already covers the lookup; including `units`
-- makes the sum index-only, which matters because this runs on every dispatch
-- and is what stands between a user and a refused job.
create index generations_user_time_units_idx
  on public.generations (user_id, created_at desc) include (units);
