/* validate-skills.mjs: check the structure of every skills/*.SKILL.md.

   Usage: node scripts/validate-skills.mjs
   Exit 1 on any error. Warnings print but do not fail. */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill, validateSkill, validateLinks, validateSet } from "./skill-model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");

const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".SKILL.md")).sort();
if (files.length === 0) {
  console.error("no *.SKILL.md files found in skills/");
  process.exit(1);
}

let errors = 0;
let warnings = 0;
const parsed = [];

for (const file of files) {
  const path = join(SKILLS_DIR, file);
  const raw = readFileSync(path, "utf8");
  const findings = [...validateSkill(file, raw), ...validateLinks(path, raw)];
  const p = parseSkill(raw);
  if (p.meta) parsed.push({ file, meta: p.meta });

  for (const f of findings) {
    f.level === "error" ? errors++ : warnings++;
    console.log(`${f.level.toUpperCase().padEnd(5)} ${file}: ${f.message}`);
  }
}
for (const f of validateSet(parsed)) {
  errors++;
  console.log(`ERROR ${f.file}: ${f.message}`);
}

console.log(`${files.length} skill(s), ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
