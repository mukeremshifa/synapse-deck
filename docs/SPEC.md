# SynapseDeck — Product & Technical Specification

**Status:** v1 shipped; v2 direction set · **Owner:** Mukerem Shifa · **Spec'd** 2026-08-11
· **Last revised** 2026-09-05

Phase progress and per-phase execution plans live in [plans/](plans/).

A centralised flashcards app that uses an LLM to generate cards from text (and later
documents), then drills them with real spaced repetition and honest progress tracking.

---

## 1. Product intent

**Name:** **SynapseDeck**, from P5. A synapse is a gap a signal jumps; a deck is cards in a
stack — the mark is both at once. Named late and deliberately: P1–P4 had nothing to brand.

**One-line (v1, shipped):** Paste what you're studying, get good flashcards, and get
drilled on them at the right time.

> **v2 direction, decided 2026-09-05 — not yet built.**
> [plans/AWS-NATIVE-BRIEF.md](plans/AWS-NATIVE-BRIEF.md) §2 sets a larger product: **one
> loop, both halves equal** — study → practice → **simulated exam** → review. Upload
> material, get an exam blueprint, sit a timed exam, get a topic-level diagnostic, and have
> the misses become scheduled cards.
>
> **This section still describes v1, which is what exists.** The one-line, the non-goals
> below, and §11's phasing are rewritten by the first phase that implements the exam loop,
> not before — a spec that describes unbuilt software is the drift this document exists to
> prevent. Three v1 non-goals are already known to fall: explanations, open-ended tutoring,
> and the deferral of documents.

**Why this project exists (secondary but real):** it is the bridge between an existing React
frontend skillset and existing LLM experience. Design decisions therefore favour
_learning-valuable_ over _shortest-path_, but never at the cost of shipping.

**The bet:** the hard part of flashcards is not the flip animation — it is (a) generating
cards that are actually worth reviewing, and (b) scheduling them so review effort converts
into retention. Everything in v1 serves those two things.

### Non-goals for v1

- OCR / scanned documents / handwriting.
- Public deck marketplace or social features.
- Mobile apps (responsive web only).
- Note generation, summaries, or open-ended tutoring ("study buddy" is post-v1).
- Collaborative editing.

---

## 2. Decisions locked

| Axis          | Decision                                               | Consequence                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Backend       | **Supabase** — Postgres + Auth + RLS + Edge Functions  | One service; provider key never touches the browser          |
| v1 slice      | **Paste text → generate → review gate → SRS practice** | Documents deferred to Phase 2                                |
| Scheduler     | **FSRS** (via `ts-fsrs`)                               | Requires a per-review log table from day one                 |
| Language      | **TypeScript** (migrate; strict-ish) + **Zod**         | Shared schemas across LLM parse / DB / forms                 |
| Card types    | **basic + cloze + MCQ** (discriminated union)          | Content varies by type; scheduling state does not            |
| LLM provider  | **Groq, free tier** (OpenAI-compatible API)            | $0 marginal cost; rate limits replace cost as the constraint |
| Generation UX | **Streaming** — cards appear one at a time             | SSE from Edge Function; NDJSON on the wire                   |
| Tenancy       | **Open signup, private decks**                         | Needs RLS + per-user generation quota + rate limit           |
| Styling       | **Tailwind v4 + shadcn/ui**                            | Existing `src/ui/*` styled-components are replaced           |

### Honest scope note

Those eight choices together are more than one sprint. The phasing in §11 exists so there is
a usable app at the end of Phase 1 rather than eight half-built layers. If schedule pressure
appears, cut in this order: MCQ type → streaming (fall back to batch + skeletons) → progress
dashboard depth. Do **not** cut the review gate or the review log.

---

## 3. Users

- **Primary (P0):** self-directed learner studying from text they already have — lecture
  notes, articles, textbook passages. Wants cards without typing them.
- **Secondary (P1):** anyone landing from a portfolio link. Needs a seeded demo account so
  the app is not an empty shell on first load.

Not designed for: teachers assigning decks to classes; teams sharing decks.

---

## 4. Core flows

### 4.1 Generate (the flagship flow)

1. User pastes text (100 – 20,000 chars) into `/create/text`.
2. Chooses: number of cards (3–50), allowed card types, difficulty/depth, deck title
   (auto-suggested from the text).
3. Client shows an estimated size (characters, plus an approximate token figure) and
   remaining monthly quota before submitting. The estimate is advisory; the server
   enforces the real limits (§7.5). Quota is measured in **units** — one per chunk, one per
   model call — so a pasted passage costs 1 and a document costs what it fans out to.
4. Submit → Edge Function streams cards back. Each card appears in a **staging list** as it
   arrives, with skeleton rows for the ones still coming.
5. **Review gate:** user edits, rejects, or accepts individual cards. Bulk accept-all.
6. Accept → cards are written as `active` and enter the FSRS `new` queue.

**Why a review gate:** LLM-generated cards are ~80% good. Reviewing a bad card for months is
worse than not having it. The gate is the single highest-leverage quality feature in the
product, and it is cheap to build.

**Draft persistence:** drafts are persisted server-side as they stream, not held only in
React state. A refresh mid-generation must not burn a paid generation. Rejecting discards
the draft; abandoning leaves a resumable draft deck.

**Where drafts live changed at P10** (AWS-native build). They used to be rows in `cards`
with `status = 'draft'`; they are now records in the DynamoDB job table, and **only
accepted cards are ever written to Postgres**. `card_status` lost its `'draft'` member
accordingly (migration `0003_drop_card_status_draft.sql`): with no code path able to
produce that status, an enum member nothing can write is worse than none at all, because
it invites handling for a state that cannot occur.

`deck_status` keeps its own `'draft'`, which means something different and still happens --
"generation finished, the review gate has not been passed". That is the resumable state
above, and it is what the deck list now reads to mark a deck resumable.

### 4.2 Practice

1. `/practice/:deckId`, or `/practice` for the all-decks due queue.
2. Queue = cards where `due <= now()`, ordered by due, with new cards interleaved subject to
   a per-day new-card cap (default 20).
