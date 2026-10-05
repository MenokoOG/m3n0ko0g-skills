/* build-skills.mjs: package every *.SKILL.md in skills/ into a .skill
   bundle, and regenerate skills/index.json.

   A .skill file is a zip containing SKILL.md at the root. We write the zip by
   hand with node:zlib so this has zero dependencies and runs the same in CI,
   on Windows, and in the bundle build.

   Usage:
     node scripts/build-skills.mjs            # write .skill files + index.json
     node scripts/build-skills.mjs --check    # verify they are current, exit 1 if not
*/

import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const CHECK = process.argv.includes("--check");

/* ---------------------------------------------------------------- zip ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* DOS date/time. We pin it so the output is byte-stable and --check is
   meaningful. A zip whose bytes change every build can never be diffed. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    /* Only use deflate when it actually wins. Some SKILL.md files are small
       enough that stored is smaller. */
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* --------------------------------------------------------------- reading */

/* Read a text file as LF, always.
 *
 * Git hands you CRLF on a Windows checkout and LF on Linux, so packaging the
 * bytes as they sit on disk makes the .skill zips differ per platform. That
 * turns --check into a false alarm on one machine and a missed staleness on
 * another, and it breaks CI the first time it runs somewhere else. Normalize
 * here so the archive contents depend on the content and nothing else. */
function readText(path) {
  return Buffer.from(readFileSync(path, "utf8").split("\r\n").join("\n"), "utf8");
}

/* ------------------------------------------------------------ frontmatter */

