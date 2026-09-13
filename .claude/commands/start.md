---
description: Orient at the start of a session — branch, status, and what to work on next
---

Orient yourself before doing any work. Run these together:

```bash
git branch --show-current && git status --short && git log --oneline -5
```

Then:

1. **Check the branch.** Work belongs on `dev` or a topic branch off it. If you are
   somewhere else, stop and say so — do not switch branches on your own.
2. **Check the tree is clean.** If there are uncommitted changes you did not make,
   surface them and ask before touching anything.
3. **Find the work.** Read `docs/ROADMAP.md`. Priorities run in order — priority 2 does
   not start before priority 1 is done. If the user named something specific, do that.

Then state, in no more than four lines: the branch, whether the tree is clean, and what
you understand the next piece of work to be. Ask only if it is genuinely ambiguous —
if the roadmap says what to do, start doing it.

Do not read the whole codebase to "get oriented". That is what the docs are for.