3. Show front → user self-reveals → rates **Again / Hard / Good / Easy** (FSRS's 4 grades).
4. Each rating writes a `reviews` row and updates the card's FSRS state in one transaction.
5. Session summary: count reviewed, rating breakdown, next-due forecast.

Keyboard-first: `Space` reveal, `1`–`4` rate, `E` edit, `U` undo last.

**Undo** is required, not a nicety — mis-hitting `1` on a mature card damages its schedule.
Undo restores the pre-review FSRS snapshot from the `reviews` row, which is why that row
stores state _before_ as well as after.

### 4.3 Manage

- `/decks` — list, search, card counts, due counts, per-deck stats.
- `/decks/:id` — card table with inline edit, type filter, bulk delete, manual add.
- Manual card creation must exist for every card type. The LLM is an accelerator, not the
  only input path.

### 4.4 Progress

`/progress` — real data only, no invented XP:

- Reviews-per-day heatmap (365 days).
- Current and longest streak (a day counts with ≥1 review).
- Retention: % of reviews graded ≥ Hard, windowed 7/30/90 days, split by card state.
- Due forecast: next 30 days, stacked bar.
- Card state distribution: new / learning / review / relearning.
- Mean stability and difficulty, and their trend.

---

## 5. Data model

Postgres on Supabase. Every table has `id uuid default gen_random_uuid()`, `created_at`,
`updated_at`, and `user_id uuid references auth.users not null`. RLS on **every** table.

### 5.1 Enums

```sql
create type card_kind   as enum ('basic', 'cloze', 'mcq');
create type card_status as enum ('active', 'suspended', 'archived');  -- P10: 'draft' removed
create type fsrs_state  as enum ('new', 'learning', 'review', 'relearning');
create type deck_status as enum ('generating', 'draft', 'active', 'failed');
create type gen_source  as enum ('text', 'document', 'manual');
```

### 5.2 `decks`

```sql
create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status deck_status not null default 'active',
  source gen_source not null default 'manual',
  new_cards_per_day int not null default 20 check (new_cards_per_day between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on decks (user_id, updated_at desc);
```

`new_cards_per_day` is **not read in v1.** The daily cap is one number per account
(`profiles.daily_new_limit`), because a per-deck cap on top of an account cap needs a rule
for how the two interact, and no such rule is obvious enough to guess at. The column stays
for when there is a reason to answer that question.

### 5.3 `cards` — content plus scheduling state

The key structural decision: **content varies by card type; scheduling state does not.** The
FSRS scheduler reads and writes only the scheduling columns and never inspects `payload`.
That keeps the scheduler type-agnostic forever, so adding a fourth card type later touches
rendering and validation but not scheduling.

```sql
create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid not null references decks on delete cascade,

  -- content (discriminated union; shape validated by Zod at every boundary)
  kind    card_kind not null,
  payload jsonb     not null,

  status card_status not null default 'active',

  -- provenance: which chunk of source text produced this card
  source_excerpt text,

  -- FSRS scheduling state
  fsrs_state     fsrs_state       not null default 'new',
  stability      double precision,
  difficulty     double precision,
  due            timestamptz      not null default now(),
  last_review    timestamptz,
  reps           int              not null default 0,
  lapses         int              not null default 0,
  scheduled_days int              not null default 0,
  elapsed_days   int              not null default 0,
  learning_steps int              not null default 0,  -- which (re)learning step

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- cheap structural guard; Zod does the real validation
  constraint payload_shape check (
    case kind
      when 'basic' then payload ? 'front' and payload ? 'back'
      when 'cloze' then payload ? 'text'
      when 'mcq'   then payload ? 'stem'  and payload ? 'options'
    end
  )
);

-- the queue query; make it fast
create index on cards (user_id, status, due) where status = 'active';
create index on cards (deck_id, status);
```

**Payload shapes (Zod, shared between client and Edge Function):**

```ts
const Basic = z.object({
  kind: z.literal('basic'),
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(2000),
});

// Anki-style cloze markers: "The mitochondrion is the {{c1::powerhouse}} of the cell."
const Cloze = z.object({
  kind: z.literal('cloze'),
  text: z
    .string()
    .min(1)
    .max(2000)
    .regex(/\{\{c\d+::[^}]+\}\}/),
  hint: z.string().max(200).optional(),
});

const Mcq = z.object({
  kind: z.literal('mcq'),
  stem: z.string().min(1).max(1000),
  options: z
    .array(z.object({ text: z.string().min(1).max(500), correct: z.boolean() }))
    .min(3)
    .max(5)
    .refine(o => o.filter(x => x.correct).length === 1, 'exactly one correct option'),
  explanation: z.string().max(1000).optional(),
});

export const CardPayload = z.discriminatedUnion('kind', [Basic, Cloze, Mcq]);
```

> **Cloze caveat:** one cloze _note_ containing `{{c1}}` and `{{c2}}` conventionally becomes
> two scheduled cards. v1 simplification: **one cloze marker group per card row**. If the
> model emits multiple groups, split into separate rows at ingest. This avoids a note-vs-card
> distinction that would complicate the schema for little v1 benefit — revisit if it bites.

### 5.4 `reviews` — append-only log

This table is the reason FSRS was chosen. It powers scheduling, every progress metric,
undo, and any future FSRS parameter optimisation.

It is append-only, with exactly one exception: `undo_last_review` sets `undone_at`. A
narrow UPDATE policy plus a trigger make that the only column any update may touch, and it
may be set once — so the log body is immutable by mechanism rather than by convention.

The `*_before` columns hold the **complete** pre-review snapshot, which is what makes undo
exact. Storing only state, stability and difficulty (as first drafted) leaves `due` and the
learning-step index unrecoverable, and an undo that restores the interval but not the
memory state looks correct while quietly damaging the schedule.

```sql
create table reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null references cards on delete cascade,

  rating      smallint    not null check (rating between 1 and 4), -- 1 Again .. 4 Easy
  reviewed_at timestamptz not null default now(),
  duration_ms int,

  -- FSRS state BEFORE this review (enables undo + offline optimiser)
  state_before          fsrs_state       not null,
  stability_before      double precision,
  difficulty_before     double precision,
  due_before            timestamptz not null,
  last_review_before    timestamptz,
  elapsed_days_before   int not null default 0,
  learning_steps_before int not null default 0,
  elapsed_days      int not null,   -- days that passed before THIS review
  scheduled_days    int not null,   -- the interval the card carried into it

  -- state AFTER
  state_after      fsrs_state       not null,
  stability_after  double precision,
  difficulty_after double precision,

  -- Set when the user undid this rating. The row is never deleted: an undone
  -- rating is real history, and the optimiser decides for itself whether to use
  -- it. P3's retention math excludes rows where this is set.
  undone_at timestamptz
);
create index on reviews (user_id, reviewed_at desc);
create index on reviews (card_id, reviewed_at desc);
```

### 5.5 `generations` — audit and quota source of truth

```sql
create table generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid references decks on delete set null,
  source gen_source not null,
  model text not null,
  input_chars int not null,
  input_tokens int,
  output_tokens int,
  cards_requested int not null,
  cards_returned int not null default 0,
  cards_accepted int,
  units int not null check (units >= 1),   -- P10: one per chunk, one per model call
  cost_usd numeric(10,6),
  status text not null default 'running',  -- running | succeeded | failed | refused
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on generations (user_id, created_at desc);
```

Quota is **counted from this table**, not tracked in a mutable counter — no drift, and it
doubles as the cost dashboard.

**Counted as `sum(units)`, not `count(*)` (P10 task 8).** Until document ingestion, one row
was one generation was one model call, so counting rows was the answer. A document fans out
into up to 40 chunks and **each chunk is its own model call**, so one row may now represent
one call or forty. `units` records what the row cost; the principle is unchanged, only the
arithmetic.

`units` is `not null` **with no default**, deliberately. History was backfilled at 1 (every
pre-P10 row genuinely was one call), and then the default was dropped so a later insert that
forgets to price itself fails loudly instead of silently under-charging a 40-chunk document
as though it were one call.

**On RDS since P10 task 8**, with `units`. The Supabase copy has no such column and does not
need one: everything that writes it there is a single pasted passage, so one row is still one
unit. See the split table in `docs/plans/P9-aws-slice.md`.

### 5.6 `profiles`

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  timezone text not null default 'UTC',  -- day boundaries for streaks/heatmap
  daily_new_limit int not null default 20,
  fsrs_params jsonb,                     -- null = library defaults
  created_at timestamptz not null default now()
);
```

Created by a trigger on `auth.users` insert. `timezone` matters: a streak computed in UTC is
wrong for most users and produces "broken streak" bug reports.

### 5.7 RLS

Uniform policy per table — one rule, no exceptions:

```sql
alter table decks enable row level security;
create policy owner_all on decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Repeated for `cards`, `reviews`, `generations`, and `profiles` (`auth.uid() = id`).
`reviews` is the one narrowing: SELECT and INSERT as usual, no DELETE at all, and an UPDATE
policy that a trigger restricts to the `undone_at` tombstone.

