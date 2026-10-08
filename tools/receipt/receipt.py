"""Write and read M3n0ko0g skill receipts. No dependencies.

The convention is in skills/TRACEABILITY.md. This is the reference implementation.

Complexity, because we ship a skill that checks it:

    write()        O(1) time, O(1) space   - one append, no read of the file
    read_all()     O(n) time, O(n) space   - n = number of records
    pending_rate() O(n) time, O(1) space   - streams, holds two counters
    supersede()    O(1) time, O(1) space   - appends, never rewrites

`pending_rate` deliberately streams rather than calling `read_all`. On a file
of a few thousand records the difference is irrelevant; the point is that the
shape stays right when the file is a few million, which is exactly when you
stop being able to fix it casually.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Literal

HumanState = Literal["pending", "accepted", "rejected"]

DEFAULT_PATH = Path("receipts.jsonl")


def _utc_now() -> str:
    """ISO-8601 in UTC, seconds precision. Local time in logs costs you an
    hour of your life during an incident."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    """A stable unique id for one receipt.

    This exists because `run_at` cannot do the job. Timestamps are not unique
   , a fast skill writes several receipts inside the same second, and a
    correction that points at a timestamp then supersedes every record sharing
    it. We shipped that bug and the tests caught it immediately.
    """
    return uuid.uuid4().hex[:12]


@dataclass(frozen=True)
class Receipt:
    """One skill run.

    `input_shape` is the shape of the input, never its content: counts, sizes,
    languages, date ranges. This is the line between telemetry and
    surveillance and the field name says so on purpose.
    """

    skill: str
    version: str
    input_shape: str
    findings: int
    unknowns: int
    recommended: str
    human: HumanState = "pending"
    run_at: str = field(default_factory=_utc_now)
    id: str = field(default_factory=_new_id)
    supersedes: str | None = None   # the `id` of the receipt this one corrects

    def __post_init__(self) -> None:
        if self.findings < 0 or self.unknowns < 0:
            raise ValueError("findings and unknowns are counts; they cannot be negative")
        if not self.skill or not self.version:
            raise ValueError("skill and version are required, an unversioned receipt cannot be compared")

    def to_json(self) -> str:
        payload = asdict(self)
        payload["input"] = payload.pop("input_shape")
        if payload["supersedes"] is None:
            del payload["supersedes"]
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def write(receipt: Receipt, path: Path = DEFAULT_PATH) -> None:
    """Append one receipt. O(1), we never read the file to write to it.

    Append-only is not a style preference. The moment records can be edited in
    place, none of them prove anything, including the correct ones.
    """
    with path.open("a", encoding="utf-8") as handle:
        handle.write(receipt.to_json() + "\n")


def stream(path: Path = DEFAULT_PATH) -> Iterator[dict]:
    """Yield records one at a time. O(n) time, O(1) space.

    Malformed lines are skipped rather than raising: a half-written line from
    a killed process should not make the whole history unreadable.
    """
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def read_all(path: Path = DEFAULT_PATH) -> list[dict]:
    """Every record, oldest first. O(n) time and space, use `stream` if the
    file is large and you only need to aggregate."""
    return list(stream(path))


def pending_rate(path: Path = DEFAULT_PATH) -> tuple[int, int, float]:
    """The only query that matters.

    Returns (pending, total, fraction_pending). If that fraction is near 1.0
    you do not have a human in the loop, you have a rubber stamp with extra
    steps. The number is uncomfortable on purpose.

    Superseded records are excluded so a correction does not get counted twice.

    O(n) time, O(s) space where s is the number of corrections, normally a
    tiny fraction of n.
    """
    superseded: set[str] = set()
    records: list[dict] = []
    for record in stream(path):
        prior = record.get("supersedes")
        if prior:
            superseded.add(prior)
        records.append(record)

    pending = total = 0
    for record in records:
        # Keyed on `id`, never on `run_at`: timestamps collide.
        if record.get("id") in superseded:
            continue
        total += 1
        if record.get("human", "pending") == "pending":
            pending += 1

    return pending, total, (pending / total if total else 0.0)


def supersede(original_id: str, corrected: Receipt, path: Path = DEFAULT_PATH) -> None:
    """Correct an earlier receipt by appending a replacement. O(1).

    `original_id` is the `id` of the receipt being corrected. The new record
    gets its own fresh id, so corrections can themselves be corrected.
    """
    write(
        Receipt(
            skill=corrected.skill,
            version=corrected.version,
            input_shape=corrected.input_shape,
            findings=corrected.findings,
            unknowns=corrected.unknowns,
            recommended=corrected.recommended,
            human=corrected.human,
            run_at=corrected.run_at,
            supersedes=original_id,
        ),
        path,
    )


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH
    waiting, seen, fraction = pending_rate(target)
    if seen == 0:
        print(f"No receipts in {target}. Nothing has run, or nothing is recording.")
        raise SystemExit(0)

    print(f"{waiting} of {seen} runs never reviewed by a human ({fraction:.0%}).")
    if fraction > 0.5:
        print("More than half your agent runs were never looked at.")
        print("That is not human-in-the-loop. Worth fixing before it matters.")
