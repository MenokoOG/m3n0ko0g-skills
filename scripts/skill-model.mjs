/* skill-model.mjs: parse and validate one *.SKILL.md.

   Pure functions, no file access except in validateLinks. Shared by
   validate-skills.mjs and build-readme-index.mjs so the rules live in one
   place. The frontmatter rules mirror build-skills.mjs and CONTRIBUTING.md. */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const REQUIRED_FIELDS = ["name", "version", "description", "license"];
/* Core fields every receipt carries. input, unknowns and recommended are
   expected but incident-replay and sign-off-pack shape them differently, so
   a missing one warns instead of failing. */
export const RECEIPT_CORE = ["skill", "version", "id", "run_at", "human"];
export const RECEIPT_EXPECTED = ["input", "unknowns", "recommended"];
const RECEIPT_OPEN = "--- M3n0ko0g skill receipt ---";
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

/* Returns { meta, body } or { error }. Folded description lines (two-space
   indent) join onto the previous key, as build-skills.mjs does. */
export function parseSkill(raw) {
  const md = normalize(raw);
  if (!md.startsWith("---\n")) return { error: "no frontmatter" };
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return { error: "unterminated frontmatter" };

  const meta = {};
  let key = null;
  for (const line of md.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      meta[key] = m[2].trim();
    } else if (key && line.startsWith("  ")) {
      meta[key] += " " + line.trim();
    }
  }
  return { meta, body: md.slice(end + 5) };
}

export function firstSentence(description) {
  const m = /^(.+?[.!?])(\s|$)/.exec(description);
  return m ? m[1] : description;
}

function parseReceipt(body) {
  const start = body.indexOf(RECEIPT_OPEN);
  if (start === -1) return null;
  const rest = body.slice(start + RECEIPT_OPEN.length);
  const end = rest.indexOf("\n---");
  const fields = {};
  for (const line of rest.slice(0, end === -1 ? undefined : end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

/* Returns an array of { level: "error" | "warn", message }. */
export function validateSkill(filename, raw) {
  const out = [];
  const err = (message) => out.push({ level: "error", message });
  const warn = (message) => out.push({ level: "warn", message });

  const slug = filename.replace(/\.SKILL\.md$/, "");
  const parsed = parseSkill(raw);
  if (parsed.error) {
    err(parsed.error);
    return out;
  }
  const { meta, body } = parsed;

  for (const f of REQUIRED_FIELDS) if (!meta[f]) err(`frontmatter missing "${f}"`);
  if (meta.name) {
    if (!KEBAB.test(meta.name)) err(`name "${meta.name}" is not kebab-case`);
    if (meta.name !== slug) err(`name "${meta.name}" does not match filename "${slug}"`);
  }
  if (meta.version && !SEMVER.test(meta.version)) err(`version "${meta.version}" is not x.y.z`);
  if (meta.description && meta.description.length < 60) err("description under 60 characters");

  if (!/^## Run record\s*$/m.test(body)) err('no "## Run record" section');
  const receipt = parseReceipt(body);
  if (!receipt) {
    err("no receipt block");
  } else {
    for (const f of RECEIPT_CORE) if (!(f in receipt)) err(`receipt missing "${f}"`);
    for (const f of RECEIPT_EXPECTED) if (!(f in receipt)) warn(`receipt has no "${f}" field`);
    if (receipt.skill && receipt.skill !== meta.name) err(`receipt skill "${receipt.skill}" does not match name`);
    if (receipt.version && receipt.version !== meta.version) err(`receipt version "${receipt.version}" does not match version`);
    /* human must start at pending. The words after it vary: sign-off-pack
       ends in signed | declined because there the field is the signature. */
    if (receipt.human && receipt.human.replace(/^<\s*/, "").split(/[\s|>]/)[0] !== "pending") {
      err(`receipt human "${receipt.human}" does not start at pending`);
    }
  }

  if (!/Part of the free skills library by M3n0ko0g\./.test(body)) err("footer line missing");
  if (!/LAHA[,:] Love All Humans Always\./.test(body)) err("LAHA sign-off missing");
  if (/—/.test(raw)) err("contains an em dash");
  if (!/unknown/i.test(body)) warn("never mentions unknowns");

  return out;
}

/* Relative markdown links in a skill body must resolve from skills/. */
export function validateLinks(filePath, raw) {
  const out = [];
  for (const m of normalize(raw).matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const url = m[1];
    if (/^(https?:|mailto:)/.test(url)) continue;
    if (!existsSync(resolve(dirname(filePath), url))) out.push({ level: "error", message: `dead link ${url}` });
  }
  return out;
}

/* Cross-skill checks: duplicate names and duplicate descriptions. */
export function validateSet(skills) {
  const out = [];
  const seen = { name: new Map(), description: new Map() };
  for (const { file, meta } of skills) {
    for (const k of ["name", "description"]) {
      if (!meta[k]) continue;
      if (seen[k].has(meta[k])) out.push({ file, level: "error", message: `duplicate ${k} (also in ${seen[k].get(meta[k])})` });
      else seen[k].set(meta[k], file);
    }
  }
  return out;
}
