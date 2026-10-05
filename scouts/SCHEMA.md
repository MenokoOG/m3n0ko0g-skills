# Scout evidence pack, schema v1

`m3n0ko0g.scout.evidence/1`

Both scouts, Python and TypeScript, emit this identical shape. One schema so a
single reader can consume either, and so the two can be run over a polyglot
repo and their packs merged without translation.

## What a scout is, and is not

A scout is **deterministic and read-only**. It parses source and reports what it
found. It never calls a model, never sends your code anywhere, never writes to
the repo it is scanning, and never guesses.

That constraint is the point. The skills in this library run on one rule:
*unknown data must increase decision discipline, not model confidence.* A
scanner that inferred intent would be handing the skills fabricated evidence,
which is worse than handing them nothing. So a scout reports two things and
keeps them strictly separate: what it **confirmed** in the source, and what it
**cannot determine** by reading.

The scout does not replace a skill. It does the mechanical half so the skill can
do the judgement half, and it tells the skill exactly which questions it could
not answer.

## Top level

```json
{
  "schema": "m3n0ko0g.scout.evidence/1",
  "scout":    { "name": "...", "version": "...", "language": "python|typescript" },
  "run":      { "id": "...", "run_at": "...", "root": "...",
                "files_scanned": 0, "lines_scanned": 0, "duration_ms": 0 },
  "counts":   { "<class>": 0 },
  "findings": [ ... ],
  "unknowns": [ ... ],
  "receipt":  "--- M3n0ko0g skill receipt --- ..."
}
```

`run.id` is 12 random hex characters, per `TRACEABILITY.md`. Corrections point
at the id, never at `run_at`.

## Findings

```json
{
  "id": "F1",
  "class": "unpinned_model",
  "confidence": "confirmed",
  "file": "api/answer.py",
  "line": 88,
  "excerpt": "model=\"gpt-4o\"",
  "detail": "Model alias is not version-pinned.",
  "feeds": ["model-swap-blast-radius", "incident-replay"]
}
```

`confidence` is one of:

| value | means |
|---|---|
| `confirmed` | The scout parsed this out of the source. It is there. |
| `inferred` | Strongly implied by structure, but not directly stated. Legitimate and never to be read as confirmed. |

There is no `unknown` confidence. A thing the scout could not establish is not
a weak finding, it is an **unknown**, and it goes in the other list. Collapsing
those two is how a report starts lying.

`feeds` names the skills that consume this finding. It is how a scout run turns
into a skill run instead of a wall of grep output.

### Classes

| class | what it marks |
|---|---|
| `model_call` | A call to a model provider. |
| `unpinned_model` | A model alias with no version. The swap already happened, repeatedly, without review. |
| `prompt_artifact` | A substantial prompt string or prompt file. |
| `tool_definition` | A tool or function definition. The model reads these, so they are prompts. |
| `runtime_prompt` | A prompt assembled or fetched at runtime. Not auditable from source. |
| `rag_embed` | An embedding call. A second model, and a second subprocessor. |
| `rag_retrieve` | A retrieval or vector-store query. |
| `no_similarity_floor` | Retrieval with a fixed k and no minimum score. The system cannot say it does not know. |
| `chunking` | Chunk size and overlap settings. |
| `retry` | Retry logic. |
| `unbounded_loop` | A loop containing a model call with no hard iteration cap. Unbounded spend and latency. |
| `parse_no_contract` | Model output parsed as structured data where nothing states a format. |
| `interpolation` | User, database or retrieved content interpolated into a prompt. |
| `logging_gap` | A model or retrieval call whose inputs are not logged. |
| `eval_check` | Something that looks like an evaluation. |
| `weak_assertion` | An assertion that cannot fail, e.g. `assert resp is not None`. |
| `secret_risk` | An API key read in a path that could reach a client bundle. |

## Unknowns

```json
{
  "id": "U1",
  "question": "How many turns of history are sent?",
  "why": "History is assembled at runtime from a store the scout cannot read.",
  "resolve": "Log the message count on one request, or read the store's schema."
}
```

Every unknown carries a `resolve`: the specific thing that would answer it.
An unknown without a way to close it is a complaint.

## Exit codes

`0` clean run. `1` a scout error. Findings never change the exit code, because
a scout that fails the build on a finding is a scout people delete.

---

Part of the free skills library by M3n0ko0g.

LAHA, Love All Humans Always.
