# Session brief — priority 1, the last of it

**Written 2026-09-13.** Branch `dev`. Read [ROADMAP.md](ROADMAP.md) first, then this.

Items 1–5 of priority 1 are done. What is left is **visual refinement** — and, before it,
the thing that matters more: **nobody has ever looked at any of this.**

> Everything below was verified against the code on 2026-09-13. Trust this file over any
> other description of the app, and the code over this file.

---

## 0. Before you touch anything

```sh
git branch --show-current      # expect: dev
git status --short             # expect: clean
npm run check                  # expect: pass, ~15s
```

`dev` is yours — commit and push without asking. `main` is frozen. There are no tests;
report work as "typechecks and builds", never "tested" or "works".

`npm run infra:synth` is still broken on this machine (`EPERM … rename` during CDK asset
bundling). It is a Windows file lock, it predates all of this, and `infra/` is frozen.

---

## 1. Your job, in the order that matters

### (a) Open the app and click through it. Before anything else.

**Four sessions have now built priority 1 and not one has had a browser.** Everything in
§2 compiles, lints, builds, and has never been rendered. That is the single largest risk
in this repository and it is also the cheapest thing on this list to retire.

```sh
npm run dev:api    # the real handlers against local Postgres
npm run dev        # vite
```

`.env.local` is complete — Cognito, Neon, Groq, and `VITE_API_MODE=live`. `DEMO_EMAIL` and
`DEMO_PASSWORD` are in it. Set `VITE_API_MODE=fake` to run with no backend at all; both
paths work.

The list of what has never been seen is §3. Work down it. **Expect to find real bugs** —
the last session found one by probing a regex it had just written (see §2(e)), and that
was in code far simpler than a three-pane layout.

### (b) Then visual refinement, which is all that is left of priority 1

- **Dark mode is flat pure black** with no surface layering.
- **Loading states are raw spinners.**
- **Home shows four stats and offers no way to act on them.** Five minutes between classes
  costs four clicks. This is the one with product substance in it, not just polish.

---

## 2. What the last session built

Two commits: `e6d8323` (layout) and `4b48cde` (study polish).

### (a) The notebook is sources · workspace · Studio

Chat used to own 52% of the centre. The centre is now a **workspace** showing whatever is
selected — a source, a deck's cards, or the notebook's summary — and chat is a **sheet**
opened from the header (`?modal=chat`).

**What is open is in the URL**: `?view=source&item=<id>`, `?view=deck&item=<id>`, or
neither for the summary. `src/features/notebook/workspace.ts` owns it. This is not
decoration — a deck on screen that the address cannot name is the shape of a bug this app
already had, where a route read `:notebookId` and treated it as a deck id.

The pane group's `autoSaveId` is now `notebook-panes-v2`. A stored layout was percentages
against the old panes, and anyone who had dragged chat narrow would have opened the new
notebook with the workspace crushed to that width.

### (b) Bodies, not pages — the pattern to keep using

`SourceBody` was split from its sheet by an earlier session and moved into the workspace
unchanged, exactly as predicted. `DeckBody` was split out of `DeckBrowser`'s `FocusFrame`
the same way. **Both card surfaces are kept**: the workspace for fixing a card without
leaving the notebook, the route for bookmarks and for editing two hundred cards.

If you need a surface in two frames, split the body. Do not fork it.

Renames, so a grep for the old names finds nothing: `SourceViewer.tsx` → `SourceBody.tsx`,
`ChatPane.tsx` → `ChatBody.tsx`, `ExamNavigator.tsx` → `QuestionNavigator.tsx`.

### (c) The Overview is findable

It was reachable only through a tile labelled "Diagnostics" in a grid of things you
*create*. The tile is gone and it is a named link in the header and the workspace. With the
tile went `Generator.kind`'s nullability, so every generator is a real `ArtifactKind` again.

### (d) Study polish

- **Card flip** — the *answer* rotates face-up, not the card. A two-sided flip would take
  the question away at the moment you need it to rate against.
- **Question navigator in quizzes** — the exam's component, used rather than copied. Both
  runners already held `Map<string, AttemptAnswer>` plus an index. Shown above three
  questions.
- **Drill incorrect** (`DrillIncorrect.tsx`) — re-asks the missed questions and **records
  nothing**. A new attempt over the missed subset would land 100% on a quiz actually scored
  60%. It drills what was answered *wrongly*, never what was left unanswered.