function parseFrontmatter(raw, file) {
  /* The four original skills were authored with CRLF. Normalize before
     parsing so line endings never decide whether a skill packages. */
  const md = raw.replace(/\r\n/g, "\n");
  if (!md.startsWith("---\n")) throw new Error(`${file}: no frontmatter`);
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${file}: unterminated frontmatter`);

  const out = {};
  let key = null;
  for (const line of md.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      out[key] = m[2].trim();
    } else if (key && line.startsWith("  ")) {
      /* folded continuation of a long description */
      out[key] += " " + line.trim();
    }
  }
  for (const required of ["name", "version", "description", "license"]) {
    if (!out[required]) throw new Error(`${file}: frontmatter missing "${required}"`);
  }
  return out;
}

/* ------------------------------------------------------------------ main */

const mdFiles = readdirSync(SKILLS_DIR)
  .filter((f) => f.endsWith(".SKILL.md"))
  .sort();

if (mdFiles.length === 0) {
  console.error("no *.SKILL.md files found in skills/");
  process.exit(1);
}

const index = [];
const stale = [];

for (const file of mdFiles) {
  const slug = file.replace(/\.SKILL\.md$/, "");
  const md = readText(join(SKILLS_DIR, file));
  const fm = parseFrontmatter(md.toString("utf8"), file);

  if (fm.name !== slug) {
    throw new Error(`${file}: frontmatter name "${fm.name}" does not match filename "${slug}"`);
  }

  const bundle = zip([{ name: "SKILL.md", data: md }]);
  const target = join(SKILLS_DIR, `${slug}.skill`);

  if (CHECK) {
    if (!existsSync(target) || !readFileSync(target).equals(bundle)) stale.push(slug);
  } else {
    writeFileSync(target, bundle);
  }

  index.push({
    name: fm.name,
    version: fm.version,
    description: fm.description,
    license: fm.license,
    md: `/skills/${file}`,
    skill: `/skills/${slug}.skill`,
    bytes: md.length,
  });
}

/* ------------------------------------------------------------- mcp bundle */

/* One zip holding the MCP server plus a copy of every skill, so a visitor can
   download it and run it without a git checkout. The server looks for
   ./skills next to itself, which is exactly what this lays out. */
function buildMcpBundle() {
  const MCP_DIR = join(ROOT, "mcp");
  const entries = [];

  for (const f of ["server.mjs", "README.md", "package.json"]) {
    entries.push({
      name: `m3n0ko0g-skills-mcp/${f}`,
      data: readText(join(MCP_DIR, f)),
    });
  }
  for (const file of mdFiles) {
    entries.push({
      name: `m3n0ko0g-skills-mcp/skills/${file}`,
      data: readText(join(SKILLS_DIR, file)),
    });
  }
  entries.push({
    name: "m3n0ko0g-skills-mcp/skills/TRACEABILITY.md",
    data: readText(join(SKILLS_DIR, "TRACEABILITY.md")),
  });

  return zip(entries);
}

/* ---------------------------------------------------------- scout bundle */

/* A separate download from the MCP bundle, on purpose. They are different
   tools for different moments: the MCP server hands an agent the method, the
   scouts produce the evidence. Bundling them together would make each look
   like an accessory of the other. */
function buildScoutBundle() {
  const SCOUTS_DIR = join(ROOT, "scouts");
  const entries = [];

  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__pycache__" || name === "node_modules") continue;
        walk(full, `${prefix}/${name}`);
      } else {
        entries.push({ name: `${prefix}/${name}`, data: readText(full) });
      }
    }
  };
  walk(SCOUTS_DIR, "m3scout");

  /* The receipt every scout emits cites this, so it ships with them. */
  entries.push({
    name: "m3scout/TRACEABILITY.md",
    data: readText(join(SKILLS_DIR, "TRACEABILITY.md")),
  });

  return zip(entries);
}

const mcpBundle = buildMcpBundle();
const scoutBundle = buildScoutBundle();
const scoutPath = join(SKILLS_DIR, "m3scout.zip");
const mcpPath = join(SKILLS_DIR, "m3n0ko0g-skills-mcp.zip");

const indexJson = JSON.stringify(
  {
    generated_by: "scripts/build-skills.mjs",
    count: index.length,
    mcp: {
      name: "m3n0ko0g-skills-mcp",
      download: "/skills/m3n0ko0g-skills-mcp.zip",
      transport: "stdio",
      tools: ["list_skills", "get_skill", "search_skills", "new_receipt"],
    },
    scouts: {
      name: "m3scout",
      download: "/skills/m3scout.zip",
      schema: "m3n0ko0g.scout.evidence/1",
      languages: ["python", "typescript"],
    },
    skills: index,
  },
  null,
  2,
) + "\n";
const indexPath = join(SKILLS_DIR, "index.json");

if (CHECK) {
  /* Compare normalized, for the same reason readText exists: a checkout can
     hand this file back with CRLF, and comparing raw bytes against a freshly
     generated LF string reports a stale index that is actually identical. */
  const onDisk = existsSync(indexPath)
    ? readFileSync(indexPath, "utf8").split("\r\n").join("\n")
    : null;
  if (onDisk !== indexJson) stale.push("index.json");
  if (!existsSync(mcpPath) || !readFileSync(mcpPath).equals(mcpBundle)) stale.push("m3n0ko0g-skills-mcp.zip");
  if (!existsSync(scoutPath) || !readFileSync(scoutPath).equals(scoutBundle)) stale.push("m3scout.zip");
  if (stale.length) {
    console.error(`stale, run "npm run build:skills": ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`skills current (${index.length}) + mcp bundle + scout bundle`);
} else {
  writeFileSync(indexPath, indexJson);
  writeFileSync(mcpPath, mcpBundle);
  writeFileSync(scoutPath, scoutBundle);
  console.log(`packaged ${index.length} skills -> skills/*.skill + index.json`);
  for (const s of index) console.log(`  ${s.name}  v${s.version}  ${s.bytes} bytes`);
  console.log(`mcp bundle   -> skills/m3n0ko0g-skills-mcp.zip (${mcpBundle.length} bytes)`);
  console.log(`scout bundle -> skills/m3scout.zip (${scoutBundle.length} bytes)`);
}
