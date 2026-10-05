# Registry

Everything in this repository, what it is for, and where it stands.

**Registry first, telemetry second.** This file is the list of what exists. `skills/TRACEABILITY.md` is what each skill emits when it runs. Build the list before you instrument it.

Hand-maintained on purpose. When keeping it current by hand starts to hurt, that is the signal to automate it.

## Skills

| Name | Version | Status | What it does |
|---|---|---|---|
| `agent-gate-review` | 0.1.0 | released | Review an AI agent or agentic system for the five controls that decide whether it is safe to give real authority â€” registration, validation, revocation, escalation, and human-in-the-loop. |
| `data-in-the-prompt` | 0.1.0 | released | Traces what data actually reaches a third-party model. |
| `eval-or-vibes` | 0.1.0 | released | Sorts every check on an AI system into Eval, Smoke, Vibe, or None, and tells you which failures would currently ship unnoticed. |
| `hot-path` | 0.1.0 | released | Find the line that makes a function slow. |
| `incident-replay` | 0.1.0 | released | Reconstructs what an AI system actually did during a bad run, using whatever logs exist, and names precisely which evidence is missing to ever answer the question. |
| `legacy-modernization-scout` | 0.1.0 | released | Map a legacy system for incremental modernization â€” inventory the surfaces, find the seams where a facade can be inserted, rank strangler-fig slices by value against reversibility, and design the adapter interfaces between old and new. |
| `model-swap-blast-radius` | 0.1.0 | released | Finds everything that breaks when you change the model underneath an AI system. |
| `prompt-archaeology` | 0.1.0 | released | Reconstructs what an undocumented prompt chain actually does. |
| `rag-integrity-check` | 0.1.0 | released | Audits a retrieval-augmented generation pipeline you inherited. |
| `sign-off-pack` | 0.1.0 | released | Assembles the evidence a named human needs to approve an AI system going live or gaining authority. |
| `token-bill` | 0.1.0 | released | Works out where the money actually goes in an LLM system and what to cut. |
| `what-did-i-agree-to` | 0.1.0 | released | Extract every commitment you made from a thread, transcript, or meeting notes â€” who you owe it to, by when, and which ones are dangerously vague. |

## Tools

| Name | Version | Status | Language | What it does |
|---|---|---|---|---|
| `tools/receipt` | 0.1.0 | released | Python 3.10+ | Write, stream and audit skill receipts. No dependencies. |
| `tools/receipt` | 0.1.0 | released | TypeScript / Node 18+ | Same convention. No dependencies. |
| `mcp/` | 0.1.0 | released | Node 18+ | MCP server for the skills library. |
| `scouts/` | 0.1.0 | released | Python and TypeScript | Read-only scanners that give the skills evidence to work from. |

## Games

| Name | Version | Status | What it is |
|---|---|---|---|
| `final-authority` | 0.1.0 | released | Browser game. You are the human in the loop for a fleet of agents. Six shifts, eighteen decisions. You lose by rubber-stamping. Single HTML file, no dependencies. |

## Status vocabulary

**draft**: written, not tested against real input. Do not publish.
**released**: tested, published, safe to hand to someone else.
**deprecated**: superseded. Still present, replacement named in the row.

---

LAHA, Love All Humans Always.
