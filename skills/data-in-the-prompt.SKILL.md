---
name: data-in-the-prompt
version: 0.1.0
description: Traces what data actually reaches a third-party model. Follows every field from its source through interpolation, retrieval, tool results, conversation history, and error paths into the request body, then checks it against what the contract, the privacy notice, and the data map say is allowed. Reports what leaves, where, and whether anyone could prove it. Use before an audit, before a provider change, before turning on logging, or when someone asks whether customer data goes to the model and the answer is a pause.
license: Released by Lawrence Jefferson II for public use.
---

# Data In The Prompt

Somebody asks a simple question. Does customer data go to the model provider?

The answer people give is usually "no, we only send the question." Then you read the code and the question arrives with 5 retrieved document chunks, the last 8 turns of conversation, a tool result containing a full account record, and a system prompt that interpolates the user's name and plan tier for personalization.

None of that was hidden. It just accumulated, one reasonable feature at a time, and nobody ever sat down and traced the whole request body end to end.

This skill does that trace. It's not a compliance opinion and it doesn't tell you what the law requires. It tells you what leaves the building, through which door, and whether you could prove it to someone who asks.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Static tracing shows what the code can send. It cannot tell you what's actually in a database column, what a user typed, or what a document in the corpus contains. A field named `notes` may hold anything. Where the content is unknown, this skill says Unknown and names the sample that would settle it, rather than assuming a field is clean because its name looks harmless.

## When to use this

Before an audit, a security review, or a customer questionnaire that asks about subprocessors. Before switching model providers, since the data map names the old one. Before turning on prompt logging, which converts a transient send into a stored copy and is a materially different thing. Before adding a tool that reads from a new system, because tool results land in the prompt and the tool's author is usually thinking about capability, not data flow.

Also when a feature adds personalization. "Include the customer's name so it feels warmer" is a data flow change, and it never gets reviewed as one.

Don't use it as a legal assessment. It produces the factual trace that a legal assessment needs. Those are different jobs and conflating them helps nobody.

## The method

### Step 1: Name the destinations

List every external endpoint that receives prompt content. Not just the main model.

The chat or completion provider. The embedding provider, which receives every document you index and every query a user types. A reranker. A moderation or classification API. An observability or tracing vendor, which usually captures full payloads and is the destination people forget most often. A prompt-management or eval platform. An error tracker, which captures request bodies in stack traces. Log aggregation, if prompts are logged.

For each, record: the vendor, the region the request goes to, whether a data processing agreement exists, whether the vendor trains on the data under your current plan, and the retention period. Get these from the contract or the vendor's documentation. Where you can't, mark Unknown. An Unknown here is a real finding, because "we assume they don't train on it" has been wrong before.

Note when the region is genuinely unknown. A global endpoint with no region pinning means you can't answer where the data is processed, and that's the exact question a data protection questionnaire asks.

### Step 2: Decompose the request body

Take each model call and break the request into every component that carries data. For each component, trace back to where the value comes from.

**The user message.** Free text, so treat it as capable of containing anything, including data your schema never anticipated. Users paste. They paste account numbers, screenshots of statements, and other people's personal information.

**The system prompt.** Check for interpolation. Names, ids, plan tiers, account state, internal notes, and "here is what we know about this customer" blocks all show up here.

**Conversation history.** How many turns, and does it include tool results and retrieved context from earlier turns? History often carries data forward long after the turn that needed it.

**Retrieved context.** The single largest surface in most RAG systems. What's in the corpus? If the index was built from a document store, a wiki, a ticket system, or a shared drive, then whatever was in there is now potentially in a prompt. Check whether ingestion filtered anything. Usually it didn't.

**Tool and function results.** A tool that reads a customer record returns that record into the conversation, and from there into every subsequent request in the session. This is the least-noticed path and often the most sensitive.

**Few-shot examples.** Check their provenance. Examples built from real production data are a permanent leak of whatever those records contained, sent on every single call.

