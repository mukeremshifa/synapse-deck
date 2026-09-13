# SynapseDeck — Specification

**Owner:** Mukerem Shifa · **Rewritten** 2026-09-13

This describes the product **as it exists today**. It is not a plan and carries no phase
history — that was deleted; see [HISTORY.md](HISTORY.md). What comes next is in
[ROADMAP.md](ROADMAP.md).

When a decision changes, change this file. Do not append a "superseded" note — the old
version is in git.

---

## 1. What it is

Keep what you are studying in a **notebook**; turn it into flashcards, quizzes, notes and
exams; get drilled on them at the right time.

**The bet:** the hard part of flashcards is not the flip animation. It is (a) generating
cards actually worth reviewing, and (b) scheduling them so review effort converts into
retention.

### Not building

OCR or handwriting. A public deck marketplace or social features. Native mobile apps
(responsive web only). Collaborative editing. **Notes are read-only** — there is no notes
editor and none is planned.

### Users

A self-directed learner studying from text they already have — lecture notes, articles,
textbook passages — who wants cards without typing them. Not teachers assigning decks to
classes, not teams sharing them.

---

## 2. The nouns

A **notebook** is the only first-class container. Everything else hangs off one.

| Noun | What it is |
| --- | --- |
| **Notebook** | The container. Owns sources and artifacts. |
| **Source** | Material the user added — pasted text or an uploaded file. Persists. Deleting one leaves its artifacts standing, rendered struck through rather than omitted. |
| **Artifact** | One kind-tagged noun: `deck`, `quiz`, `noteset` or `exam`. Not four tables. |
| **Card** | A flashcard carrying FSRS state. Lives in a deck artifact. |
| **Question** | Not a card. Lives in a quiz or exam. Eight kinds, all graded deterministically. |
| **Attempt** | One sitting of a quiz or exam. A durable record. |
| **Topic** | The join between material and mastery. Reconciled by normalised name, per notebook. |

**A generation produces a new artifact, never a replacement.** This is why a practice
session's cards cannot change underneath the user mid-review.

An artifact's `payload` stores only what cannot be derived. Every count is computed.

### Card types

`basic`, `cloze`, `mcq` — a discriminated union. Content varies by type; scheduling state
does not.

### Question kinds

`mcq`, `msq`, `true/false`, `numeric`, `matching`, `ordering`, `fill-in-the-blank`,
`categorise`. All eight grade deterministically — **no model runs at grade time.**

---

## 3. Routes

```
/                                                  home
/settings                                          settings
/notebooks/:notebookId                             the notebook (three panes)
/notebooks/:notebookId/overview                    analytics
/notebooks/:notebookId/decks/:deckId/practice      practice runner
/notebooks/:notebookId/quizzes/:quizId             quiz runner
/notebooks/:notebookId/exams/:examId               exam runner
/notebooks/:notebookId/notes/:noteSetId            notes reader
/login  /signup  /auth/callback                    auth
```

**Every runner route names its artifact.** A runner that read `:notebookId` and treated it
as a deck id was a real bug — one notebook's session served every notebook's cards.

Modals are URL-reflected (`src/app/modals.tsx`). Confirmations deliberately are not.

---

## 4. The notebook

Three panes above tablet width, three tabs below `md`.

| Pane | Width | Holds |
| --- | --- | --- |
| Sources | 22% | The notebook's sources. "+ Add source" is the primary CTA. |
| Chat | 52% | Grounded chat. Ephemeral — no persistence, no history, resets on navigation. |
| Studio | 26% | Artifacts by kind, each with server-computed readiness and provenance. |

> **This split is wrong and [ROADMAP.md](ROADMAP.md) priority 1 changes it.** The most
> transient pane owns the most screen; the study material is cramped into a quarter.

Below `md` both layouts must not render at once — `PaneGroup` hardcodes `flex` in its own
`cn(...)`, so a `hidden` class passed to it loses. Branch, do not just hide.

---

## 5. Scheduling

FSRS via `ts-fsrs`, with a per-review log table from day one.

Due-queue policy is **one implementation, on the client, in `queue.ts`** — the same policy
drives the practice queue, home's "new available" figure and the forecast's day 0.

A practice session's state is component state, not TanStack Query. The queue arrives once
as a snapshot; refetching underneath someone would reorder cards they are part-way through.

---

## 6. Generation

One generate modal, four kinds, source selection scoped to the notebook. Generation never
navigates away and never creates a notebook.

`createArtifact` returns a **`Job`**. Progress is stages derived from reported fields only —
indeterminate until `unitsTotal > 0` — and survives navigating away and back, because it
reads `listJobs` rather than anything the modal held.

**A failed job leaves no half-artifact.** The row flips to `failed` with 0 cards rather
than spinning for ever.

There is **no review gate**. The contract has no draft card and no accept step; what exists
is a partial-success surface over `Job.truncated`. Restoring a card-by-card gate means
changing the contract deliberately.

---

## 7. Architecture

```
src/lib/api/contract.ts     the specification — nouns as Zod, ApiClient interface
       ├── fake.ts          typed in-repo implementation (frontend develops against this)
       └── client.ts        HTTP transport (production)

services/api/src/data/      ALL SQL lives here, and the tenancy boundary with it
services/api/migrations/    append-only plain SQL
infra/                      CDK, two stacks, us-east-1 — frozen, do not delete
```

43 contract methods, all 43 served. Both implementations satisfy the interface with no
cast. **Change the contract first, then both sides.**

### Tenancy

Application-level, not RLS. Four mandatory rules, and the reasoning for why they are weaker
than what they replaced, are in [HISTORY.md §2](HISTORY.md#2-tenancy-is-application-level-and-weaker-than-what-it-replaced).

### Runtime seams

`CARD_PROVIDER`, `JOB_STORE`, `PIPELINE_RUNNER`, `UPLOAD_STORE`, `EMBEDDING_PROVIDER`. Each
throws when unset. See [HISTORY.md §6](HISTORY.md#6-runtime-seams-pick-infrastructure-and-none-has-a-default) —
these are what make [ROADMAP.md](ROADMAP.md) priority 2 cheap.

---

## 8. Frontend

TypeScript strict with `noUncheckedIndexedAccess`. Tailwind v4 + shadcn/ui. TanStack Query
for server state, component state for session state.

**Card content is untrusted LLM output — render it as text.**
`dangerouslySetInnerHTML` is blocked by an ESLint rule; do not disable it. Markdown support
must use a React renderer emitting elements, never raw HTML.

One Zod definition per concept, shared by client and server. Do not redefine a card shape
anywhere else.

The design system — palette, contrast method, tokens, the four states — is in
[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md). Contrast is **computed, not asserted**:
`scripts/check-contrast.mjs` parses `globals.css`, so it cannot drift.

---

## 9. Non-functional

- **Keys never reach the browser.** Provider keys are server-side only.
- **Open signup, private notebooks.** Per-user generation quota and rate limiting.
- **Groq free tier** limits *tokens* per minute, not requests — a request-shaped backoff
  reliably fails. Honour `retry-after`.
- **Accessibility:** keyboard-operable runners, visible focus, contrast verified by script.

---

## 10. What is not true yet

Listed so the spec does not describe software that does not exist:

- **Grounded chat has never answered a question.** Retrieval is built; no embedding key was
  ever supplied.
- **Exam questions are a fixture.** The blueprint and diagnostic read real user data; the
  questions do not. The UI says so.
- **Nothing is deployed.** The path has never been walked on real infrastructure.
- Cards cannot be edited, listed, or created by hand. Sources cannot be opened.

All four are [ROADMAP.md](ROADMAP.md) priority 1.