The Edge Function calls Supabase **with the caller's JWT**, not the service role key, so RLS
applies to generated inserts too. The service role key is not used in v1 at all — if a future
job needs it, it stays server-side and writes an explicit `user_id`.

---

### 5.8 `topics` — the join (P10, RDS only)

Added at P10 task 7, on **RDS only** (`services/api/migrations/0004_topics.sql`). The
Supabase schema does not have it and will not get it; Phase F ends that split.

```sql
create table topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,          -- display form, as the model produced it
  slug text not null,          -- match key: NFKC, lower-cased, whitespace collapsed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topics_user_slug_key unique (user_id, slug)
);

alter table cards add column topic_id uuid references topics on delete set null;
```

Topics are the join the brief's D11 describes: cards, questions, the blueprint and the
mastery map all read them. `cards.topic_id` is **nullable and stays nullable** — hand-made
cards have no topic, and a chunk whose model output named none still produces good cards.
Deleting a topic sets it null rather than cascading: the card survives, unfiled.

**Where topics come from.** The model names them in the same call that writes the cards,
never as a second pass over the same text — a separate extraction pass would double the
token cost of every job to re-derive something the model already knew.

**How they reconcile.** Names are matched against the user's existing topics on the
normalised `slug`, so "Krebs Cycle", "krebs cycle" and "Krebs&nbsp;Cycle" are one topic and
one row. The existing display name wins a match, so a topic list does not silently re-case
itself as documents arrive. Reconciliation runs **at the review gate**, not at generation:
a job the user abandons must leave no topics behind.

This match is deliberately weaker than the problem deserves — "Krebs cycle" and "Citric acid
cycle" are one topic to a person and two rows here. Closing that needs embeddings, which is
Phase G. See [ADR 0009](adr/0009-topic-reconciliation-by-name.md) for why the phase accepted
the weaker match rather than pulling pgvector forward.

The unique constraint is `(user_id, slug)` and **not** `(slug)`: topics are per-user, and a
global unique index would leak the existence of another user's topic through a constraint
violation.

## 6. Scheduling (FSRS)

**Library:** `ts-fsrs` — TypeScript-native, implements current FSRS, and its review-log shape
matches §5.4. Hand-rolling FSRS is a fun weekend and a long-term liability; SM-2 was rejected
for worse scheduling at similar effort.

**Where it runs:** client-side on rating, wrapped in a single Postgres RPC that inserts the
`reviews` row and updates `cards` atomically. Reason for one RPC: a partial write (review
logged but card not rescheduled, or the reverse) silently corrupts a user's schedule and
stays invisible until much later.

```sql
create function review_card(p_card_id uuid, p_rating smallint, p_duration_ms int,
                            p_expected_updated_at timestamptz, p_next jsonb)
  returns cards ...
-- Locks the card, inserts the reviews row from its current state, then applies p_next.
-- security invoker so RLS applies. Raises PT409 if the card's updated_at has moved
-- (two tabs), PT404 if the card is not the caller's, and validates every p_next key
-- explicitly — RLS checks who you are, never what you sent.

create function undo_last_review(p_card_id uuid) returns cards ...
-- Restores the newest non-undone review's *_before snapshot onto the card and
-- tombstones that review. Also security invoker.
```

Design points:

- **Day boundary** = 04:00 in the user's `profiles.timezone` — standard SRS convention, so
  late-night studying belongs to the previous day.
- **New-card interleaving:** due reviews first; new cards mixed in up to the daily cap.
  Reviews are never starved by new cards.
- **Suspend/bury:** `status = 'suspended'` removes a card from queues without deleting it.
- **Fuzz** enabled (a `ts-fsrs` option) so cards created together do not clump forever.
  ts-fsrs seeds it from the card, so the same card previewed twice gives the same answer —
  which is what lets the rating buttons promise "Good → 4d" and then honour it.
- **Short-term (re)learning steps** stay enabled — the library default. That requires
  persisting `cards.learning_steps`: without it every learning card restarts at step 0 on
  each review, so a card rated Good repeatedly loops on the 10-minute step and never
  graduates. The alternative, `enable_short_term: false`, was rejected because it retires
  the `learning` and `relearning` states entirely, and §4.4 reports a distribution over all
  four.
- **Lapses** count every `Again`. ts-fsrs counts one only from the `review` state; the
  simpler rule is the app's, enforced in `review_card`, and `lapses` is a display counter
  that the FSRS model never reads. What matters is that it is counted in exactly one place.
- **Parameter optimisation** is post-v1, but the log makes it possible without migration. It
  needs roughly 1,000 reviews to be meaningful, so expect to enable it months in.

---

## 7. Generation pipeline

### 7.1 Shape

```
Browser  ──POST /functions/v1/generate-cards (JWT)──▶  Supabase Edge Function (Deno)
                                                        │ 1 authenticate (JWT → user)
                                                        │ 2 validate input (Zod)
                                                        │ 3 quota + rate-limit check
                                                        │ 4 char-budget check → hard ceiling
                                                        │ 5 insert decks(status=generating)
                                                        │      + generations(status=running)
                                                        │ 6 Groq streaming call (SSE)
   ◀──text/event-stream (one event per card)──────────  │ 7 per card: Zod → insert draft
                                                        │            → emit SSE event
                                                        │ 8 finalise generations row
```

### 7.2 Provider, model, and parameters

**Provider: Groq, free tier.** Groq exposes an OpenAI-compatible REST API, so the Edge
Function talks to it over plain `fetch` (no SDK needed for one streaming endpoint) or via
the `openai` package with `baseURL` overridden.

```ts
// supabase/functions/generate-cards/index.ts  (Deno)
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const response = await fetch(GROQ_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: Deno.env.get('GENERATION_MODEL'), // pinned at deploy, not hardcoded
    stream: true,
    stream_options: { include_usage: true }, // usage arrives in the final chunk
    temperature: 0.4, // low: card writing wants consistency, not flair
    max_tokens: 4096,
    messages: [
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      { role: 'user', content: buildUserTurn(params) },
    ],
  }),
  signal: AbortSignal.timeout(60_000),
});
```