**Error and retry paths.** An exception handler that includes the failing payload in a message to an error tracker sends the whole prompt to a new destination on the worst day.

**Metadata fields.** User ids, session ids, and custom tags sent alongside the request. Some providers accept a `user` field explicitly for abuse monitoring. Note what you put in it. An email address there is a different disclosure than an opaque id.

### Step 3: Classify what each field can carry

For each field in the trace, mark what class of data it can carry. Mark the ceiling, not the typical case.

Use plain categories: direct identifiers (name, email, phone, address, account number), indirect identifiers (ip, device id, precise timestamp plus location), financial, health, credentials and secrets, employment or HR content, children's data, and confidential business content that isn't personal but is still not meant to leave.

Two rules make this useful instead of theatrical.

First, mark by what the field can hold, not what you hope it holds. A free-text `notes` column in a support system holds whatever agents typed, and agents type everything. Mark it as capable of direct identifiers and confidential content, then mark the actual content Unknown and recommend sampling it.

Second, flag any field that reaches the prompt with no bound on its size or shape. An unbounded interpolation is both a data flow risk and a prompt injection surface, and it's worth naming once for both reasons.

### Step 4: Check the trace against what's been claimed

Now compare the trace to the documents that make claims about it.

The privacy notice or policy, and whether it names AI processing and subprocessors. The data processing agreement and its subprocessor list, and whether every destination from Step 1 appears on it. The data map or record of processing, if one exists. Customer contracts, especially any that promise data stays in a region or never reaches a third party. Security questionnaire answers already sent to customers, which are commitments in practice. Internal policy, including any rule about what may be pasted into an AI tool.

Report each mismatch as a factual gap: what the document says, what the code does, and the file and line proving it. Don't characterize a gap as a violation. State the discrepancy and let the people whose job it is make that call. A trace that overreaches into legal conclusions gets argued about instead of fixed.

### Step 5: Check whether you could prove any of this

This is the step that turns the report from a snapshot into something durable.

Could you show, for a specific request last Tuesday, what was sent? If a customer invokes a deletion right, can you find and delete what reached the provider, or is it in a retention window you don't control? If a provider changed its training policy, could you tell what you'd already sent? Is there any test or check that fails when a new field starts reaching the prompt?

Almost always the answer to the last one is no, and it's the most useful recommendation in the report. A single test asserting the set of fields in a request body turns data flow from something you re-audit every year into something CI enforces.

## What to look for

**Tool results carrying full records** where the model needs two fields. The most common oversharing in agent systems and usually a one-line fix at the tool boundary.

**Conversation history unbounded**, carrying a tool result from turn 2 into turn 30.

**The corpus never filtered at ingestion.** Whatever was in the source is in the index, including the documents nobody meant to publish internally either.

**An observability vendor capturing full payloads by default.** Frequently absent from the subprocessor list.

**An error tracker with request-body capture on.**

**Personalization added to a system prompt** in a commit whose message is about tone.

**Few-shot examples built from real records.**

**An embedding provider different from the chat provider,** so there are two subprocessors when everyone thinks there's one.

**No region pinning.**

**Prompt logging that stores full payloads indefinitely**, in a log system with broader internal access than the source database. This is a real and common outcome: data that was tightly controlled in the database becomes readable by anyone with log access once it passes through a prompt.

**A redaction step that runs on the user message only,** leaving retrieval and tool results untouched.

**Free-tier or personal API keys** in any environment, where the data terms are different and usually worse.

## The output

Write `DATA-IN-THE-PROMPT.md`. Destinations first, then the trace, then the gaps. Someone answering a customer questionnaire should be able to work from the first two blocks.

