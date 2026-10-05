---
name: legacy-modernization-scout
version: 0.1.0
description: Map a legacy system for incremental modernization — inventory the surfaces, find the seams where a facade can be inserted, rank strangler-fig slices by value against reversibility, and design the adapter interfaces between old and new. Produces a written scout report with an explicit register of what is still unknown. Use before committing to any rewrite, replatform, or "we'll just rebuild it" decision.
license: Released by Lawrence Jefferson II for public use.
---

# Legacy Modernization Scout

Most legacy rewrites fail for the same reason: someone decided what to build before anyone established what was actually there. This skill runs the scouting pass first.

The output is not a plan to rebuild the system. It is a map of the system, a ranked set of small reversible slices, and an honest list of what nobody has confirmed yet.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* When the evidence about a subsystem is thin, this skill slows down and records the gap. It does not fill the gap with a plausible guess and keep moving. A scout report that says "we do not know how billing authenticates" is worth more than one that assumes.

## When to use this

Reach for it when someone is about to commit to a rewrite, a replatform, a cloud migration, a language or framework change, or an "add AI to this" initiative on top of a system nobody fully understands. Also use it when a system works but nobody will touch it, when the last three attempts to change it caused an outage, or when the people who built it have left.

Do not use it for greenfield design, for a system small enough to read end to end in an afternoon, or as a substitute for talking to the people who operate the thing.

## The method

### Step 1 — Bound the system, out loud

Before any inventory, write down four things and get them confirmed by a human:

What is in scope. What is explicitly out of scope. What "done" means for this modernization — the business outcome, not the technology. And what constraints are non-negotiable: regulatory, uptime, data residency, contractual, budget, or a hard date.

If any of these four cannot be answered, that is the first finding. Record it and continue; do not invent one.

### Step 2 — Inventory the surfaces

Walk the system and catalogue what it actually exposes. For each item capture what it is, who or what calls it, how often, and how confident you are in that answer.

Look for entry points (HTTP endpoints, RPC, message consumers, file drops, terminal screens, batch triggers), data stores (databases, tables, files, queues, caches, and anything that is a store in practice even if nobody calls it one), scheduled and batch work (cron, job schedulers, overnight runs, month-end and year-end processing — these are where the worst surprises live), outbound integrations (third-party APIs, partner feeds, payment rails, reporting exports), and authentication and authorization (where identity is established, where permission is decided, and whether those are the same place).

Read the source where you can. Read the runbooks, the on-call notes, the ticket history, and the schema. Where the evidence runs out, mark it and move on.

### Step 3 — Rate confidence on every finding

Every inventory item gets one of three marks, and the mark is not optional:

**Confirmed** — verified in source, schema, config, or logs, or confirmed by an operator who owns it.

**Inferred** — reasonable from naming, structure, or convention, but not verified. Inferred items are hypotheses. Say so.

**Unknown** — we looked and could not establish it, or we have not looked yet.

A scout report where everything is Confirmed is a scout report that was not honest.

### Step 4 — Find the seams

A seam is a place where you can insert a facade without rewriting what sits behind it — a point where the interface is narrow, the contract is stable, and the traffic can be redirected.

For each candidate seam, record where it sits, how wide the contract is (parameters in, results out, side effects), whether traffic can be routed conditionally at that point, whether the old and new paths can run side by side, and whether a bad slice can be rolled back by flipping the route rather than by restoring a backup.

Rank seams by narrowness. The narrowest stable contract is the best first cut, almost regardless of business value. A wide seam is not a seam; it is a rewrite wearing a costume.

Watch for false seams: an interface that looks narrow but shares a database transaction with the caller, a service boundary that passes ORM objects, an endpoint whose real contract is "and it also updates three other tables."

### Step 5 — Design the adapter for each seam

Every seam that gets cut needs an adapter — a translation layer that lets old and new speak to each other without either one learning the other's dialect.

For each adapter, specify the contract on the legacy side, the contract on the modern side, the mapping between them including every field that does not map cleanly, what happens on failure in each direction, and — critically — whether the adapter is a permanent interface or scaffolding to be removed. Say which. Adapters that were meant to be temporary and were never labelled as such become the next generation's legacy system.

Record data-shape mismatches explicitly: fixed-width and packed decimal fields, sentinel values that mean null, dates encoded as integers, encoding and codepage differences, precision loss on money, and timezone assumptions baked into the schema. These are where migrations silently corrupt data.

### Step 6 — Rank the slices

A slice is one seam cut, one adapter built, one piece of behaviour moved. Score each on four axes:

**Value** — what does the business get when this lands? **Risk** — what is the blast radius if it goes wrong? **Reversibility** — how fast can we put it back, and does putting it back lose data? **Evidence** — how much of this slice rests on Inferred or Unknown findings?

Order the slices so the first one is small, reversible, and resting on Confirmed evidence — even if its business value is modest. The first slice's job is to prove the migration mechanism works and to build the team's confidence in the rollback path. Value comes second.

Any slice that depends on an Unknown does not get scheduled. It gets a spike to resolve the Unknown first.

### Step 7 — Define verification before you cut

For each slice, state how you will know it worked, before it is built. Name the observable signal: parallel-run output comparison, shadow traffic diffing, reconciliation counts, error-rate and latency thresholds, and a specific rollback trigger with a number attached.

"We'll monitor it" is not a verification plan. "Run both paths for ten business days; roll back if the daily reconciliation differs on more than zero records" is.

### Step 8 — Name the human decisions

Some calls are not the scout's to make. Flag them explicitly and route them to a named human: anything that changes what a customer sees, anything touching money movement or regulated data, anything that cannot be rolled back, and any slice where the evidence is Inferred but the blast radius is large.

The report should make it obvious which decisions are waiting on a person and who that person is.

## The deliverable

Write a single file, `MODERNIZATION-SCOUT.md`, with these sections in this order:

**Scope and outcome** — what is in, what is out, what done means, what constrains us.

**Unknowns register** — every Unknown, what it blocks, and what would resolve it. This section goes near the top, not buried in an appendix. It is the most valuable part of the report.

**System inventory** — the surfaces from Step 2, each with its confidence mark.

**Seam analysis** — candidate seams, ranked by narrowness, with false seams called out and explained.

**Adapter designs** — one per seam that made the cut, including the mismatch list and the permanent-or-scaffolding call.

**Slice plan** — ranked slices with value, risk, reversibility, and evidence scores, plus the verification plan for each.

**Decisions awaiting a human** — the list from Step 8, each with an owner.

**What we did not look at** — the honest boundary of this scouting pass.

Then write one short summary for the person who commissioned it: the recommended first slice, why that one, and the single biggest unknown standing in the way.

## How this fails

The scout report is wrong when it reads as confident and complete. If the Unknowns register is empty, the scouting pass did not happen — someone pattern-matched instead of looking. If every seam is rated excellent, the seams were not tested against the false-seam checks. If the first slice is the most valuable one rather than the safest one, the plan is optimising for the demo rather than for the migration surviving contact with production.

A good scout report is uncomfortable to read. It says what nobody has confirmed.

---

Part of the free skills library by M3n0ko0g.

LAHA — Love All Humans Always.
