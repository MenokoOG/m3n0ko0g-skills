#!/usr/bin/env node
/* m3scout - M3n0ko0g legacy AI systems scout, TypeScript and JavaScript.
 *
 * Reads a TS/JS codebase and reports what the AI system in it actually does:
 * where it calls a model, what prompts it sends, how retrieval is wired, what
 * cannot be diagnosed when it fails, and what the scout could not determine by
 * reading.
 *
 * Deterministic and read-only. Never calls a model, never sends your code
 * anywhere, never writes to the tree it is scanning.
 *
 * A note on precision, because it matters and the skills demand it be stated.
 * The Python scout parses with the `ast` module and knows exactly what it is
 * looking at. This one has no compiler available without taking a dependency,
 * so it lexes instead: it strips comments, tracks string and template literals
 * properly, and follows brace depth. That is much better than matching regexes
 * against raw text, and it is still less certain than a parse. So this scout
 * marks more findings `inferred` than its Python counterpart does, deliberately.
 * Reporting a guess as `confirmed` to look more capable is the exact failure
 * these skills exist to catch.
 *
 * Emits the same evidence pack, schema v1, so both scouts can be run over a
 * polyglot repo and their output merged without translation.
 *
 *   node m3scout.mjs <path>                 human-readable report
 *   node m3scout.mjs <path> --json          evidence pack, schema v1
 *   node m3scout.mjs <path> --json -o e.json
 *   node m3scout.mjs <path> --skill token-bill
 *
 * Node 18+. No dependencies.
 *
 * Released by Lawrence Jefferson II for public use.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, basename, sep, extname } from "node:path";
import { randomBytes } from "node:crypto";

const SCOUT_NAME = "m3scout-typescript";
const SCOUT_VERSION = "1.0.0";
const SCHEMA = "m3n0ko0g.scout.evidence/1";

/* ------------------------------------------------------------- knowledge -- */

const MODEL_CALL_PATTERNS = [
  "chat.completions.create",
  "completions.create",
  "messages.create",
  "messages.stream",
  "responses.create",
  "generateContent",
  "invokeModel",
];
/* Bare callables from the common TS wrappers. */
const MODEL_CALL_NAMES = ["generateText", "streamText", "generateObject", "streamObject"];

const EMBED_PATTERNS = ["embeddings.create", "embedDocuments", "embedQuery", "embedMany"];
const EMBED_NAMES = ["embed", "getEmbedding"];

const RETRIEVE_PATTERNS = [
  "similaritySearch",
  "similaritySearchWithScore",
  "maxMarginalRelevanceSearch",
  "asRetriever",
  "getRelevantDocuments",
];
const RETRIEVE_NAMES = ["retrieve", "search", "query"];

const VECTOR_HINTS = [
  "pinecone", "weaviate", "qdrant", "chroma", "milvus", "faiss",
  "pgvector", "lancedb", "opensearch", "elasticsearch", "upstash",
];

const UNPINNED = new Set([
  "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "gpt-4.1", "gpt-5",
  "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
  "claude-3-5-sonnet", "claude-sonnet-4", "claude-opus-4",
  "gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash",
  "latest", "default",
]);

const PROMPT_WORDS = [
  "you are", "your task", "instructions", "respond", "answer", "assistant",
  "do not", "must not", "never ", "always ", "given the", "context:",
  "question:", "step by step", "json", "output format", "summarize",
  "you must", "based on the", "role:", "system:",
];

const K_KEYS = ["k", "topK", "top_k", "nResults", "n_results", "limit"];
const FLOOR_KEYS = ["scoreThreshold", "score_threshold", "minScore", "min_score", "threshold", "distanceThreshold"];
const MODEL_KEYS = ["model", "modelName", "model_name", "modelId", "deploymentName", "engine"];

const SECRET_PATTERN = /\b(?:OPENAI|ANTHROPIC|GOOGLE|AZURE|COHERE|MISTRAL|GROQ|HF|HUGGINGFACE)[A-Z_]*(?:API_)?KEY\b|\bapiKey\b/;

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "__pycache__",
  ".idea", ".vscode", "vendor", "target",
]);

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

const PROMPT_FILE_HINTS = ["prompt", "instruction", "persona", "system", "template"];

