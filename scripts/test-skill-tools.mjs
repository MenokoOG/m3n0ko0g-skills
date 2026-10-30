#!/usr/bin/env node
/* Tests for the skill validator and the README index generator.

   Feeds known-bad skills to validateSkill and asserts the exact error, then
   runs the validator over the real skills/ directory. No mocks, no runner.

   Usage: node scripts/test-skill-tools.mjs */

import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkill, validateSet, parseSkill, firstSentence } from "./skill-model.mjs";
import { renderIndex, replaceBlock, auditOrder } from "./build-readme-index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  pass  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`);
  }
}

const DESC = "A description that is comfortably longer than sixty characters so it passes the length floor.";
const RECEIPT = [
  "## Run record",
  "",
  "```",
  "--- M3n0ko0g skill receipt ---",
  "skill:       demo-skill",
  "version:     0.1.0",
  "id:          <12 hex>",
  "run_at:      <ISO-8601 UTC>",
  "input:       <shape only>",
  "unknowns:    <n>",
  "recommended: <one step>",
  "human:       <pending | accepted | rejected>",
  "---",
  "```",
].join("\n");
const FOOTER = "Part of the free skills library by M3n0ko0g.\n\nLAHA, Love All Humans Always.\n";

function skill({ name = "demo-skill", version = "0.1.0", desc = DESC, body = `Unknowns first.\n\n${RECEIPT}\n\n${FOOTER}`, license = "x" } = {}) {
  return `---\nname: ${name}\nversion: ${version}\ndescription: ${desc}\nlicense: ${license}\n---\n\n# Demo\n\n${body}`;
}
const errors = (file, raw) => validateSkill(file, raw).filter((f) => f.level === "error").map((f) => f.message);
const has = (list, text) => list.some((m) => m.includes(text));

console.log("skill validator\n");

console.log("  valid skill:");
check("clean skill has no errors", errors("demo-skill.SKILL.md", skill()).length === 0, errors("demo-skill.SKILL.md", skill()).join("; "));
check("CRLF line endings are accepted", errors("demo-skill.SKILL.md", skill().replace(/\n/g, "\r\n")).length === 0);
check("folded description is joined", parseSkill(skill({ desc: "first line\n  second line" })).meta.description === "first line second line");

console.log("\n  frontmatter:");
check("no frontmatter is an error", has(errors("a.SKILL.md", "# hi"), "no frontmatter"));
check("unterminated frontmatter is an error", has(errors("a.SKILL.md", "---\nname: a\n"), "unterminated"));
check("missing license is an error", has(errors("demo-skill.SKILL.md", skill({ license: "" })), 'missing "license"'));
check("name must match filename", has(errors("other.SKILL.md", skill()), "does not match filename"));
check("name must be kebab-case", has(errors("Demo_Skill.SKILL.md", skill({ name: "Demo_Skill" })), "not kebab-case"));
check("version must be semver", has(errors("demo-skill.SKILL.md", skill({ version: "v1" })), "not x.y.z"));
check("short description is an error", has(errors("demo-skill.SKILL.md", skill({ desc: "too short" })), "under 60"));

