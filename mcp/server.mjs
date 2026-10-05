#!/usr/bin/env node
/* M3n0ko0g Skills MCP server.
 *
 * Serves the free skills library over the Model Context Protocol so any MCP
 * client can list, read, and search the skills without downloading anything.
 *
 * Zero dependencies on purpose. The protocol over stdio is newline-delimited
 * JSON-RPC 2.0, which is small enough to implement directly, and a tool that
 * audits other people's dependency surface should be careful about its own.
 *
 * Transport rule, and the one that breaks servers when it is broken: stdout
 * carries protocol messages and nothing else. Every log line goes to stderr.
 *
 * Usage:
 *   node server.mjs                     # stdio, for an MCP client
 *   node server.mjs --list              # print the library and exit
 *   M3N0KO0G_SKILLS_DIR=/path node server.mjs
 *
 * Released by Lawrence Jefferson II for public use.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = "m3n0ko0g-skills";
const SERVER_VERSION = "1.0.0";

/* Protocol versions we can speak, newest first. We echo back the client's
   version when we know it, and otherwise answer with our newest. */
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const log = (...a) => process.stderr.write(a.join(" ") + "\n");

/* ------------------------------------------------------------ the library */

/* Look in the places a copy could reasonably live: an explicit env var, a
   skills/ folder beside this file (how the standalone bundle ships), the
   skills/ folder of this repo, or public/skills in a checkout of the site. */
function findSkillsDir() {
  const candidates = [
    process.env.M3N0KO0G_SKILLS_DIR,
    join(HERE, "skills"),
    join(HERE, "..", "skills"),
    join(HERE, "..", "public", "skills"),
  ].filter(Boolean);

  for (const dir of candidates) {
    const abs = resolve(dir);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      const hasSkills = readdirSync(abs).some((f) => f.endsWith(".SKILL.md"));
      if (hasSkills) return abs;
    }
  }
  throw new Error(
    "No skills directory found. Looked in: " +
      candidates.map((c) => resolve(c)).join(", ") +
      ". Set M3N0KO0G_SKILLS_DIR to point at one.",
  );
}

function parseFrontmatter(raw) {
  const md = raw.replace(/\r\n/g, "\n");
  if (!md.startsWith("---\n")) return null;
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return null;

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
  return { meta, body: md.slice(end + 5), full: md };
}

/* The audit pass, in the order you would run it. Anything not listed here is
   a general-purpose skill. Kept explicit rather than inferred, because the
   ordering is editorial and a heuristic would get it wrong. */
const AUDIT_ORDER = [
  "legacy-modernization-scout",
  "prompt-archaeology",
  "rag-integrity-check",
  "data-in-the-prompt",
  "agent-gate-review",
  "eval-or-vibes",
  "token-bill",
  "model-swap-blast-radius",
  "incident-replay",
  "sign-off-pack",
];

function loadLibrary() {
  const dir = findSkillsDir();
  const skills = new Map();

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".SKILL.md")).sort()) {
    const raw = readFileSync(join(dir, file), "utf8");
    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      log(`skipping ${file}: no readable frontmatter`);
      continue;
    }
    const name = parsed.meta.name || file.replace(/\.SKILL\.md$/, "");
    const auditIndex = AUDIT_ORDER.indexOf(name);
    skills.set(name, {
      name,
      version: parsed.meta.version || "0.0.0",
      description: parsed.meta.description || "",
      license: parsed.meta.license || "",
      track: auditIndex === -1 ? "general" : "audit",
      order: auditIndex === -1 ? 999 : auditIndex,
      body: parsed.body,
      full: parsed.full,
      file,
    });
  }

  const traceabilityPath = join(dir, "TRACEABILITY.md");
  const traceability = existsSync(traceabilityPath)
    ? readFileSync(traceabilityPath, "utf8").replace(/\r\n/g, "\n")
    : null;

  return { dir, skills, traceability };
}

const LIB = loadLibrary();

