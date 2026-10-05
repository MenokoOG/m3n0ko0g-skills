---
name: model-swap-blast-radius
version: 0.1.0
description: Finds everything that breaks when you change the model underneath an AI system. Maps every place behavior is coupled to the current model, from tool-call format and JSON mode to token budgets, stop sequences, prompt scar tissue, and fine-tune dependencies. Produces a ranked change list and a rollback plan. Use before a deprecation deadline, a cost-cutting swap, a provider move, or a version bump somebody thinks is routine.
license: Released by Lawrence Jefferson II for public use.
---

# Model Swap Blast Radius

The deprecation email arrives with 90 days on it. Somebody says "it's just a string change." And it is, right up until the JSON parsing starts failing on 4 percent of requests, the escalation prompt stops triggering, and the invoice doubles because the new model is chattier.

Model swaps look like configuration and behave like migrations. The coupling is real, it's undocumented, and most of it lives in prompt text that was tuned by trial and error against one specific model version by somebody who no longer works there.

This skill finds the coupling before you hit it in production. It doesn't do the swap. It tells you what the swap costs, in a form you can hand to whoever has to approve it.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Static reading finds where the system depends on the current model. It cannot tell you how the new model will actually behave on your inputs. Only a run tells you that. Where behavior is unknown, this skill says Unknown and names the test that would resolve it, rather than predicting a model's output.

## When to use this

Before a deprecation deadline. Before swapping to a cheaper model. Before moving provider. Before a minor version bump, which is where most of the damage happens, because minor bumps skip review.

Also before adopting a model you can't pin, and before anyone signs a contract that assumes the swap is easy.

Don't use it to choose which model to move to. It's about your system's coupling, not about model quality. Pick the candidate first, then run this against that specific candidate, because the answers are different for every target.

## The method

### Step 1: Pin down both ends

Record the exact current model string at every call site, including version and provider. Then record the exact candidate.

Two things fall out immediately. If any call site uses an unpinned alias, the swap already happened, repeatedly, without review. Report that first. And if different call sites use different models, the swap isn't one migration, it's several with different risk.

Then write down what you don't know: whether the candidate's tokenizer differs, whether its tool-calling format matches, whether it supports the same structured-output mode, whether the context window is larger or smaller, and what its rate limits look like at your traffic. These are documented facts, so go read the docs rather than guessing. What stays unknown after reading goes in the register.

### Step 2: Find the hard coupling

Hard coupling is anything that breaks deterministically, not probabilistically. These are findable by reading code, and they're the cheap part of the report.

**Tool and function calling.** Providers differ on schema shape, on whether parallel tool calls are supported, on how a call is returned, on whether arguments arrive as a JSON string or an object, and on the message format for results. Check every place tool calls are constructed and parsed.

**Structured output.** JSON mode, schema-constrained decoding, and grammar constraints are all provider-specific. A system relying on guaranteed-valid JSON from the current model, and parsing without a fallback, will fail on any model that only offers best-effort.

**Token counting.** A tokenizer change moves every length calculation. Find every place the code counts tokens: truncation, chunk sizing, context assembly, cost estimation, budget checks. A system that truncates context at a hardcoded token count computed with the old tokenizer will truncate in the wrong place.

**Context window.** If the candidate's window is smaller, find every path that could exceed it, especially long conversations and large retrieval payloads. If it's larger, check that nothing hardcodes the old limit.

**Stop sequences, logit bias, seeds, logprobs.** Each is supported unevenly. Any code reading logprobs, or relying on a seed for reproducibility, has a hard dependency.

**System prompt handling.** Some models treat the system message as strongly binding, some as a suggestion, and some don't have a distinct system role at all. If the architecture assumes the system prompt overrides user input, that assumption is model-specific and it's a security-relevant one.

**Response metadata.** Field names for usage, finish reasons, and refusal signals differ. Any code branching on `finish_reason == "length"` or similar will branch wrong.

**Fine-tunes and adapters.** A fine-tuned model doesn't port. If the system depends on one, the swap includes retraining, and the training data may not exist anymore. Check that it does. Find out who has it and whether the pipeline that produced it still runs.

**Rate limits and concurrency.** Different limits mean different retry behavior and possibly a different architecture at peak.

### Step 3: Find the soft coupling

