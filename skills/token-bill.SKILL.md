---
name: token-bill
version: 0.1.0
description: Works out where the money actually goes in an LLM system and what to cut. Traces cost per call path, finds retry storms, re-sent context, oversized system prompts, wasted reasoning tokens, and re-embedding that did not need to happen. Ranks fixes by dollars saved against risk taken, and says which expensive things to leave alone. Use when the invoice jumped, before a budget conversation, or when someone proposes a cheaper model to solve a problem that is not about the model.
license: Released by Lawrence Jefferson II for public use.
---

# Token Bill

The invoice went up 60 percent and nobody changed anything. Except somebody did: the corpus grew, so retrieved context grew, so every request carries more tokens. Or a retry loop that used to fire on 1 percent of requests now fires on 8. Or a feature shipped in March quietly doubled the system prompt.

The reflex is to move to a cheaper model. Sometimes that's right. Usually it's the most disruptive fix available for a problem that has three cheap ones sitting in front of it.

This skill finds where the money goes, in order, with numbers. Then it says what to cut, what to leave, and what would cost more than it saves.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Reading code shows you what a request could cost. It can't tell you the traffic mix, the retry rate, the cache hit rate, or how long conversations actually get. Where those are unknown, this skill writes Unknown and says what to measure, rather than producing a savings estimate built on assumptions.

## When to use this

When the bill moved and nobody can say why. Before a budget conversation, so you walk in with a breakdown instead of a total. Before agreeing to a cheaper model, because the cheaper model may not be the lever. When usage is growing and you want to know what scales linearly and what scales badly.

Also before adding a feature that increases per-request context. A RAG system that goes from top-3 to top-10 chunks just took a 3x on its input tokens on every single request, forever, and that decision usually gets made in a standup.

Don't use it as a profiler substitute where real usage data exists. If you have per-request token logs, those outrank everything this skill reads statically. Bring them.

## The method

### Step 1: Get the shape of the traffic, or mark it Unknown

Five numbers decide everything. Get them from logs or billing if you can.

Requests per day, and the split across call paths. Tokens in and out per request, as a mean and a p95, because tail requests often dominate. Retry and failure rate. Cache hit rate if caching is on. And conversation length distribution, since a chat system's cost is driven by turn 8, not turn 1.

If you can't get them, write Unknown and carry it through. Every saving figure below then becomes conditional, and it must be labeled that way. A savings number built on a guessed traffic mix is a number that gets quoted in a meeting and then turns out to be wrong.

### Step 2: Build the per-path cost model

Don't cost the system. Cost each path through it, because they differ by orders of magnitude and the expensive one is rarely the busy one.

For each path, list every model call in order. For each call: the model, the input token components broken out, and the output tokens.

Break input into parts, because this is where the finding usually is:

System prompt. Tool and function definitions, which people forget are sent on every single call and can run to thousands of tokens. Few-shot examples. Retrieved context. Conversation history. The user's actual message, which is usually the smallest piece by far.

Then multiply by the call count on that path and by the path's share of traffic. Now you have a ranked bill instead of a total.

### Step 3: Find the waste

Waste means tokens that bought nothing. Seven patterns cover most of it.

**Re-sent context.** The same document, system prompt, or history sent on every turn without caching. In a 10-turn conversation with a 2,000 token system prompt, that's 20,000 tokens of the same text. Check whether prompt caching is available and enabled. This is frequently the single largest line and the cheapest to fix.

**Tool definitions on every call.** A registry of 20 tools with rich descriptions can exceed the system prompt. Check whether all 20 are needed on every call, or whether the path is known before the call is made.

**Retry storms.** Retries triple the cost of the requests that hit them and they cluster. Look for: retry on parse failure with no backoff, retry that re-sends the entire conversation, retry that doesn't distinguish a transient error from a deterministic one (retrying a 400 is pure spend), and agent loops bounded by model output instead of a counter. An unbounded agent loop is the most expensive bug in this category by a wide margin.

**Reasoning tokens nobody reads.** "Think step by step" on a call whose output is parsed for a single field. The thinking is billed and discarded. Same for chain-of-thought in a classifier that returns one of four labels.

