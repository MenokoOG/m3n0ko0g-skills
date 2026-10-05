---
name: prompt-archaeology
version: 0.1.0
description: Reconstructs what an undocumented prompt chain actually does. Finds every prompt string in a codebase, maps which call feeds which, and reports the dead branches, the contradictory instructions, the silent duplicates, and the prompts nobody has version control on. Use before changing a prompt you did not write, before a model swap, or when someone asks what this system actually tells the model to do and the honest answer is that nobody knows.
license: Released by Lawrence Jefferson II for public use.
---

# Prompt Archaeology

Somebody wrote that prompt in 2023. They're gone. It works, mostly, and every few months someone appends a sentence because a customer complained. Now it's 4,000 tokens long, three of its rules contradict each other, and nobody can explain why paragraph 6 exists.

That's the normal condition of an AI system assembled between 2021 and 2026. Not a failure. Just what happens when the instructions live in string literals instead of in source control with a reason attached.

This skill digs the chain up and draws the map. It does not rewrite anything. Rewriting before you know what's there is how a system that mostly works becomes a system that mostly doesn't.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Reading prompts statically tells you what the model is asked to do. It cannot tell you what the model actually did, which instructions carry weight, or why a paragraph was added. Where that's unknown, this skill writes Unknown and refuses to guess intent.

## When to use this

Before you change a prompt you didn't write. Before a model swap, because prompt quirks tuned for one model are the largest single source of silent regression. Before an audit, when someone needs a written answer to "what are we telling the model." After onboarding, when the new engineer asks a reasonable question and gets silence.

Also when behavior drifted and nobody changed the code. Prompts assembled at runtime from database rows, feature flags, or user settings change without a commit. Those are the ones that bite.

Don't use it as a prompt optimizer. It doesn't score wording or suggest better phrasing. It tells you what is there, what conflicts, and what nobody can account for.

## The method

### Step 1: Find every prompt, including the ones that aren't strings

Sweep the repository for prompt content. It hides in more places than people expect.

Obvious: string literals passed to a `messages` array, `system=` arguments, `.prompt` files, template files (`.jinja`, `.hbs`, `.mustache`, anything under a `prompts/` directory), YAML and JSON config with `system_prompt` or `instructions` keys.

Less obvious, and usually where the real behavior lives: strings concatenated at runtime from several sources; prompts stored in a database and fetched per request; few-shot examples in a separate fixtures file; tool and function descriptions (these are prompts, the model reads them, and they steer behavior as hard as the system prompt does); RAG chunk templates that wrap retrieved text; output-format instructions injected by a framework you didn't write; and retry prompts that only fire on failure.

Framework defaults count. If the code uses LangChain, LlamaIndex, an SDK helper, or an agent library, that library injects text the model sees and the repo never shows. Name the library and version, mark the injected content Unknown unless you've actually read the library source, and say so out loud.

For each artifact record: file and line, approximate token count, static or runtime-assembled, and every call site that uses it.

### Step 2: Draw the chain

A prompt chain is a graph. Build it.

For each model call, record what goes in (which prompt artifacts, which variables, which retrieved content, which prior turns) and where the output goes (parsed into a structure, fed to the next call, shown to a user, written to a store, used as a routing decision).

Then draw the edges. Which call feeds which. Where the branches are and what decides them. Where a loop exists and what bounds it. Which paths reach a side effect that can't be undone.

Two things to flag hard here. First: any call whose output is parsed but whose prompt never states the required format. That's a parser depending on luck. Second: any loop whose exit condition depends on model output rather than a counter. That's unbounded spend and unbounded latency in one line.

### Step 3: Read the prompts against each other, not one at a time

This is the step people skip, and it's where the findings are.

A single prompt read alone looks fine. The problems live in the relationships.

**Contradictions.** One paragraph says "always include the source id." Another, appended eight months later, says "keep it short and skip references." The model resolves that conflict however it likes, differently on different inputs, and the behavior looks like randomness. Quote both lines with line numbers. Don't pick a winner. Say the conflict exists and that a human has to choose.

**Duplicates.** The same rule stated in the system prompt, again in the user template, and again in a tool description. Three places to change it, two of which will get missed.

**Dead instructions.** A rule referring to a tool that no longer exists, an output field nothing parses, a persona overridden downstream, an example in a format the code no longer accepts. Dead text still costs tokens and still steers the model.

**Orphan branches.** Prompts in the repo no live call path reaches. Either delete them, or the map is wrong. Both are worth knowing.

**Unstated assumptions.** A prompt saying "use the schema above" where the schema is injected by a variable that can be empty. A prompt referencing "the previous answer" on a path where there isn't one.

### Step 4: Check the provenance

For each artifact, answer: when was it last changed, by whom, and does the commit message say why?

"Fix bug" on a prompt change is a provenance failure. Record it. A prompt whose paragraphs can't be traced to a reason is a prompt nobody can safely edit, because any edit might remove the sentence that quietly fixed an incident in 2024.

Prompts living in a database or a config UI usually have no history at all. That's the highest-severity provenance finding available and it belongs at the top of the report. It means behavior can change with no commit, no review, and no way to answer what it used to say.

### Step 5: Rank by blast radius, not by ugliness

Order findings by what breaks if the finding is real.

A contradiction on a path that writes to a customer-facing record outranks a contradiction in an internal summarizer. An unversioned prompt on the routing call outranks a 200 token dead paragraph. Token bloat is real and it's almost never the top finding. A report that leads with token count is a report that missed the point.

