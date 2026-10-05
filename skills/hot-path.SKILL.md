---
name: hot-path
version: 0.1.0
description: Find the line that makes a function slow. Reads Python or TypeScript, reports time and space complexity, names the exact expression responsible, and gives the rewrite with its new complexity. Also says when the optimization is not worth doing. Use on any function that feels slow, before a performance review, or when a code review says "this looks O(n squared)" and nobody wants to re-derive it.
license: Released by Lawrence Jefferson II for public use.
---

# Hot Path

Everyone half-remembers Big-O. Almost nobody wants to sit down at 4pm and re-derive it for the function that just timed out in staging.

The useful answer is never "this is O(n^2)." The useful answer is *"line 7 — the `.includes()` inside the loop — here is the version that isn't."* This skill gives that answer, and it tells you when to leave the code alone.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Reading code statically cannot tell you how big `n` gets, how often the function runs, or whether it is on a hot path at all. Where that is unknown, this skill says so instead of asserting a speedup it cannot predict.

## When to use this

Reach for it when a function is slow and you want to know why, when a review flags complexity and you want the specific line, when you are choosing between two implementations, or when you want to check that a refactor did not quietly make things worse.

Do not use it as a profiler. A profiler measures what actually happened; this reads structure and tells you what *will* happen as input grows. Both are useful and they answer different questions. If you already have profiler output, bring it — measured evidence outranks static reading every time.

## The method

### Step 1 — Establish what you cannot see

Before analysing anything, write down what is unknown about the runtime picture.

How large does the input actually get: ten items, ten thousand, ten million? How often is this called — once at startup, or per request? Is the input already sorted, already unique, already indexed? Are the collections in scope local, or references to something much larger?

If the caller has not said, ask, or mark it Unknown and carry it through to the verdict. A complexity finding without a sense of scale is trivia. O(n^2) on a list of five is free. O(n log n) on a billion is a budget line.

### Step 2 — Walk the structure, not the vibes

Read the function and build the cost model from the code, bottom up.

Identify every loop and its bound. Identify every operation *inside* a loop whose own cost is not constant. Identify recursion and whether it branches. Identify every allocation that scales with input. Then multiply the nesting rather than guessing it.

The mistake to avoid is reading a single flat `for` loop, calling it O(n), and never checking what the body does. Nearly every accidental quadratic in real code is a linear-looking loop with a linear operation hidden inside it, wearing a short method name.

### Step 3 — Name the line

The finding is worthless unless it points at an expression. Report the line number and quote the expression itself.

Not "there is a nested lookup." Instead: *line 7, `if item in seen_list:` — `in` on a list is O(n), inside a loop over n items, so this is the quadratic.*

If several lines contribute, rank them. Fixing the dominant term is the whole job; the rest is noise until the dominant term is gone.

### Step 4 — Give the rewrite

Produce actual code, not a description of code. It must be a drop-in replacement with the same observable behaviour: same return value, same exceptions, same side effects, same ordering guarantees if any were relied on.

State the new complexity for time and space. If the fix trades space for time — most of them do — say what it now costs in memory. A rewrite that turns an O(n^2) time problem into an O(n) memory problem on a memory-constrained box is not automatically a win.

If behaviour cannot be preserved exactly, stop and say so at the top of the output. A faster function that returns things in a different order is a bug with good benchmarks.

### Step 5 — Say when not to bother

This step is what separates advice from noise, and it is not optional.

Recommend leaving the code alone when `n` is small and bounded by something structural — a config file, a list of weekdays, a fixed set of regions. When the function runs once at startup. When the quadratic sits behind a network call that dominates the time anyway. When the clear version is materially easier to read and the input cannot realistically grow.

Say it plainly: *"This is O(n^2), and you should leave it. `n` is the number of database columns. It will never exceed sixty, and the loop is clearer than the Set version."*

Premature optimisation is not a myth. It is a real cost paid in readability, in review time, and in the bugs that live in clever code. Only recommend a change when the growth curve actually matters at this input size and this call frequency.

## What to look for

### Python

