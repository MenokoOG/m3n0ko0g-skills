---
name: incident-replay
version: 0.1.0
description: Reconstructs what an AI system actually did during a bad run, using whatever logs exist, and names precisely which evidence is missing to ever answer the question. Separates what is known from what is inferred from what is unknowable, and ends with the smallest logging change that would make the next incident diagnosable. Use after an agent did something wrong, during a postmortem, or when someone asks what happened and the room goes quiet.
license: Released by Lawrence Jefferson II for public use.
---

# Incident Replay

The agent sent the wrong email. Or approved the wrong refund, or told a customer something that isn't true, or ran a tool 40 times in a loop at 2am. Somebody asks what happened.

And the honest answer, most of the time, is that nobody can tell. The system logged that a request came in and that a response went out. What the model saw, what it decided, which branch it took, what the tool returned: none of it was written down, because in 2023 the thing was a prototype and nobody logs a prototype.

This skill does two jobs. It reconstructs as much of the run as the evidence supports, marking every step by how well it's known. And then it names exactly what was missing, so the next incident is a lookup instead of a seance.

The second job is the more valuable one. Most incidents can't be fully explained. All of them can be made explicable next time.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* A reconstruction is only as good as its evidence. The temptation in a postmortem is to produce a clean narrative because a clean narrative feels like understanding. This skill marks every step Confirmed, Inferred, or Unknown, and it never promotes an Inferred step to Confirmed because the story would read better.

## When to use this

After an agent does something wrong or expensive. During a postmortem, especially one where the root cause is described as "the model hallucinated," which is a conclusion disguised as an explanation. When a customer disputes what the system told them. When an auditor or a regulator asks for the record. Before giving an agent more authority, run it on a past incident as a rehearsal for the one that hasn't happened yet.

Also run it when nothing has gone wrong. Pick a normal run and try to reconstruct it. If you can't reconstruct a good run, you definitely can't reconstruct a bad one, and it's much cheaper to find that out on a quiet Tuesday.

Don't use it to assign blame to a person. A reconstruction that reads as an accusation gets contested rather than acted on, and the logging never gets fixed.

## The method

### Step 1: Fix the boundaries before you look at anything

Write down the exact window, the identifiers, and the claim.

Start and end time, with timezone. The request, session, trace, or conversation id if one exists. The specific thing that's alleged to have happened, stated as a claim you can test rather than as a summary. "The agent told the customer their warranty covered water damage" is testable. "The agent gave bad information" is not.

Also write down who is asking and what decision hangs on the answer. A postmortem that feeds an engineering fix and a reconstruction that feeds a legal response need different levels of rigor, and you should know which one you're writing before you start.

### Step 2: Inventory the evidence, before reading it

List every place a trace of this run could exist, and mark each available, partial, or absent. Do this first, as a list, because the gaps in this inventory are half the deliverable and they're easy to forget once you get absorbed in the logs you do have.

Where to look: application logs, the LLM provider's own logs and dashboards (often retained longer than yours and frequently forgotten), an observability or tracing vendor, the database rows the run wrote or changed, outbound side effects like emails, webhooks, tickets and payments, the conversation record shown to the user, feature flag and config state at that moment, deploy history, the vector store and what was in the index that day, and any queue or retry records.

For each, note the retention window. An incident reported 40 days later against a 30 day retention is a different investigation, and knowing that in the first ten minutes saves a day.

### Step 3: Build the timeline with confidence marks

Reconstruct the run step by step. Every step gets one of three marks, and the marks are the point.

**Confirmed.** Direct evidence exists. A log line, a database row, a stored payload, a provider record. Cite it: source, timestamp, identifier.

**Inferred.** No direct evidence, but the code path plus surrounding evidence makes it near-certain. Example: no log of the retrieval call, but the answer quotes text that exists in exactly one document, so that document was almost certainly retrieved. State the inference and the reasoning in one line. Inferred is legitimate and useful, and it must never be written as fact.

**Unknown.** Can't be established. Say what would have established it. "The model's tool-call arguments were not logged. A single log line at agent.py:104 would have captured them."

Keep the timeline in event order with timestamps. Where a timestamp is absent, write the ordering you can establish and mark the rest Unknown rather than interpolating.

### Step 4: Locate the decision point

Almost every incident has one moment where the run went from recoverable to not. Find it and describe it precisely.