## What to look for

**Model-specific tuning nobody labeled.** All-caps emphasis, "You MUST" repeated three times, XML tags, "think step by step," JSON-mode preambles, few-shot examples in a very particular shape. Usually scar tissue from fighting one specific model version, and usually the exact thing that breaks on a swap. Flag every one and mark its origin Unknown unless a comment or commit explains it.

**Injection surface.** Any place user input, retrieved documents, tool output, or database content lands inside the prompt with no delimiting or escaping. Name the variable and the line. This isn't a full security review, but an unbounded interpolation into a system prompt is worth writing down in any pass over prompt code.

**Silent truncation.** Context assembled by concatenation with no length check, or a truncation that drops the tail of retrieved text without telling anyone. Both change behavior at exactly the moment the input gets interesting.

**Temperature and sampling set per call.** Record every non-default value and whether anything documents why. A `temperature=0.9` on a structured-extraction call is usually somebody testing something in 2023 that never got reverted.

**Model pinning.** An unpinned model alias means the prompt's counterparty changes underneath it without notice. Record the exact model string at every call site.

## The output

Write `PROMPT-ARCHAEOLOGY.md`. Lead with the Unknowns. Somebody's going to read only the first page, so the first page carries what can't be answered from the code.

```
PROMPT ARCHAEOLOGY
system:     <name>          scanned: <n> files, <n> prompt artifacts
date:       <ISO-8601>      prompt tokens on the main path: ~<n>

UNKNOWNS  (read these first)
  U1  3 prompts are fetched from the `prompt_templates` table at runtime.
      Current content is not in the repo and has no version history. The
      system's behavior can change with no commit. Not auditable from source.
  U2  Framework injects additional instructions (langchain 0.1.x,
      AgentExecutor). Injected text not read. Effect unknown.
  U3  Why the system prompt repeats "never speculate" three times is not
      recorded in any commit message.

THE CHAIN
  classify  ->  (branch: intent)
                  |- retrieve -> answer -> format -> [writes to ticket]
                  |- escalate -> [sends email]   <-- irreversible, 1 call
                  \- fallback -> answer          <-- orphan, no caller

FINDINGS  (ranked by blast radius)

  F1  CONTRADICTION      blast: customer-facing writes
      prompts/system.txt:14   "Always include the source document id."
      prompts/system.txt:61   "Keep responses under two sentences and omit
                               references unless asked."
      Added 11 months apart. Both live. The model picks one per request.
      Needs a human decision, not a rewrite.

  F2  UNVERSIONED        blast: routing, all traffic
      The classify prompt is a database row. No history, no review, no
      rollback. Highest-leverage prompt in the system.

  F3  PARSE WITHOUT CONTRACT   blast: silent data loss
      api/answer.py:88 runs json.loads(resp) but the prompt never states a
      format. Works today. Unbounded failure mode.

  F4  DEAD               blast: tokens only, ~240 per call
      prompts/system.txt:31-38 instructs use of a `lookup_customer` tool.
      No such tool is registered. Removed in 4a1c8de, prompt not updated.

  F5  MODEL-TUNED, UNLABELED   blast: breaks on model swap
      6 all-caps "MUST NOT" constructions, 1 XML-tagged example block,
      "think step by step" on a call whose reasoning output is discarded.
      Origin unknown. Do not remove without an eval in place.

PROVENANCE
  prompts/system.txt        12 commits, 9 with message "prompt tweak"
  prompts/classify.txt      not in repo (see U1)
  tools/*.py descriptions   unchanged since initial commit, 2023-06

RECOMMENDED NEXT STEP
  One thing: get the 3 database prompts into the repo, or into any store
  with history. Every other finding is unfixable while the highest-traffic
  prompt in the system can change without a trace.
```

Keep the chain diagram in plain text. It gets pasted into tickets and chat, and an image doesn't survive that trip.

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository. Emit it even when the chain turns out clean.

```
--- M3n0ko0g skill receipt ---
skill:       prompt-archaeology
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <n> files scanned, <n> prompt artifacts   # shape only, never prompt text
chain:       <n> model calls, <n> branches, <n> irreversible side effects
findings:    <n>  (top class: contradiction | unversioned | dead | parse | injection)
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

The receipt never contains prompt content. Prompts are often the most sensitive thing in an AI codebase, and a receipt that quotes them turns a log into a leak. Shape only: counts, classes, file names.

`human` starts at `pending` and is only ever set by a person. The skill does not mark its own work accepted.

## Rules

Never rewrite a prompt in this pass. The deliverable is a map, and a map that edits the territory is not a map.

Never guess why a paragraph exists. If no commit message, comment, or doc explains it, write Unknown. Guessing intent is how the sentence that prevented an incident gets deleted as redundant.

Never report a contradiction without quoting both sides with file and line. An unquoted contradiction is an opinion.

Never present a database-backed or runtime-assembled prompt as if it were read. Say it wasn't, and say what that costs.

Never lead the report with token count. It's the easiest number to produce and almost never the most important finding.

If a framework injects text you haven't read, say so by name and version. "Probably fine" isn't a finding, and neither is silence.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Agent Gate Review** (what authority this system has) and **Model Swap Blast Radius** (what breaks when the model underneath it changes).

LAHA, Love All Humans Always.
