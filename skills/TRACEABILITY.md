# TRACEABILITY.md

Every skill in this library ends its run by emitting a receipt. This file says why, what a receipt must contain, and what it must never contain.

It is short on purpose. A traceability standard nobody reads is a traceability standard nobody follows.

## Why

An AI system that cannot show its work cannot be audited, and a system that cannot be audited cannot be signed off by anyone who understands what they are signing.

That problem does not get better by adding a skill. A skill that produces a confident report and leaves no trace is a new unauditable component in a system that already had too many. So every skill here logs that it ran, on what shape of input, what it concluded, and, critically, whether a human accepted the conclusion.

The `human` field is the entire point. It is the difference between a record of what a model said and a record of what an organization decided.

## The receipt

Every run emits one, at the end of the run, whether or not the skill found anything. A skill that only logs when it found something teaches you nothing about how often it runs or how often it comes back clean.

The common fields:

```
--- M3n0ko0g skill receipt ---
skill:       <skill name>
version:     <skill version>
id:          <12 random hex chars>
run_at:      <ISO-8601 UTC>
input:       <shape of what was read: counts, never content>
<skill-specific result fields>
unknowns:    <count>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

Individual skills add their own result fields. They never remove `skill`, `version`, `id`, `run_at`, `input`, or `human`.

## The id

Twelve random hex characters, generated per run. Not a hash of the input, not a timestamp, not a sequence.

Corrections, disputes, and follow-ups point at the `id`. They never point at `run_at`, because two runs can share a timestamp and because timestamps get rewritten by log pipelines, timezone conversion, and well-meaning normalization. An id that means one run, forever, is what makes a correction attachable.

## Shape, never content

A receipt records the shape of what was read. Counts, classes, file names, verdict labels.

It never records: prompt text, model output, user messages, retrieved chunks, document content, personal data, credentials, customer identifiers, or field values of any kind.

This is not a preference. The inputs to these skills are usually the most sensitive material in a codebase, and a receipt is the artifact most likely to end up pasted into a chat channel, committed to a repo, or shipped to a log aggregator with broader access than the source. A receipt that quotes its input turns a traceability record into a leak.

When in doubt, log the count and the class. `findings: 4 (top class: contradiction)` tells a reader what they need. The quote belongs in the report, which lives under the access control the report deserves.

## The human field

Starts at `pending`. Every time.

A skill never sets it to `accepted`. A skill never sets it to `rejected`. Only a person does, and the change should be attributable to that person by whatever mechanism the surrounding system already uses.

A receipt that sits at `pending` forever is itself a finding. It means a report was produced and nobody ever acted on it, which is worth knowing and is invisible without this field.

On **Sign-Off Pack** the field carries `signed` or `declined` instead, and there it is not an acknowledgement. It is the signature.

## Where receipts go

The skill emits the receipt as text at the end of its output. Where it is stored afterward is the surrounding system's decision, not the skill's.

Sensible destinations: a run log, an audit table, the same place the report lands, a ticket. What matters is that the receipt and the report it describes stay findable from each other, via the `id`.

## Corrections

If a finding turns out to be wrong, do not edit the receipt. Emit a new one that references the original `id`, and say what changed.

An edited audit record is not an audit record.

---

Part of the free skills library by M3n0ko0g.

LAHA, Love All Humans Always.