The recurring accidental quadratics: membership tests with `in` against a `list` or `tuple` inside a loop, where a `set` is O(1) instead of O(n). `list.pop(0)` or `list.insert(0, x)` in a loop, each O(n) — `collections.deque` gives O(1) at both ends. String building with `s += part` inside a loop, which reallocates every iteration, where `"".join(parts)` is linear. `list.remove()` or `del list[i]` inside a loop over that same list, which is both quadratic and a correctness bug waiting to happen.

Also: `sorted()` or `max()` called inside a loop when the value does not change between iterations. Re-materialising a generator to call `len()` on it. A nested loop over two collections where a dict keyed on the join field collapses it to linear. Dataframe work using `.iterrows()`, or building a frame by concatenating inside a loop instead of collecting once and concatenating at the end.

On space: comprehensions that materialise a whole dataset where a generator expression would stream it, `.readlines()` on a large file instead of iterating the handle, and unbounded caches or memo dicts that never evict.

### TypeScript and JavaScript

The recurring accidental quadratics: `Array.prototype.includes` or `indexOf` inside a loop, where a `Set` is O(1). `.find()` inside a loop over another array — the classic nested join; build a `Map` once and look up. `.shift()` in a loop, O(n) per call. Spread accumulation, `acc = [...acc, item]` inside a `reduce` or loop, which copies the entire accumulator every iteration; this is a very common quadratic hiding in otherwise tidy functional code, and the fix is to push into an array or concat once at the end.

Also: `.splice()` inside a loop over the same array. Chained `.filter().map().find()` passes over a large array where one pass would do — usually a constant-factor issue rather than a complexity one, so say which. `Object.keys()` or `JSON.parse` recomputed inside a loop on unchanged data. Sorting inside a loop. `new RegExp` constructed per iteration instead of once outside it.

On space: retaining whole arrays in closures that outlive them, unbounded `Map` caches, and building large intermediate arrays where an iterator or generator would stream.

## The output

Return one block per function analysed. Keep it short enough to read inside a code review.

```
FUNCTION      dedupe_orders  (orders.py:14)
TIME          O(n^2)  ->  O(n)
SPACE         O(1)    ->  O(n)     (a set of seen ids)

THE LINE      orders.py:17
              if order.id in seen:
              `seen` is a list, so `in` is O(n) — inside a loop over n orders.

THE REWRITE
              seen = set()
              out = []
              for order in orders:
                  if order.id in seen:
                      continue
                  seen.add(order.id)
                  out.append(order)
              return out

              Order is preserved. Behaviour is identical.

UNKNOWN       How large `orders` gets. Not stated, and not visible from this
              file. At n = 100 the current version is fine; at n = 100,000 it
              is roughly 5 billion comparisons in the worst case.

WORTH IT?     Yes, if orders can exceed a few thousand. The rewrite is the
              same length and no harder to read, so there is little reason
              not to take it either way.
```

When the honest answer is "leave it," say that in `WORTH IT?` and do not soften it. A recommendation to change nothing is a real finding.

## Run record

Every run of this skill ends by emitting a receipt, per `TRACEABILITY.md` in this repository. Emit it even when the finding is "leave it alone" — a skill that only logs when it found something teaches you nothing about how often it runs.

```
--- M3n0ko0g skill receipt ---
skill:       hot-path
version:     0.1.0
id:          <12 random hex chars — corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <language>, <n> function(s), <n> lines   # shape only, never the source
findings:    <n>  (dominant: <complexity class>)
unknowns:    <n>  # every Unknown from Step 1 counts here
recommended: <changed | leave-as-is | behaviour-change-flagged>
human:       <pending | accepted | rejected>
---
```

`human` starts at `pending` and is only ever set by a person. The skill does not mark its own work accepted. That field is the entire point of the receipt.

## Rules

Never claim a speedup you have not reasoned through. Give the complexity class, not a multiplier, unless benchmarks were provided.

Never report a complexity without naming the line that causes it.

Never hand back a rewrite that changes observable behaviour without flagging it in bold at the top of the output.

Never optimise for its own sake. If `n` is bounded and small, say so and stop.

If the code calls into a library whose complexity you cannot verify, mark it Unknown rather than assuming. The complexity of someone else's function is not knowable by reading yours.

---

Part of the free skills library by M3n0ko0g.

For a static Big-O estimator that runs over whole Python codebases as a CLI, an agent tool, or an MCP server, see **Asymptote**.

LAHA — Love All Humans Always.
