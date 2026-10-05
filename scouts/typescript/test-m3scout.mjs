#!/usr/bin/env node
/* Tests for m3scout (TypeScript).
 *
 * Runs the real scout over the fixture and asserts on the evidence pack. No
 * mocks: the fixture is a deliberately broken support agent of the kind
 * assembled in 2023, and every defect planted in it must be found.
 *
 * Also asserts schema parity with the Python scout, so the two can be merged.
 *
 *   node test-m3scout.mjs
 *
 * Exit 0 on pass, 1 on failure. No dependencies, no test runner.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCOUT = join(HERE, "m3scout.mjs");
const FIXTURE = join(HERE, "fixture");
const PY_SCOUT = join(HERE, "..", "python", "m3scout.py");
const PY_FIXTURE = join(HERE, "..", "python", "fixture");

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log("  pass  " + label);
  } else {
    failed++;
    console.log("  FAIL  " + label + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
  }
}

function run(args, opts = {}) {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [SCOUT, ...args], {
        encoding: "utf8",
        cwd: HERE,
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
      }),
      stderr: "",
    };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

const cls = (pack) => pack.findings.map((f) => f.class);
const of = (pack, c) => pack.findings.filter((f) => f.class === c);

console.log("m3scout (typescript) - tests against the fixture\n");

const res = run([FIXTURE, "--json"]);
check("scout exits 0", res.code === 0, res.stderr.slice(0, 200));

let pack;
try {
  pack = JSON.parse(res.stdout);
} catch (e) {
  console.log("  FAIL  --json did not emit valid JSON -> " + e.message);
  console.log(res.stdout.slice(0, 400));
  process.exit(1);
}

/* -- schema ------------------------------------------------------------- */
check("declares schema v1", pack.schema === "m3n0ko0g.scout.evidence/1", pack.schema);
check("names itself", pack.scout.name === "m3scout-typescript");
check("reports language", pack.scout.language === "typescript");
check("run id is 12 hex", /^[0-9a-f]{12}$/.test(pack.run.id), pack.run.id);
check("run_at is ISO UTC", /Z$/.test(pack.run.run_at), pack.run.run_at);
check("counted the files", pack.run.files_scanned === 3, pack.run.files_scanned);
check(
  "every finding has id, class, confidence, file, feeds",
  pack.findings.every((f) => f.id && f.class && f.confidence && f.file !== undefined && f.feeds?.length),
);
check(
  "confidence is only confirmed or inferred",
  pack.findings.every((f) => f.confidence === "confirmed" || f.confidence === "inferred"),
  [...new Set(pack.findings.map((f) => f.confidence))],
);
check("finding ids are unique", new Set(pack.findings.map((f) => f.id)).size === pack.findings.length);

/* -- the planted defects ------------------------------------------------ */
console.log("\n  the planted defects:");
const c = cls(pack);

check("finds the unbounded agent loop", c.includes("unbounded_loop"));
check(
  "  and finds exactly one, not the bounded loop below it",
  c.filter((x) => x === "unbounded_loop").length === 1,
  c.filter((x) => x === "unbounded_loop").length,
);
check("finds retrieval with no similarity floor", c.includes("no_similarity_floor"));
check(
  "finds all three unpinned model aliases",
  c.filter((x) => x === "unpinned_model").length === 3,
  of(pack, "unpinned_model").map((f) => f.excerpt),
);
check(
  "  does NOT flag the pinned gpt-4o-2024-08-06",
  !of(pack, "unpinned_model").some((f) => f.excerpt.includes("2024-08-06")),
);
check("finds the API key in a file that ships to the browser", c.includes("secret_risk"));
check(
  "  and points at the .tsx",
  of(pack, "secret_risk")[0]?.file.endsWith(".tsx"),
  of(pack, "secret_risk")[0]?.file,
);
check("finds the embedding call", c.includes("rag_embed"));
check("finds the retrieval call", c.includes("rag_retrieve"));
check("finds the tool definitions", c.includes("tool_definition"));
check("finds JSON.parse with no contract", c.includes("parse_no_contract"));
check("finds the interpolated template prompt", c.includes("interpolation"));
check("finds the retrieval logging gap", c.includes("logging_gap"));
check(
  "finds all three assertions that cannot fail",
  c.filter((x) => x === "weak_assertion").length === 3,
  c.filter((x) => x === "weak_assertion").length,
);
check("finds the system prompt", of(pack, "prompt_artifact").length >= 2);
check(
  "finds the model-tuned scar tissue",
  of(pack, "prompt_artifact").some((f) => f.confidence === "inferred" && f.excerpt.includes("all-caps")),
);
check("flags the high temperature", of(pack, "model_call").some((f) => f.excerpt.includes("temperature: 0.9")));
check(
  "sees a model called over raw HTTP, with no SDK involved",
  of(pack, "model_call").some((f) => f.excerpt.includes("api.openai.com")),
  of(pack, "model_call").map((f) => f.excerpt),
);