Soft coupling is prompt text and system design tuned to one model's quirks. It doesn't break cleanly. It degrades, quietly, on a percentage of requests. This is the expensive part, and the part people miss.

Look for scar tissue in every prompt: repeated emphasis, all-caps prohibitions, "you MUST" stacked three deep, explicit reminders not to apologize or preamble, XML tags, "think step by step" where the reasoning isn't consumed, format instructions repeated at both ends of the prompt, and few-shot examples in a very specific shape.

Each of those was almost certainly added to fix a behavior in one model. On a different model it may be unnecessary, harmless, or actively harmful. A prompt that fights a tendency the new model doesn't have can push it into the opposite failure.

Also look for implicit expectations about output length and verbosity (downstream truncation and UI layout depend on these), about default tone, about how the model handles conflicting instructions, and about its willingness to refuse. A system whose safety story is "the model won't do that" has soft coupling to exactly the thing model updates change most.

Mark every item of soft coupling with what it was probably fighting, and mark the origin Unknown unless a comment or commit says. Then say plainly: soft coupling cannot be verified by reading. It needs a run.

### Step 4: Find the cost and latency coupling

Price per token is the number everyone checks and the least useful one.

What matters is tokens per request on your actual traffic. A cheaper model that's more verbose, or that needs an extra retry, or that needs a longer prompt to hit the same quality, can cost more. A reasoning model that emits hidden tokens can cost several times its headline rate.

Check whether anything downstream has a latency budget: a UI timeout, a webhook deadline, a queue worker limit, a synchronous request path. A slower model breaks those regardless of quality.

If prompt caching is in use, check whether the candidate supports it and on what terms. Losing a cache discount can wipe out the whole saving that motivated the swap.

State your cost projection as a range with the assumption written out, or say Unknown. A single confident number here is almost always wrong.

### Step 5: Write the change list and the rollback

The deliverable is a sequence somebody can execute, not a risk essay.

Order it: hard coupling first, because it's deterministic and cheap to fix. Then evals, because you can't detect soft-coupling damage without them. Then the actual swap, behind a flag, on a slice of traffic. Then a measured comparison. Then full rollout.

The rollback plan needs three things. The exact one-line change that reverts it. What has to stay compatible for that revert to work, which is usually stored data written in the new model's format. And the signal that triggers a rollback, named and thresholded in advance, because a rollback decision made during an incident is a rollback decided by whoever is loudest.

If the system has no evals, say the swap can't be verified. That's not a reason to block it. It's a fact the approver needs, and it changes how much traffic you send first.

## What to look for

The recurring ones:

**An unpinned model alias.** The swap has been happening silently. Highest-value finding in the report because it's cheap to fix and it retroactively explains drift nobody could account for.

**`json.loads` with no fallback** on a call that relied on guaranteed JSON mode.

**Hardcoded token limits** computed with the old tokenizer.

**A fine-tune whose training data is gone.**

**Prompts that name the model.** "You are ChatGPT" or "As Claude" in a system prompt, which becomes a lie and sometimes a behavior change.

**Regexes parsing model output.** Every one is tuned to a formatting habit.

**Retry logic keyed on a provider-specific error code.**

**Tests with hardcoded expected model outputs.** They'll fail, and the temptation will be to update them to match, which throws away the only signal you had.

**Cost alerts and dashboards keyed on the old model name**, which go quiet at exactly the wrong moment.

**A second model in the system nobody mentioned:** an embedding model, a reranker, a moderation call, a small classifier. Swapping the embedding model without rebuilding the index is a total retrieval failure and it's a very easy mistake to make inside a general "upgrade the models" ticket.

## The output

Write `MODEL-SWAP-BLAST-RADIUS.md`. Name both models in the header, because this report is only valid for that pair.