/* Plenty of systems never touch an SDK and just POST to the endpoint. Those
 * calls are invisible to call-name matching, and they are common in exactly
 * the hand-assembled systems these scouts are pointed at. */
const PROVIDER_URLS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "api.groq.com",
  "api-inference.huggingface.co",
  "openai.azure.com",
  "bedrock-runtime.",
];

/* ----------------------------------------------------------------- lexer -- */

/* Strip comments and record every string/template literal with its position.
 * Comments become spaces so all offsets stay stable, which is what lets a
 * finding point at a real line number afterwards. */
function lex(src) {
  const out = new Array(src.length);
  const strings = [];
  let i = 0;
  const n = src.length;

  const blank = (from, to) => {
    for (let j = from; j < to; j++) out[j] = src[j] === "\n" ? "\n" : " ";
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    /* line comment */
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    /* block comment */
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
      continue;
    }
    /* string or template */
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      let j = i + 1;
      let interpolated = false;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
          interpolated = true;
          depth++;
          j += 2;
          continue;
        }
        if (quote === "`" && depth > 0) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}") depth--;
          j++;
          continue;
        }
        if (src[j] === quote) {
          j++;
          break;
        }
        if (quote !== "`" && src[j] === "\n") break; /* unterminated */
        j++;
      }
      strings.push({
        start,
        end: j,
        quote,
        interpolated,
        raw: src.slice(start + 1, Math.max(start + 1, j - 1)),
      });
      /* Keep the literal out of the cleaned source so a prompt containing the
         word "while" cannot be mistaken for a loop. */
      blank(start, j);
      i = j;
      continue;
    }
    out[i] = c;
    i++;
  }

  for (let j = 0; j < n; j++) if (out[j] === undefined) out[j] = src[j];
  return { clean: out.join(""), strings };
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/* Find the argument text of a call whose "(" is at `open`. Brace-aware, so a
 * nested object or call does not truncate it. */
function callArgs(clean, open) {
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return { text: clean.slice(open + 1, i), end: i };
    }
  }
  return { text: clean.slice(open + 1), end: clean.length };
}

/* The body of a block starting at the first "{" at or after `from`. */
function blockAfter(clean, from) {
  const open = clean.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { start: open, end: i, text: clean.slice(open, i + 1) };
    }
  }
  return null;
}

function trim(text, width = 90) {
  const one = String(text).split(/\s+/).join(" ").trim();
  return one.length <= width ? one : one.slice(0, width - 3) + "...";
}

function looksLikePrompt(text) {
  if (text.length < 120) return false;
  const low = text.toLowerCase();
  return PROMPT_WORDS.some((w) => low.includes(w));
}

/* A key's value inside a call's argument text, when it is a literal we can
 * read. Returns null when the key is absent, and kind "expression" when the
 * value is there but is not a literal.
 *
 * Subtlety worth stating, because getting it wrong silently reports every
 * pinned model as unreadable: string literals are blanked out of `clean`, so
 * the region after a colon is indistinguishable from plain whitespace. Skipping
 * whitespace in one go therefore steps straight over the value. We advance one
 * character at a time and check for a literal starting at each position. */
function literalFor(argText, keys, ctx, argOffset) {
  for (const key of keys) {
    const re = new RegExp(`(?:^|[{,;\\s])${key}\\s*:`, "g");
    let m;
    while ((m = re.exec(argText)) !== null) {
      const absColon = argOffset + m.index + m[0].length - 1;
      let p = absColon + 1;
      const limit = Math.min(ctx.clean.length, p + 400);
      while (p < limit) {
        const lit = ctx.strStart.get(p);
        if (lit) return { kind: "string", value: lit.raw, offset: p, key };
        const c = ctx.clean[p];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
          p++;
          continue;
        }
        break;
      }
      const num = /^(-?\d+(?:\.\d+)?)/.exec(ctx.clean.slice(p, p + 24));
      if (num) return { kind: "number", value: Number(num[1]), offset: p, key };
      return { kind: "expression", value: null, offset: p, key };
    }
  }
  return null;
}

function hasKey(argText, keys) {
  return keys.some((k) => new RegExp(`(?:^|[{,\\s])${k}\\s*:`).test(argText));
}

function isPinned(model) {
  const m = String(model).trim().toLowerCase();
  if (!m) return false;
  if (UNPINNED.has(m)) return false;
  if (m.endsWith("-latest") || m.endsWith(":latest")) return false;
  return m
    .replace(/:/g, "-")
    .split("-")
    .some((p) => /^\d{4,}$/.test(p));
}