/* -- the lexer earns its keep ------------------------------------------- */
console.log("\n  the lexer:");
check(
  "the word 'while' inside a comment is not read as a loop",
  c.filter((x) => x === "unbounded_loop").length === 1,
);
check(
  "the word 'while' inside the system prompt is not read as a loop",
  !of(pack, "unbounded_loop").some((f) => f.line > 25 && f.line < 36),
  of(pack, "unbounded_loop").map((f) => f.line),
);
check(
  "model literals are read, not reported as expressions",
  !pack.unknowns.some((u) => /Which model does supportAgent/.test(u.question)),
  pack.unknowns.filter((u) => /Which model/.test(u.question)).map((u) => u.question),
);

/* -- unknowns ------------------------------------------------------------ */
console.log("\n  unknowns:");
check("records unknowns", pack.unknowns.length >= 4, pack.unknowns.length);
check("every unknown carries a way to resolve it", pack.unknowns.every((u) => u.resolve && u.why && u.question));
check(
  "asks what the framework injects",
  pack.unknowns.some((u) => /framework inject/i.test(u.question)),
);
check("asks what is in the corpus", pack.unknowns.some((u) => /corpus/i.test(u.question)));
check("unknown ids are unique", new Set(pack.unknowns.map((u) => u.id)).size === pack.unknowns.length);

/* -- the discipline ------------------------------------------------------ */
console.log("\n  the discipline:");
check("no finding claims a confidence of 'unknown'", !pack.findings.some((f) => f.confidence === "unknown"));
check("the logging gap is inferred, not confirmed", of(pack, "logging_gap").every((f) => f.confidence === "inferred"));
check("the unpinned alias is confirmed", of(pack, "unpinned_model").every((f) => f.confidence === "confirmed"));
check("recommends capping the loop first", pack.receipt.includes("cap the loop"));

/* -- receipt ------------------------------------------------------------- */
console.log("\n  receipt:");
check("emits a receipt", pack.receipt.includes("--- M3n0ko0g skill receipt ---"));
check("human starts pending", /human:\s+pending/.test(pack.receipt));
check("receipt id matches the run id", pack.receipt.includes(pack.run.id));
check(
  "receipt carries shape, not content",
  !pack.receipt.includes("gpt-4o") &&
    !pack.receipt.includes("SYSTEM_PROMPT") &&
    !pack.receipt.includes("You are a support"),
  "a receipt that quotes its input turns a log into a leak",
);

/* -- text report --------------------------------------------------------- */
console.log("\n  text report:");
const text = run([FIXTURE]).stdout;
check("report leads with unknowns", text.indexOf("UNKNOWNS") < text.indexOf("FINDINGS"));
check("report names the next skills to run", text.includes("NEXT SKILL TO RUN"));
check("report states its own precision limit", text.includes("PRECISION"));
check("report ends with the receipt", text.trimEnd().endsWith("---"));
check(
  "report is ASCII only",
  [...text].every((ch) => ch.charCodeAt(0) < 128),
  [...text].filter((ch) => ch.charCodeAt(0) >= 128).slice(0, 5),
);

