# M3n0ko0g skills

Twelve skills, an MCP server and two scouts for the AI systems assembled between 2021 and 2026 that nobody inside can explain, audit, or sign off on.

Apache-2.0. Zero dependencies. Node 18+ or Python 3.8+, nothing to install.

## The problem

Somewhere in your company there is a support agent, a document search, a classifier, or a prompt chain that was built in 2023 by someone who read a tutorial. It works, mostly. It has been patched eleven times since, each patch a sentence appended to a prompt because a customer complained.

Now someone has to sign for it. A director, a risk owner, an auditor. And the honest answers to their questions are all the same.

What does it tell the model to do? Nobody knows, the prompt is 4,000 tokens and three of its rules contradict each other. Which model is it on? An alias, so it has changed under you several times without a commit. What went to the provider last Tuesday? The question, plus 5 retrieved chunks, 8 turns of history and a tool result containing a full account record. Is it tested? There is a file that asserts the response is not empty. What happened during the incident? The system logged that a request came in and a response went out, and nothing in between.

That is the normal condition of a legacy AI system. This repo is a method for working through it, in order, with evidence, until a named human has something they can actually sign.

## What is here

| Piece | What it does | Run it |
|---|---|---|
| **12 skills** in [`skills/`](skills/) | The methods. Markdown a person or an agent follows. Ten form an audit pass, two are general purpose. | Read the `.SKILL.md`, or load the `.skill` bundle into a client that takes them. |
| **MCP server** in [`mcp/`](mcp/) | Serves the library over the Model Context Protocol so an agent can search, list and read skills on demand. | `node mcp/server.mjs` |
| **Two scouts** in [`scouts/`](scouts/) | Deterministic, read-only scanners for Python and TypeScript. They find every model call, prompt, retrieval and logging gap so the skills have evidence to work from. | `python scouts/python/m3scout.py <repo>` or `node scouts/typescript/m3scout.mjs <repo>` |
| **Receipt tools** in [`tools/receipt/`](tools/receipt/) | Reference implementations of the receipt convention in Python and TypeScript. No dependencies. Write, stream and audit receipts. | `python tools/receipt/receipt.py` or import `receipt.ts` |
| **FINAL AUTHORITY** in [`games/final-authority/`](games/final-authority/) | A browser game about approving things. You are the human in the loop for a fleet of agents, and you lose by rubber-stamping. One HTML file, no dependencies. | Open `games/final-authority/index.html` |

One rule runs through all of it: **unknown data must increase decision discipline, not model confidence.** Every skill leads with what it cannot know. Every scout keeps what it confirmed strictly apart from what it could not establish. And every run ends with a receipt whose `human` field starts at `pending` and can only be set by a person. See [`skills/TRACEABILITY.md`](skills/TRACEABILITY.md).

## The audit pass, in run order

Each skill feeds the next. The last one is a signature block. They also work standalone.

| # | Skill | The question it answers |
|---|---|---|
| 1 | [legacy-modernization-scout](skills/legacy-modernization-scout.SKILL.md) | What is actually here, and where are the seams? Run before anyone commits to a rewrite. |
| 2 | [prompt-archaeology](skills/prompt-archaeology.SKILL.md) | What does this undocumented prompt chain tell the model to do? Finds contradictions, dead branches and prompts with no version control. |
| 3 | [rag-integrity-check](skills/rag-integrity-check.SKILL.md) | Is that confident wrong answer a retrieval failure or a generation failure? The fixes have nothing in common. |
| 4 | [data-in-the-prompt](skills/data-in-the-prompt.SKILL.md) | What data actually reaches the provider, through which door, and could you prove it? |
| 5 | [agent-gate-review](skills/agent-gate-review.SKILL.md) | Registration, validation, revocation, escalation, human-in-the-loop. Which of the five gates is enforced in code and which is a prompt asking nicely? |
| 6 | [eval-or-vibes](skills/eval-or-vibes.SKILL.md) | Sorts every check into Eval, Smoke, Vibe or None, then names what would ship broken without anyone noticing. |
| 7 | [token-bill](skills/token-bill.SKILL.md) | Where the money goes, per call path, and which expensive things to leave alone. |
| 8 | [model-swap-blast-radius](skills/model-swap-blast-radius.SKILL.md) | What breaks when the model underneath changes. Hard coupling, soft coupling, cost, and a rollback trigger with a number on it. |
| 9 | [incident-replay](skills/incident-replay.SKILL.md) | What happened during the bad run, marked Confirmed, Inferred or Unknown, and the one log line that would make the next one a lookup. |
| 10 | [sign-off-pack](skills/sign-off-pack.SKILL.md) | Assembles what a named human signs: scope, evidence table, residual risk, rollback, owners. Refuses to recommend. |

Two more that are about work in general:

