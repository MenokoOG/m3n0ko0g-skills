# m3scout: legacy AI systems scouts

Two scanners, one for Python and one for TypeScript/JavaScript, that read a codebase and report what the AI system inside it actually does.

They exist because the [M3n0ko0g skills](https://github.com/MenokoOG/m3n0ko0g-skills) are methods, and a method still needs someone to do the mechanical half: find every model call, every prompt, every retrieval, and every place a failure could never be diagnosed. That part is grunt work, it is deterministic, and a machine should do it.

## What a scout is, and is not

**Deterministic and read-only.** A scout parses source and reports what it found. It never calls a model. It never sends your code anywhere. It never writes to the tree it is scanning, and there is a test asserting that.

That constraint is the whole design. The skills run on one rule: *unknown data must increase decision discipline, not model confidence.* A scanner that inferred intent would be handing the skills fabricated evidence, which is worse than handing them nothing.

So a scout reports two things, kept strictly apart:

- **Findings**: what it read in the source, marked `confirmed` (parsed, it is there) or `inferred` (strongly implied by structure, never to be read as fact).
- **Unknowns**: what it could not establish by reading, each with the specific thing that would resolve it.

There is deliberately no `unknown` confidence level on a finding. Collapsing "I could not tell" into "a weak finding" is how a report starts lying.

A scout does not replace a skill. It does the mechanical half so the skill can do the judgement half, and every finding names which skills consume it.

## Run them

```bash
# Python
python scouts/python/m3scout.py path/to/repo
python scouts/python/m3scout.py path/to/repo --json -o evidence.json

# TypeScript / JavaScript
node scouts/typescript/m3scout.mjs path/to/repo
node scouts/typescript/m3scout.mjs path/to/repo --json -o evidence.json

# Only what one skill needs
python scouts/python/m3scout.py path/to/repo --skill rag-integrity-check
```

Python 3.8+ or Node 18+. **No dependencies, either side.** A tool that audits someone else's dependency surface should be careful about its own.

Both emit the same evidence pack, [schema v1](./SCHEMA.md), so you can run both over a polyglot repo and merge the output without translation. There is a test asserting the two schemas stay identical.

## What they find

| class | what it marks |
|---|---|
| `unbounded_loop` | A loop containing a model call with no iteration cap. The most expensive bug available. |
| `secret_risk` | An API key referenced in a file that ships to the browser. |
| `no_similarity_floor` | Retrieval with a fixed k and no minimum score, so the system cannot say it does not know. |
| `unpinned_model` | A model alias with no version. The swap is already happening without review. |
| `logging_gap` | A retrieval whose inputs are never logged, so no failure can be diagnosed after the fact. |
| `parse_no_contract` | Model output parsed as structured data where nothing states a format. |
| `weak_assertion` | An assertion that passes on garbage. Smoke, never Eval. |
| `interpolation` | User, database or retrieved content substituted into a prompt, unbounded. |
| `rag_embed` · `rag_retrieve` · `chunking` | The retrieval pipeline. |
| `tool_definition` | Tool schemas, which the model reads and which are billed on every call. |
| `prompt_artifact` | Prompts, including the all-caps scar tissue tuned against one model version. |
| `model_call` · `retry` · `eval_check` | The rest of the shape. |

Both scouts also catch a provider endpoint called over **raw HTTP** with no SDK involved. That case is common in hand-assembled systems and invisible to anything that audits by grepping for client libraries. We found it by running the scout against our own repo, where it missed exactly that.

## Precision, stated honestly

The Python scout parses with the `ast` module and knows what it is looking at.

The TypeScript scout has no compiler available without taking a dependency, so it lexes: strips comments, tracks string and template literals properly, follows brace depth. Much better than matching regexes against raw text, still less certain than a parse. So it marks more findings `inferred`, deliberately, and its report says so.

There are tests for the difference. The TS fixture contains the word `while` inside a comment and again inside a system prompt, and neither may be read as a loop.

## Test them

```bash
python scouts/python/test_m3scout.py      # 55 assertions
node scouts/typescript/test-m3scout.mjs   # 65 assertions, incl. schema parity
```

No mocks and no test runner. Each suite runs the real scout over a fixture: a deliberately broken support agent of the kind assembled in 2023, with every defect the skills describe planted in it. Every one must be found, the bounded loop next to the unbounded one must *not* be flagged, and the receipt must contain no prompt text.

## The receipt

Every run ends with a receipt, per [TRACEABILITY.md](../skills/TRACEABILITY.md). Shape only, never content: counts, classes, file names. Never prompt text, model output, or field values. A receipt that quotes its input turns a log into a leak, and this is the artifact most likely to get pasted into a chat channel.

`human` starts at `pending` and can only be set by a person.

## Use them with the skills

```bash
# 1. Scout the repo
node scouts/typescript/m3scout.mjs ./legacy-app --json -o evidence.json

# 2. See which skill the evidence points at
node scouts/typescript/m3scout.mjs ./legacy-app | grep -A5 "NEXT SKILL"

# 3. Pull that skill's method (via the MCP server, or just read the SKILL.md)
node mcp/server.mjs --list
```

The report ends by naming the skills most of the findings feed, and a single recommended next step. Take that step.

---

Part of the free skills library by M3n0ko0g.

LAHA, Love All Humans Always.