**Oversized retrieval.** Top-k tuned upward to fix a recall problem, never tuned back. Chunks with overlap sent whole so the same sentences arrive twice. Retrieved text sent unformatted with markup and boilerplate still in it.

**Re-embedding unchanged content.** A rebuild that re-embeds the whole corpus when 2 percent changed. Cheap per token and enormous in volume.

**The wrong model on a cheap job.** A frontier model doing intent classification into four buckets, or extracting a date, or deciding if a string is a question. These are the best savings in the report because the quality risk is genuinely low and measurable.

### Step 4: Cost each fix against its risk

Every fix gets three marks: estimated saving, risk to behavior, and effort.

Risk is the one people skip, and it's why cost reports get ignored. Cutting the system prompt in half saves money and might break the thing the prompt was doing. Dropping top-k from 10 to 5 saves real money and might lose answers. Say so.

Use three risk levels and be strict.

**No behavior risk.** Prompt caching, removing dead prompt text, not re-embedding unchanged documents, fixing a retry that re-sends history, capping an unbounded loop. Nothing about the output changes. Take these immediately, all of them, without a meeting.

**Measurable risk.** Model downgrade on a narrow task, lower k, shorter context, dropping reasoning tokens. The output may change, and an eval can tell you whether it did. These are fine if you have an eval and unwise if you don't. Say which case you're in.

**Unmeasurable risk.** Cutting system prompt text nobody can explain, removing a retry that might be covering a real failure, trimming instructions on a path with no tests. Don't recommend these as savings. Recommend building the measurement first.

### Step 5: Say what to leave alone

A cost report that recommends cutting everything gets filed. Name the expensive things that are earning their cost.

The retry that's covering a real upstream flake. The frontier model on the path where quality is the product. The long system prompt that encodes two years of hard-won edge cases. The verbose output the customer specifically asked for.

Say it directly: *"The answer path is 71 percent of the bill and it should be. That's the product. Cut elsewhere."*

Also flag anything where the fix costs more than the saving. Engineering time is real money, and a two-week refactor to save 40 dollars a month is a loss with good intentions.

## What to look for

**Prompt caching available and not enabled.** Often the biggest single line, usually a config change.

**Tool definitions sent on every call regardless of path.**

**Full conversation history re-sent with no windowing or summarization**, in a system where conversations run long.

**Retry on a deterministic error.** A schema the model can't satisfy will fail all three attempts at triple the price.

**An agent loop with no hard iteration cap.** Check for one. If it's absent, that's a finding regardless of current spend, because the ceiling is unbounded.

**A frontier model on classification, extraction, routing, or reformatting.**

**Reasoning or thinking tokens on a call whose output is one field.**

**Embeddings regenerated on every deploy.**

**Streaming disabled** where perceived latency drives users to retry manually. Doesn't change tokens per request, does change request count.

**Dev and staging pointed at production models with no budget cap.** More than one team has found a runaway test loop this way.

**Logging that stores full prompts and responses forever.** Not a token cost. Shows up as a storage line on the same invoice and surprises people.

## The output

Write `TOKEN-BILL.md`. Costs by path first, then the waste, then a ranked fix list split by risk. Whoever approves the budget should be able to read the first two blocks and stop.