```
MODEL SWAP BLAST RADIUS
from:   <exact model string>     to:   <exact candidate string>
date:   <ISO-8601>               call sites: <n>

UNKNOWNS  (read these first)
  U1  No evals exist on the answer path (see EVAL-OR-VIBES). Soft-coupling
      damage would not be detectable before users find it. This does not
      block the swap. It means the first rollout slice should be 5 percent,
      not 100.
  U2  Candidate's behavior on our actual prompts is unknown. 14 items of
      soft coupling are listed below. None can be resolved by reading.
  U3  Tokens per request on real traffic not measured. Cost projection is
      a range built on a 40-request sample.

HARD COUPLING     (breaks deterministically, findable in code)
  H1  tools/registry.py:23   Tool schema uses the old provider's shape.
                             Candidate needs a different key layout.
  H2  api/answer.py:88       json.loads with no fallback. Current model ran
                             in guaranteed JSON mode. Candidate is best
                             effort. Expect parse failures.
  H3  context.py:51          MAX_TOKENS = 3500, computed with the old
                             tokenizer. Candidate tokenizes ~8 percent
                             longer on our corpus. Truncation moves.
  H4  classify.py:12         Model alias is unpinned ("latest"). This has
                             already swapped under us at least twice.
  H5  embeddings.py:9        Second model present. NOT in scope of this
                             swap. If it changes, the index must be rebuilt
                             or retrieval fails completely.

SOFT COUPLING     (degrades quietly, needs a run to verify)
  S1  system.txt:14-19  Four all-caps MUST NOT constructions. Probably
                        fighting a tendency of the old model. Unknown
                        whether the candidate has it.
  S2  system.txt:44     "Do not apologize or add preamble." Classic scar
                        tissue. Harmless if unnecessary.
  S3  answer.txt:8      Few-shot examples in a tight format. Candidate may
                        follow format more or less literally.
  S4  system.txt:2      "You are ChatGPT." Becomes false. Remove.
  S5  parse.py:34       Regex expects a "Answer:" prefix the old model
                        reliably produced. Not guaranteed by anything.
  ... 9 more

COST AND LATENCY
  price/token   -38 percent
  tokens/req    unknown, 40-request sample suggests +15 to +60 percent
  net           somewhere between -29 percent and +0 percent. Not a
                confident saving. Measure before promising one.
  cache         candidate supports prompt caching on different terms.
                Current discount does not carry over. Included above.
  latency       p95 budget is 4s at the UI. Candidate p95 unmeasured.

THE CHANGE LIST     (in order)
  1  Pin the alias in classify.py. Do this today, swap or no swap.
  2  Fix H1, H2, H3. Deterministic, ~1 day.
  3  Build the escalation eval (E1 from EVAL-OR-VIBES). Without it,
     step 5 has nothing to measure.
  4  Remove S4. Leave all other soft coupling alone for now.
  5  Flag the swap. 5 percent of traffic. Run 3 days.
  6  Compare: eval score, tokens/req, p95, parse failure rate,
     escalation rate.
  7  Revisit soft coupling with evidence from step 6. Then roll out.

ROLLBACK
  revert:   one line, MODEL constant in config/models.py
  blocked by: nothing. No data is written in a model-specific format.
  trigger:  parse failure rate above 0.5 percent, or escalation rate
            moving more than 20 percent in either direction, or p95
            above 4s. Any one of the three, no discussion needed.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       model-swap-blast-radius
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
from:        <model string>
to:          <model string>
input:       <n> call sites, <n> prompt artifacts   # shape only, never prompt text
hard:        <n>   soft: <n>   other models found: <n>
cost:        <range or unknown>
unknowns:    <n>
rollback:    <one-line | blocked | none>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

`human` starts at `pending` and is only ever set by a person. On a swap, that field is the approval record.

## Rules

Never predict how the new model will behave on your prompts. You can't, nobody can, and a prediction here gets quoted back at you. Say Unknown and name the run that resolves it.

Never report a cost saving from price per token alone. Tokens per request is the variable that decides it, and it usually moves the wrong way.

Never let a swap ship without a rollback trigger defined in advance, with numbers. "We'll watch it" is not a trigger.

Never remove soft coupling in the same change as the swap. Then you can't tell which change caused what. Swap first, clean up after, with evidence.

Never treat a minor version bump as out of scope. Minor bumps change behavior and skip review, which is the worst combination available.

Always check for a second model in the system. The embedding model is the one that gets swapped by accident inside a general upgrade ticket, and the failure is total.

If no evals exist, say the swap is unverifiable and recommend a smaller first slice. Don't block it. Blocking a deprecation-driven swap isn't an option anyone actually has.

---

Part of the free skills library by M3n0ko0g.

Run **Prompt Archaeology** and **Eval or Vibes** first. This skill is much sharper when it can point at their output.

LAHA, Love All Humans Always.