**Pinned at P2 (2026-08-12): `llama-3.3-70b-versatile`.** Free-tier limits read from
Groq's own rate-limit page that day: 30 requests/min, 1,000 requests/day, **12,000
tokens/min**, 100,000 tokens/day, shared across the API key rather than per user. It was
chosen over `openai/gpt-oss-120b` — the only free-tier family with strict `json_schema`
support — for two reasons that both come from the numbers: 12,000 TPM against 8,000 means
a 20,000-character paste plus a 4,096-token answer fits inside one minute's budget rather
than exceeding it on its own, and a non-reasoning model starts emitting card text
immediately instead of spending its first seconds on reasoning tokens, which is what the
under-5s first card in §10 actually depends on. The `json_schema` support is not lost
value here: it constrains output to one object, which §7.3 does not want.

**The model is still a deploy-time env var, not a literal.** Groq's free-tier roster and its
per-model rate limits change often enough that hardcoding a name here would be stale
before P2 ships. The P2 task is: read the current model list and free-tier limits from
Groq's own console/docs, pick the strongest instruction-following model that supports
JSON-mode output, pin it in `GENERATION_MODEL`, and record the choice with a date in the
P2 plan. Every `generations` row already stores `model`, so a later switch is auditable.

Notes that matter and are easy to get wrong:

- **No provider-side token counting.** Groq has no `count_tokens` endpoint, so the
  pre-flight ceiling in §7.5 is enforced on **characters**, with a conservative
  chars-per-token divisor for the _display_ estimate only. Never present the estimate as
  exact, and never let it be the thing that enforces the limit.
- **No Anthropic-style prompt caching.** Do not design around a cached system-prefix
  discount. Keep the system prompt stable anyway — it makes output consistent and makes
  regressions attributable to the prompt version — but budget as if every request pays
  full input cost.
- **`temperature` and `top_p` are available and useful here** (unlike the Claude models
  originally specced). Start low (~0.3–0.5): high temperature on a strict NDJSON contract
  buys nothing but malformed lines.
- **JSON mode is a belt, not a substitute for Zod.** If the pinned model supports
  `response_format: { type: 'json_object' }`, note that it constrains output to a _single_
  JSON object, which conflicts with the NDJSON-per-line contract in §7.3. Either leave
  `response_format` unset and rely on the prompt plus per-line Zod validation, or switch
  that model to batch mode with a `{"cards":[…]}` object. **Decided at P2: unset.** The
  pinned model reaches JSON object mode only, which would collapse the stream into one
  object; per-line Zod plus a prompt that states the contract twice is what holds the
  shape, and `src/lib/generate.ts` drops a bad line rather than the batch.
- **Rate limits are the real constraint, not cost.** A free-tier 429 is normal operating
  behaviour, not an exception. Read `retry-after`, surface `rate_limited` to the client
  (§7.3), and never retry a streaming generation silently — the user is watching a
  half-filled staging list.
- **Refusals and truncation.** Check `finish_reason` on the final chunk: `length` means
  the model hit `max_tokens` mid-card and the last NDJSON line must be discarded rather
  than salvaged. A content refusal surfaces as a normal completion whose body is prose
  instead of JSON — zero valid lines with a non-empty response is the signal, and it
  records `status='refused'` on the `generations` row.

> **Provider portability.** Nothing above leaks into the client: the browser only ever
> sees the SSE contract in §7.3. Swapping Groq for another provider later is a change to
> one Edge Function and one env var, which is the main reason the streaming translation
> lives server-side rather than calling the provider from React.

### 7.3 Wire format: NDJSON in, SSE out

**Superseded for the app by P10 task 9.** Nothing in `src/` reads an SSE stream any more:
both `/create/text` and `/create/document` post to `POST /jobs` and poll `GET /jobs/{id}`,
because a job that fans out over chunks cannot hold one request open. Cards now arrive a
chunk at a time rather than one at a time — the streaming feel was this format's one real
advantage, and it was traded for chunked generation, a shared quota, and a generation that
survives a refresh.

This section still describes the **Supabase Edge Function**, which stays deployed until
Phase F, and `src/lib/sse.ts` / `src/lib/ndjson.ts` remain for it. Both go when it does.

The model is instructed to emit **one JSON object per line** (NDJSON), not a single JSON
array. The Edge Function splits on newline, Zod-validates each line, inserts it, and re-emits
it as an SSE event.

**Why NDJSON rather than schema-enforced structured output:** with a streamed JSON _array_,
nothing is validatable until the array closes, so incremental delivery needs a partial JSON
parser and a malformed tail can lose the whole batch. NDJSON makes each line independently
parseable and independently discardable — one bad card is dropped and logged while the other
19 still land. The trade-off is losing `output_config.format` schema enforcement; Zod-per-line
recovers the guarantee at the point it actually matters, before the DB write. If line
adherence proves unreliable in testing, the fallback is
`output_config: { format: { type: 'json_schema', schema } }` in batch mode with skeleton
loaders — a contained change.

**SSE events.** The client uses `fetch` + `ReadableStream`, not `EventSource`: EventSource
cannot send an `Authorization` header or POST a body.

```
event: meta   data: {"deckId":"…","generationId":"…","expected":20}
event: card   data: {"id":"…","kind":"basic","payload":{…},"index":0}
event: card   data: {"id":"…","kind":"cloze","payload":{…},"index":1}
event: warn   data: {"index":7,"reason":"validation_failed"}
event: done   data: {"returned":19,"inputTokens":4102,"outputTokens":1876}
event: error  data: {"code":"quota_exceeded","message":"…"}
```

The client must handle: mid-stream disconnect (the deck is left `generating`; a resume view
reads the drafts already persisted), `warn` (a skipped card), and `error` arriving after some
cards already landed.

### 7.4 Prompt design (system prompt outline)

- Role: write flashcards a serious student would keep.
- **Atomicity** — one fact per card; split compound facts.
- **Answer-independence** — the front must be answerable without seeing sibling cards.
- No trivia extracted from formatting, page numbers, or the author's asides.
- Cloze only where a definition, term, or date sits in a natural sentence.
- MCQ distractors must be plausible and wrong for a _reason_ — no filler options. Expect this
  to be the weakest generated type; the review gate is the mitigation.
- Quote the `source_excerpt` each card came from, so the review gate can show provenance.
- Output contract: one JSON object per line. No prose, no markdown fences, no array wrapper.

Prompt text is version-controlled at `supabase/functions/_shared/prompts/cards.v1.ts`, and
the version string is recorded on each `generations` row so quality regressions are
attributable.

### 7.5 Rate-limit and abuse control

On Groq's free tier the marginal cost of a generation is **$0**, so the thing being
protected is no longer a bill — it is the shared rate limit and the app's own stability.
Reframe accordingly: a single user pasting 50 documents does not cost money, it exhausts
the per-key quota and takes the feature down for everyone.

The `generations.cost_usd` column stays (nullable, left `null` on the free tier) so that
moving to a paid provider later needs no migration.

Controls, all enforced in the Edge Function, never client-side:

1. **Input cap** — 20,000 chars per request, hard-rejected before any API call
   (`GENERATION_LIMITS.maxChars`).