/* ----------------------------------------------------------------- scout -- */

class Scout {
  constructor(root) {
    this.root = resolve(root);
    this.findings = [];
    this.unknowns = [];
    this._seenUnknown = new Set();
    this.filesScanned = 0;
    this.linesScanned = 0;
    this.errors = [];
    this.vectorStores = new Set();
    this.evalFiles = [];
    this.sawModelCall = false;
    this.sawRag = false;
    this.sawEmbed = false;
  }

  add(cls, confidence, file, line, excerpt, detail, feeds) {
    this.findings.push({
      id: `F${this.findings.length + 1}`,
      class: cls,
      confidence,
      file,
      line,
      excerpt,
      detail,
      feeds,
    });
  }

  unknown(question, why, resolveStep) {
    if (this._seenUnknown.has(question)) return;
    this._seenUnknown.add(question);
    this.unknowns.push({
      id: `U${this.unknowns.length + 1}`,
      question,
      why,
      resolve: resolveStep,
    });
  }

  rel(path) {
    const r = relative(this.root, path).split(sep).join("/");
    return r === "" ? basename(path) : r;
  }

  *files() {
    const isFile = statSync(this.root).isFile();
    if (isFile) {
      yield this.root;
      return;
    }
    const stack = [this.root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        this.errors.push([this.rel(dir), e.message]);
        continue;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
        } else if (EXTS.has(extname(e.name))) {
          yield full;
        } else if (/\.(txt|md|hbs|mustache|prompt)$/i.test(e.name)) {
          const hay = (basename(dir) + "/" + e.name).toLowerCase();
          if (PROMPT_FILE_HINTS.some((h) => hay.includes(h))) yield full;
        }
      }
    }
  }

  run() {
    for (const path of this.files()) {
      let src;
      try {
        src = readFileSync(path, "utf8");
      } catch (e) {
        this.errors.push([this.rel(path), e.message]);
        continue;
      }
      this.filesScanned++;
      this.linesScanned += src.split("\n").length;

      if (!EXTS.has(extname(path))) {
        this.add(
          "prompt_artifact", "confirmed", this.rel(path), 1, trim(src, 70),
          `Prompt file, roughly ${Math.round(src.length / 4)} tokens.`,
          ["prompt-archaeology", "token-bill"],
        );
        continue;
      }

      try {
        this.scanFile(this.rel(path), src);
      } catch (e) {
        this.errors.push([this.rel(path), `${e.name}: ${e.message}`]);
      }
    }
    this.finalize();
  }

  scanFile(rel, src) {
    const { clean, strings } = lex(src);
    const strStart = new Map(strings.map((x) => [x.start, x]));
    const ctx = { clean, strStart };
    const starts = lineIndex(src);
    const at = (off) => lineAt(starts, off);
    const srcLine = (line) => trim((src.split("\n")[line - 1] || "").trim());

    const low = src.toLowerCase();
    for (const h of VECTOR_HINTS) if (low.includes(h)) this.vectorStores.add(h);

    const base = basename(rel).toLowerCase();
    const isTest = /\.(test|spec)\.[tj]sx?$/.test(base) || base.includes("eval") || rel.includes("__tests__");
    if (isTest) {
      this.evalFiles.push(rel);
      this.scanTests(rel, src);
    }

    /* --- a provider endpoint reached over raw HTTP --- */
    for (const s of strings) {
      const hit = PROVIDER_URLS.find((u) => s.raw.includes(u));
      if (!hit) continue;
      const line = at(s.start);
      this.sawModelCall = true;
      const embedding = /embedding/i.test(s.raw);
      this.add(
        embedding ? "rag_embed" : "model_call", "confirmed", rel, line, trim(s.raw, 70),
        "A model provider endpoint is called over raw HTTP rather than through " +
          "an SDK. Call-name matching does not see these, so anything that audits " +
          "this system by grepping for client libraries will miss it entirely.",
        ["prompt-archaeology", "token-bill", "model-swap-blast-radius", "incident-replay"],
      );
      this.unknown(
        `Which model does the raw HTTP call at ${rel}:${line} send?`,
        "The endpoint is a literal but the request body is assembled separately, " +
          "so the model string is not readable at the URL.",
        "Read the body construction, or log the resolved model with each request.",
      );
    }

    /* --- prompts in string and template literals --- */
    for (const s of strings) {
      if (!looksLikePrompt(s.raw)) continue;
      const line = at(s.start);
      this.add(
        "prompt_artifact", "confirmed", rel, line, trim(s.raw, 70),
        `Prompt literal, roughly ${Math.round(s.raw.length / 4)} tokens.`,
        ["prompt-archaeology", "token-bill", "model-swap-blast-radius"],
      );
      if (s.interpolated) {
        this.add(
          "interpolation", "confirmed", rel, line, trim(s.raw, 70),
          "Prompt built by template interpolation. Whatever those values carry " +
            "reaches the model, and the substitution is unbounded.",
          ["data-in-the-prompt", "prompt-archaeology"],
        );
      }
      this.scarTissue(rel, line, s.raw);
    }

    /* --- calls --- */
    const modelCallLines = [];
    const callRe = /([A-Za-z_$][\w$.]*)\s*\(/g;
    let m;
    while ((m = callRe.exec(clean)) !== null) {
      const name = m[1];
      const open = m.index + m[0].length - 1;
      const line = at(m.index);
      const tail = name.split(".").slice(-3).join(".");
      const bare = name.split(".").pop();

      const isModel =
        MODEL_CALL_PATTERNS.some((p) => name.endsWith(p) || tail.endsWith(p)) ||
        MODEL_CALL_NAMES.includes(bare);
      const isEmbed =
        EMBED_PATTERNS.some((p) => name.endsWith(p)) || EMBED_NAMES.includes(bare);
      const isRetrieve = RETRIEVE_PATTERNS.some((p) => name.endsWith(p));

      const { text: args } = callArgs(clean, open);
      const argOffset = open + 1;

      if (isModel) {
        modelCallLines.push(line);
        this.sawModelCall = true;
        this.add(
          "model_call", "confirmed", rel, line, trim(name),
          "A model is called here.",
          ["prompt-archaeology", "token-bill", "model-swap-blast-radius", "incident-replay"],
        );
        this.modelDetails(rel, line, args, ctx, argOffset);
      } else if (isEmbed) {
        this.sawEmbed = true;
        this.add(
          "rag_embed", "confirmed", rel, line, trim(name),
          "An embedding call. This is a second model and usually a second " +
            "subprocessor. It sees every document indexed and every query typed, " +
            "and it is the one that gets swapped by accident inside a general " +
            "upgrade ticket, where the failure is total.",
          ["rag-integrity-check", "data-in-the-prompt", "model-swap-blast-radius"],
        );
        const mk = literalFor(args, MODEL_KEYS, ctx, argOffset);
        if (!mk || mk.kind !== "string") {
          this.unknown(
            `Which embedding model builds the index, at ${rel}:${line}?`,
            "Not a literal at the call site.",
            "Pin it, and record it beside the index. If the build-time and " +
              "query-time models ever differ, retrieval fails completely and silently.",
          );
        }
      } else if (isRetrieve || (RETRIEVE_NAMES.includes(bare) && hasKey(args, K_KEYS))) {
        this.sawRag = true;
        this.retrieveDetails(rel, line, args, ctx, argOffset, name, src);
      }

      if (name === "JSON.parse" && modelCallLines.some((l) => l < line)) {
        this.add(
          "parse_no_contract", "inferred", rel, line, srcLine(line),
          "JSON.parse downstream of a model call. If the prompt does not state " +
            "the required format, this parser is depending on luck.",
          ["prompt-archaeology", "model-swap-blast-radius", "eval-or-vibes"],
        );
      }

      if (/retry|backoff/i.test(name)) {
        this.add(
          "retry", "confirmed", rel, line, srcLine(line),
          "Retry logic. Check that it distinguishes transient failures from " +
            "deterministic ones, and whether it re-sends the whole prompt.",
          ["token-bill", "incident-replay"],
        );
      }
    }

    /* --- unbounded loops containing a model call --- */
    const whileRe = /\bwhile\s*\(/g;
    while ((m = whileRe.exec(clean)) !== null) {
      const open = m.index + m[0].length - 1;
      const { text: cond, end } = callArgs(clean, open);
      const body = blockAfter(clean, end);
      if (!body) continue;
      const region = cond + body.text;
      const hasModel =
        MODEL_CALL_PATTERNS.some((p) => region.includes(p)) ||
        MODEL_CALL_NAMES.some((p) => region.includes(p + "("));
      if (!hasModel) continue;

      const counted =
        /\+\+|\+=/.test(region) ||
        /\b\w*(?:max|limit|attempt|count|iter|retr|step)\w*\b/i.test(cond);
      if (!counted) {
        this.add(
          "unbounded_loop", "confirmed", rel, at(m.index), srcLine(at(m.index)),
          "A while loop contains a model call and no counter bounds it. Exit " +
            "depends on model output. Unbounded spend and unbounded latency.",
          ["token-bill", "agent-gate-review"],
        );
      }
    }

    /* --- a key in a file that ships to the browser --- */
    if (SECRET_PATTERN.test(clean)) {
      const idx = clean.search(SECRET_PATTERN);
      const line = at(idx);
      const clientSide =
        /\bfrom\s+["']react["']|\bfrom\s+["']vue["']|\bfrom\s+["']svelte["']/.test(src) ||
        /^src\//.test(rel) ||
        /\.(jsx|tsx)$/.test(rel);
      if (clientSide) {
        this.add(
          "secret_risk", "confirmed", rel, line, srcLine(line),
          "An API key is referenced in a file that looks like it ships to the " +
            "browser. A frontend bundle is public. If this builds, the key is " +
            "readable by anyone who opens devtools.",
          ["data-in-the-prompt", "agent-gate-review", "sign-off-pack"],
        );
      }
    }
  }

  modelDetails(rel, line, args, ctx, argOffset) {
    const mk = literalFor(args, MODEL_KEYS, ctx, argOffset);
    if (!mk) {
      this.unknown(
        `Which model does ${rel}:${line} use?`,
        "No model key at the call site. It is set elsewhere, or defaulted by the client.",
        "Read the client construction, or log the resolved model on one request.",
      );
    } else if (mk.kind !== "string") {
      this.unknown(
        `Which model does ${rel}:${line} use?`,
        "The model argument is a variable or expression, not a literal.",
        "Log the resolved model string alongside each request.",
      );
    } else if (!isPinned(mk.value)) {
      this.add(
        "unpinned_model", "confirmed", rel, line, `model: "${mk.value}"`,
        "Model alias carries no version. The provider can move it underneath " +
          "you, so this swap has likely already happened more than once with no " +
          "review and no record.",
        ["model-swap-blast-radius", "incident-replay", "eval-or-vibes"],
      );
    }

    const temp = literalFor(args, ["temperature"], ctx, argOffset);
    if (temp && temp.kind === "number" && temp.value >= 0.7) {
      this.add(
        "model_call", "confirmed", rel, line, `temperature: ${temp.value}`,
        "High temperature. If this call's output is parsed or used as a " +
          "decision, the variance is a correctness problem, not a style one.",
        ["eval-or-vibes", "prompt-archaeology"],
      );
    }

    if (hasKey(args, ["tools", "functions", "toolChoice", "tool_choice"])) {
      this.add(
        "tool_definition", "confirmed", rel, line, trim(args, 70),
        "Tool definitions are sent with this call. The model reads them, so " +
          "they are prompts, and they are billed on every request.",
        ["token-bill", "prompt-archaeology", "model-swap-blast-radius"],
      );
    }
  }

  retrieveDetails(rel, line, args, ctx, argOffset, name, src) {
    const k = literalFor(args, K_KEYS, ctx, argOffset);
    /* A positional numeric second argument is the common similaritySearch(q, 5). */
    let kval = k && k.kind === "number" ? k.value : null;
    if (kval === null) {
      const pos = /,\s*(\d+)/.exec(args);
      if (pos) kval = Number(pos[1]);
    }

    this.add(
      "rag_retrieve", "confirmed", rel, line, trim(name),
      `Retrieval call${kval === null ? "" : `, k=${kval}`}.`,
      ["rag-integrity-check", "incident-replay", "token-bill"],
    );

    if (!hasKey(args, FLOOR_KEYS)) {
      this.add(
        "no_similarity_floor", "confirmed", rel, line, trim(args, 70) || trim(name),
        "Retrieval with no minimum score. The system always returns results, " +
          "including when nothing relevant exists, so it cannot say it does not " +
          "know. This is the mechanism behind most confident wrong answers.",
        ["rag-integrity-check", "eval-or-vibes", "sign-off-pack"],
      );
    }

    const lines = src.split("\n");
    const near = lines
      .slice(Math.max(0, line - 4), line + 3)
      .join("\n");
    if (!/\b(?:console\.\w+|logger?\.\w+|log\()/.test(near)) {
      this.add(
        "logging_gap", "inferred", rel, line, trim(name),
        "No logging call within three lines of this retrieval. If chunk ids " +
          "and scores are not recorded, no retrieval failure in this system " +
          "can ever be diagnosed after the fact.",
        ["incident-replay", "rag-integrity-check"],
      );
    }
  }

  scarTissue(rel, line, text) {
    const low = text.toLowerCase();
    const marks = [];
    const caps =
      (text.match(/MUST/g) || []).length +
      (text.match(/NEVER/g) || []).length +
      (text.match(/DO NOT/g) || []).length;
    if (caps >= 2) marks.push("repeated all-caps prohibitions");
    if (low.includes("step by step")) marks.push('"think step by step"');
    if ((text.match(/</g) || []).length >= 2 && text.includes(">")) marks.push("XML-style tags");
    if (low.includes("do not apologize") || low.includes("no preamble") || low.includes("without preamble")) {
      marks.push("anti-preamble instruction");
    }
    if (marks.length) {
      this.add(
        "prompt_artifact", "inferred", rel, line, marks.join(", "),
        "Soft coupling: phrasing of this kind is usually scar tissue from " +
          "fighting one specific model version. It may be unnecessary or harmful " +
          "on a different model. Origin cannot be read from source.",
        ["model-swap-blast-radius", "prompt-archaeology"],
      );
    }
  }

  scanTests(rel, src) {
    src.split("\n").forEach((raw, i) => {
      const s = raw.trim();
      if (!/\bexpect\s*\(|\bassert\b/.test(s)) return;
      const weak =
        /toBeDefined\s*\(\s*\)/.test(s) ||
        /not\s*\.\s*toBeNull\s*\(\s*\)/.test(s) ||
        /not\s*\.\s*toBeUndefined\s*\(\s*\)/.test(s) ||
        /toBeTruthy\s*\(\s*\)/.test(s) ||
        /length\s*\)\s*\.\s*toBeGreaterThan\s*\(\s*0\s*\)/.test(s) ||
        /\.ok\s*\(/.test(s);
      if (weak) {
        this.add(
          "weak_assertion", "confirmed", rel, i + 1, trim(s),
          "This assertion passes on garbage. It checks the system ran, not that " +
            "it was right. Smoke, never Eval.",
          ["eval-or-vibes", "sign-off-pack"],
        );
      }
    });
  }

  finalize() {
    if (this.sawModelCall) {
      this.unknown(
        "How often is each model call actually made, and on what traffic mix?",
        "Call frequency is a runtime property. Static reading cannot see it.",
        "Log a counter per call path for a day. Until then any cost or risk " +
          "ranking is ordering, not forecasting.",
      );
      this.unknown(
        "What does a wrong answer cost here?",
        "Not determinable from source. It is a business fact.",
        "Ask the owner. It sets the budget for everything else in the report.",
      );
      this.unknown(
        "What does the framework inject into these prompts?",
        "Agent and orchestration libraries add instructions the repo never shows. " +
          "This scout reads your source, not your dependencies.",
        "Read the library version's own prompt templates, or log the full request " +
          "body once and compare it to what the code appears to send.",
      );
    }
    if (this.sawRag || this.sawEmbed) {
      this.unknown(
        "What is actually in the corpus?",
        "The scout reads the pipeline, never the documents. Whatever was ingested " +
          "is retrievable into a prompt.",
        "Sample 200 chunks and classify them. If ingestion was unfiltered, this is " +
          "the largest unbounded surface in the system.",
      );
      this.unknown(
        "Does the index have a deletion path?",
        "Removal at the source does not imply removal from the index, and a delete " +
          "path cannot be confirmed by reading the query side.",
        "Delete one document at the source, then query for it.",
      );
    }
    if (this.sawRag && this.sawEmbed) {
      this.unknown(
        "Does the embedding model that built the index match the one used at query time?",
        "The scout sees call sites, not which model produced the stored vectors.",
        "Record the embedding model and version beside the index. A mismatch is " +
          "total, silent retrieval failure and it looks like the model got dumber.",
      );
    }
    if (this.sawModelCall && this.evalFiles.length === 0) {
      this.add(
        "eval_check", "confirmed", ".", 0, "no test or eval files found",
        "No test or eval file was found anywhere in the tree. Nothing would catch " +
          "a regression from a prompt edit or a model change.",
        ["eval-or-vibes", "sign-off-pack", "model-swap-blast-radius"],
      );
    }
    if (this.vectorStores.size) {
      this.add(
        "rag_retrieve", "inferred", ".", 0, [...this.vectorStores].sort().join(", "),
        "Vector store referenced in the tree. Which store decides the freshness " +
          "and deletion story.",
        ["rag-integrity-check"],
      );
    }
  }
}

/* ---------------------------------------------------------------- output -- */

function counts(findings) {
  const out = {};
  for (const f of findings) out[f.class] = (out[f.class] || 0) + 1;
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function recommendation(scout) {
  const first = (cls) => scout.findings.find((f) => f.class === cls);
  const loop = first("unbounded_loop");
  if (loop) return `cap the loop at ${loop.file}:${loop.line} - unbounded spend and latency`;
  const secret = first("secret_risk");
  if (secret) return `move the API key out of ${secret.file}:${secret.line} - a frontend bundle is public`;
  const floor = first("no_similarity_floor");
  if (floor) return `add a similarity floor at ${floor.file}:${floor.line} so the system can say it does not know`;
  const gap = first("logging_gap");
  if (gap) return `log retrieved chunk ids and scores at ${gap.file}:${gap.line} - one line, and it makes every future failure a lookup`;
  const pin = first("unpinned_model");
  if (pin) return `pin the model alias at ${pin.file}:${pin.line} - the swap is already happening without review`;
  if (first("weak_assertion")) return "replace the assertions that cannot fail with one eval that gates the build";
  if (first("eval_check")) return "build one eval on the highest-traffic path before changing anything";
  if (scout.findings.length) return `run prompt-archaeology over the ${scout.findings.length} findings below`;
  return "nothing found - confirm the scout was pointed at the right tree";
}

function receipt(scout, runId, runAt) {
  const c = counts(scout.findings);
  const top = Object.keys(c)[0] || "none";
  return [
    "--- M3n0ko0g skill receipt ---",
    `skill:       ${SCOUT_NAME}`,
    `version:     ${SCOUT_VERSION}`,
    `id:          ${runId}`,
    `run_at:      ${runAt}`,
    `input:       typescript, ${scout.filesScanned} file(s), ${scout.linesScanned} lines`,
    `findings:    ${scout.findings.length}  (top class: ${top})`,
    `unknowns:    ${scout.unknowns.length}`,
    `recommended: ${recommendation(scout)}`,
    "human:       pending",
    "---",
  ].join("\n");
}

function evidencePack(scout, durationMs) {
  const runId = randomBytes(6).toString("hex");
  const runAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    schema: SCHEMA,
    scout: { name: SCOUT_NAME, version: SCOUT_VERSION, language: "typescript" },
    run: {
      id: runId,
      run_at: runAt,
      root: scout.root.split(sep).join("/"),
      files_scanned: scout.filesScanned,
      lines_scanned: scout.linesScanned,
      duration_ms: durationMs,
    },
    counts: counts(scout.findings),
    findings: scout.findings,
    unknowns: scout.unknowns,
    receipt: receipt(scout, runId, runAt),
  };
}

const CLASS_ORDER = [
  "unbounded_loop", "secret_risk", "no_similarity_floor", "unpinned_model",
  "logging_gap", "parse_no_contract", "weak_assertion", "eval_check",
  "interpolation", "rag_embed", "rag_retrieve", "chunking", "retry",
  "tool_definition", "prompt_artifact", "model_call",
];

function report(pack, scout) {
  const out = [];
  const run = pack.run;
  out.push("SCOUT - legacy AI system, TypeScript / JavaScript");
  out.push(`root:     ${run.root}`);
  out.push(`scanned:  ${run.files_scanned} file(s), ${run.lines_scanned} lines, ${run.duration_ms}ms`);
  out.push("");

  if (pack.unknowns.length) {
    out.push("UNKNOWNS  (read these first - the scout could not determine them by reading)");
    for (const u of pack.unknowns) {
      out.push(`  ${u.id}  ${u.question}`);
      out.push(`      why:     ${u.why}`);
      out.push(`      resolve: ${u.resolve}`);
    }
    out.push("");
  }

  if (!pack.findings.length) {
    out.push("No findings. Either this tree has no AI system in it, or the scout");
    out.push("was pointed at the wrong place. Check the root above before concluding");
    out.push("anything - an empty report is not a clean bill of health.");
    out.push("");
  } else {
    out.push("COUNTS");
    for (const [cls, n] of Object.entries(pack.counts)) {
      out.push(`  ${String(n).padStart(4)}  ${cls}`);
    }
    out.push("");

    const grouped = {};
    for (const f of pack.findings) (grouped[f.class] ||= []).push(f);

    out.push("FINDINGS");
    const order = [...CLASS_ORDER, ...Object.keys(grouped).filter((c) => !CLASS_ORDER.includes(c))];
    for (const cls of order) {
      const items = grouped[cls];
      if (!items) continue;
      out.push("");
      out.push(`  [${cls}]  ${items.length}`);
      out.push(`  feeds: ${items[0].feeds.join(", ")}`);
      out.push(`  ${items[0].detail}`);
      for (const f of items.slice(0, 12)) {
        const mark = f.confidence === "confirmed" ? "C" : "I";
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        out.push(`    ${mark}  ${loc}  ${f.excerpt}`);
      }
      if (items.length > 12) out.push(`    ... and ${items.length - 12} more`);
    }
    out.push("");
  }

  if (scout.errors.length) {
    out.push("COULD NOT READ");
    for (const [path, why] of scout.errors.slice(0, 10)) out.push(`  ${path}  ${why}`);
    out.push("");
  }

  out.push("NEXT SKILL TO RUN");
  const feeds = {};
  for (const f of pack.findings) for (const s of f.feeds) feeds[s] = (feeds[s] || 0) + 1;
  for (const [skill, n] of Object.entries(feeds).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    out.push(`  ${skill.padEnd(28)} ${n} finding(s) feed it`);
  }
  out.push("");
  out.push("PRECISION");
  out.push("  This scout lexes rather than parses, so findings marked I (inferred)");
  out.push("  are structural reads, not certainties. The Python scout parses with");
  out.push("  ast and is more certain. Treat I as a lead, C as evidence.");
  out.push("");
  out.push("RECOMMENDED NEXT STEP");
  out.push(`  ${recommendation(scout)}`);
  out.push("");
  out.push(pack.receipt);
  return out.join("\n");
}

/* ------------------------------------------------------------------ main -- */

function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(`${SCOUT_NAME} ${SCOUT_VERSION}\n`);
    return 0;
  }
  const path = args.find((a) => !a.startsWith("-"));
  if (!path) {
    process.stderr.write(
      "usage: node m3scout.mjs <path> [--json] [-o FILE] [--skill NAME]\n",
    );
    return 1;
  }
  if (!existsSync(path)) {
    process.stderr.write(`m3scout: no such path: ${path}\n`);
    return 1;
  }

  const outIdx = Math.max(args.indexOf("-o"), args.indexOf("--out"));
  const outFile = outIdx !== -1 ? args[outIdx + 1] : null;
  const skillIdx = args.indexOf("--skill");
  const skill = skillIdx !== -1 ? args[skillIdx + 1] : null;

  const started = Date.now();
  const scout = new Scout(path);
  try {
    scout.run();
  } catch (e) {
    process.stderr.write(`m3scout: ${e.name}: ${e.message}\n`);
    return 1;
  }
  const duration = Date.now() - started;

  if (skill) {
    scout.findings = scout.findings
      .filter((f) => f.feeds.includes(skill))
      .map((f, i) => ({ ...f, id: `F${i + 1}` }));
  }

  const pack = evidencePack(scout, duration);
  const text = args.includes("--json") ? JSON.stringify(pack, null, 2) : report(pack, scout);

  if (outFile) {
    writeFileSync(outFile, text + "\n");
    process.stderr.write(`m3scout: wrote ${outFile}\n`);
  } else {
    process.stdout.write(text + "\n");
  }
  return 0;
}

process.exit(main(process.argv));
