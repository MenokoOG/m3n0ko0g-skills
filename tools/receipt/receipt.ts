/* Write and read M3n0ko0g skill receipts. No dependencies.
 *
 * The convention is in skills/TRACEABILITY.md. This is the reference implementation.
 *
 * Complexity, because we ship a skill that checks it:
 *
 *   write()        O(1) time, O(1) space  - one append, the file is never read
 *   readAll()      O(n) time, O(n) space  - n = number of records
 *   pendingRate()  O(n) time, O(s) space  - s = number of corrections
 *   supersede()    O(1) time, O(1) space  - appends, never rewrites
 *
 * Note `pendingRate` builds a Set of superseded ids rather than calling
 * `.includes()` on an array inside the loop. That would be the textbook
 * accidental quadratic — and shipping one inside the traceability tool for a
 * repo containing `hot-path` would be embarrassing.
 */

import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export type HumanState = "pending" | "accepted" | "rejected";

export const DEFAULT_PATH = "receipts.jsonl";

export interface Receipt {
  skill: string;
  version: string;
  /** Shape of the input, never its content: counts, sizes, languages, date
   *  ranges. This is the line between telemetry and surveillance. */
  input: string;
  findings: number;
  unknowns: number;
  recommended: string;
  human: HumanState;
  /** ISO-8601, UTC. Local time in logs costs you an hour during an incident. */
  run_at: string;
  /** Stable unique id for this record. See `newId` for why `run_at` cannot
   *  serve this purpose. */
  id: string;
  /** The `id` of the receipt this one corrects. Corrections append. */
  supersedes?: string;
}

/** ISO-8601 in UTC, seconds precision. */
function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A stable unique id for one receipt.
 *
 *  This exists because `run_at` cannot do the job. Timestamps are not unique —
 *  a fast skill writes several receipts inside the same second, and a
 *  correction pointing at a timestamp then supersedes every record sharing it.
 *  We shipped that bug and the tests caught it immediately. */
function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function makeReceipt(
  fields: Omit<Receipt, "human" | "run_at" | "id"> &
    Partial<Pick<Receipt, "human" | "run_at" | "id">>,
): Receipt {
  if (!fields.skill || !fields.version) {
    throw new Error("skill and version are required — an unversioned receipt cannot be compared");
  }
  if (fields.findings < 0 || fields.unknowns < 0) {
    throw new Error("findings and unknowns are counts; they cannot be negative");
  }
  return { human: "pending", run_at: utcNow(), id: newId(), ...fields };
}

/** Append one receipt. O(1) — the file is never read in order to write it.
 *
 *  Append-only is not a style preference. The moment records can be edited in
 *  place, none of them prove anything, including the correct ones. */
export async function write(receipt: Receipt, path = DEFAULT_PATH): Promise<void> {
  await appendFile(path, JSON.stringify(receipt) + "\n", "utf8");
}

/** Every record, oldest first. O(n).
 *
 *  Malformed lines are skipped rather than thrown: a half-written line from a
 *  killed process should not make the whole history unreadable. */
export async function readAll(path = DEFAULT_PATH): Promise<Receipt[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const out: Receipt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Receipt);
    } catch {
      continue;
    }
  }
  return out;
}

export interface PendingReport {
  pending: number;
  total: number;
  /** 0.0 to 1.0. Near 1.0 means nobody is reading the output. */
  fraction: number;
}

/** The only query that matters.
 *
 *  If `fraction` is near 1.0 you do not have a human in the loop, you have a
 *  rubber stamp with extra steps. The number is uncomfortable on purpose.
 *
 *  Superseded records are excluded so a correction is not counted twice. */
export async function pendingRate(path = DEFAULT_PATH): Promise<PendingReport> {
  const records = await readAll(path);

  // Set, not an array — `.includes()` inside the loop below would be O(n^2).
  const superseded = new Set<string>();
  for (const record of records) {
    if (record.supersedes) superseded.add(record.supersedes);
  }

  let pending = 0;
  let total = 0;
  for (const record of records) {
    // Keyed on `id`, never on `run_at` — timestamps collide.
    if (superseded.has(record.id)) continue;
    total += 1;
    if ((record.human ?? "pending") === "pending") pending += 1;
  }

  return { pending, total, fraction: total === 0 ? 0 : pending / total };
}

/** Correct an earlier receipt by appending a replacement. O(1).
 *
 *  `originalId` is the `id` of the receipt being corrected. The replacement
 *  gets its own fresh id, so corrections can themselves be corrected. */
export async function supersede(
  originalId: string,
  corrected: Omit<Receipt, "id" | "supersedes">,
  path = DEFAULT_PATH,
): Promise<void> {
  await write({ ...corrected, id: newId(), supersedes: originalId }, path);
}
