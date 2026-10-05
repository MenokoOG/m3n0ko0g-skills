# Contributing

Thanks for looking. This repo takes contributions, and the bar is the same one the skills hold other people's systems to: evidence over confidence, and a human signs.

## Ground rules

- No dependencies. The MCP server, the build script and both scouts run on Node 18+ and Python 3.8+ with nothing installed. A pull request that adds a `dependencies` block will be asked to remove it. A tool that audits other people's dependency surface should be careful about its own.
- No em dashes in prose. Commas, periods, colons, parentheses.
- Every skill emits a receipt, and `human` starts at `pending`. Both are non-negotiable. See [skills/TRACEABILITY.md](skills/TRACEABILITY.md).
- Unknowns first. A skill or a scout that buries what it could not establish in an appendix is not done.
- CI must be green on every push: `check:skills`, the MCP protocol test, and both scout suites. 163 assertions today. Add to that number, never subtract from it.

## Adding a skill

A skill is one file, `skills/<name>.SKILL.md`. The build packages it into `skills/<name>.skill` (a zip with `SKILL.md` at the root) and lists it in `skills/index.json`.

### 1. The frontmatter contract

The build refuses a skill without all four fields, and refuses one whose `name` does not match its filename.

```yaml
---
name: my-skill-name
version: 0.1.0
description: One paragraph. What it does, what it produces, when to reach for it. This is what search_skills and an agent's tool picker read, so write it for them.
license: Released by Lawrence Jefferson II for public use.
---
```

`name` is kebab-case and equals the filename minus `.SKILL.md`. A long `description` may fold onto continuation lines indented by two spaces.

### 2. The shape of the body

Read two existing skills before writing one. `rag-integrity-check` and `incident-replay` are good models. The sections they share:

- An opening that names the situation in plain words. Somebody has this problem on a Tuesday. Say what it looks like from where they sit.
- **Operating law**, quoted verbatim: *unknown data must increase decision discipline, not model confidence.* Then one or two sentences on what this particular skill cannot know from reading, and what it does about that.
- **When to use this**, and when not to.
- **The method**, as numbered steps. Step 1 is always some form of "write down what you cannot see before you look at anything."
- **What to look for**, the recurring findings, in rough order of how often they turn out to matter.
- **The output**, as a fenced example of the file the skill writes. Unknowns go at the top of that file, never in an appendix.
- **Run record**, the receipt (below).
- **Rules**, a short list of "never" and "always" lines. Each one should be a failure you have actually seen.
- The footer: `Part of the free skills library by M3n0ko0g.` then `LAHA, Love All Humans Always.`

### 3. The receipt requirement

Every skill ends its run by emitting a receipt. Put the block in a section called `## Run record`. The six common fields are required and may not be removed. Add skill-specific result fields between `input` and `unknowns`.

```
--- M3n0ko0g skill receipt ---
skill:       my-skill-name
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <shape of what was read: counts, never content>
<skill-specific result fields>
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

Two lines below the block, say it in prose: the receipt carries shape and never content, and `human` starts at `pending` and is only ever set by a person. The skill never marks its own work accepted.

### 4. The Unknowns-first discipline

This is the part reviewers check hardest.

The skill's method must begin by establishing what cannot be known from the input in front of it. Its output must lead with those Unknowns. Its findings must carry a confidence mark (Confirmed, Inferred, or the skill's equivalent), and nothing Inferred may be written as fact. Where the honest answer is "not measurable," the skill says that and names the measurement that would change it, rather than producing a number.

A skill whose example output has an empty Unknowns section will be sent back.

### 5. Build and test

```bash
npm run build:skills    # writes skills/<name>.skill, index.json, and the two bundles
npm test                # check:skills, the MCP protocol test, both scout suites
```

Commit the generated `.skill`, `index.json`, `m3scout.zip` and `m3n0ko0g-skills-mcp.zip` alongside your SKILL.md. CI runs `check:skills`, which fails if any of them is stale. The build pins zip timestamps so the bytes are stable across machines.

If your skill belongs in the audit pass, add it to `AUDIT_ORDER` in `mcp/server.mjs` at the position it should run, and update the count assertions in `mcp/test-server.mjs`. Otherwise it lands in the general track automatically.

## Changing a scout

Both scouts read source and never call a model, never send anything anywhere, and never write to the tree they scan. There is a test asserting the last one. Keep it that way.

A new finding class needs: an entry in `scouts/SCHEMA.md`, the same class name in both `m3scout.py` and `m3scout.mjs`, a `feeds` list naming the skills that consume it, and a planted example in both fixtures with a test that finds it. The two scouts must keep emitting the same schema. There is a parity test.

Findings are `confirmed` or `inferred`. Never add an `unknown` confidence. A thing the scout could not establish goes in the unknowns list with a `resolve` step.

## Pull requests

One change per PR. Say what you changed and why in the description. If a test count moved, say by how much. Green CI on all six matrix jobs before review.

LAHA, Love All Humans Always.
