# Phase plans

`SPEC.md` says _what_ the product is and _why_ each decision was made. These plans say
_how_ to execute one phase, in enough detail that a fresh session can be pointed at a
single file and start work without re-deriving anything.

## How to use one

> Execute docs/plans/P1-core-loop.md.

That should be the whole prompt. If a plan needs more context than that to act on, the
plan is underspecified — fix the plan.

## Convention

Each plan contains, in this order:

1. **Preconditions** — what must already be true, with a command to verify it.
2. **Out of scope** — what belongs to a later phase. This section exists because scope
   creep is the main failure mode of a plan like this; anything tempting-but-later goes
   here explicitly.
3. **Tasks** — ordered, each naming the files it touches. Ordered so the app builds and
   runs after every task, never only at the end.
4. **Acceptance criteria** — observable checks, not vibes.
5. **Tests to write** — named, with the specific failure each one catches.
6. **Decisions to record** — things the executing session must write back into `SPEC.md`
   or this file, so the next session inherits them.

## Why these are written one at a time

Only the next phase gets a detailed plan. A P4 plan written today would be fiction: it
would assume file layouts, hooks, and query keys that P1–P3 have not created yet, and
every drift between plan and reality is a session confidently doing the wrong thing.

So: the last task of every phase plan is to write the next one. That way each plan is
authored against the codebase it will actually run in.

## Board

| Phase            | Plan                                       | Status                                                               |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| P0 — Reset       | _(executed inline, no plan file)_          | ✅ Complete — 2026-08-12                                             |
| P0b — Cloud link | [P0b-cloud-link.md](P0b-cloud-link.md)     | ✅ Complete — 2026-08-12                                             |
| P1 — Core loop   | [P1-core-loop.md](P1-core-loop.md)         | ✅ Complete — 2026-08-12                                             |
| P2 — Generation  | [P2-generation.md](P2-generation.md)       | ✅ Complete — 2026-08-12                                             |
| P3 — Progress    | [P3-progress.md](P3-progress.md)           | ✅ Complete — 2026-08-12                                             |
| P4 — Ship        | [P4-ship.md](P4-ship.md)                   | 🟡 Code complete — 2026-08-13; the deploy itself is the owner's      |
| P5 — Identity    | [P5-identity.md](P5-identity.md)           | ✅ Complete — 2026-08-13                                             |
| P6 — Surface     | [P6-surface.md](P6-surface.md)             | ✅ Complete — 2026-08-13                                             |
| P7 — Landing     | [P7-landing.md](P7-landing.md)             | ✅ Complete — 2026-08-13                                             |
| Post-v1          | [POST-V1.md](POST-V1.md)                   | 📋 Backlog, not a phase                                              |
| AWS-native + v2  | [AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md) | 🧭 Decisions made 2026-09-05 — 8 phases scoped, no plan, no code yet |

**P7 was the last phase of v1, and the v1 board is closed.** SPEC §11 lists nothing between
P7 and Post-v1, so there is no P8 plan file and this is not an omission: writing one would
mean inventing a phase to fill a row.

**Reopened 2026-09-05, one row only.** The owner set a new direction — AWS-native — and
[AWS-NATIVE-BRIEF.md](AWS-NATIVE-BRIEF.md) records the decisions. That file is deliberately
_not_ a phase plan: it is the level above one, and it changes no code. It is a **brief**,
meant to be handed to a planning session whose first output is `P8-aws-foundation.md`.

`AWS-MIGRATION.md` was the first attempt at that document and is **superseded**. It
optimised for lowest idle cost against a goal that had not yet been stated, and concluded
the opposite on four decisions; the brief's §10 records which and why. It is kept because
the wrong reasoning is instructive, not because any of it is current.

**Scope grew again the same day.** The brief's §2 records it: the product is no longer only
flashcards but **one loop, both halves equal** — study → practice → simulated exam → review,
with a blueprint generator, a timed exam runner, and a diagnostic that turns exam misses into
scheduled cards. Eight phases are scoped in the brief's §5, roughly 25–35 sessions.
`SPEC.md` §1 carries a pointer to that direction but **still describes v1**, deliberately:
it is rewritten by the phase that first implements the new loop, not in advance.

The convention below still holds, so each phase gets a real plan file when it is actually
started, written against the codebase it will run in. Until then the board stays closed in
practice. Everything that remains is either in
[POST-V1.md](POST-V1.md), each entry with the condition that should start it, or on the
owner's list below — and the owner's list is not work a session can plan its way out of.

Two items moved into POST-V1 with P7 rather than being left implied by their absence: the
**custom domain**, which three files waited on with a `__SITE_ORIGIN__` token, and a
**mobile layout**, which the landing page was the first screen to state out loud that the app
did not have. The first of those is now settled — see the deploy note below.

**Post-P7 revision, 2026-08-14.** The owner made a pass over the landing page after the board
closed: it is now responsive down to 360 px, the header spends a second accent on "Create
account" and no longer carries the theme control, the review-log strapline is gone from both
footers, `/` has a real footer with contact details, and no em dash appears in its copy. Six
decisions, all recorded in SPEC §12 under _Changed after P7_, and POST-V1 item 10 is narrowed
to the app because the landing page is out of its scope now. This is not a phase and did not
get a plan file — a change to one screen that a session can hold in its head does not need
one, and pretending otherwise would reopen a board that is legitimately closed.

