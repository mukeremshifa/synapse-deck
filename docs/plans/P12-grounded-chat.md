# P12 — grounded chat, and the empty pane P11 left

**Status:** Planned 2026-09-06, written as P11's last task · Not started

P11 built the notebook shell and deliberately shipped its centre pane empty
([P11 §3](P11-notebook-shell.md)). This is the plan that fills it — and it is a **backend**
phase, which is why it could not be part of P11.

---

## 1. Preconditions

```bash
git branch --show-current    # aws-native, or a topic branch off it
git status                   # clean
npm run verify               # passes
```

**And one that is not mechanical:** a model must answer. P10 task 10 is still blocked on
Bedrock model access ([P10-SESSION-4.md](P10-SESSION-4.md)), and chat needs *two* model
capabilities that generation does not — embeddings for retrieval, and a chat completion
that can cite. Check both before starting:

```bash
export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
aws bedrock get-foundation-model-availability --region us-east-1 --model-id amazon.nova-lite-v1:0
aws bedrock get-foundation-model-availability --region us-east-1 --model-id amazon.titan-embed-text-v2:0
```

**If either is `NOT_AUTHORIZED`, stop and say so.** This phase cannot be faked: see §3.

---

## 2. Why this is worth doing next

The workspace pane is the largest single area of the app and it currently says "not built".
That is honest, and it was the right call for a frontend rewrite, but it is also the pane a
reviewer looks at first — and "grounded answers with citations" is the capability that
makes a notebook a notebook rather than a folder.

It is also the **third** workload for the Step Functions shape the brief already chose
(AWS-NATIVE-BRIEF §2), and the first that needs a vector store — which is a genuinely new
AWS capability to demonstrate rather than a second helping of one already shown.

---

## 3. The rule this phase exists under

**No stub answers. Not once, not behind a flag, not "just to see the layout".**

P10's stub is safe because a stub card announces itself in its own text and passes through
a review gate before it becomes anything. A chat answer has neither property: it is fluent
prose about the user's own study material, delivered with no gate, and a plausible wrong
answer is indistinguishable from a right one. P11 refused to ship an input box for exactly
this reason and that refusal is inherited, not re-litigated.

If the model is unavailable when this phase runs, the pane stays as it is.

---

## 4. Out of scope

- **Audio overview, mind maps, briefing docs.** Still absent, still not stubs.
- **Multi-source fan-out for generation.** The sources rail says each source is generated
  from on its own; making that false is a different phase and it must update that copy.
- **Anything touching `main`.** Owner's alone.

---

## 5. Tasks, in order

1. **Chunk and embed on ingestion.** The pipeline already chunks for generation
   (`services/api/`); embedding is a second consumer of the same chunks, not a second
   chunker. Store vectors with `user_id` — see §6.
2. **The vector store.** pgvector on RDS is the default choice and should be justified or
   overturned in one paragraph in an ADR, not silently. RDS is already there, already
   tenanted, already backed up; a second datastore needs a reason.
3. **Retrieval endpoint.** `POST /notebooks/{deckId}/ask`. Returns an answer plus spans.
4. **The citation model.** A citation must resolve to a source *and* an offset, or it is
   decoration. Decide the shape before writing the prompt.
5. **The chat pane.** Replace `WorkspacePane`'s empty state. Transcript, input, citations
   that scroll the source into view.
6. **Update the docs.** SPEC §1's note that chat is unbuilt, §4 (a new flow), §8.2 if a
   route is added. This plan's board row. Write P13.

---

## 6. The tenancy trap, named up front

A vector store is a new table, and **`CLAUDE.md` is unambiguous**: a new table on RDS
without a data-access module following all four rules is a cross-tenant leak, not a TODO.

Retrieval makes this sharper than usual. A similarity search is `order by embedding <-> $1
limit k` — a shape where forgetting `where user_id = $2` does not error, does not look
wrong, and returns *the most relevant chunks from every user in the system*, which is the
worst possible failure mode dressed as a working feature.

`scripts/check-data-access.mjs` cannot catch it (it checks shape, not meaning). Read the
query.

---

## 7. Acceptance criteria

1. `npm run verify` passes.
2. Asking a question about a source returns an answer citing that source, and clicking the
   citation reveals the cited span.
3. A question with no support in the sources gets an answer that says so, rather than a
   confident fabrication. **Test this deliberately** — it is the property that makes the
   feature trustworthy and the one most likely to regress silently.
4. The retrieval query includes `where user_id = …`. Verified by reading it.
5. No path produces a chat answer without a model call.

---

## 8. What will go unverified

There are still no tests (ADR 0005). Everything above is checked by hand or not at all —
and for this phase specifically, criterion 3 has no mechanical check whatsoever. Say
"typechecks and builds", and separately say what you asked the model and what it said.