2. **Character ceiling** — `GENERATION_QUOTA.maxInputChars`, **28,000** as tuned at P2,
   checked before dispatch and applied to the _assembled_ prompt, system message included.
   Groq has no `count_tokens` endpoint, so this is a character budget; the token figure
   shown in the UI is an estimate and is never the enforcement mechanism. The arithmetic:
   28,000 ÷ 4 chars/token ≈ 7,000 input tokens, plus `max_tokens` 4,096 ≈ 11,100, which is
   ~92% of the pinned model's 12,000 token/minute ceiling.
3. **Monthly quota** — **300 units per user per month**, summed from `generations.units`.
   **One unit is one chunk is one model call** (P10 task 8). A pasted passage is a single
   chunk and so costs 1, exactly as before; a document costs what it fans out to, up to the
   40-chunk cap. Charging per upload instead would price a 3-page PDF and a 300-page
   textbook the same, which is the version a user finds unfair the first time it matters.

   The allowance was rebased from 30 generations to 300 units so that the paste-only user
   is strictly better off (300 rather than 30), while a document spends in proportion to
   the work it asks for. 300 units is roughly seven full-size documents, or many small
   ones, or the same 300 pastes.

   **The whole job is priced before any of it runs.** The document is chunked, the cost is
   known exactly, and the request is refused *before* a deck or job record exists —
   refusing at chunk 30 of 40, after the money is spent and with a deck covering three
   quarters of a document, is the worst version of a quota. A refusal that cannot be
   afforded names the shortfall ("this needs 40 units and you have 12 left") rather than
   just saying no, because the numbers are what make the next move obvious.

   Free tier, so the cost of a generation is $0 and the number is a fair-share limit on the
   shared key rather than a bill. A row spends an allowance when it produced cards, or
   while it is still running: a refusal and a failure that returned nothing spend nothing,
   or the first refusal would make every later request refuse too.
4. **Rate limit** — max 3 generations per 60s, and 1 concurrent per user. A `running` row
   older than five minutes is a crashed worker and stops counting, or one lost worker locks
   a user out permanently.
5. **Global kill switch** — `GENERATION_ENABLED` env var, checked before anything else.
   No org-wide spend ceiling: on the free tier there is no spend, and the per-key rate limit
   is the shared resource being protected.
6. The client reads the remaining allowance from the same rows with the same filter
   (`useQuotaUsage`, `quotaCountFilter`) and shows it beside the paste box and in
   `/settings`, so a refusal is visible before submit rather than after. It is advisory —
   only the Edge Function can refuse.

---

## 8. Frontend

### 8.1 Stack

| Concern        | Choice                                                | Note                                                |
| -------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Build          | Vite (existing)                                       | keep                                                |
| Language       | TypeScript                                            | migrate `.jsx` → `.tsx` as files are rewritten      |
| Styling        | Tailwind v4 + shadcn/ui                               | `@tailwindcss/vite` plugin, `@import "tailwindcss"` |
| Routing        | react-router 7 (existing)                             | keep; add a protected-route wrapper                 |
| Server state   | TanStack Query                                        | cache, optimistic rating, retries                   |
| Forms          | react-hook-form + `zodResolver`                       | reuses the §5.3 Zod schemas                         |
| Toasts         | `sonner`                                              | replaces `react-hot-toast` (shadcn default)         |
| Charts         | Recharts                                              | the heatmap is a hand-rolled CSS grid               |
| Icons          | `lucide-react`                                        | replaces `react-icons`                              |
| SRS            | `ts-fsrs`                                             |                                                     |
| Backend client | `@supabase/supabase-js`                               | replaces `axios` + `json-server`                    |
| Tests          | _none — suite deleted 2026-09-05_                     | ADR 0005; rebuild at a checkpoint                   |
| Type           | DM Serif Display · Plus Jakarta Sans · JetBrains Mono | self-hosted via `@fontsource`; no CDN (P5)          |
| Brand assets   | `@resvg/resvg-js` + `png-to-ico` + `wawoff2`          | dev-only; `npm run brand:assets` (P5)               |

### 8.2 Routes

```
/login  /signup  /auth/callback
/                       landing page — public, no session, no request (P7)
/dashboard              due today, streak, quick-practice, recent decks
/decks                  deck list
/decks/:id              card table, inline edit, manual add
/create/text            paste → generate (streaming)
/create/review/:deckId  review gate for drafts
/practice               all-decks due queue
/practice/:deckId       single-deck queue
/progress               heatmap, retention, forecast
/settings               daily limits, timezone, quota usage
/account
*                       404
```

`/` is the only public route with anything on it. It sits under `PublicOnlyRoute`, not
outside the guards altogether: a visitor **with** a session goes to `/dashboard`. Everything
from `/dashboard` down is inside `ProtectedRoute`, which wraps the layout rather than each
child, so a route added later cannot quietly skip it.

### 8.3 State ownership

- **Server state** (decks, cards, queue, stats) → TanStack Query, keyed `['deck', id]`,
  `['queue', deckId]`, `['stats', window]`.
- **Session-local** (current card index, revealed flag, the staging list during generation) →
  component state or a small reducer. Not Query.
- **Rating is optimistic:** advance the UI immediately; roll back and toast on RPC failure.
  Practice must feel instant or nobody uses it.

### 8.4 Accessibility and input

- Full keyboard path through practice; visible focus rings.
- The flip is a `<button>` with `aria-expanded`, not a div — the answer must be reachable by
  a screen reader, and the card must not become a keyboard trap.
- Respect `prefers-reduced-motion` for the flip animation.
- Cloze blanks announced as "blank" rather than rendered as bare underscores.

---

## 9. Repo reset

### Delete

- `src/ui/*` — all styled-components files (superseded by Tailwind + shadcn).
- `src/GlobalStyles.js`.
- `src/data/data-sample-cards.json` — replaced by a real seed migration.
- `src/features/Create/UseCreateFromText.js` (empty file), `src/pages/Questions.jsx`.
- `src/pages/PracticeCards.jsx` — rewritten. Its data fetching is broken today: it writes to
  a local `var` inside an effect with no dependency array, so it renders nothing.
- Dependencies: `styled-components`, `json-server`, `axios`, `react-icons`,
  `react-hot-toast`.
- The `server` npm script.

### Keep

`vite.config.js`, `eslint.config.js`, `.prettierrc`, `index.html`, `public/logo-light.png`,
`react-router-dom`, `react-hook-form`. The page and route _structure_ is a good starting map
even though the contents are rewritten.

### Target layout

```
src/
  app/            router, providers (Query, auth, theme)
  components/ui/  shadcn primitives
  features/
    auth/  decks/  cards/  generate/  practice/  progress/
  lib/
    supabase.ts  fsrs.ts  schemas.ts  queries.ts  format.ts
  types/          generated Supabase types
supabase/
  migrations/     *.sql
  functions/
    generate-cards/
    _shared/      prompts/, schemas.ts, quota.ts, sse.ts
docs/SPEC.md
```

`src/lib/schemas.ts` is imported by both the client and the Edge Function — one Zod definition
of a card, validated at the LLM boundary, the form boundary, and the DB boundary. This is the
concrete payoff of the TypeScript decision.

