#!/usr/bin/env python3
"""m3scout - M3n0ko0g legacy AI systems scout, Python.

Reads a Python codebase and reports what the AI system in it actually does:
where it calls a model, what prompts it sends, how retrieval is wired, what
cannot be diagnosed when it fails, and what the scout could not determine by
reading.

Deterministic and read-only. It parses source with the `ast` module. It never
calls a model, never sends your code anywhere, and never writes to the tree it
is scanning.

That constraint is deliberate. A scanner that guessed at intent would be feeding
the skills fabricated evidence, which is worse than feeding them nothing. So it
reports what it confirmed, separately from what it could not establish, and
every unknown carries the specific thing that would resolve it.

Output feeds the M3n0ko0g skills library. Each finding names the skills that
consume it.

    python m3scout.py <path>                 human-readable report
    python m3scout.py <path> --json          evidence pack, schema v1
    python m3scout.py <path> --json -o e.json
    python m3scout.py <path> --skill prompt-archaeology   only what that skill needs

Python 3.8+. No dependencies.

Released by Lawrence Jefferson II for public use.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import secrets
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

SCOUT_NAME = "m3scout-python"
SCOUT_VERSION = "1.0.0"
SCHEMA = "m3n0ko0g.scout.evidence/1"

# ---------------------------------------------------------------- knowledge --

# Attribute paths that mean "a model was called". Matched against the dotted
# call target, so `client.chat.completions.create` matches on its tail.
MODEL_CALL_TAILS = (
    "chat.completions.create",
    "completions.create",
    "messages.create",
    "messages.stream",
    "responses.create",
    "generate_content",
    "invoke_model",
    "chat.complete",
)

# Bare callables that mean a model call in the common wrappers.
MODEL_CALL_NAMES = ("acompletion", "completion", "chat_completion", "text_generation")

EMBED_TAILS = ("embeddings.create", "embed_documents", "embed_query", "embed_content")
EMBED_NAMES = ("embed", "get_embedding", "encode")

RETRIEVE_TAILS = (
    "similarity_search",
    "similarity_search_with_score",
    "max_marginal_relevance_search",
    "as_retriever",
    "get_relevant_documents",
    "aget_relevant_documents",
    "vector_store.query",
)
RETRIEVE_NAMES = ("retrieve", "search", "query")

# Vector stores worth naming, because "which store" changes the freshness and
# deletion story completely.
VECTOR_HINTS = (
    "pinecone", "weaviate", "qdrant", "chroma", "milvus", "faiss",
    "pgvector", "lancedb", "opensearch", "elasticsearch", "redis",
)

# A model string with no version. These are the ones that swap under you.
UNPINNED = (
    "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "gpt-4.1", "gpt-5",
    "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
    "claude-3-5-sonnet", "claude-sonnet-4", "claude-opus-4",
    "gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash",
    "latest", "default",
)

MODEL_KWARGS = ("model", "model_name", "model_id", "deployment_name", "engine")

# Words that make a long string a prompt rather than SQL or a log line.
PROMPT_WORDS = (
    "you are", "your task", "instructions", "respond", "answer", "assistant",
    "do not", "must not", "never ", "always ", "given the", "context:",
    "question:", "step by step", "json", "output format", "summarize",
    "you must", "based on the", "role:", "system:",
)

PROMPT_FILE_HINTS = ("prompt", "instruction", "persona", "system", "template")

# Plenty of systems never touch an SDK and just POST to the endpoint. Those
# calls are invisible to call-name matching, and they are common in exactly the
# hand-assembled systems these scouts are pointed at.
PROVIDER_URLS = (
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.cohere.ai",
    "api.mistral.ai",
    "api.groq.com",
    "api-inference.huggingface.co",
    "openai.azure.com",
    "bedrock-runtime.",
)

SECRET_NAMES = ("api_key", "apikey", "secret", "token", "openai_api_key",
                "anthropic_api_key", "access_key", "password")

PARSE_CALLS = ("loads", "parse_raw", "model_validate_json", "parse_obj_as")

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".env", "dist", "build", ".tox", ".mypy_cache", ".pytest_cache",
    "site-packages", ".next", ".nuxt", "target", ".idea", ".vscode",
}


# ------------------------------------------------------------------ records --

@dataclass
class Finding:
    id: str
    cls: str
    confidence: str
    file: str
    line: int
    excerpt: str
    detail: str
    feeds: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["class"] = d.pop("cls")
        return d


@dataclass
class Unknown:
    id: str
    question: str
    why: str
    resolve: str


# ------------------------------------------------------------------- helpers --

def dotted(node: ast.AST) -> str:
    """Reconstruct a dotted name from an attribute or name node."""
    parts: List[str] = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    elif isinstance(cur, ast.Call):
        parts.append("()")
    return ".".join(reversed(parts))


def trim(text: str, width: int = 90) -> str:
    one = " ".join(str(text).split())
    return one if len(one) <= width else one[: width - 3] + "..."


def const_str(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    # A joined f-string still tells us the literal parts.
    if isinstance(node, ast.JoinedStr):
        out = []
        for v in node.values:
            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                out.append(v.value)
            else:
                out.append("{...}")
        return "".join(out)
    return None


def kwarg(call: ast.Call, names: Iterable[str]) -> Optional[ast.keyword]:
    for kw in call.keywords:
        if kw.arg in names:
            return kw
    return None


def looks_like_prompt(text: str) -> bool:
    if len(text) < 120:
        return False
    low = text.lower()
    return any(w in low for w in PROMPT_WORDS)


# -------------------------------------------------------------- the visitor --

class FileScout(ast.NodeVisitor):
    """Walks one module. Records findings against the enclosing repo scout."""

    def __init__(self, scout: "Scout", relpath: str, source: str):
        self.s = scout
        self.rel = relpath
        self.lines = source.splitlines()
        # Stack of loop nodes we are currently inside, for unbounded-loop work.
        self.loop_stack: List[ast.AST] = []
        # Model calls seen inside the current loop, by loop id.
        self.loop_model_calls: Dict[int, List[int]] = {}
        self.model_call_lines: List[int] = []
        self.has_logging_import = False
        self.logged_lines: set = set()

    # -- structure ---------------------------------------------------------

    def visit_Import(self, node: ast.Import) -> None:
        for a in node.names:
            if a.name.split(".")[0] in ("logging", "structlog", "loguru"):
                self.has_logging_import = True
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module and node.module.split(".")[0] in ("logging", "structlog", "loguru"):
            self.has_logging_import = True
        self.generic_visit(node)

    def _visit_loop(self, node: ast.AST) -> None:
        self.loop_stack.append(node)
        self.loop_model_calls[id(node)] = []
        self.generic_visit(node)
        self.loop_stack.pop()

        calls = self.loop_model_calls.pop(id(node), [])
        if not calls:
            return

        # A `for` over a finite iterable is bounded by construction. A `while`
        # is only bounded if something in its test or body counts.
        if isinstance(node, ast.While):
            if not self._loop_has_counter(node):
                self.s.add(
                    "unbounded_loop", "confirmed", self.rel, node.lineno,
                    self._src(node.lineno),
                    "A while loop contains a model call and no counter bounds it. "
                    "Exit depends on model output. Unbounded spend and unbounded latency.",
                    ["token-bill", "agent-gate-review"],
                )

    def visit_For(self, node: ast.For) -> None:
        self._visit_loop(node)

    def visit_While(self, node: ast.While) -> None:
        self._visit_loop(node)

    def _loop_has_counter(self, node: ast.While) -> bool:
        """True if anything in the loop increments a bound or compares one."""
        for sub in ast.walk(node):
            if isinstance(sub, ast.AugAssign) and isinstance(sub.op, ast.Add):
                return True
            if isinstance(sub, ast.Compare):
                # `while attempts < max_attempts` style.
                for cmp_node in (sub.left, *sub.comparators):
                    name = ""
                    if isinstance(cmp_node, ast.Name):
                        name = cmp_node.id.lower()
                    elif isinstance(cmp_node, ast.Attribute):
                        name = cmp_node.attr.lower()
                    if any(k in name for k in ("max", "limit", "attempt", "count", "iter", "retry", "step")):
                        return True
        return False

    # -- assignments -------------------------------------------------------

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str):
            for url in PROVIDER_URLS:
                if url in node.value:
                    embedding = "embedding" in node.value.lower()
                    self.s.add(
                        "rag_embed" if embedding else "model_call",
                        "confirmed", self.rel, node.lineno, trim(node.value, 70),
                        "A model provider endpoint is called over raw HTTP rather "
                        "than through an SDK. Call-name matching does not see these, "
                        "so anything that audits this system by grepping for client "
                        "libraries will miss it entirely.",
                        ["prompt-archaeology", "token-bill",
                         "model-swap-blast-radius", "incident-replay"],
                    )
                    if not embedding:
                        self.model_call_lines.append(node.lineno)
                    self.s.unknown(
                        f"Which model does the raw HTTP call at {self.rel}:{node.lineno} send?",
                        "The endpoint is a literal but the request body is assembled "
                        "separately, so the model string is not readable at the URL.",
                        "Read the body construction, or log the resolved model with "
                        "each request.",
                    )
                    break
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        target = ""
        if node.targets and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
        elif node.targets and isinstance(node.targets[0], ast.Attribute):
            target = node.targets[0].attr

        low = target.lower()

        text = const_str(node.value)
        if text and looks_like_prompt(text):
            self.s.add(
                "prompt_artifact", "confirmed", self.rel, node.lineno,
                trim(text, 70),
                f"Prompt string, roughly {len(text) // 4} tokens, assigned to `{target}`.",
                ["prompt-archaeology", "token-bill", "model-swap-blast-radius"],
            )
            self._scan_prompt_text(text, node.lineno)

        # An f-string prompt is a runtime-assembled prompt.
        if isinstance(node.value, ast.JoinedStr) and text and looks_like_prompt(text):
            self.s.add(
                "interpolation", "confirmed", self.rel, node.lineno,
                trim(text, 70),
                f"Prompt `{target}` is built by interpolation. Whatever those values "
                "carry reaches the model, and the substitution is unbounded.",
                ["data-in-the-prompt", "prompt-archaeology"],
            )

        if any(k in low for k in ("chunk_size", "chunk_overlap")):
            val = node.value.value if isinstance(node.value, ast.Constant) else "?"
            self.s.add(
                "chunking", "confirmed", self.rel, node.lineno,
                f"{target} = {val}",
                "Chunking setting. Check whether it respects document structure; "
                "fixed-size splitting cuts sentences and tables in half.",
                ["rag-integrity-check"],
            )

        if low in SECRET_NAMES or any(low.endswith("_" + s) for s in ("key", "secret", "token")):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) and len(node.value.value) > 12:
                self.s.add(
                    "secret_risk", "confirmed", self.rel, node.lineno,
                    f"{target} = <string literal, {len(node.value.value)} chars>",
                    "A credential-shaped name assigned a long string literal. "
                    "If this is a real key it does not belong in source.",
                    ["data-in-the-prompt"],
                )

        self.generic_visit(node)

    def _scan_prompt_text(self, text: str, line: int) -> None:
        """Soft coupling: emphasis and formatting tuned against one model."""
        low = text.lower()
        marks = []
        if text.count("MUST") + text.count("NEVER") + text.count("DO NOT") >= 2:
            marks.append("repeated all-caps prohibitions")
        if "step by step" in low:
            marks.append('"think step by step"')
        if "<" in text and ">" in text and text.count("<") >= 2:
            marks.append("XML-style tags")
        if "do not apologize" in low or "no preamble" in low or "without preamble" in low:
            marks.append("anti-preamble instruction")
        if marks:
            self.s.add(
                "prompt_artifact", "inferred", self.rel, line,
                ", ".join(marks),
                "Soft coupling: phrasing of this kind is usually scar tissue from "
                "fighting one specific model version. It may be unnecessary or "
                "harmful on a different model. Origin cannot be read from source.",
                ["model-swap-blast-radius", "prompt-archaeology"],
            )

    # -- calls -------------------------------------------------------------

    def visit_Call(self, node: ast.Call) -> None:
        name = dotted(node.func)
        low = name.lower()
        tail_match = any(low.endswith(t) for t in MODEL_CALL_TAILS)
        bare = name.split(".")[-1]

        if tail_match or bare in MODEL_CALL_NAMES:
            self._model_call(node, name)
        elif any(low.endswith(t) for t in EMBED_TAILS) or bare in EMBED_NAMES:
            self._embed_call(node, name)
        elif any(low.endswith(t) for t in RETRIEVE_TAILS) or (
            bare in RETRIEVE_NAMES and kwarg(node, ("k", "top_k", "n_results", "limit"))
        ):
            self._retrieve_call(node, name)

        if bare in PARSE_CALLS and ("json" in low or "pydantic" in low or bare != "loads"):
            self._parse_call(node, name)

        if bare in ("retry", "Retrying") or "retry" in low:
            self.s.add(
                "retry", "confirmed", self.rel, node.lineno, trim(self._src(node.lineno)),
                "Retry logic. Check that it distinguishes transient failures from "
                "deterministic ones, and whether it re-sends the whole prompt.",
                ["token-bill", "incident-replay"],
            )

        if bare in ("info", "debug", "warning", "error", "exception", "log"):
            self.logged_lines.add(node.lineno)

        self.generic_visit(node)

    def _src(self, line: int) -> str:
        if 1 <= line <= len(self.lines):
            return trim(self.lines[line - 1].strip())
        return ""

    def _model_call(self, node: ast.Call, name: str) -> None:
        self.model_call_lines.append(node.lineno)
        for loop in self.loop_stack:
            self.loop_model_calls.setdefault(id(loop), []).append(node.lineno)

        self.s.add(
            "model_call", "confirmed", self.rel, node.lineno, trim(name),
            "A model is called here.",
            ["prompt-archaeology", "token-bill", "model-swap-blast-radius", "incident-replay"],
        )

        kw = kwarg(node, MODEL_KWARGS)
        if kw is None:
            self.s.unknown(
                f"Which model does {self.rel}:{node.lineno} use?",
                "No model keyword at the call site. It is set elsewhere, or defaulted "
                "by the client or the library.",
                "Read the client construction, or log the resolved model on one request.",
            )
        else:
            model = const_str(kw.value)
            if model is None:
                self.s.unknown(
                    f"Which model does {self.rel}:{node.lineno} use?",
                    "The model argument is a variable or expression, not a literal.",
                    "Log the resolved model string alongside each request.",
                )
            else:
                pinned = self._is_pinned(model)
                if not pinned:
                    self.s.add(
                        "unpinned_model", "confirmed", self.rel, kw.value.lineno,
                        f'model="{model}"',
                        "Model alias carries no version. The provider can move it "
                        "underneath you, so this swap has likely already happened "
                        "more than once with no review and no record.",
                        ["model-swap-blast-radius", "incident-replay", "eval-or-vibes"],
                    )

        temp = kwarg(node, ("temperature",))
        if temp is not None and isinstance(temp.value, ast.Constant):
            try:
                if float(temp.value.value) >= 0.7:
                    self.s.add(
                        "model_call", "confirmed", self.rel, node.lineno,
                        f"temperature={temp.value.value}",
                        "High temperature. If this call's output is parsed or used as "
                        "a decision, the variance is a correctness problem, not a style one.",
                        ["eval-or-vibes", "prompt-archaeology"],
                    )
            except (TypeError, ValueError):
                pass

        if kwarg(node, ("tools", "functions", "tool_choice")) is not None:
            self.s.add(
                "tool_definition", "confirmed", self.rel, node.lineno,
                trim(self._src(node.lineno)),
                "Tool definitions are sent with this call. The model reads them, so "
                "they are prompts, and they are billed on every request.",
                ["token-bill", "prompt-archaeology", "model-swap-blast-radius"],
            )

        # Inline prompt strings passed straight into the call.
        for arg in list(node.args) + [k.value for k in node.keywords]:
            text = const_str(arg)
            if text and looks_like_prompt(text):
                self.s.add(
                    "prompt_artifact", "confirmed", self.rel, getattr(arg, "lineno", node.lineno),
                    trim(text, 70),
                    "Prompt written inline at the call site.",
                    ["prompt-archaeology", "token-bill"],
                )
                self._scan_prompt_text(text, getattr(arg, "lineno", node.lineno))

    @staticmethod
    def _is_pinned(model: str) -> bool:
        m = model.strip().lower()
        if not m:
            return False
        if m in UNPINNED:
            return False
        if m.endswith("-latest") or m.endswith(":latest"):
            return False
        # A date stamp or an explicit version suffix counts as pinned.
        parts = m.replace(":", "-").split("-")
        return any(p.isdigit() and len(p) >= 4 for p in parts)

    def _embed_call(self, node: ast.Call, name: str) -> None:
        self.s.add(
            "rag_embed", "confirmed", self.rel, node.lineno, trim(name),
            "An embedding call. This is a second model and usually a second "
            "subprocessor. It sees every document indexed and every query typed, "
            "and it is the one that gets swapped by accident inside a general "
            "upgrade ticket, where the failure is total.",
            ["rag-integrity-check", "data-in-the-prompt", "model-swap-blast-radius"],
        )
        kw = kwarg(node, MODEL_KWARGS)
        if kw is None or const_str(kw.value) is None:
            self.s.unknown(
                f"Which embedding model builds the index, at {self.rel}:{node.lineno}?",
                "Not a literal at the call site.",
                "Pin it, and record it beside the index. If the build-time and "
                "query-time models ever differ, retrieval fails completely and silently.",
            )

    def _retrieve_call(self, node: ast.Call, name: str) -> None:
        k = kwarg(node, ("k", "top_k", "n_results", "limit"))
        pos_k = None
        if k is None:
            for a in node.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, int):
                    pos_k = a.value
                    break

        kval = None
        if k is not None and isinstance(k.value, ast.Constant):
            kval = k.value.value
        elif pos_k is not None:
            kval = pos_k

        self.s.add(
            "rag_retrieve", "confirmed", self.rel, node.lineno, trim(name),
            f"Retrieval call{'' if kval is None else f', k={kval}'}.",
            ["rag-integrity-check", "incident-replay", "token-bill"],
        )

        floor = kwarg(node, ("score_threshold", "min_score", "threshold", "distance_threshold"))
        if floor is None:
            self.s.add(
                "no_similarity_floor", "confirmed", self.rel, node.lineno,
                trim(self._src(node.lineno)),
                "Retrieval with no minimum score. The system always returns results, "
                "including when nothing relevant exists, so it cannot say it does not "
                "know. This is the mechanism behind most confident wrong answers.",
                ["rag-integrity-check", "eval-or-vibes", "sign-off-pack"],
            )

        # Is the result logged anywhere near here?
        near = any(abs(l - node.lineno) <= 3 for l in self.logged_lines)
        if not near:
            self.s.add(
                "logging_gap", "inferred", self.rel, node.lineno,
                trim(self._src(node.lineno)),
                "No logging call within three lines of this retrieval. If chunk ids "
                "and scores are not recorded, no retrieval failure in this system "
                "can ever be diagnosed after the fact.",
                ["incident-replay", "rag-integrity-check"],
            )

    def _parse_call(self, node: ast.Call, name: str) -> None:
        # Only interesting if a model call happened earlier in this file.
        if not self.model_call_lines:
            return
        if not any(l < node.lineno for l in self.model_call_lines):
            return
        self.s.add(
            "parse_no_contract", "inferred", self.rel, node.lineno,
            trim(self._src(node.lineno)),
            "Structured parsing downstream of a model call. If the prompt does not "
            "state the required format, this parser is depending on luck.",
            ["prompt-archaeology", "model-swap-blast-radius", "eval-or-vibes"],
        )


# --------------------------------------------------------------- the scout --

class Scout:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.findings: List[Finding] = []
        self.unknowns: List[Unknown] = []
        self._seen_unknowns: set = set()
        self.files_scanned = 0
        self.lines_scanned = 0
        self.errors: List[Tuple[str, str]] = []
        self.vector_stores: set = set()
        self.eval_files: List[str] = []

    def add(self, cls: str, confidence: str, file: str, line: int,
            excerpt: str, detail: str, feeds: List[str]) -> None:
        self.findings.append(
            Finding(f"F{len(self.findings) + 1}", cls, confidence, file, line,
                    excerpt, detail, feeds)
        )

    def unknown(self, question: str, why: str, resolve: str) -> None:
        if question in self._seen_unknowns:
            return
        self._seen_unknowns.add(question)
        self.unknowns.append(
            Unknown(f"U{len(self.unknowns) + 1}", question, why, resolve)
        )

    # -- walking -----------------------------------------------------------

    def _python_files(self) -> Iterable[str]:
        if os.path.isfile(self.root):
            yield self.root
            return
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for fn in filenames:
                if fn.endswith(".py"):
                    yield os.path.join(dirpath, fn)

    def _prompt_files(self) -> Iterable[str]:
        if os.path.isfile(self.root):
            return
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for fn in filenames:
                low = fn.lower()
                if low.endswith((".txt", ".md", ".jinja", ".j2", ".tmpl", ".prompt")):
                    hay = (os.path.basename(dirpath) + "/" + low)
                    if any(h in hay for h in PROMPT_FILE_HINTS):
                        yield os.path.join(dirpath, fn)

    def rel(self, path: str) -> str:
        try:
            return os.path.relpath(path, self.root).replace(os.sep, "/")
        except ValueError:
            return path.replace(os.sep, "/")

    def run(self) -> None:
        for path in self._python_files():
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    source = fh.read()
            except OSError as exc:
                self.errors.append((self.rel(path), str(exc)))
                continue

            self.files_scanned += 1
            self.lines_scanned += source.count("\n") + 1
            rel = self.rel(path)

            low_src = source.lower()
            for hint in VECTOR_HINTS:
                if hint in low_src:
                    self.vector_stores.add(hint)

            base = os.path.basename(path).lower()
            if base.startswith("test_") or base.endswith("_test.py") or "eval" in base:
                self.eval_files.append(rel)
                self._scan_tests(rel, source)

            try:
                tree = ast.parse(source, filename=path)
            except SyntaxError as exc:
                self.errors.append((rel, f"syntax error line {exc.lineno}"))
                continue

            FileScout(self, rel, source).visit(tree)

        for path in self._prompt_files():
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            self.files_scanned += 1
            self.lines_scanned += text.count("\n") + 1
            self.add(
                "prompt_artifact", "confirmed", self.rel(path), 1, trim(text, 70),
                f"Prompt file, roughly {len(text) // 4} tokens.",
                ["prompt-archaeology", "token-bill"],
            )

        self._finalize()

    def _scan_tests(self, rel: str, source: str) -> None:
        """Assertions that cannot fail are Smoke, never Eval."""
        for i, line in enumerate(source.splitlines(), 1):
            s = line.strip()
            if not s.startswith("assert"):
                continue
            low = s.lower()
            weak = (
                "is not none" in low
                or low.endswith("assert resp") or low.endswith("assert result")
                or ("len(" in low and (">0" in low.replace(" ", "") or ">=1" in low.replace(" ", "")))
                or ("in " in low and "error" in low and "not" in low)
            )
            if weak:
                self.add(
                    "weak_assertion", "confirmed", rel, i, trim(s),
                    "This assertion passes on garbage. It checks the system ran, not "
                    "that it was right. Smoke, never Eval.",
                    ["eval-or-vibes", "sign-off-pack"],
                )

    def _finalize(self) -> None:
        model_calls = [f for f in self.findings if f.cls == "model_call"]
        retrieves = [f for f in self.findings if f.cls == "rag_retrieve"]
        embeds = [f for f in self.findings if f.cls == "rag_embed"]

        if model_calls:
            self.unknown(
                "How often is each model call actually made, and on what traffic mix?",
                "Call frequency is a runtime property. Static reading cannot see it.",
                "Log a counter per call path for a day. Until then any cost or risk "
                "ranking is ordering, not forecasting.",
            )
            self.unknown(
                "What does a wrong answer cost here?",
                "Not determinable from source. It is a business fact.",
                "Ask the owner. It sets the budget for everything else in the report.",
            )

        if retrieves or embeds:
            self.unknown(
                "What is actually in the corpus?",
                "The scout reads the pipeline, never the documents. Whatever was "
                "ingested is retrievable into a prompt.",
                "Sample 200 chunks and classify them. If ingestion was unfiltered, "
                "this is the largest unbounded surface in the system.",
            )
            self.unknown(
                "Does the index have a deletion path?",
                "Removal at the source does not imply removal from the index, and a "
                "delete path cannot be confirmed by reading the query side.",
                "Delete one document at the source, then query for it.",
            )

        if embeds and retrieves:
            self.unknown(
                "Does the embedding model that built the index match the one used at query time?",
                "The scout sees call sites, not which model produced the stored vectors.",
                "Record the embedding model and version beside the index. A mismatch "
                "is total, silent retrieval failure and it looks like the model got dumber.",
            )

        if not self.eval_files and model_calls:
            self.add(
                "eval_check", "confirmed", ".", 0, "no test or eval files found",
                "No test or eval file was found anywhere in the tree. Nothing would "
                "catch a regression from a prompt edit or a model change.",
                ["eval-or-vibes", "sign-off-pack", "model-swap-blast-radius"],
            )

        if self.vector_stores:
            self.add(
                "rag_retrieve", "inferred", ".", 0,
                ", ".join(sorted(self.vector_stores)),
                "Vector store referenced in the tree. Which store decides the "
                "freshness and deletion story.",
                ["rag-integrity-check"],
            )


# ------------------------------------------------------------------ output --

def counts(findings: List[Finding]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for f in findings:
        out[f.cls] = out.get(f.cls, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def receipt(scout: Scout, run_id: str, run_at: str) -> str:
    c = counts(scout.findings)
    top = next(iter(c), "none")
    return "\n".join([
        "--- M3n0ko0g skill receipt ---",
        f"skill:       {SCOUT_NAME}",
        f"version:     {SCOUT_VERSION}",
        f"id:          {run_id}",
        f"run_at:      {run_at}",
        f"input:       python, {scout.files_scanned} file(s), {scout.lines_scanned} lines",
        f"findings:    {len(scout.findings)}  (top class: {top})",
        f"unknowns:    {len(scout.unknowns)}",
        "recommended: " + recommendation(scout),
        "human:       pending",
        "---",
    ])


def recommendation(scout: Scout) -> str:
    """One next step. The most leveraged unfixed thing, in a fixed order."""
    by_class = {f.cls: f for f in scout.findings}
    if "unbounded_loop" in by_class:
        f = by_class["unbounded_loop"]
        return f"cap the loop at {f.file}:{f.line} - unbounded spend and latency"
    if "no_similarity_floor" in by_class:
        f = by_class["no_similarity_floor"]
        return f"add a similarity floor at {f.file}:{f.line} so the system can say it does not know"
    if "logging_gap" in by_class:
        f = by_class["logging_gap"]
        return f"log retrieved chunk ids and scores at {f.file}:{f.line} - one line, and it makes every future failure a lookup"
    if "unpinned_model" in by_class:
        f = by_class["unpinned_model"]
        return f"pin the model alias at {f.file}:{f.line} - the swap is already happening without review"
    if "weak_assertion" in by_class:
        return "replace the assertions that cannot fail with one eval that gates the build"
    if "eval_check" in by_class:
        return "build one eval on the highest-traffic path before changing anything"
    if scout.findings:
        return f"run prompt-archaeology over the {len(scout.findings)} findings below"
    return "nothing found - confirm the scout was pointed at the right tree"


def evidence_pack(scout: Scout, duration_ms: int) -> Dict[str, Any]:
    run_id = secrets.token_hex(6)
    run_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "schema": SCHEMA,
        "scout": {"name": SCOUT_NAME, "version": SCOUT_VERSION, "language": "python"},
        "run": {
            "id": run_id,
            "run_at": run_at,
            "root": scout.root.replace(os.sep, "/"),
            "files_scanned": scout.files_scanned,
            "lines_scanned": scout.lines_scanned,
            "duration_ms": duration_ms,
        },
        "counts": counts(scout.findings),
        "findings": [f.to_dict() for f in scout.findings],
        "unknowns": [asdict(u) for u in scout.unknowns],
        "receipt": receipt(scout, run_id, run_at),
    }


def report(pack: Dict[str, Any], scout: Scout) -> str:
    out: List[str] = []
    run = pack["run"]
    out.append("SCOUT - legacy AI system, Python")
    out.append(f"root:     {run['root']}")
    out.append(f"scanned:  {run['files_scanned']} file(s), {run['lines_scanned']} lines, {run['duration_ms']}ms")
    out.append("")

    if pack["unknowns"]:
        out.append("UNKNOWNS  (read these first - the scout could not determine them by reading)")
        for u in pack["unknowns"]:
            out.append(f"  {u['id']}  {u['question']}")
            out.append(f"      why:     {u['why']}")
            out.append(f"      resolve: {u['resolve']}")
        out.append("")

    if not pack["findings"]:
        out.append("No findings. Either this tree has no AI system in it, or the scout")
        out.append("was pointed at the wrong place. Check the root above before concluding")
        out.append("anything - an empty report is not a clean bill of health.")
        out.append("")
    else:
        out.append("COUNTS")
        for cls, n in pack["counts"].items():
            out.append(f"  {n:>4}  {cls}")
        out.append("")

        # Group by class so the report reads as evidence, not as a log.
        order = [
            "unbounded_loop", "no_similarity_floor", "unpinned_model", "logging_gap",
            "parse_no_contract", "weak_assertion", "eval_check", "secret_risk",
            "interpolation", "rag_embed", "rag_retrieve", "chunking", "retry",
            "tool_definition", "prompt_artifact", "model_call",
        ]
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for f in pack["findings"]:
            grouped.setdefault(f["class"], []).append(f)

        out.append("FINDINGS")
        for cls in order + [c for c in grouped if c not in order]:
            items = grouped.get(cls)
            if not items:
                continue
            out.append("")
            out.append(f"  [{cls}]  {len(items)}")
            out.append(f"  feeds: {', '.join(items[0]['feeds'])}")
            out.append(f"  {items[0]['detail']}")
            for f in items[:12]:
                mark = "C" if f["confidence"] == "confirmed" else "I"
                loc = f"{f['file']}:{f['line']}" if f["line"] else f["file"]
                out.append(f"    {mark}  {loc}  {f['excerpt']}")
            if len(items) > 12:
                out.append(f"    ... and {len(items) - 12} more")
        out.append("")

    if scout.errors:
        out.append("COULD NOT READ")
        for path, why in scout.errors[:10]:
            out.append(f"  {path}  {why}")
        out.append("")

    out.append("NEXT SKILL TO RUN")
    feeds: Dict[str, int] = {}
    for f in pack["findings"]:
        for s in f["feeds"]:
            feeds[s] = feeds.get(s, 0) + 1
    for skill, n in sorted(feeds.items(), key=lambda kv: -kv[1])[:4]:
        out.append(f"  {skill:<28} {n} finding(s) feed it")
    out.append("")
    out.append("RECOMMENDED NEXT STEP")
    out.append(f"  {recommendation(scout)}")
    out.append("")
    out.append(pack["receipt"])
    return "\n".join(out)


# -------------------------------------------------------------------- main --

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="m3scout",
        description="M3n0ko0g legacy AI systems scout for Python. Deterministic, "
                    "read-only, no model calls. Feeds the M3n0ko0g skills library.",
    )
    p.add_argument("path", help="file or directory to scan")
    p.add_argument("--json", action="store_true", help="emit the evidence pack (schema v1)")
    p.add_argument("-o", "--out", help="write output to a file instead of stdout")
    p.add_argument("--skill", help="only findings that feed this skill")
    p.add_argument("--version", action="version", version=f"{SCOUT_NAME} {SCOUT_VERSION}")
    args = p.parse_args(argv)

    if not os.path.exists(args.path):
        sys.stderr.write(f"m3scout: no such path: {args.path}\n")
        return 1

    started = time.time()
    scout = Scout(args.path)
    try:
        scout.run()
    except Exception as exc:  # a scout that crashes tells you nothing
        sys.stderr.write(f"m3scout: {type(exc).__name__}: {exc}\n")
        return 1
    duration = int((time.time() - started) * 1000)

    if args.skill:
        scout.findings = [f for f in scout.findings if args.skill in f.feeds]
        for i, f in enumerate(scout.findings, 1):
            f.id = f"F{i}"

    pack = evidence_pack(scout, duration)
    text = json.dumps(pack, indent=2) if args.json else report(pack, scout)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        sys.stderr.write(f"m3scout: wrote {args.out}\n")
    else:
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