/* -- skill filter -------------------------------------------------------- */
console.log("\n  --skill filter:");
const filt = JSON.parse(run([FIXTURE, "--json", "--skill", "rag-integrity-check"]).stdout);
check("filters to one skill's findings", filt.findings.every((f) => f.feeds.includes("rag-integrity-check")));
check(
  "filtered findings are fewer than the full set",
  filt.findings.length > 0 && filt.findings.length < pack.findings.length,
  `${filt.findings.length} of ${pack.findings.length}`,
);
check("renumbers filtered ids from F1", filt.findings[0].id === "F1");

/* -- edges --------------------------------------------------------------- */
console.log("\n  edges:");
const empty = mkdtempSync(join(tmpdir(), "m3scout-empty-"));
try {
  const e = run([empty, "--json"]);
  check("empty tree exits 0", e.code === 0);
  check("empty tree reports no findings", JSON.parse(e.stdout).findings.length === 0);
  check("empty tree says so rather than implying it is clean", run([empty]).stdout.includes("not a clean bill of health"));
} finally {
  rmSync(empty, { recursive: true, force: true });
}

const broken = mkdtempSync(join(tmpdir(), "m3scout-broken-"));
try {
  writeFileSync(join(broken, "bad.ts"), "const x = `unterminated\nfunction f( {\n");
  const b = run([broken]);
  check("malformed source does not crash the scout", b.code === 0, b.stderr.slice(0, 160));
} finally {
  rmSync(broken, { recursive: true, force: true });
}

check("a missing path exits 1 with a message", (() => {
  const m = run(["/no/such/path"]);
  return m.code === 1 && m.stderr.includes("no such path");
})());

check(
  "scout never writes to the tree it scans",
  readdirSync(FIXTURE).sort().join(",") === "ChatPanel.tsx,supportAgent.test.ts,supportAgent.ts",
  readdirSync(FIXTURE).sort(),
);

/* -- parity with the python scout ---------------------------------------- */
console.log("\n  schema parity with the python scout:");
if (!existsSync(PY_SCOUT)) {
  check("python scout present", false, PY_SCOUT);
} else {
  let py = null;
  for (const exe of ["python", "python3", "py"]) {
    try {
      py = JSON.parse(
        execFileSync(exe, [PY_SCOUT, PY_FIXTURE, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      );
      break;
    } catch {
      /* try the next interpreter name */
    }
  }
  if (!py) {
    console.log("  skip  python interpreter not found, parity not checked");
  } else {
    check("same schema string", py.schema === pack.schema, [py.schema, pack.schema]);
    check(
      "same top-level keys",
      Object.keys(py).sort().join(",") === Object.keys(pack).sort().join(","),
      [Object.keys(py).sort(), Object.keys(pack).sort()],
    );
    check(
      "same run keys",
      Object.keys(py.run).sort().join(",") === Object.keys(pack.run).sort().join(","),
      [Object.keys(py.run).sort(), Object.keys(pack.run).sort()],
    );
    check(
      "same finding keys",
      Object.keys(py.findings[0]).sort().join(",") === Object.keys(pack.findings[0]).sort().join(","),
      [Object.keys(py.findings[0]).sort(), Object.keys(pack.findings[0]).sort()],
    );
    check(
      "same unknown keys",
      Object.keys(py.unknowns[0]).sort().join(",") === Object.keys(pack.unknowns[0]).sort().join(","),
      [Object.keys(py.unknowns[0]).sort(), Object.keys(pack.unknowns[0]).sort()],
    );
    const pyClasses = new Set(py.findings.map((f) => f.class));
    const tsClasses = new Set(pack.findings.map((f) => f.class));
    const shared = [...pyClasses].filter((x) => tsClasses.has(x));
    check(
      "both scouts find the same core classes on equivalent fixtures",
      ["unbounded_loop", "no_similarity_floor", "unpinned_model", "logging_gap",
       "parse_no_contract", "weak_assertion", "rag_embed", "rag_retrieve",
       "tool_definition", "interpolation", "model_call", "prompt_artifact"]
        .every((k) => shared.includes(k)),
      { pyOnly: [...pyClasses].filter((x) => !tsClasses.has(x)), tsOnly: [...tsClasses].filter((x) => !pyClasses.has(x)) },
    );
    check(
      "both receipts start human at pending",
      /human:\s+pending/.test(py.receipt) && /human:\s+pending/.test(pack.receipt),
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