It's usually one of five things. A classification or routing decision that picked the wrong branch. A retrieval that returned the wrong context, or nothing, and the system answered anyway. A tool call with wrong arguments. A guard that should have fired and didn't, or doesn't exist. A human approval step that was bypassed, auto-approved, or never designed.

Be precise about which. "The model hallucinated" is not a decision point, it's a shrug. The useful version is: *"Retrieval returned 5 chunks, all below 0.3 similarity. There's no floor, so the model received 5 unrelated chunks plus an instruction to answer from context, and it did what it was told."* That names a mechanism and a fix. The shrug names neither.

If the decision point can't be located because of missing evidence, say that plainly and make it the headline finding. That's a much more important result than a plausible guess.

### Step 5: Separate cause from contributing conditions

The cause is the thing that, changed, prevents this run. Contributing conditions made it possible or made it worse.

Both go in the report, clearly labeled. The reason to separate them is that postmortems tend to generate a list of twelve improvements and no fix. Naming one cause and calling the rest conditions keeps the fix from getting diluted into a backlog.

If you genuinely can't determine the cause, write "cause: not determinable from available evidence," and list what would have determined it. Don't pick the most plausible candidate and promote it. An incident report with a confident wrong cause is worse than one with an honest gap, because the fix goes to the wrong place and everyone believes it's handled.

### Step 6: Write the evidence gap as a change list

This is the part that pays for the whole exercise.

For every Unknown in the timeline, write the specific change that would have resolved it: the file, the line, the field. Then rank by how many Unknowns each change closes, because one well-placed log line often closes five.

Be concrete about cost and about retention. "Log the retrieved chunk ids and scores at retriever.py:52. One line. Closes U1, U3, U4. At current volume, roughly 40MB a month. Retain 90 days." That's a ticket. "Improve observability" is not.

Watch the privacy boundary here. Logging full prompts and responses closes every gap and creates a new problem: a permanent store of customer content, model output, and possibly personal data, sitting in a log system with looser access control than the database. Recommend logging identifiers, scores, decisions, token counts, and hashes by default. Recommend full content capture only with a stated retention window and a stated access control, and say so out loud rather than leaving it implied.

## What to look for

**Nothing logged between request and response.** The most common shape by far. The system has an input and an output and no middle.

**Tool calls logged as "called tool X" with no arguments and no result.** Half a record. You know it acted and not what it did.

**Retrieval not logged.** Makes every RAG incident undiagnosable.

**Unpinned model alias.** You can't establish which model produced the output. If the alias moved that week, that alone may be the cause and you'll never prove it.

**Prompts assembled at runtime from a database.** You can't recover what the prompt said that day unless the table is versioned. Check whether it is.

**No request id threaded through.** Logs exist but can't be joined into one run.

**Timestamps without timezone,** or mixed timezones across services. Ordering becomes guesswork at exactly the wrong moment.

**Retries invisible.** One log line for a call that ran three times means you're reading the third attempt and don't know it.

**The user-facing conversation stored, but not the system prompt or the retrieved context.** You can see what was said and not why.

**Feature flag state not recorded.** The code you're reading today may not be the code that ran.

**Provider-side logs nobody checked.** Frequently the only surviving record. Check them early, they often have their own retention clock.

## The output

Write `INCIDENT-REPLAY.md`. Evidence inventory first, then timeline, then the gap list. The person who reads only the first page needs to know what's knowable before they read anything that looks like a conclusion.