| Skill | The question it answers |
|---|---|
| [hot-path](skills/hot-path.SKILL.md) | Which line makes this function slow, what is the rewrite, and is it worth doing? |
| [what-did-i-agree-to](skills/what-did-i-agree-to.SKILL.md) | What did I commit to in that thread, to whom, by when, and which ones are dangerously vague? |

Every skill leads with Unknowns, marks findings by confidence, refuses to report a number it cannot evidence, names one next step, and emits a receipt. `sign-off-pack` will not recommend approval. `token-bill` always names something expensive to leave alone. `incident-replay` will not accept "the model hallucinated" as a cause.

## The MCP server

Point any MCP client at [`mcp/server.mjs`](mcp/server.mjs). Claude Desktop, Claude Code, or anything that speaks JSON-RPC over stdio.

```bash
claude mcp add m3n0ko0g-skills -- node ./mcp/server.mjs
```

Four tools: `list_skills` (the audit pass comes back in run order), `get_skill`, `search_skills` (describe the problem, get the skill), and `new_receipt` (a compliant receipt with a fresh id and a UTC timestamp, `human` already at `pending`). Every skill is also a resource at `skill://<name>`.

```
$ node mcp/server.mjs --list
M3n0ko0g free skills library: 12 skill(s)

The audit pass is listed in the order you would run it. Each skill feeds
the next, and the last one is a signature block. They also work standalone.

AUDIT PASS (legacy AI systems)

  legacy-modernization-scout  v0.1.0
    Map a legacy system for incremental modernization ...
```

The server is one file with no imports outside the Node standard library. The protocol test spawns the real server and speaks actual JSON-RPC to it. If it passes, a client can drive it. Details and client config in [`mcp/README.md`](mcp/README.md).

## The scouts

The skills are methods, and a method still needs someone to do the mechanical half: find every model call, every prompt, every retrieval, every place a failure could never be diagnosed. That is grunt work, it is deterministic, and a machine should do it.

`m3scout` does it. One scout for Python (parses with `ast`), one for TypeScript and JavaScript (lexes, since there is no compiler without a dependency, and says so in its report). Both emit the same evidence pack, [schema v1](scouts/SCHEMA.md), so you can run both over a polyglot repo and merge the output.

A scout never calls a model, never sends your code anywhere, and never writes to the tree it scans. There is a test asserting the last one. Findings are `confirmed` or `inferred`. There is deliberately no `unknown` confidence level. A thing the scout could not establish goes in a separate list with the specific step that would resolve it.

Here is the TypeScript scout run against its own fixture, a deliberately broken support agent of the kind assembled in 2023. This is real output, unedited.