---

## 10. Non-functional requirements

**Security**

- `GROQ_API_KEY` lives only in Supabase function secrets: never in client env, never in
  the repo. `.env.local` gitignored; `.env.example` committed.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` reach the browser.
  Supabase's modern key system (`sb_publishable_…` / `sb_secret_…`) is used rather than
  the legacy `anon` / `service_role` JWTs, which are deprecated at the end of 2026.
- **The secret key is never used.** It maps to `service_role` (`BYPASSRLS`), so it would
  void every policy in §5.7. `src/lib/env-schema.ts` fails startup if a client env value
  starts with `sb_secret_`. A test asserted that until the suite was deleted
  ([ADR 0005](adr/0005-no-test-suite.md)), so that file is now the only thing enforcing it.
- RLS on every table. A test queried as user B for user A's rows until the suite was
  deleted; nothing verifies the boundary now, which is why it must be read rather than
  assumed.
- Card content is rendered as **text, never via `dangerouslySetInnerHTML`** — generated
  content is untrusted input. Markdown support, if added later, needs sanitisation.
- Zod-validate every Edge Function input; never trust a client-sent `user_id`.

**Performance**

- Practice queue fetch under 300ms p95 (indexed per §5.3).
- Rating → next card under 100ms perceived (optimistic update).
- Time-to-first-card in generation under 5s. This is what streaming buys.

**Testing** — **suspended, and none of the below currently exists.** The suite was deleted on
2026-09-05 ([ADR 0005](adr/0005-no-test-suite.md)); `check` and `verify` prove the code
compiles, lints and builds and nothing verifies behaviour. This stays as the shape a rebuilt
suite should take — it was aimed at what breaks silently — not as a description of the repo:

- Unit: the FSRS wrapper (each rating from each state), cloze parser/renderer, Zod schemas
  against real and malformed LLM output, streak and retention math across timezone
  boundaries.
- Integration: RLS isolation; `review_card` RPC atomicity.
- One E2E happy path (Playwright, optional): signup → generate (mocked) → accept → practice →
  rate.
- **Explicitly not tested:** styling, animation.

**Reliability**

- Every generation failure recorded on the `generations` row with a reason.
- An interrupted generation is resumable from persisted drafts.
- No destructive action without confirmation (delete deck, bulk delete cards).

---

## 11. Phasing

| Phase                        | Deliverable                                                                                                                                                        | Done when                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **P0 — Reset** ✅ done       | TS + Tailwind v4 + shadcn scaffold; deletions done; migrations for §5 + RLS, verified against in-process Postgres; route shell                                     | ✅ build + typecheck + 38 tests green; RLS isolation test passes                                                       |
| **P0b — Cloud link** ✅ done | Project linked (`cnlnsaamiujselyuowzx`, eu-west-1, PG 17.6); migrations pushed; types generated; modern publishable/secret key mode                                | ✅ RLS verified live: anonymous reads return `[]`, anonymous insert rejected `42501`                                   |
| **P1 — Core loop** ✅ done   | Auth; deck and card CRUD (all 3 types, manual); FSRS practice + `review_card` RPC; undo; keyboard controls; settings; empty states                                 | ✅ 157 tests green; simulated week schedules correctly; undo restores exactly                                          |
| **P2 — Generation** ✅ done  | Edge Function; NDJSON→SSE streaming; staging + review gate; `generations` audit; quota + rate limit                                                                | ✅ 251 tests green; pipeline built and typechecked under Deno — see docs/plans/P2-generation.md                        |
| **P3 — Progress** ✅ done    | Heatmap, streak, retention, due forecast, state distribution; timezone-correct                                                                                     | ✅ 299 tests green; SQL day buckets proven equal to `studyDayKey` across DST — see docs/plans/P3-progress.md           |
| **P4 — Ship** ✅ done        | Deploy (Vercel + Supabase cloud); demo seed account; empty states; error boundaries; README                                                                        | ✅ 305 tests green; the deploy itself is the owner's — see docs/plans/P4-ship.md                                       |
| **P5 — Identity** ✅ done    | Name; token system (chroma-0 neutrals + `#D0F861`); self-hosted type; mark; generated favicon/PWA/social assets; grade ramp                                        | ✅ 324 tests green; `npm run brand:assets` is deterministic — see docs/plans/P5-identity.md                            |
| **P6 — Surface** ✅ done     | Per-screen pass: shell with an account menu and a three-state theme control, serif card fronts, generate readouts, progress hierarchy, deck density, system states | ✅ 346 tests green; the palette is closed by test — see docs/plans/P6-surface.md                                       |
| **P7 — Landing** ✅ done     | `/` becomes a public marketing route; the product shown in markup rather than screenshots; robots and sitemap; the data-layer boundary made testable               | ✅ 355 tests green; `/` renders with no session and fires zero requests, proven by test — see docs/plans/P7-landing.md |
| **Post-v1**                  | Documents (txt/md, then PDF text-layer, chunking, background jobs); FSRS parameter optimisation; PWA/offline; shared decks; generated quiz mode; notes             | —                                                                                                                      |

**P1 before P2 is deliberate.** The LLM is the exciting part; the scheduler is the part that
must be right. Building generation on top of an unproven scheduler means debugging both at
once.

---

## 12. Resolved questions

All settled as of 2026-08-12. Kept here as a decision record rather than deleted, so the
reasoning behind each is recoverable later.

| #   | Question                   | Resolution                                                                                         |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Document formats (post-v1) | `.txt`/`.md` first, then PDF text-layer, ≤50 pages                                                 |
| 2   | Model / provider           | **Groq free tier**, `llama-3.3-70b-versatile` via `GENERATION_MODEL`, pinned 2026-08-12 — see §7.2 |
| 3   | Deployment target          | Vercel for the SPA, Supabase cloud for the backend                                                 |
| 4   | Timeline                   | None. Phases are ordered, not dated                                                                |
| 5   | Cloze multi-group          | One deletion group per card; multi-group notes split at ingest (`splitClozeGroups`)                |
| 6   | Offline / PWA              | Desktop web only for v1, except `/` — see _Changed after P7_                                       |
| 7   | MCQ grading                | Auto-grade into FSRS (correct → Good, wrong → Again), with a manual override                       |

### Closed at P2 (2026-08-12)

- **Which Groq model** — `llama-3.3-70b-versatile`, with the reasoning and the numbers in
  §7.2. Still an env var, so switching it is a secret change and not a deploy; every
  `generations` row records the model it used, so a switch stays auditable.
- **Free-tier rate limits** — 30 RPM / 1,000 RPD / 12,000 TPM / 100,000 TPD, read from
  Groq's rate-limit page on 2026-08-12. Re-read them before changing `maxInputChars` or the
  burst limiter; they move, which is why the arithmetic that depends on them is written out
  in `src/lib/quota.ts` rather than left as bare constants.

### Changed after P7 (2026-08-14)

The board was closed and the landing page shipped; this is the owner's pass over it. Six
decisions, four of which amend something P6 or P7 had settled — recorded here rather than
edited into those sections, so the reasoning that was replaced is still readable.