- **Inline markdown and math in notes** — `components/InlineText`, shared by chat answers
  and note blocks.

### (e) Two things found by testing rather than reading

**1. `motion-safe:` generates nothing in this project.** Tailwind v4 emits variants only
for utilities it knows, so `motion-safe:` on a component-layer class of ours produces no
CSS — confirmed against the production bundle, where no `motion-safe:*` rule ships at all.
**That means the three existing `motion-safe:animate-in` call sites have always been inert**
(`animate-in` does not exist either — it is a leftover from `tailwindcss-animate`, which
`globals.css` says was deliberately not installed). They are harmless, they are still
there, and they are worth cleaning up if you are nearby. Reduced motion is honoured by the
global `prefers-reduced-motion` block, which matches `*`.

**2. A naive italic rule corrupts arithmetic.** `\*[^*\n]+\*` turns "multiply 3 * 4 * 5"
into an italic " 4 ". The delimiters now have to hug non-space, as in markdown. Found by
extracting the regex from the shipped file and running it over real strings — do that
again for anything parser-shaped, it costs a minute.

### (f) No markdown library, deliberately

`InlineText` is a regex split producing elements, so it **cannot** emit HTML by
construction rather than by configuration — there is no `skipHtml` to get wrong. A real
engine would also parse block structure the contract does not have: there is no code,
table or image in `NoteBlock`, so a paragraph starting `# ` would silently become a
heading inside a paragraph.

Maths sets variables, exponents and indices (`$E=mc^2$`, `$x_{n+1}$`). Anything with a
backslash or beyond simple `^`/`_` renders **as its own source**, because a half-rendered
formula in revision notes is worse than a visibly literal one.

---

## 3. What nothing verifies — read before trusting §2

`check` and `verify` prove the code compiles, lints and builds. Nothing else. Every item
below is typechecked and has never been rendered.

**The layout, all of it.** Three panes at their new sizes; the workspace's three states;
the source-not-found state; resizing; the `-v2` layout key actually discarding the old one;
the whole tabs branch below `md`.

**The URL selection.** Opening a source and a deck; back and forward walking selections;
reload restoring one; a pasted `?view=deck&item=<bad id>`; `?view=source&item=` (empty,
which the code resolves to the overview — verify it does).

**The chat sheet.** That it opens from the header, that `?modal=chat` restores on a pasted
URL, that back closes it, and that the transcript is lost on close — which is expected and
documented, but should be *seen* rather than assumed.

**`SourcesPane`'s row.** It now has a `<Link>` where it had a `<button>`, plus a checkbox
and a delete button — three tab stops. **Check this with the keyboard as well as the
mouse**; the previous brief flagged the same row and it has changed again since.

**Every study-polish surface.** The flip's timing and whether reduced motion really kills
it; the navigator in a quiz of twenty; the whole drill flow including "Drill again" and the
end-of-drill card; and notes with `**bold**`, `*italic*`, `` `code` `` and `$x^2$` in them
— including whether the demo seed has any such notes to render.

**What was *not* checked even in logic:** whether the demo data exercises any of this. A
notebook with two sources and one deck will not show you much.

---

## 4. Rules that will bite you

- **`userId` never comes from the client.** If you touch `services/api/`, read the four
  tenancy rules in [HISTORY.md §2](HISTORY.md#2-tenancy-is-application-level-and-weaker-than-what-it-replaced).
  Rules 2 and 4 are **not enforced by any linter**.
- **No SQL outside `services/api/src/data/`.**
- **One Zod definition per concept.** `CardPayload` lives in `src/lib/schemas.ts`, not in
  `contract.ts`.
- **Card and note content is untrusted.** Render it as text or as elements.
  `dangerouslySetInnerHTML` is blocked by an ESLint rule; do not disable it, and do not add
  a markdown library to get around the inconvenience — see §2(f).
- **`npm run check:routes` proves the two route tables match. It does not prove a route
  reaches a handler.** A whole phase once shipped with every ingestion route returning 500.
- **`npm run check` before every commit.** Never commit with it failing.
- **Do not create new documents.** `docs/` is six files. `BRIEF.md` is the only one ever
  *replaced* — rewrite it for the session after you.