The split that still matters day to day: schema and RLS changes are testable locally
against PGlite (`npm test`), but anything touching Supabase Auth needs the real project,
because the harness only stubs `auth.users`.

All five migrations are applied and `src/types/database.ts` is generated from the live
schema. P1 pushed `…_review_card.sql` and `…_revoke_anon_rpc.sql`; **P2 added none** — the
`generations` table, `deck_status`, and `card_status = 'draft'` were all built in P0 for
it; P3 added `20260812210000_progress_stats.sql`. **P4 adds none either**, so it starts
against a database that matches the repository.

Second split, new since P2: `tsc` and ESLint both exclude `supabase/functions`, so the
Edge Function is typechecked only by `npm run fn:check` (Deno). Run it alongside the other
four commands whenever anything under `src/lib` that the function imports changes — the
bridge in `supabase/functions/_shared/` means those files are compiled by two compilers.

Third, new since P3 and finished in P4: the bundle is split. Everything except the auth
pages, the dashboard and the deck list loads lazily, so `npm run build` prints a dozen chunks
and the eager one is `index-*.js`.

**There is no size target, and there has not been one since P6.** P4 was handed 400 kB and
spent a page of the plan explaining why it is unreachable with this dependency set; P5 and P6
then each justified a handful of kB against a number that was never real. The build takes the
size it needs. Sizes in the P4–P6 plans are records of what was measured at the time, not bars
anything has to clear, and `chunkSizeWarningLimit` in `vite.config.ts` is raised so the build
stops reporting a threshold nobody is enforcing.

What replaced it is a boundary rather than a budget: a module should not import what it does
not use, and a public page must not reach the authenticated data layer at all. That is a
correctness rule — it is about what requests fire and when — and it is testable, which a kB
count never usefully was.

**The P2/P4 generation item is done, and the plans said otherwise for two days.** Verified
against the live project on 2026-08-14: `generate-cards` is deployed and `ACTIVE` (version 1,
`verify_jwt: true`, 401 to an unauthenticated request), and `GROQ_API_KEY` and
`GENERATION_MODEL` were both set as function secrets on 2026-08-12. So `/create/text` is
configured, and `npm run demo:seed` is unblocked — it had been the reason P4 could not close.

Worth naming as a failure mode rather than just fixing: the owner did that work from the
dashboard and CLI, where no commit records it, so three files went on asserting it was
outstanding. Anything done outside the repository has to be written back into the repository,
or the plans quietly become fiction about the parts of the system they cannot see. The
owner's remaining list is at the bottom of [P4-ship.md](P4-ship.md).

**Deploy, as of 2026-08-14.** The backend is live; the frontend is not. Supabase holds the
five migrations, the generated types and a deployed `generate-cards`. Vercel has never been
connected, so there is no origin serving the app yet.

The domain is decided: **`synapsedeck.mukeremshifa.com`**, a subdomain of the owner's
`mukeremshifa.com`, DNS on Cloudflare and hosting on Vercel. Vercel because `vercel.json`
was written at P4 and its SPA rewrite is already reasoned about in three documents;
Cloudflare stays the registrar and nameserver only, which means the subdomain's record has
to be **DNS-only, not proxied** — an orange-cloud record in front of Vercel puts two CDNs in
series and breaks certificate issuance. POST-V1 item 11 is closed by the same commit as this
note: the three files carry the real origin now.

**What actually blocks the deploy is git, and it is the owner's.** Local `dev` is 16 commits
ahead of both `origin/dev` and `origin/main`; `origin/dev` is still at P0. Vercel builds from
GitHub, so connecting it today would deploy the scaffold, not the product. Everything from P1
to here has to be pushed first. Per the project rules that is not something a session does.

Fourth, new since P5: the visual system is `src/styles/globals.css` and nothing else — no
component hardcodes a colour, and `src/test/tokens.test.ts` enforces three invariants about
that file (theme parity, chroma-0 neutrals, and the grade ramp's lightness ordering). The
shipped icons and social cards in `public/` are **generated** by `npm run brand:assets` from
`assets/brand/*.svg`; edit the masters, re-run, and commit the result. Re-running must leave
`git status --porcelain public/` empty.

Sixth, new since P7: `/` is public. It is the one route an anonymous request can reach with
anything on it, and the rule that keeps it cheap is not a kB figure but a boundary — the
landing page's module graph may not touch `@/lib/queries`, `@/lib/supabase` or another
feature. Two tests hold it: `LandingPage.test.tsx` walks that graph transitively, and
`landing-requests.test.tsx` renders the real providers and route table with `fetch` and
`WebSocket` stubbed to fail, so "makes zero network requests" is an assertion rather than
something somebody once saw in a network panel.

Fifth, new since P6: that closure is now enforced from the other direction too.
`src/test/palette.test.ts` walks every `.ts`, `.tsx` and `.css` file under `src/` and fails on
a numbered Tailwind palette class or a literal colour outside a comment, so "just this one
green" cannot get back in. P6 also settled the typographic rules a later session would
otherwise re-litigate — where the serif may appear, that numbers are mono, and what "one
accent per screen" excludes — all recorded in SPEC §12 under _Closed at P6_.