- **`/` is responsive. Everything behind the login is still not.** Row 6 above stands for
  the app: the shell is a six-link header at a fixed height, `/decks` is a table, and
  practice is built for a keyboard. The landing page is the exception because it is the one
  screen whose whole job is to be opened from a link, and links get opened on phones. It is
  written mobile-first and designed down to 360 px: sections stack, the two-up grids only
  appear at `lg`, the header sheds the ghost "Sign in" below `sm` (the hero repeats it two
  lines down), and both CTA rows put the button above the sign-in prompt rather than beside
  it. This does not shorten POST-V1 item 10; it removes the landing page from its scope and
  removes the footer sentence that item was leaning on.
- **The landing page spends the accent twice, and this is the one screen allowed to.** P6
  capped it at once per screen (_Closed at P6_), and the cap is about emphasis: one obvious
  next thing to do. Both spends here are the same button, "Create account" in the header and
  in the hero, so a visitor who has scrolled past the hero still has the accent above them
  rather than a page with no visible way forward. The closing CTA stays outline, because a
  third would make none of the three primary. Nothing else on the page is accent: `--primary`
  is oklch(0.922 …), roughly 1.2:1 against paper, and headlines are ink.
- **No theme control on `/`.** P6 made the control a three-state radio group and put it in
  the account menu; the landing page has no account menu, which is why P7 put the group in
  the header. A settings widget shown to somebody who has not decided to use the product is
  the wrong thing in the wrong place, and it was competing with the sign-up button for the
  top-right corner. Removing the control is all that changed: `ThemeProvider` still sits
  above the router, so a first-time visitor with nothing in `localStorage` gets `system`,
  and somebody who chose light or dark inside the app still sees their choice here.
- **The review-log strapline is out of both footers.** "Every number here is counted from
  your own review log — nothing is estimated." was a marketing line printed on every screen
  of a signed-in app, and `/progress` already says it in the one place it means something,
  about the numbers actually on the page. Both footers now carry a credit instead. The
  landing page keeps the section that makes the claim properly, with the `reviews` columns
  listed beside it — a claim with its evidence is not the same object as a strapline.
- **The landing footer is a real footer.** Wordmark and one line of what the product is,
  a Product column (create account, sign in), a Contact column (mukeemoha@gmail.com, and
  github.com/mukeremshifa), then a credit and the year. It replaces P7's fine print, which
  stated that there was no mobile layout — now false — and that drafting cards needs a
  provider key on the deployment, which is still true and is now unsaid. That is a real
  loss of honesty and it is deliberate: the caveat belongs on `/create/text`, where the
  feature is, and that screen already answers "not configured on this project yet".
- **No em dash in anything a visitor reads on `/`.** A house-style rule, not a typographic
  one: colons, full stops and commas carry the same joins, and the dash was doing the work
  of all three across the page. `LandingPage.test.tsx` asserts the rendered text is free of
  U+2014; the en dash in "1–4" is a range and stays, and the rule is about copy, so the
  comments and this document are not in scope. Nothing in `public/` was regenerated — the
  rasterised text is "Forgetting is the schedule." and never had one.

### Closed at P7 (2026-08-13)

- **A signed-in visitor to `/` is sent to `/dashboard`.** `/` is public but still guarded,
  by `PublicOnlyRoute` — the same guard that keeps a signed-in user off `/login`. Somebody
  with a session who opens the bare domain typed it out of habit and wants their due queue;
  making them read a pitch for a product they already use, and click past it, charges them
  for arriving. The alternative — leaving `/` unguarded so everyone sees the marketing page
  — would also mean the landing page needs a "go to the app" state, which is a second
  signed-in surface to keep in step with the first.
- **The auth pages stayed eager, for a new reason.** P4 made them eager because they were
  the first screen a signed-out visitor saw. After P7 they are not; `/` is. Measured rather
  than assumed: splitting them moves 4.8 kB raw / 1.6 kB gzip out of a 788 kB eager chunk,
  because `react-hook-form`, Zod and the Supabase client all stay eager for other reasons.
  That buys a signed-in user 1.6 kB once, and costs a stranger a chunk fetch on the single
  most important click in the product — the sign-up button they just decided to press. The
  landing page itself **is** lazy, and there the same arithmetic points the other way: it is
  11.9 kB that a signed-in user would never render, and referencing it lazily grew the eager
  chunk by 0.3 kB.
- **A public page may not reach the authenticated data layer.** Not a size rule — a
  behavioural one, and the thing that replaced the bundle-size target nobody was enforcing.
  One `import { useDecks } from '@/lib/queries'` pulls in Supabase and TanStack Query, and a
  rendered query hook starts making requests for a visitor who has no session and has asked
  for nothing. It is enforced twice: `LandingPage.test.tsx` walks the module graph
  _transitively_ (the realistic breakage is not importing `queries.ts`, it is importing a
  component that does), and `landing-requests.test.tsx` renders the real providers and the
  real route table with `fetch` and `WebSocket` replaced by spies that fail if used.
- **The product is shown in markup, never in screenshots.** `src/features/marketing/showcase/`
  holds inert copies of the practice card, the grade ramp and the review gate rows, built from
  the same tokens and type rules as the real screens — so they follow the theme, stay sharp at
  any zoom, cost no image bytes, and cannot go stale the way a PNG of a dashboard does. They
  **copy** the markup rather than importing the live components, which is the whole point: the
  live ones reach the data layer. The cost is drift, and that is the right trade — a stale
  drawing is cosmetic, a marketing page that 401s in the console is not.
- **The `h1` is bound to the social card.** `public/og-image.png` was rasterised at P5 with
  "Forgetting is the schedule." set in the serif. The page and the image every shared link
  renders must not disagree, and nobody would find out until a link was posted somewhere. A
  test asserted that the heading and the string in `scripts/build-brand-assets.mjs` still
  match; it went with the suite ([ADR 0005](adr/0005-no-test-suite.md)), so the pairing is
  now a convention to check by hand.
  Changing the headline means changing both and re-running `npm run brand:assets`.
- **`robots.txt` is a blanket `Disallow` plus an exact-match `Allow: /$`.** P5's per-route
  list had already drifted — `/account`, `/login` and `/signup` were never in it — which is
  what enumerating routes in a file nobody edits alongside the route table gets you. The
  blanket rule is also the more accurate one: `vercel.json` rewrites every path to the same
  `index.html`, so a crawler following `/dashboard` gets a duplicate of the landing page at a
  second address rather than a new document.
- **The origin is `https://synapsedeck.mukeremshifa.com`, and it is stated in three files.**
  P7 shipped a `__SITE_ORIGIN__` token rather than invent a domain, on the grounds that a
  plausible fake origin produces link previews that 404 and a sitemap that indexes nothing,
  silently, while a token fails loudly. The domain was chosen on 2026-08-14 — a subdomain of
  the owner's `mukeremshifa.com`, DNS on Cloudflare, hosting on Vercel — so the token is
  gone: `public/sitemap.xml` has a fully-qualified `<loc>`, `public/robots.txt` has a real
  `Sitemap:` line, and `index.html` has an absolute `og:url`, `og:image` and `twitter:image`.

  Three files now repeat one string, and nothing in the running app notices when they
  disagree: the site renders perfectly while shared links preview a 404. So
  `brand-assets.test.ts` derives the origin from `index.html`'s `og:url` and asserts the
  other two match, and that no `__SITE_ORIGIN__` survives outside a comment. The same test's
  asset check had to learn about absolute URLs at the same time — a path-only matcher stops
  verifying `og-image.png` exists the moment that tag stops being root-relative, which is
  precisely the silent 404 the file was written to catch.

