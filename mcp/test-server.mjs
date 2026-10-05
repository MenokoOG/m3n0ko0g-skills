#!/usr/bin/env node
/* Protocol test for the M3n0ko0g Skills MCP server.
 *
 * Spawns the real server over stdio and speaks actual JSON-RPC to it. Not a
 * mock: if this passes, an MCP client can drive it.
 *
 * Usage: node mcp/test-server.mjs
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.mjs");

const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });

let stdoutBuf = "";
const pending = new Map();
let stray = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      stray.push(line);
      continue;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    } else {
      stray.push(line);
    }
  }
});

child.stderr.setEncoding("utf8");
let stderrText = "";
child.stderr.on("data", (d) => (stderrText += d));

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 5000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

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

async function main() {
  console.log("M3n0ko0g Skills MCP server, protocol test\n");

  /* initialize */
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  check("initialize returns a result", !!init.result, JSON.stringify(init.error));
  check(
    "echoes the requested protocol version",
    init.result?.protocolVersion === "2025-06-18",
    init.result?.protocolVersion,
  );
  check("declares tools capability", !!init.result?.capabilities?.tools);
  check("declares resources capability", !!init.result?.capabilities?.resources);
  check("names itself", init.result?.serverInfo?.name === "m3n0ko0g-skills");

  notify("notifications/initialized");

  /* an older client must still be answered */
  const initOld = await send("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  check(
    "negotiates down for an older client",
    initOld.result?.protocolVersion === "2024-11-05",
    initOld.result?.protocolVersion,
  );

  /* ping */
  const ping = await send("ping", {});
  check("ping answers", !!ping.result);

  /* tools/list */
  const tools = await send("tools/list", {});
  const names = (tools.result?.tools || []).map((t) => t.name);
  check("tools/list returns 4 tools", names.length === 4, names.join(","));
  for (const n of ["list_skills", "get_skill", "search_skills", "new_receipt"]) {
    check(`  exposes ${n}`, names.includes(n));
  }
  check(
    "every tool has a description and schema",
    (tools.result?.tools || []).every((t) => t.description && t.inputSchema?.type === "object"),
  );

  /* list_skills */
  const list = await send("tools/call", { name: "list_skills", arguments: {} });
  const listText = list.result?.content?.[0]?.text || "";
  check("list_skills is not an error", !list.result?.isError);
  check("list_skills reports 12 skills", /12 skill\(s\)/.test(listText), listText.slice(0, 60));
  check("list_skills includes prompt-archaeology", listText.includes("prompt-archaeology"));
  check("list_skills separates the two tracks", listText.includes("AUDIT PASS") && listText.includes("GENERAL PURPOSE"));
  check(
    "audit pass is in run order, scout before sign-off",
    listText.indexOf("legacy-modernization-scout") < listText.indexOf("sign-off-pack"),
  );

  /* track filter */
  const audit = await send("tools/call", { name: "list_skills", arguments: { track: "audit" } });
  const auditText = audit.result?.content?.[0]?.text || "";
  check("track=audit returns 10", /10 skill\(s\)/.test(auditText), auditText.slice(0, 40));
  check("track=audit excludes hot-path", !auditText.includes("hot-path"));

  /* get_skill */
  const got = await send("tools/call", { name: "get_skill", arguments: { name: "sign-off-pack" } });
  const gotText = got.result?.content?.[0]?.text || "";
  check("get_skill returns the full document", gotText.length > 10000, String(gotText.length));
  check("get_skill keeps the frontmatter", gotText.startsWith("---\nname: sign-off-pack"));
  check("get_skill includes the receipt block", gotText.includes("M3n0ko0g skill receipt"));

  /* get_skill, unknown name */
  const missing = await send("tools/call", { name: "get_skill", arguments: { name: "nope" } });
  check("unknown skill is an isError result, not a crash", missing.result?.isError === true);
  check(
    "unknown skill lists what is available",
    (missing.result?.content?.[0]?.text || "").includes("prompt-archaeology"),
  );

  /* search_skills */
  const search = await send("tools/call", {
    name: "search_skills",
    arguments: { query: "our RAG gives confident wrong answers" },
  });
  const searchText = search.result?.content?.[0]?.text || "";
  check("search finds something", !search.result?.isError && searchText.includes("match"));
  check(
    "search ranks rag-integrity-check first",
    searchText.indexOf("rag-integrity-check") ===
      Math.min(
        ...["rag-integrity-check", "eval-or-vibes", "incident-replay"]
          .map((n) => searchText.indexOf(n))
          .filter((i) => i !== -1),
      ),
    searchText.split("\n")[2],
  );

  const search2 = await send("tools/call", {
    name: "search_skills",
    arguments: { query: "the invoice doubled and nobody changed anything" },
  });
  check(
    "search finds token-bill for a cost question",
    (search2.result?.content?.[0]?.text || "").includes("token-bill"),
  );

  const search3 = await send("tools/call", {
    name: "search_skills",
    arguments: { query: "zzzznotathing" },
  });
  check(
    "no match returns guidance, not an error",
    !search3.result?.isError &&
      (search3.result?.content?.[0]?.text || "").includes("list_skills"),
  );

  /* new_receipt */
  const r1 = await send("tools/call", {
    name: "new_receipt",
    arguments: { skill: "hot-path", input: "python, 3 functions, 140 lines", findings: "2" },
  });
  const rText = r1.result?.content?.[0]?.text || "";
  check("new_receipt emits a receipt", rText.includes("--- M3n0ko0g skill receipt ---"));
  check("receipt human field starts pending", /human:\s+pending/.test(rText));
  check("receipt id is 12 hex chars", /id:\s+[0-9a-f]{12}\b/.test(rText), rText.match(/id:.*/)?.[0]);
  check("receipt run_at is ISO UTC", /run_at:\s+\d{4}-\d{2}-\d{2}T.*Z/.test(rText));

  const r2 = await send("tools/call", {
    name: "new_receipt",
    arguments: { skill: "hot-path", input: "x" },
  });
  const id1 = rText.match(/id:\s+([0-9a-f]{12})/)?.[1];
  const id2 = (r2.result?.content?.[0]?.text || "").match(/id:\s+([0-9a-f]{12})/)?.[1];
  check("receipt ids are unique per run", id1 && id2 && id1 !== id2, `${id1} vs ${id2}`);

  /* resources */
  const res = await send("resources/list", {});
  const uris = (res.result?.resources || []).map((r) => r.uri);
  check("resources/list returns 13 (12 skills + TRACEABILITY)", uris.length === 13, String(uris.length));
  check("exposes skill://token-bill", uris.includes("skill://token-bill"));
  check("exposes skill://TRACEABILITY", uris.includes("skill://TRACEABILITY"));

  const read = await send("resources/read", { uri: "skill://incident-replay" });
  check(
    "resources/read returns the document",
    (read.result?.contents?.[0]?.text || "").includes("# Incident Replay"),
  );
  check("resources/read sets markdown mime type", read.result?.contents?.[0]?.mimeType === "text/markdown");

  const badRead = await send("resources/read", { uri: "skill://does-not-exist" });
  check("bad resource uri returns a protocol error", !!badRead.error);

  /* unknown method */
  const unknown = await send("banana/peel", {});
  check("unknown method returns -32601", unknown.error?.code === -32601);

  /* the transport rule */
  check("nothing stray was written to stdout", stray.length === 0, stray.join(" | ").slice(0, 120));
  check("startup log went to stderr", stderrText.includes("ready"), stderrText.trim().slice(0, 80));

  console.log(`\n${passed} passed, ${failed} failed`);
  child.kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("test harness error:", e.message);
  console.error("stderr from server:\n" + stderrText);
  child.kill();
  process.exit(1);
});