```
$ node scouts/typescript/m3scout.mjs scouts/typescript/fixture
SCOUT - legacy AI system, TypeScript / JavaScript
root:     /path/to/m3n0ko0g-skills/scouts/typescript/fixture
scanned:  3 file(s), 176 lines, 5ms

UNKNOWNS  (read these first - the scout could not determine them by reading)
  U1  Which model does the raw HTTP call at supportAgent.ts:124 send?
      why:     The endpoint is a literal but the request body is assembled separately, so the model string is not readable at the URL.
      resolve: Read the body construction, or log the resolved model with each request.
  U2  How often is each model call actually made, and on what traffic mix?
      why:     Call frequency is a runtime property. Static reading cannot see it.
      resolve: Log a counter per call path for a day. Until then any cost or risk ranking is ordering, not forecasting.
  U3  What does a wrong answer cost here?
      why:     Not determinable from source. It is a business fact.
      resolve: Ask the owner. It sets the budget for everything else in the report.
  U4  What does the framework inject into these prompts?
      why:     Agent and orchestration libraries add instructions the repo never shows. This scout reads your source, not your dependencies.
      resolve: Read the library version's own prompt templates, or log the full request body once and compare it to what the code appears to send.
  U5  What is actually in the corpus?
      why:     The scout reads the pipeline, never the documents. Whatever was ingested is retrievable into a prompt.
      resolve: Sample 200 chunks and classify them. If ingestion was unfiltered, this is the largest unbounded surface in the system.
  U6  Does the index have a deletion path?
      why:     Removal at the source does not imply removal from the index, and a delete path cannot be confirmed by reading the query side.
      resolve: Delete one document at the source, then query for it.
  U7  Does the embedding model that built the index match the one used at query time?
      why:     The scout sees call sites, not which model produced the stored vectors.
      resolve: Record the embedding model and version beside the index. A mismatch is total, silent retrieval failure and it looks like the model got dumber.

COUNTS
     6  model_call
     3  prompt_artifact
     3  unpinned_model
     3  weak_assertion
     1  interpolation
     1  logging_gap
     1  no_similarity_floor
     1  parse_no_contract
     1  rag_embed
     1  rag_retrieve
     1  secret_risk
     1  tool_definition
     1  unbounded_loop

FINDINGS

  [unbounded_loop]  1
  feeds: token-bill, agent-gate-review
  A while loop contains a model call and no counter bounds it. Exit depends on model output. Unbounded spend and unbounded latency.
    C  supportAgent.ts:95  while (!done) {

  [secret_risk]  1
  feeds: data-in-the-prompt, agent-gate-review, sign-off-pack
  An API key is referenced in a file that looks like it ships to the browser. A frontend bundle is public. If this builds, the key is readable by anyone who opens devtools.
    C  ChatPanel.tsx:8  apiKey: import.meta.env.VITE_OPENAI_API_KEY,

  [no_similarity_floor]  1
  feeds: rag-integrity-check, eval-or-vibes, sign-off-pack
  Retrieval with no minimum score. The system always returns results, including when nothing relevant exists, so it cannot say it does not know. This is the mechanism behind most confident wrong answers.
    C  supportAgent.ts:61  question, 5

  [unpinned_model]  3
  feeds: model-swap-blast-radius, incident-replay, eval-or-vibes
  Model alias carries no version. The provider can move it underneath you, so this swap has likely already happened more than once with no review and no record.
    C  ChatPanel.tsx:16  model: "gpt-4o-mini"
    C  supportAgent.ts:77  model: "gpt-4o"
    C  supportAgent.ts:96  model: "gpt-4o"

  [logging_gap]  1
  feeds: incident-replay, rag-integrity-check
  No logging call within three lines of this retrieval. If chunk ids and scores are not recorded, no retrieval failure in this system can ever be diagnosed after the fact.
    I  supportAgent.ts:61  store.similaritySearch

  [parse_no_contract]  1
  feeds: prompt-archaeology, model-swap-blast-radius, eval-or-vibes
  JSON.parse downstream of a model call. If the prompt does not state the required format, this parser is depending on luck.
    I  supportAgent.ts:88  return JSON.parse(response.choices[0].message.content as string);

  [weak_assertion]  3
  feeds: eval-or-vibes, sign-off-pack
  This assertion passes on garbage. It checks the system ran, not that it was right. Smoke, never Eval.
    C  supportAgent.test.ts:9  expect(res).toBeDefined();
    C  supportAgent.test.ts:14  expect(res.length).toBeGreaterThan(0);
    C  supportAgent.test.ts:19  expect(res).toBeTruthy();

  [interpolation]  1
  feeds: data-in-the-prompt, prompt-archaeology
  Prompt built by template interpolation. Whatever those values carry reaches the model, and the substitution is unbounded.
    C  supportAgent.ts:69  You are helping ${customer.name}, who is on the ${customer.plan} pl...

  [rag_embed]  1
  feeds: rag-integrity-check, data-in-the-prompt, model-swap-blast-radius
  An embedding call. This is a second model and usually a second subprocessor. It sees every document indexed and every query typed, and it is the one that gets swapped by accident inside a general upgrade ticket, where the failure is total.
    C  supportAgent.ts:50  client.embeddings.create

  [rag_retrieve]  1
  feeds: rag-integrity-check, incident-replay, token-bill
  Retrieval call, k=5.
    C  supportAgent.ts:61  store.similaritySearch

  [tool_definition]  1
  feeds: token-bill, prompt-archaeology, model-swap-blast-radius
  Tool definitions are sent with this call. The model reads them, so they are prompts, and they are billed on every request.
    C  supportAgent.ts:77  { model: , messages: [ { role: , content: SYSTEM_PROMPT }, { role: ...

  [prompt_artifact]  3
  feeds: prompt-archaeology, token-bill, model-swap-blast-radius
  Prompt literal, roughly 113 tokens.
    C  supportAgent.ts:26  You are a support assistant for a warranty company. You MUST answer...
    I  supportAgent.ts:26  repeated all-caps prohibitions, "think step by step", anti-preamble instruction
    C  supportAgent.ts:69  You are helping ${customer.name}, who is on the ${customer.plan} pl...

  [model_call]  6
  feeds: prompt-archaeology, token-bill, model-swap-blast-radius, incident-replay
  A model is called here.
    C  ChatPanel.tsx:16  client.chat.completions.create
    C  supportAgent.ts:124  https://api.openai.com/v1/chat/completions
    C  supportAgent.ts:77  client.chat.completions.create
    C  supportAgent.ts:77  temperature: 0.9
    C  supportAgent.ts:96  client.chat.completions.create
    C  supportAgent.ts:112  client.chat.completions.create

NEXT SKILL TO RUN
  model-swap-blast-radius      14 finding(s) feed it
  prompt-archaeology           12 finding(s) feed it
  token-bill                   10 finding(s) feed it
  incident-replay              10 finding(s) feed it

PRECISION
  This scout lexes rather than parses, so findings marked I (inferred)
  are structural reads, not certainties. The Python scout parses with
  ast and is more certain. Treat I as a lead, C as evidence.

RECOMMENDED NEXT STEP
  cap the loop at supportAgent.ts:95 - unbounded spend and latency

--- M3n0ko0g skill receipt ---
skill:       m3scout-typescript
version:     1.0.0
id:          1b7894fa2da3
run_at:      2026-09-14T20:44:01Z
input:       typescript, 3 file(s), 176 lines
findings:    24  (top class: model_call)
unknowns:    7
recommended: cap the loop at supportAgent.ts:95 - unbounded spend and latency
human:       pending
---
```

