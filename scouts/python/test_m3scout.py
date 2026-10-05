#!/usr/bin/env python3
"""Tests for m3scout.

Runs the real scout over the fixture and asserts on the evidence pack. No
mocks: the fixture is a deliberately broken support agent of the kind assembled
in 2023, and every defect planted in it must be found.

    python test_m3scout.py

Exit 0 on pass, 1 on failure. No dependencies, no test runner.
"""

import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixture")
SCOUT = os.path.join(HERE, "m3scout.py")

passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  pass  " + label)
    else:
        failed += 1
        print("  FAIL  " + label + (("  -> " + str(detail)) if detail else ""))


def run(args):
    return subprocess.run(
        [sys.executable, SCOUT] + args,
        capture_output=True, text=True, cwd=HERE,
    )


def classes(pack):
    return [f["class"] for f in pack["findings"]]


def by_class(pack, cls):
    return [f for f in pack["findings"] if f["class"] == cls]


def main():
    print("m3scout - tests against the fixture\n")

    proc = run([FIXTURE, "--json"])
    check("scout exits 0", proc.returncode == 0, proc.stderr[:200])
    try:
        pack = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        print("  FAIL  --json did not emit valid JSON -> " + str(exc))
        print(proc.stdout[:400])
        return 1

    # -- schema ---------------------------------------------------------
    check("declares schema v1", pack["schema"] == "m3n0ko0g.scout.evidence/1", pack.get("schema"))
    check("names itself", pack["scout"]["name"] == "m3scout-python")
    check("reports language", pack["scout"]["language"] == "python")
    check("run id is 12 hex", len(pack["run"]["id"]) == 12 and all(c in "0123456789abcdef" for c in pack["run"]["id"]))
    check("run_at is ISO UTC", pack["run"]["run_at"].endswith("Z"), pack["run"]["run_at"])
    check("counted the files", pack["run"]["files_scanned"] == 2, pack["run"]["files_scanned"])
    check("every finding has an id, class, confidence, file, feeds",
          all(f.get("id") and f.get("class") and f.get("confidence") and f.get("file") is not None and f.get("feeds")
              for f in pack["findings"]))
    check("confidence is only confirmed or inferred",
          set(f["confidence"] for f in pack["findings"]) <= {"confirmed", "inferred"},
          set(f["confidence"] for f in pack["findings"]))
    check("finding ids are unique", len(set(f["id"] for f in pack["findings"])) == len(pack["findings"]))

    # -- every planted defect is found ----------------------------------
    print("\n  the planted defects:")
    cl = classes(pack)

    check("finds the unbounded agent loop", "unbounded_loop" in cl)
    loop = by_class(pack, "unbounded_loop")
    check("  and points at the while, not the call",
          loop and loop[0]["line"] == 94, loop[0]["line"] if loop else None)

    check("finds retrieval with no similarity floor", "no_similarity_floor" in cl)

    check("finds both unpinned model aliases", cl.count("unpinned_model") == 2, cl.count("unpinned_model"))
    check("  and quotes the alias",
          any('gpt-4o' in f["excerpt"] for f in by_class(pack, "unpinned_model")))

    check("finds the embedding call", "rag_embed" in cl)
    check("finds the retrieval call", "rag_retrieve" in cl)
    check("finds the chunking settings", cl.count("chunking") == 2, cl.count("chunking"))
    check("finds the tool definitions", "tool_definition" in cl)
    check("finds the json parse with no contract", "parse_no_contract" in cl)
    check("finds the interpolated prompt", "interpolation" in cl)
    check("finds the retrieval logging gap", "logging_gap" in cl)
    check("finds all three assertions that cannot fail",
          cl.count("weak_assertion") == 3, cl.count("weak_assertion"))
    check("finds the system prompt", any("SYSTEM_PROMPT" in f["detail"] for f in by_class(pack, "prompt_artifact")))
    check("finds the model-tuned scar tissue",
          any(f["confidence"] == "inferred" and "all-caps" in f["excerpt"]
              for f in by_class(pack, "prompt_artifact")))
    check("finds all four model calls including the raw HTTP one",
          cl.count("model_call") >= 4, cl.count("model_call"))
    check("flags the high temperature",
          any("temperature=0.9" in f["excerpt"] for f in by_class(pack, "model_call")))
    check("sees a model called over raw HTTP, with no SDK involved",
          any("api.openai.com" in f["excerpt"] for f in by_class(pack, "model_call")))

    # -- unknowns -------------------------------------------------------
    print("\n  unknowns:")
    check("records unknowns", len(pack["unknowns"]) >= 4, len(pack["unknowns"]))
    check("every unknown carries a way to resolve it",
          all(u.get("resolve") and u.get("why") and u.get("question") for u in pack["unknowns"]))
    check("asks whether the embedding models match",
          any("embedding model" in u["question"].lower() for u in pack["unknowns"]))
    check("asks what is in the corpus",
          any("corpus" in u["question"].lower() for u in pack["unknowns"]))
    check("unknown ids are unique", len(set(u["id"] for u in pack["unknowns"])) == len(pack["unknowns"]))

    # -- the discipline -------------------------------------------------
    print("\n  the discipline:")
    check("no finding claims a confidence of 'unknown'",
          not any(f["confidence"] == "unknown" for f in pack["findings"]),
          "unknowns belong in the other list, never as a weak finding")
    check("the logging gap is inferred, not confirmed",
          all(f["confidence"] == "inferred" for f in by_class(pack, "logging_gap")))
    check("the unpinned alias is confirmed, not inferred",
          all(f["confidence"] == "confirmed" for f in by_class(pack, "unpinned_model")))
    check("recommends capping the loop first",
          "cap the loop" in pack["receipt"],
          [l for l in pack["receipt"].splitlines() if l.startswith("recommended")])

    # -- receipt --------------------------------------------------------
    print("\n  receipt:")
    r = pack["receipt"]
    check("emits a receipt", "--- M3n0ko0g skill receipt ---" in r)
    check("human starts pending", "human:       pending" in r)
    check("receipt id matches the run id", pack["run"]["id"] in r)
    check("receipt carries shape, not content",
          "gpt-4o" not in r and "SYSTEM_PROMPT" not in r and "You are a support" not in r,
          "a receipt that quotes its input turns a log into a leak")

    # -- text report ----------------------------------------------------
    print("\n  text report:")
    text = run([FIXTURE]).stdout
    check("report leads with unknowns",
          text.index("UNKNOWNS") < text.index("FINDINGS"), "unknowns must not be an appendix")
    check("report names the next skills to run", "NEXT SKILL TO RUN" in text)
    check("report ends with the receipt", text.rstrip().endswith("---"))
    check("report is ASCII only",
          all(ord(c) < 128 for c in text),
          [c for c in text if ord(c) >= 128][:5])

    # -- skill filter ---------------------------------------------------
    print("\n  --skill filter:")
    filt = json.loads(run([FIXTURE, "--json", "--skill", "rag-integrity-check"]).stdout)
    check("filters to one skill's findings",
          all("rag-integrity-check" in f["feeds"] for f in filt["findings"]),
          len(filt["findings"]))
    check("filtered findings are fewer than the full set",
          0 < len(filt["findings"]) < len(pack["findings"]),
          f'{len(filt["findings"])} of {len(pack["findings"])}')
    check("renumbers filtered ids from F1", filt["findings"][0]["id"] == "F1")

    # -- behaviour under stress -----------------------------------------
    print("\n  edges:")
    with tempfile.TemporaryDirectory() as empty:
        e = run([empty, "--json"])
        check("empty tree exits 0", e.returncode == 0)
        epack = json.loads(e.stdout)
        check("empty tree reports no findings", epack["findings"] == [])
        etext = run([empty]).stdout
        check("empty tree says so rather than implying it is clean",
              "not a clean bill of health" in etext)

    with tempfile.TemporaryDirectory() as broken:
        with io.open(os.path.join(broken, "bad.py"), "w", encoding="utf-8") as fh:
            fh.write("def f(:\n  pass\n")
        b = run([broken])
        check("a syntax error does not crash the scout", b.returncode == 0, b.stderr[:120])
        check("and it says which file it could not read", "COULD NOT READ" in b.stdout)

    missing = run(["/no/such/path"])
    check("a missing path exits 1 with a message",
          missing.returncode == 1 and "no such path" in missing.stderr)

    check("scout never writes to the tree it scans",
          sorted(os.listdir(FIXTURE)) == ["support_agent.py", "test_support_agent.py"],
          sorted(os.listdir(FIXTURE)))

    print("\n%d passed, %d failed" % (passed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
