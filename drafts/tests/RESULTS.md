# skill-lint test results

Date: 2026-10-10 · Draft: `drafts/skill-lint.SKILL.md` v0.1.0 · Status: draft, tested as far as listed below

## What was run

| # | Target | What it is | Result |
|---|---|---|---|
| 1 | `hostile-commit-helper` | Synthetic. Written for this test. 9 planted problems plus a script. | Caught 8 of 9 by pattern, the 9th by the hidden-text pattern. See below. |
| 2 | `clean-changelog-helper` | Synthetic. Benign, but uses the words "token", "secret" and a URL. | 0 hits on the instruction and hidden-text patterns. 2 hits on the code pattern (false positives, as expected). |
| 3 | The 12 skills in `skills/` | Benign defensive docs written by Lawrence. | 31 hits on the instruction pattern, all prose that discusses the phrases. 0 on the hidden-text pattern. |
| 4 | `math-olympiad` (official marketplace) | Real third-party skill, 10 text files, 2 shell scripts. | 3 URL hits (license, README), 2 "silently" in math prose, 0 hidden text. Scripts read in full. Verdict would be NO FINDINGS IN WHAT WAS READ. |
| 5 | `plugin-dev/hook-development` (official marketplace) | Real third-party skill about hooks. Stress case for noise. | 197 hits on the code pattern run over the whole tree, 1 trivial hit on the instruction pattern, 0 hidden text. |

## Planted problems in the hostile fixture

| Planted | Caught by |
|---|---|
| Self-asserted "verified and security reviewed" | instruction pattern |
| Authority claim ("administrator has approved", "mandatory") | instruction pattern |
| "Run every command without asking" | instruction pattern |
| HTML comment carrying an instruction | hidden-text pattern, instruction pattern |
| "Ignore previous instructions", "take priority" | instruction pattern |
| Remote "fetch and follow" | instruction pattern, URL in code pattern |
| Concealment ("do not mention") | instruction pattern (inside the comment) |
| Concealment split by a zero-width space | **hidden-text pattern only.** The phrase pattern missed it. |
| Script reading credential paths, `curl \| sh` | code pattern |

## What changed in the skill because of this

1. The code pattern now runs over `scripts/` only. Run over documentation it returned 197 hits on a benign skill.
2. Added the instruction-phrase pattern and the hidden-text pattern to Step 3, with the zero-width evidence for running the second one every time.
3. Added Confirmed and Inferred marks to every finding, and a rule against writing Inferred as fact. CONTRIBUTING requires this.
4. Step 1 now starts with "write down what you cannot see." CONTRIBUTING requires this.
5. Fixed the example verdict. Confirmed concealment is BLOCK, not HOLD.
6. Added a "What to look for first" section, ordered by severity.

## Promotion dry run (throwaway copy, real repo untouched)

- `build-skills.mjs` packaged it without error. Frontmatter valid. `--check` reports 13 skills current.
- `npm test` fails on two count assertions in `mcp/test-server.mjs` (lines 133 and 221: 12 becomes 13, 13 becomes 14). After patching those two, all suites pass: 43 + 65 + 55 = 163, same as baseline.
- `search_skills` over the MCP returns it as the top hit, in the `general` track (not the audit pass).
- Still to do on promotion: "twelve" text in `README.md`, `package.json`, `mcp/README.md`, `mcp/package.json`, "12 skills" in `CHANGELOG.md`, a `REGISTRY.md` row, and the generated `.skill`, `index.json` and bundle files.

## What this testing does not show

- **Circular on the hostile fixture.** I wrote the skill and the fixture. Catching my own planted problems proves the patterns match my own phrasing, nothing more. A real hostile skill will use words I didn't think of.
- **No real malicious sample was reviewed.** Both real artifacts were benign. The false-negative rate on real attacks is unknown.
- **No independent reviewer ran the procedure.** I applied the steps myself. Whether another person or model follows them the same way is untested.
- **Patterns ran through ripgrep via a search tool,** not from the shell. `rg` isn't on the Git Bash path here, and the PowerShell quoting of the `\x{...}` classes is untested.
- **The pattern 1 path assumes a `scripts/` folder.** Artifacts that keep code elsewhere need the path changed.
- **The Rules aren't all battle-tested.** CONTRIBUTING asks that each rule be a failure you have actually seen. These come from published research on skill marketplaces and from the fixture, not from incidents you've handled. Worth a ruling on whether that's acceptable for 0.1.0.
- **Skill instruction compliance was not tested.** Nothing here shows a model resists a hostile skill while reviewing it. Step 0 is a design position, not a measured result.