function sortedSkills() {
  return [...LIB.skills.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
}

/* ------------------------------------------------------------------ tools */

function toolListSkills({ track } = {}) {
  let list = sortedSkills();
  if (track === "audit" || track === "general") {
    list = list.filter((s) => s.track === track);
  }

  const lines = [
    `M3n0ko0g free skills library: ${list.length} skill(s)`,
    "",
    "The audit pass is listed in the order you would run it. Each skill feeds",
    "the next, and the last one is a signature block. They also work standalone.",
    "",
  ];

  let current = null;
  for (const s of list) {
    if (s.track !== current) {
      current = s.track;
      lines.push(current === "audit" ? "AUDIT PASS (legacy AI systems)" : "GENERAL PURPOSE");
      lines.push("");
    }
    lines.push(`  ${s.name}  v${s.version}`);
    lines.push(`    ${s.description}`);
    lines.push("");
  }
  lines.push("Call get_skill with a name to read the full method.");
  return lines.join("\n");
}

function toolGetSkill({ name }) {
  if (!name) throw new Error("get_skill requires a `name`.");
  const skill = LIB.skills.get(name);
  if (!skill) {
    const known = sortedSkills().map((s) => s.name).join(", ");
    throw new Error(`No skill named "${name}". Available: ${known}`);
  }
  return skill.full;
}

/* Plain scoring. Name match beats description match beats body match, and a
   phrase match beats scattered terms. No stemming, no fuzzy matching: a
   search that guesses is a search you cannot predict. */
function toolSearchSkills({ query, limit = 5 }) {
  if (!query || !query.trim()) throw new Error("search_skills requires a `query`.");
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  const scored = [];
  for (const s of sortedSkills()) {
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    const body = s.body.toLowerCase();

    let score = 0;
    if (name.includes(q)) score += 100;
    if (desc.includes(q)) score += 50;
    if (body.includes(q)) score += 20;

    for (const t of terms) {
      if (name.includes(t)) score += 20;
      if (desc.includes(t)) score += 8;
      const hits = body.split(t).length - 1;
      score += Math.min(hits, 10);
    }
    if (score > 0) scored.push({ skill: s, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, Math.min(limit, 12)));

  if (top.length === 0) {
    return `No skill matched "${query}". Call list_skills to see all ${LIB.skills.size}.`;
  }

  const out = [`${top.length} match(es) for "${query}":`, ""];
  for (const { skill, score } of top) {
    out.push(`${skill.name}  v${skill.version}  [${skill.track}]  score ${score}`);
    out.push(`  ${skill.description}`);

    /* One line of context from the body, so the caller can judge relevance
       without pulling the whole file. */
    const term = terms[0] || q;
    const idx = skill.body.toLowerCase().indexOf(term);
    if (idx !== -1) {
      const snippet = skill.body
        .slice(Math.max(0, idx - 90), idx + 150)
        .replace(/\s+/g, " ")
        .trim();
      out.push(`  ...${snippet}...`);
    }
    out.push("");
  }
  out.push("Call get_skill with a name to read the full method.");
  return out.join("\n");
}

/* Every skill in this library ends by emitting a receipt. This builds a
   compliant one so a caller does not have to hand-roll the id or the
   timestamp, which are the two fields people get wrong. */
function toolNewReceipt({ skill: skillName, input, findings, unknowns, recommended }) {
  if (!skillName) throw new Error("new_receipt requires a `skill` name.");
  const skill = LIB.skills.get(skillName);
  if (!skill) {
    const known = sortedSkills().map((s) => s.name).join(", ");
    throw new Error(`No skill named "${skillName}". Available: ${known}`);
  }

  const lines = [
    "--- M3n0ko0g skill receipt ---",
    `skill:       ${skill.name}`,
    `version:     ${skill.version}`,
    `id:          ${randomBytes(6).toString("hex")}`,
    `run_at:      ${new Date().toISOString()}`,
    `input:       ${input || "<shape only: counts, never content>"}`,
  ];
  if (findings !== undefined) lines.push(`findings:    ${findings}`);
  lines.push(`unknowns:    ${unknowns === undefined ? "<count>" : unknowns}`);
  lines.push(`recommended: ${recommended || "<single next step, one line>"}`);
  lines.push("human:       pending");
  lines.push("---");
  lines.push("");
  lines.push(
    "`human` starts at pending and is only ever set by a person. Never set it",
    "yourself. `input` records shape only: counts, classes, file names. Never",
    "prompt text, model output, user content, or field values. See TRACEABILITY.",
  );
  return lines.join("\n");
}

const TOOLS = [
  {
    name: "list_skills",
    description:
      "List every skill in the M3n0ko0g free skills library with its version and description. The audit pass for legacy AI systems is returned in the order you would run it. Call this first when you do not know which skill applies.",
    inputSchema: {
      type: "object",
      properties: {
        track: {
          type: "string",
          enum: ["audit", "general"],
          description:
            "Optional filter. 'audit' returns the legacy AI systems pass; 'general' returns the general-purpose skills. Omit for all of them.",
        },
      },
    },
    handler: toolListSkills,
  },
  {
    name: "get_skill",
    description:
      "Read the full SKILL.md for one skill: the method, what to look for, the output format, the receipt, and the rules. Use this once you know which skill you need, then follow the method it gives you.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The skill name, e.g. 'prompt-archaeology'. Exact match.",
        },
      },
      required: ["name"],
    },
    handler: toolGetSkill,
  },
  {
    name: "search_skills",
    description:
      "Find which skill applies to a problem, by keyword. Searches names, descriptions and full text. Use it when you can describe the situation but do not know the skill name, e.g. 'the agent sent a wrong email', 'our RAG gives confident wrong answers', 'the invoice doubled'.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you are trying to do, or the problem you are looking at.",
        },
        limit: {
          type: "integer",
          description: "Maximum matches to return. Default 5.",
        },
      },
      required: ["query"],
    },
    handler: toolSearchSkills,
  },
  {
    name: "new_receipt",
    description:
      "Build a compliant M3n0ko0g skill receipt for a run you just completed, with a fresh random id and a UTC timestamp. Every skill in this library ends by emitting one. The `human` field always starts at pending and may only be set by a person.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Which skill was run." },
        input: {
          type: "string",
          description:
            "Shape of what was read: counts, classes, file names. Never content.",
        },
        findings: { type: "string", description: "Optional. Count and top class." },
        unknowns: { type: "string", description: "Optional. How many Unknowns." },
        recommended: { type: "string", description: "Optional. The single next step." },
      },
      required: ["skill"],
    },
    handler: toolNewReceipt,
  },
];