```
DATA IN THE PROMPT
system:  <name>       date: <ISO-8601>
calls traced: <n>     destinations: <n>

UNKNOWNS  (read these first)
  U1  Corpus content not sampled. 41,000 chunks ingested from the shared
      drive with no filter. What is in them is unknown. All of it reaches
      the model when retrieved. Sampling 200 chunks would settle this.
  U2  `customer.notes` is free text. Content unknown. Marked at ceiling.
  U3  Whether the tracing vendor's payload capture is on in production
      could not be determined from the repo. Config is set in their UI.

DESTINATIONS
  vendor            purpose      region   DPA   trains?   retention
  <chat provider>   answers      us-east  yes   no        30d
  <embed provider>  indexing     us-east  yes   no        30d
  <tracing vendor>  observability unknown no    unknown   unknown  <-- G1
  <error tracker>   errors       eu-west  yes   no        90d      <-- G2

WHAT REACHES THE MODEL     (answer path)
  component            source                        can carry          bound
  user message         free text from customer       anything           none
  system prompt        template + interpolation       name, plan tier    fixed
                       prompt.py:31 injects customer.name
  history (8 turns)    prior turns incl tool results  anything prior     8 turns
  retrieved context    vector index, 41k chunks       unknown, see U1    top-10
  tool: get_account    full account record            direct id,         none
                       tools/account.py:44            financial
  tool: search_tickets full ticket bodies             anything           none
  metadata.user        customer email                 direct id          -
                       client.py:19  <-- sends email to provider as tag

CLASSES PRESENT   direct-id: yes   financial: yes   health: unknown (U1)
                  credentials: possible via user paste   confidential: yes

GAPS AGAINST WHAT WE HAVE SAID

  G1  Tracing vendor is not on the subprocessor list in the DPA, and
      payload capture status is unknown. If it is on, full prompts
      including retrieved context reach a destination customers were
      not told about.

  G2  Privacy notice says "we do not share personal data with AI
      providers." prompt.py:31 sends customer.name and client.py:19
      sends customer email. Factual discrepancy, both directions
      documented above.

  G3  get_account returns the full record where the prompt uses two
      fields. tools/account.py:44. Everything else is sent for no
      reason and then carried in history for the rest of the session.

  G4  metadata.user is the customer's email. An opaque id would serve
      the same abuse-monitoring purpose.

  G5  Corpus ingested with no filter. Whatever was on the shared drive
      is retrievable into a prompt.

COULD YOU PROVE IT?
  per-request record of what was sent   no
  deletion reachable at the provider    no, 30d window, not controllable
  test that fails on a new field        no
  subprocessor list current             no, see G1

RECOMMENDED NEXT STEP
  One thing: fix G3. Return the two fields the prompt uses. It is a
  small change at one tool boundary, it removes financial data from
  every request on the session, and unlike the other findings it needs
  no legal review to be obviously correct.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       data-in-the-prompt
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <n> model calls, <n> destinations   # shape only, never field values
classes:     <list of class names present, never values>
gaps:        <n> against stated commitments
provable:    <yes | partial | no>
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

This receipt is the strictest in the library. Class names only, never a value, never a field's contents, never a sample. A receipt for a data flow audit that contains data is a self-inflicted incident.

`human` starts at `pending` and is only ever set by a person.

## Rules

Never call a gap a violation. State what the document says, what the code does, and the line. The legal characterization belongs to someone else and the report is more useful without it.

Never classify a field by its name. `notes`, `description`, `context`, and `metadata` hold whatever people put in them. Mark the ceiling and mark the content Unknown.

Never trace only the happy path. Error handlers and retries reach destinations the main path doesn't.

Never omit the embedding provider. It sees the entire corpus and every query, and it's usually missing from the subprocessor list because nobody thinks of it as an AI vendor.

Never treat prompt logging as equivalent to prompt sending. Sending is transient and contractually bounded. Logging is a stored copy under your own retention and access control, and it's a bigger commitment than the original send.

Never recommend redaction as a general fix without saying where it runs. Redaction on the user message alone, with retrieval and tool results untouched, is the shape that gets shipped and it closes almost nothing.

If the corpus was ingested unfiltered, say so plainly and recommend sampling. It's the largest unbounded surface in most of these systems and the one people are most surprised by.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Prompt Archaeology** (what the prompt says) and **Incident Replay** (what it said on the day in question).

LAHA, Love All Humans Always.