Things worth noticing in that output. The fixture has two `while` loops that call a model, and the scout flagged only the unbounded one. The word `while` appears in a comment and inside the system prompt, and neither was read as a loop. The model called over raw HTTP with no SDK at line 124 was caught, which is the case a grep for client libraries misses. The receipt at the end carries counts and file names and never the prompt text. And the pinned `gpt-4o-2024-08-06` at line 112 was left alone.

The Python scout, same idea, against its own fixture:

```
$ python scouts/python/m3scout.py scouts/python/fixture
SCOUT - legacy AI system, Python
root:     /path/to/m3n0ko0g-skills/scouts/python/fixture
scanned:  2 file(s), 131 lines, 1ms

UNKNOWNS  (read these first - the scout could not determine them by reading)
  U1  Which model does the raw HTTP call at support_agent.py:109 send?
      why:     The endpoint is a literal but the request body is assembled separately, so the model string is not readable at the URL.
      resolve: Read the body construction, or log the resolved model with each request.
  U2  How often is each model call actually made, and on what traffic mix?
      why:     Call frequency is a runtime property. Static reading cannot see it.
      resolve: Log a counter per call path for a day. Until then any cost or risk ranking is ordering, not forecasting.
  U3  What does a wrong answer cost here?
      why:     Not determinable from source. It is a business fact.
      resolve: Ask the owner. It sets the budget for everything else in the report.
  U4  What is actually in the corpus?
      why:     The scout reads the pipeline, never the documents. Whatever was ingested is retrievable into a prompt.
      resolve: Sample 200 chunks and classify them. If ingestion was unfiltered, this is the largest unbounded surface in the system.
  U5  Does the index have a deletion path?
      why:     Removal at the source does not imply removal from the index, and a delete path cannot be confirmed by reading the query side.
      resolve: Delete one document at the source, then query for it.
  U6  Does the embedding model that built the index match the one used at query time?
      why:     The scout sees call sites, not which model produced the stored vectors.
      resolve: Record the embedding model and version beside the index. A mismatch is total, silent retrieval failure and it looks like the model got dumber.

COUNTS
     4  model_call
     3  prompt_artifact
     3  weak_assertion
     2  chunking
     2  unpinned_model
     1  interpolation
     1  logging_gap
     1  no_similarity_floor
     1  parse_no_contract
     1  rag_embed
     1  rag_retrieve
     1  tool_definition
     1  unbounded_loop
...
```

Add `--json` for the evidence pack, `-o file` to write it, and `--skill <name>` for only the findings that feed one skill. Full class table and precision notes in [`scouts/README.md`](scouts/README.md).

## Putting it together

```bash
# 1. Scout the repo. Evidence first.
node scouts/typescript/m3scout.mjs ./legacy-app --json -o evidence.json

# 2. The report ends by naming which skill most of the findings feed.
node scouts/typescript/m3scout.mjs ./legacy-app | grep -A5 "NEXT SKILL"

# 3. Pull that skill's method, from the MCP server or straight from skills/.
node mcp/server.mjs --list
```

Then follow the method. It will tell you what it cannot know, what it found, and one next step. At the bottom is a receipt with `human: pending`. Someone has to change that field, and that someone is the point.

## Zero dependencies

There is no `npm install` step and no `pip install` step, and CI proves it: the workflow checks out the repo and runs the tests on Node 18, 20 and 22 against Python 3.9 and 3.12 with nothing installed in between. The zip packager is written by hand against `node:zlib`. The MCP server implements JSON-RPC over stdio directly. The TypeScript scout lexes instead of pulling in a parser, and says so in its own report.

A tool that audits other people's dependency surface should be careful about its own.

## Test

```bash
npm test
```

Runs `check:skills` (every `.skill` bundle and the index are current), the MCP protocol test (43 assertions against the real server over stdio), and both scout suites (65 TypeScript, 55 Python, no mocks, no test runner). 163 assertions. All of them must pass on every push.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: frontmatter contract, receipt block, Unknowns first, no dependencies, `npm run build:skills`, green CI.

## License

Apache-2.0, Lawrence Jefferson II. See [LICENSE](LICENSE).

---

LAHA, Love All Humans Always.
