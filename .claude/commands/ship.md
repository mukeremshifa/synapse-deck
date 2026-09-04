---
description: Run the fast gate and commit the current work to dev
---

Commit the work in progress. This is the everyday path — fast gate, then commit.

1. **Run the fast gate.**

   ```bash
   npm run check
   ```

   If it fails, fix it and run again. **Do not commit with a failing check.** If you
   cannot fix it, stop and explain — leaving work uncommitted is better than committing
   something broken.

2. **Review what you are about to commit.**

   ```bash
   git status --short && git diff --stat
   ```

   If something unexpected is staged — a build artifact, a `.env`, a file you did not
   touch — stop and ask.

3. **Commit to `dev`** (or the current topic branch). Write a concise imperative subject
   saying what changed, and a body only where the *why* is not obvious. Match the
   existing history; see `docs/adr/0003-branching-model.md`.

4. **Stop there.** Do not push. Do not merge. Do not offer to. Say what was committed and
   what remains.

If the work finishes a phase or a significant chunk, say so and suggest `/checkpoint`
rather than running it unprompted.