```
INCIDENT REPLAY
incident:  <short factual description of the claim being tested>
window:    <start> to <end>  <timezone>
ids:       <request / session / trace ids, or "none available">
asked by:  <who, and what decision depends on this>
date:      <ISO-8601>

EVIDENCE INVENTORY
  source                        status     retention   note
  application logs              partial    30d         request in / response out only
  provider dashboard            available  90d         token counts, model, finish reason
  tracing vendor                absent     -           not instrumented on this path
  database rows written         available  -           ticket 88214 updated 14:22:07Z
  outbound email                available  -           message-id <...>, sent 14:22:09Z
  conversation shown to user    available  -           4 turns
  retrieved chunks              absent     -           never logged
  prompt text as sent           absent     -           assembled at runtime, table not versioned
  feature flags at that time    absent     -           not recorded
  deploy history                available  -           no deploy that day

TIMELINE      (C = confirmed, I = inferred, U = unknown)

  14:22:01Z  C  Request received. session 9f2a, user asks about water damage.
                app.log:118841
  14:22:01Z  U  System prompt as sent. Assembled from prompt_templates at
                runtime. Table has no history. Content that day not recoverable.
  14:22:02Z  I  Intent classified as "coverage_question". Not logged. Inferred
                from the branch taken: only that branch reaches retrieval.
  14:22:03Z  U  Retrieval ran. Chunk ids, scores, and count all unlogged.
  14:22:03Z  I  Retrieval returned something. The answer quotes a sentence
                appearing in exactly one corpus document (policy-2019-b).
                That document was superseded in 2024 and is still in the index.
  14:22:06Z  C  Model responded. 1,203 in / 214 out. provider dashboard.
                Model string recorded as an alias, not a version. See U2.
  14:22:07Z  C  Ticket 88214 updated with the answer text. db row.
  14:22:09Z  C  Email sent to customer. message-id <...>.
  14:22:09Z  U  Whether any guard evaluated this answer before it went out.
                No guard is present in the code today. Whether one was present
                that day is unknown, because flag state was not recorded.

DECISION POINT
  Retrieval returned a superseded document and nothing in the system marks
  documents as superseded. There is no date or version field on chunk
  metadata (confirmed, ingest.py:44). The model was given text that was
  true in 2019 and asked to answer from context. It complied.

  Confidence: Inferred, high. The quoted sentence exists in exactly one
  document. Direct confirmation is not possible because retrieval was
  never logged.

CAUSE
  Not determinable with certainty. The strongest supported account is the
  decision point above. The evidence that would settle it, retrieved chunk
  ids, does not exist and cannot be recovered.

CONTRIBUTING CONDITIONS
  1  Superseded documents are not removed from the index and carry no
     status field. Confirmed.
  2  No similarity floor on retrieval, so the system cannot decline to
     answer. Confirmed, retriever.py:44.
  3  No guard between model output and an outbound customer email.
     Confirmed by reading current code.
  4  Prompt content that day is unrecoverable. Confirmed.

EVIDENCE GAP     (ranked by Unknowns closed)

  G1  Log retrieved chunk ids and scores.
      retriever.py:52, one line. Closes U3, and converts the decision
      point from Inferred to Confirmable next time.
      ~40MB/month at current volume. Ids and scores only, no chunk text.

  G2  Version the prompt_templates table, or move prompts into the repo.
      Closes U1. Also closes the same gap for every future incident.

  G3  Log the resolved model version, not the alias.
      One line at the client wrapper. Closes U2.

  G4  Record feature flag state with each request id.
      Closes U4.

  G5  Log the classification result and score.
      Converts an Inferred step to Confirmed. Lower value than G1 but
      nearly free.

  Note on scope: do not log full prompts and responses by default. That
  closes every gap and creates a permanent store of customer content in a
  system with weaker access control than the database. Ids, scores,
  decisions and token counts close most of these gaps without it.

RECOMMENDED NEXT STEP
  One thing: G1. It is one line, it is the missing evidence in this
  incident, and it is the missing evidence in every retrieval incident
  this system will have.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       incident-replay
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
incident:    <internal incident ref or hash, never a description with customer detail>
window:      <duration>
evidence:    <n> sources available / <n> partial / <n> absent
timeline:    confirmed <n> / inferred <n> / unknown <n>
cause:       <determined | inferred | not-determinable>
gaps:        <n> logging changes identified
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

The receipt never contains customer content, prompt text, model output, or personal data. An incident receipt is the one most likely to end up in a shared channel, so it carries shape only.

`human` starts at `pending` and is only ever set by a person. On an incident, that field is the record that someone accepted the account, and it matters more here than anywhere else in the library.

## Rules

Never write a timeline step without a confidence mark. An unmarked step reads as Confirmed and that's how a guess becomes a finding.

Never promote Inferred to Confirmed because the narrative is cleaner. The gaps are the deliverable.

Never accept "the model hallucinated" as a cause. Name the mechanism: what was in the context, what guard was absent, what the model was instructed to do with what it got.

Never blame a person. Name the missing control.

Never recommend logging full prompts and responses without saying what that creates: a retention obligation, an access-control question, and possibly a personal data store. Say it in the report, not in a footnote.

Never stop at the reconstruction. The gap list is the part that changes anything. A postmortem that explains one incident and prevents nothing is a document.

If the retention window has already closed on the evidence you need, say so in the first block. That's the finding, and it should change the retention policy before it changes anything else.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Agent Gate Review** (the controls that were missing) and **RAG Integrity Check** (when the decision point turns out to be retrieval, which it often does).

LAHA, Love All Humans Always.