### Closed at P6 (2026-08-13)

- **Where the serif is allowed to appear.** Three places, and no others: the wordmark, a
  page's own headline (`h1`, or the title of a card that _is_ the whole screen — the session
  summary, the error fallback, the auth panels), and the question side of a card. It never
  sets body copy, labels, buttons, numbers, or any answer. This is the decision most likely
  to drift, because nothing looks broken when a display face quietly becomes the interface
  face — it just stops being designed. `CardFace.test.tsx` and `PracticeSession.test.tsx`
  assert the card-front half of the rule, which is the half that carries the product.
- **Numbers are set in the mono face, with tabular figures.** Queue positions, intervals,
  counts, percentages, stability, quota. Digits that do not reflow as a count crosses from 9
  to 10 are the difference between a figure and a label, and JetBrains Mono was already being
  shipped for the rating intervals alone.
- **"The accent at most once per screen" is about emphasis, not about the ramp.** `--primary`
  marks the one thing to do next and nothing else — so a list of twenty decks has accent
  buttons on none of its rows, and the review gate puts the accent only on the row the
  keyboard is actually on. The `--grade-*` ramp is exempt: it is a scale carrying meaning, and
  `--grade-easy` being the accent is the point of the ramp rather than a second accent
  competing with the first. The logo's node is exempt for the same kind of reason.
- **Settings is not a navigation destination.** The shell is the lockup, five links that are
  the product's loop, and an account control. Settings, theme and sign-out live inside that
  control, because a nav with seven equal items has no primary path through it. The menu is
  hand-rolled rather than Radix's: `AppLayout` is in the eager chunk, and a floating-UI
  dependency in the first bundle a signed-in user downloads costs more than it settles.
- **The theme control exposes all three states.** P1–P5 shipped a light↔dark flip on top of a
  provider that has always supported `system` and kept a live `matchMedia` listener — so the
  first click was a permanent opt-out of a state with no way back. It is now a radio group,
  and it reports the _chosen_ theme rather than the resolved one: under `system` at night
  those differ, and marking Dark would claim a choice the user never made.
- **Charts name their series in text.** The rule P3 set for the heatmap, extended to the
  forecast and the state mix. Recharts' own `<Legend>` was replaced by `ChartLegend`, outside
  the responsive container, so the names are the app's own type and are assertable — a legend
  that exists only inside a canvas-shaped component is a legend nobody can test.
- **One map from grade and card state to colour**, `src/lib/grade-tokens.ts`. Three files
  previously agreed only by holding the same four strings, which is the arrangement that let
  the rating buttons drift away from the tokens through all of P1–P4.

### Closed at P5 (2026-08-13)

- **The name is SynapseDeck**, and the storage key moved with it
  (`flashcards.theme` → `synapsedeck.theme`), discarding every saved theme preference. With
  one demo account that was free; it never would be again.
- **The accent is `#D0F861` = `oklch(0.922 0.181 122.5)`, and it can never be a foreground.**
  Lightness 0.92 puts it at roughly 1.2:1 against white, so accent text or an accent hairline
  is invisible. It is a field with ink on top, a chart fill, or a focus ring on dark —
  nothing else. There is deliberately no darkened variant: darkening it far enough to read on
  white produces olive, which is a different colour wearing the same name. `--ring` is
  therefore ink in light and accent in dark, because one ring colour cannot serve both.
- **Neutrals are chroma 0 in both themes.** Black, white, and one wavelength of green. A grey
  tinted toward the accent muddies the only colour allowed to carry meaning. A test used to
  fail if one drifted; it was deleted with the suite (ADR 0005), so this is now a
  convention rather than an enforced invariant.
- **The four grade colours are one ramp ending on the accent.** Not four unrelated hues:
  again → hard → good → easy sweeps red to `#D0F861`, and rating Easy _is_ the brand colour
  because Easy is what the product exists to produce. Lightness climbs 0.60 → 0.72 → 0.82 →
  0.92 so the four remain separable with no colour vision at all — a red-to-green sweep is
  the exact axis deuteranopia flattens, so value carries the information and hue is the
  reward. Before P5 the rating buttons ignored these tokens entirely while the charts used
  them, so one rating was two colours depending on the screen.
- **Type is DM Serif Display / Plus Jakarta Sans / JetBrains Mono, self-hosted.** The Google
  Fonts link was the app's only third-party request, on a page that renders untrusted model
  output. Adding `--font-sans` / `--font-serif` / `--font-mono` to `@theme` also fixed a bug
  that had been live since P0: Tailwind's `font-sans` utility never resolved to Poppins.
- **Brand assets are generated, not drawn by hand each time.** `npm run brand:assets` renders
  every icon and social card from `assets/brand/*.svg` using the same font files the app
  ships. Two traps are recorded in that script: resvg silently ignores woff/woff2 rather than
  erroring, and `wawoff2`'s decompressor returns a view onto shared wasm memory, so
  decompressing under `Promise.all` corrupts the output at exactly the right byte length.

### Closed at P3 (2026-08-12)

- **Where the day bucketing lives** — in both places, and proven equal. `studyDayKey`
  stays the client's only answer; `review_day_counts` transcribes it as
  `(reviewed_at at time zone tz - interval '4 hours')::date` because aggregating a year
  of reviews in the browser is the wrong shape. A test asserted the two agree across DST
  transitions in both directions — the only thing that kept a second implementation honest.
  It was deleted with the suite (ADR 0005); the duplication remains and is now unguarded.
- **Heatmap intensity is relative, not absolute** — the five buckets are scaled to the
  90th percentile of the user's own active days. Fixed thresholds cannot serve both a
  fifteen-a-day user and a three-hundred-a-day user; one gets a blank year and the other
  a solid block, and in both cases the chart stops carrying information.
- **The forecast is computed on the client** — `cards` is small next to `reviews`, only
  active non-new cards inside the horizon are fetched, and one fewer SQL function is one
  fewer thing to revoke from `anon`.
- **Mean stability and difficulty are over cards; the trend is over reviews.** A
  collection that is growing has a mean that moves for reasons unrelated to memory, so
  the trend compares the two halves of the review window and the label says so.

---

## 13. Success criteria for v1

1. A study text becomes 15 or more usable cards in under a minute, with the first card
   visible in under 5 seconds.
2. Fewer than 20% of generated cards are rejected at the review gate.
3. The scheduler is trustworthy enough to use daily for a month without manual correction.
4. Progress numbers are derived entirely from the review log — nothing invented.
5. Monthly LLM spend stays under a set ceiling with no manual intervention.
