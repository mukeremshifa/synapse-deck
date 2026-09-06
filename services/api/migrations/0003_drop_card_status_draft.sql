-- Remove 'draft' from card_status. P10 task 4.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A VALUE IS BEING REMOVED RATHER THAN LEFT ALONE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- P10 moves draft cards out of Postgres entirely. A generation job's drafts now
-- live in DynamoDB until the user accepts them at the review gate, and only
-- accepted cards are written to `public.cards`. So after this phase **no code
-- path inserts a row with status = 'draft'** — the value is not merely unused,
-- it is unreachable.
--
-- An enum member nothing can produce is worse than no member at all: it invites
-- handling for a state that cannot occur, and every reader has to work out
-- whether the dead branch is dead or whether they have missed a writer. The
-- owner's decision (recorded in docs/plans/P10-SESSION-2.md) is to remove it.
--
-- **`public.decks.status` also has a 'draft' and it stays.** That one means
-- "generation finished, the review gate has not been passed" — the resumable
-- gate state, and still very much reachable. Only `card_status` loses its
-- value. A grep for 'draft' that takes the deck one with it is the obvious way
-- to get this wrong.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A TYPE SWAP AND NOT ONE STATEMENT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Postgres has `ALTER TYPE ... ADD VALUE` but **no `DROP VALUE`**, at any
-- version. Removing a member means building a new type, moving the column onto
-- it, and dropping the old one. There is no shorter path.
--
-- The whole thing runs in one transaction — the runner gives each file its own
-- (see run.mjs) — so it either completes or leaves the schema untouched. It
-- cannot half-apply and leave the column pointing at a type that no longer
-- exists.
--
-- ── The part that will fail if it is forgotten ────────────────────────────
--
-- Three indexes depend on `cards.status`, and two of them are **partial indexes
-- whose predicates name the type explicitly**:
--
--     cards_queue_idx      ... where status = 'active'::card_status
--     cards_deck_due_idx   ... where status = 'active'::card_status
--     cards_deck_status_idx ... (deck_id, status)
--
-- `alter table ... alter column ... type` cannot rewrite a column that indexes
-- depend on in this way; the drop of the old type would also fail while they
-- reference it. So they are dropped first and recreated afterwards, identically
-- to their definitions in 0001_schema.sql. `cards_queue_idx` is the practice
-- queue's index (SPEC §10 perf budget) — recreating it is not optional
-- housekeeping, it is the difference between an index scan and a sequential one
-- on the hottest query in the product.
--
-- ── What happens to existing draft rows ───────────────────────────────────
--
-- The `using` clause below casts through text, which **fails loudly** if any
-- row still holds 'draft' — the new type has no such member, so the cast raises
-- rather than silently coercing. That is the behaviour we want: a migration
-- that quietly rewrote real drafts to 'active' would push someone's unreviewed
-- cards into their practice queue without asking.
--
-- Verified before writing this: the local database holds 0 rows with
-- status = 'draft' (all rows are 'active'), so the cast has nothing to refuse.
-- If this ever runs somewhere that does have drafts, it will stop, and the
-- decision about those rows belongs to whoever is running it.
--
-- **The live Supabase project is deliberately not touched.** It keeps its own
-- copy of this enum, still serves /progress and generation until Phase F, and
-- `src/types/database.ts` is generated from *it* — so that generated file will
-- keep 'draft' and legitimately disagree with this schema. The RDS side is
-- authoritative for the API; Supabase is authoritative for the generated client
-- types until Phase F retires it.

-- ---------------------------------------------------------------------------
-- 1. The indexes that depend on the column, dropped so the type can change.
-- ---------------------------------------------------------------------------

drop index if exists public.cards_queue_idx;
drop index if exists public.cards_deck_due_idx;
drop index if exists public.cards_deck_status_idx;

-- ---------------------------------------------------------------------------
-- 2. The new type, the column, and the old type.
-- ---------------------------------------------------------------------------

create type public.card_status_new as enum ('active', 'suspended', 'archived');

-- The default is dropped before the type change and restored after: a default
-- of `'active'::card_status` cannot survive its type being replaced, and
-- leaving it in place makes the ALTER fail with an error about the default
-- rather than about the column.
alter table public.cards alter column status drop default;

alter table public.cards
  alter column status type public.card_status_new
  using status::text::public.card_status_new;

alter table public.cards
  alter column status set default 'active'::public.card_status_new;

drop type public.card_status;

alter type public.card_status_new rename to card_status;

-- ---------------------------------------------------------------------------
-- 3. The indexes, recreated exactly as 0001_schema.sql declares them.
-- ---------------------------------------------------------------------------

create index cards_queue_idx on public.cards (user_id, due)
  where status = 'active';
create index cards_deck_status_idx on public.cards (deck_id, status);
create index cards_deck_due_idx on public.cards (deck_id, due)
  where status = 'active';