```
TOKEN BILL
system:  <name>          date: <ISO-8601>
period:  <date range>    total: <amount or "unknown, projected from code">

UNKNOWNS  (read these first)
  U1  No per-request token logging. All figures below are projected from
      code and a 40-request sample. Treat as a ranking, not a forecast.
  U2  Retry rate unknown. Modeled at 3 percent. If it is 10, F2 moves to
      the top of this report.
  U3  Conversation length distribution unknown. Modeled at 4 turns.

COST BY PATH       (projected share)
  path              calls/req   in tok    out tok   share
  answer                2         6,400      520     71%
  classify              1         3,900       12     19%   <-- see F4
  escalate (rare)       1         6,400      340      4%
  ingest/embed        batch           -        -      6%

WHERE THE INPUT TOKENS GO   (answer path, per call)
  tool definitions     2,100   33%   <-- sent on every call, 4 of 19 used
  retrieved context    2,000   31%   top-10, overlapping chunks
  system prompt        1,400   22%   includes ~240 tokens of dead text
  history                800   13%
  user message           100    1%

WASTE FOUND

  F1  NO PROMPT CACHING                 save: ~31%    risk: none
      System prompt and tool definitions are identical across calls and
      re-sent every time. Provider supports caching. Config change.

  F2  TOOL DEFINITIONS ALWAYS SENT      save: ~18%    risk: none
      19 tools defined, 4 reachable from the answer path. The path is known
      before the call. Send the 4.

  F3  RETRY RE-SENDS FULL CONTEXT       save: ~4%     risk: none
      retry.py:22 rebuilds the whole prompt on a parse failure, including
      retrieval. 3 attempts at full price. Also retries on 400, which can
      never succeed.

  F4  FRONTIER MODEL ON CLASSIFY        save: ~16%    risk: measurable
      classify.py routes into 4 buckets using the top model, and sends the
      full system prompt to do it. A small model with a 200 token prompt
      is the standard shape here. Needs the escalation eval to verify.
      Do F1-F3 first, then this with a measurement in place.

  F5  TOP-K NEVER TUNED BACK            save: ~9%     risk: measurable
      k was raised 5 to 10 in 2024 to fix a recall complaint. No eval
      then, none now. Cannot recommend the cut blind. Build the retrieval
      eval, then revisit.

  F6  DEAD PROMPT TEXT                  save: ~2%     risk: none
      ~240 tokens instructing a tool that no longer exists.

  F7  FULL CORPUS RE-EMBEDDED ON DEPLOY save: ~5%     risk: none
      ingest.py rebuilds everything. Hash the source, embed what changed.

LEAVE ALONE
  The answer path is 71 percent of this bill and that is correct. It is
  the product. Output tokens are already short.
  The escalate path is expensive per call and runs rarely. Cutting it
  saves 4 percent and risks the one path with a human on the other end.

DO THIS NOW, NO MEETING NEEDED
  F1, F2, F3, F6, F7. All zero behavior risk. Combined: roughly 60 percent.

THEN, WITH A MEASUREMENT IN PLACE
  F4, then F5. Both need an eval first. Neither is worth doing blind.

FIX THAT IS NOT WORTH IT
  Rewriting the ingest pipeline to stream. Saves under 1 percent. Two
  weeks of work. No.

RECOMMENDED NEXT STEP
  One thing: turn on prompt caching. It is a config change, it carries no
  behavior risk, and it is the largest line in this report.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       token-bill
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <n> call paths, <n> model calls   # shape only, never prompt or usage text
basis:       <measured | projected-from-code | mixed>
findings:    <n>  (zero-risk <n> / measurable <n> / not-worth-it <n>)
projected:   <percent range> at <no | measurable> behavior risk
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

Never put prompt text, user content, or customer-identifying usage detail in the receipt.

`human` starts at `pending` and is only ever set by a person.

## Rules

Never give a savings number without saying whether it's measured or projected. A projected number presented as measured is how a cost report becomes a broken promise in a budget meeting.

Never recommend a model downgrade without an eval on that path, or without saying plainly that there isn't one and what that means.

Never rank fixes by saving alone. Saving against risk is the ranking. A 30 percent saving that breaks the refusal path is not a win.

Never recommend cutting prompt text nobody can explain. Recommend finding out what it does. That's Prompt Archaeology, and it comes first.

Always name at least one thing to leave alone. A report that says cut everything is a report nobody trusts.

Always check for an unbounded agent loop, even when spend looks fine. Current cost says nothing about the ceiling.

If there's no per-request token logging, say so first and recommend adding it. Every number in the report is weaker than it should be until that exists.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Prompt Archaeology** (what the dead text is), **Eval or Vibes** (whether a cut is safe to make), and **Model Swap Blast Radius** (what a downgrade actually costs to execute).

LAHA, Love All Humans Always.