console.log("\n  receipt and body:");
const noReceipt = skill({ body: `Unknowns first.\n\n${FOOTER}` });
check("missing Run record is an error", has(errors("demo-skill.SKILL.md", noReceipt), "Run record"));
check("missing receipt block is an error", has(errors("demo-skill.SKILL.md", noReceipt), "no receipt block"));
const noHuman = skill({ body: `Unknowns.\n\n${RECEIPT.replace(/human:.*\n/, "")}\n\n${FOOTER}` });
check("receipt missing human is an error", has(errors("demo-skill.SKILL.md", noHuman), 'receipt missing "human"'));
const badHuman = skill({ body: `Unknowns.\n\n${RECEIPT.replace("<pending | accepted | rejected>", "approved")}\n\n${FOOTER}` });
check("human must start at pending", has(errors("demo-skill.SKILL.md", badHuman), "does not start at pending"));
const signoff = skill({ body: `Unknowns.\n\n${RECEIPT.replace("<pending | accepted | rejected>", "<pending | signed | declined>")}\n\n${FOOTER}` });
check("pending | signed | declined is accepted", errors("demo-skill.SKILL.md", signoff).length === 0);
const noInput = skill({ body: `Unknowns.\n\n${RECEIPT.replace(/input:.*\n/, "")}\n\n${FOOTER}` });
check("missing input is a warning, not an error", errors("demo-skill.SKILL.md", noInput).length === 0 && validateSkill("demo-skill.SKILL.md", noInput).some((f) => f.level === "warn"));
const wrongSkill = skill({ body: `Unknowns.\n\n${RECEIPT.replace("skill:       demo-skill", "skill:       other")}\n\n${FOOTER}` });
check("receipt skill must match name", has(errors("demo-skill.SKILL.md", wrongSkill), "does not match name"));
check("missing footer is an error", has(errors("demo-skill.SKILL.md", skill({ body: `Unknowns.\n\n${RECEIPT}\n` })), "footer"));
check("em dash is an error", has(errors("demo-skill.SKILL.md", skill({ body: `Unknowns — here.\n\n${RECEIPT}\n\n${FOOTER}` })), "em dash"));
check("no mention of unknowns is only a warning", validateSkill("demo-skill.SKILL.md", skill({ body: `${RECEIPT.replace(/unknowns/g, "gaps")}\n\n${FOOTER}` })).some((f) => f.level === "warn"));

console.log("\n  set checks:");
const a = { file: "a.SKILL.md", meta: { name: "a", description: "same" } };
const b = { file: "b.SKILL.md", meta: { name: "b", description: "same" } };
check("duplicate description is an error", validateSet([a, b]).length === 1);
check("duplicate name is an error", validateSet([a, { file: "c.SKILL.md", meta: { name: "a", description: "x" } }]).length === 1);

console.log("\nreadme index\n");
const skills = [
  { name: "zeta", version: "0.1.0", description: "Last alphabetically. Second sentence." },
  { name: "beta", version: "0.2.0", description: "Audit second." },
  { name: "alpha", version: "0.1.0", description: "Audit first." },
];
const table = renderIndex(skills, ["alpha", "beta"]);
const lines = table.split("\n");
check("table has header, rule and one row per skill", lines.length === 5);
check("audit skills lead in run order", lines[2].includes("[alpha]") && lines[3].includes("[beta]"));
check("general skills follow", lines[4].includes("[zeta]") && lines[4].includes("general"));
check("only the first sentence is used", lines[4].includes("Last alphabetically.") && !lines[4].includes("Second sentence"));
check("audit rows carry their run number", lines[3].includes("audit 2"));
check("firstSentence keeps a lone sentence", firstSentence("No period here") === "No period here");
check("auditOrder reads the array", auditOrder('const AUDIT_ORDER = [\n  "x",\n  "y",\n];').join() === "x,y");
const doc = "top\n<!-- skills-index:start (generated by scripts/build-readme-index.mjs, do not edit) -->\nold\n<!-- skills-index:end -->\nbottom";
const replaced = replaceBlock(doc, "NEW");
check("replaceBlock swaps only the block", replaced.includes("NEW") && !replaced.includes("old") && replaced.startsWith("top") && replaced.endsWith("bottom"));
check("replaceBlock is idempotent", replaceBlock(replaced, "NEW") === replaced);
let threw = false;
try { replaceBlock("no markers", "x"); } catch { threw = true; }
check("missing markers throw", threw);

console.log("\nthe real repo\n");
const v = spawnSync(process.execPath, [join(HERE, "validate-skills.mjs")], { encoding: "utf8" });
check("every skill in skills/ validates", v.status === 0, v.stdout.trim().split("\n").slice(-3).join(" | "));
const r = spawnSync(process.execPath, [join(HERE, "build-readme-index.mjs"), "--check"], { encoding: "utf8" });
check("README index is current", r.status === 0, (r.stderr || r.stdout).trim());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