/* -------------------------------------------------------------- resources */

function resourceList() {
  const out = sortedSkills().map((s) => ({
    uri: `skill://${s.name}`,
    name: `${s.name} v${s.version}`,
    description: s.description,
    mimeType: "text/markdown",
  }));
  if (LIB.traceability) {
    out.push({
      uri: "skill://TRACEABILITY",
      name: "TRACEABILITY",
      description:
        "The receipt convention every skill in this library emits, and the rule that a receipt records shape and never content.",
      mimeType: "text/markdown",
    });
  }
  return out;
}

function resourceRead(uri) {
  if (uri === "skill://TRACEABILITY") {
    if (!LIB.traceability) throw new Error("TRACEABILITY.md is not present in this copy.");
    return LIB.traceability;
  }
  const m = /^skill:\/\/(.+)$/.exec(uri);
  if (!m) throw new Error(`Unsupported URI: ${uri}. Expected skill://<name>.`);
  const skill = LIB.skills.get(m[1]);
  if (!skill) throw new Error(`No skill named "${m[1]}".`);
  return skill.full;
}

/* ----------------------------------------------------------- the protocol */

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handle(msg) {
  const { id, method, params = {} } = msg;

  /* Notifications carry no id and get no reply. */
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "The M3n0ko0g free skills library for auditing legacy AI systems: the AI " +
          "systems assembled 2021-2026 that nobody inside can explain, audit, or sign " +
          "off on. Call search_skills when you can describe the problem, list_skills " +
          "to browse, then get_skill to read the method and follow it. Every skill " +
          "leads with what it cannot know, and ends by emitting a receipt whose human " +
          "field only a person may set.",
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const text = tool.handler(params.arguments || {});
        return ok(id, { content: [{ type: "text", text }] });
      } catch (e) {
        /* A tool failure is a result, not a protocol error. The client should
           see the message and be able to correct the call. */
        return ok(id, { content: [{ type: "text", text: e.message }], isError: true });
      }
    }

    case "resources/list":
      return ok(id, { resources: resourceList() });

    case "resources/read": {
      try {
        return ok(id, {
          contents: [
            { uri: params.uri, mimeType: "text/markdown", text: resourceRead(params.uri) },
          ],
        });
      } catch (e) {
        return err(id, -32602, e.message);
      }
    }

    /* Declared in no capability, so a well-behaved client will not call these.
       Answer empty rather than erroring, since some clients probe anyway. */
    case "prompts/list":
      return ok(id, { prompts: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });

    default:
      if (isNotification) return null;
      return err(id, -32601, `Method not found: ${method}`);
  }
}

function serve() {
  let buffer = "";
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify(err(null, -32700, "Parse error")) + "\n");
        continue;
      }

      let reply;
      try {
        reply = handle(msg);
      } catch (e) {
        reply = err(msg.id ?? null, -32603, e.message);
      }
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }
  });

  process.stdin.on("end", () => process.exit(0));
  log(`${SERVER_NAME} v${SERVER_VERSION} ready, ${LIB.skills.size} skills from ${LIB.dir}`);
}

/* ------------------------------------------------------------------- main */

if (process.argv.includes("--list")) {
  process.stdout.write(toolListSkills({}) + "\n");
} else if (process.argv.includes("--version")) {
  process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
} else {
  serve();
}
