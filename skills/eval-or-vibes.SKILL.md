---
name: eval-or-vibes
version: 0.1.0
description: Sorts every check on an AI system into Eval, Smoke, Vibe, or None, and tells you which failures would currently ship unnoticed. Then names the cheapest eval that would have caught the last incident. Use before a model swap, before a prompt change on a system you inherited, or when someone asks whether the system is tested and the answer takes more than one sentence.
license: Released by Lawrence Jefferson II for public use.
---

# Eval or Vibes

Ask a team whether their AI feature is tested and you'll usually get a yes. Push once and it turns into "well, we try it before we ship." Push twice and you find a file called `test_prompts.py` that asserts the response isn't empty.

That's not a criticism. Writing evals for a generative system is genuinely harder than writing unit tests, and in 2023 nobody knew how. The problem isn't that the evals are thin. The problem is that everybody believes they're thicker than they are, so a model swap gets approved on the strength of testing that doesn't exist.

This skill puts a number on it. Every check gets sorted into one of four buckets, and then the report answers one question: what could break right now without anyone noticing?

**Operating law:** *unknown data must increase decision discipline, not model confidence.* A test suite tells you what's checked. It can't tell you what users actually do, which failures cost money, or whether the assertions still mean anything. Where that's unknown, this skill writes Unknown rather than reporting a coverage percentage that would be fiction.

## When to use this

Before a model swap or version bump. Before changing a prompt on a system you didn't write. Before giving an agent more authority. After an incident, to answer honestly whether it was catchable. During due diligence on a system somebody else built, where "is it tested" is a question with real money behind it.

Also run it when a team wants to invest in evals and doesn't know where to start. The answer is almost never "build a comprehensive suite." It's usually one or two specific checks, and this pass finds them.

Don't use it to score a team. A report that reads as a report card gets argued with instead of acted on. The deliverable is a gap list, not a grade.

## The four buckets

Every check in the repository lands in exactly one. The definitions are strict on purpose, because the whole value of this skill is refusing to let a Smoke test be counted as an Eval.

**Eval.** Runs on a fixed dataset with expected outcomes, produces a score, and has a threshold that fails the build or blocks a deploy. Three parts, all required. Fixed inputs, graded outputs, a gate. A scored run nobody looks at is not an Eval, because nothing happens when it drops.

**Smoke.** Checks the system runs. Asserts a response came back, parsed as JSON, had the right shape, didn't throw, finished under a timeout. Genuinely useful, catches real outages, and says nothing whatsoever about quality. A smoke test passes happily while the model returns beautifully-formatted nonsense.

**Vibe.** A human tried it and it looked fine. Includes the manual QA pass before release, the demo, the founder trying five questions, and the markdown file of example prompts somebody checked in and nobody runs. Vibes catch things automation misses and they don't scale, don't gate, and vanish when the person who does them is on holiday.

**None.** Nothing checks this path at all.

Two more marks you'll need often:

**Stale.** An Eval whose dataset, threshold, or expected outputs no longer match the system. A regression suite built for a prompt that was rewritten twice since is Stale. Stale sits worse than None, because None is honest and Stale gives people confidence they haven't earned.

**Unknown.** You couldn't determine whether a check exists, usually because the CI config or the test runner isn't visible. Mark it and move on. Don't infer.

## The method

### Step 1: List the behaviors, not the tests

Start from what the system does, not from what's in the test directory. Starting from the tests means you only find coverage for things somebody already thought of, which defeats the point.

Walk the paths a request can take and write down each distinct behavior. For a support agent that might be: classifies intent, retrieves relevant docs, drafts an answer, decides whether to escalate, refuses out-of-scope questions, handles a hostile user, handles a question the corpus can't answer, redacts personal data, stays inside a token budget.

Include the refusal behaviors and the failure behaviors. Those are the least tested and the most expensive when they break. "Says I don't know when it doesn't know" is a behavior, it's the one everybody assumes works, and it's almost never checked.

### Step 2: Sort every check

Find everything that could be a check: unit tests, integration tests, CI jobs, eval scripts, notebooks, golden files, LLM-as-judge harnesses, manual QA docs, release checklists, canary deployments, and production monitors.

Assign each to a behavior from Step 1 and to a bucket. One bucket each, the highest one it genuinely earns. When you're tempted to call something an Eval because it has the word eval in the filename, check for the gate. No gate, no Eval.

Two things to check on anything that looks like a real Eval. Does it actually run, meaning is it wired into CI or a scheduled job, or does it require somebody to remember? And when did it last run and pass? A suite that's been red or skipped for four months is Stale.

### Step 3: Judge the judge

If the system uses LLM-as-judge grading, it needs its own scrutiny, because an unvalidated judge is a random number generator with good manners.

Ask: has the judge been checked against human labels, and on how many examples? Does it score with a rubric or a bare "is this good?" Is the judge model pinned, or will a provider update silently move every score? Does it grade the same model family it's grading, which tends to inflate. Does anyone spot-check judge output, or is the number taken on faith?

An LLM judge validated against 50 human-labeled examples with reported agreement is a legitimate Eval. An unvalidated one is a Vibe with a decimal point, and it should be reported that way.

### Step 4: Find the silent failures

This is the section people actually read. For each behavior with None, Vibe, or Stale coverage, write the concrete failure that would ship unnoticed.

Not "escalation is untested." Instead: *"If the escalation prompt stops triggering, tickets that need a human sit in the queue until a customer complains. Nothing in CI, nothing in monitoring, and nothing in the weekly report would show it. Estimated time to notice: days."*

Rank these by cost, not by how uncovered they are. A completely untested internal summarizer matters less than a thinly tested refusal path on a customer-facing agent.

Add a time-to-notice estimate for each: minutes, hours, days, never. "Never" is the finding that changes behavior in the room.

### Step 5: Name the cheapest eval that pays

Close with two or three specific evals, ordered by value per hour of work. For each: what it checks, roughly how many examples it needs, where the examples come from, what the threshold should be, and which silent failure it converts from invisible to blocking.

Be realistic about where examples come from. "Collect 200 labeled examples" is advice nobody follows. "Pull the 40 tickets from last quarter where the agent escalated wrongly, they're already labeled by what the human did next" is advice somebody does on a Tuesday.

If an incident happened recently, work backwards from it. The cheapest eval to justify is the one that would have caught the thing that already hurt.

## What to look for

**Assertions that can't fail.** `assert response is not None`. `assert len(output) > 0`. `assert "error" not in response.lower()`. These pass on garbage. Count them as Smoke and say so.

**Golden files regenerated on failure.** If the workflow when a test fails is to re-record the expected output, the test never fails. It's a Vibe with a diff view.

**Evals that run on 5 examples.** Below roughly 30, a score moves on noise. Report the n. A 20 percent regression on 5 examples is one example.

**Temperature above 0 in an eval** with no repeats and no variance reported. The score is partly a dice roll.

**Test data drawn from the prompt's own few-shot examples.** The system was shown the answers.

**No eval on the refusal path.** Near-universal, and it's the behavior that keeps a system out of trouble.

**No eval on cost or latency.** A prompt change that triples token use passes every quality check.

**Production monitoring counted as testing.** Monitors catch failures after users do. Useful, different thing, and it belongs in its own row.

**Nothing that checks the system's behavior on inputs it wasn't designed for.** Empty input, a novel, another language, an injection attempt, a question about a competitor.

## The output

Write `EVAL-OR-VIBES.md`. The coverage table first, the silent failures second, the cheap wins last. Anyone skimming should get the shape from the table and the urgency from the failures.

```
EVAL OR VIBES
system:  <name>            date: <ISO-8601>
checks found: <n>          behaviors identified: <n>

TALLY     Eval 2  |  Smoke 9  |  Vibe 4  |  Stale 1  |  None 6  |  Unknown 1

COVERAGE BY BEHAVIOR
  behavior                       bucket   gate?  last run     n
  intent classification          Eval     yes    2026-09-11   180
  document retrieval             None     -      -            -
  answer drafting                Vibe     no     manual QA    ~6
  escalation decision            None     -      -            -
  refusal / out of scope         None     -      -            -
  "I don't know" on no-answer    None     -      -            -
  PII redaction                  Eval     yes    2026-09-11   64
  token budget                   Smoke    yes    2026-09-11   -
  hostile user handling          Vibe     no     ad hoc       -
  tone and format                Stale    no     2025-04-02   40
  latency                        Smoke    yes    2026-09-11   -
  cost per request               None     -      -            -

JUDGE
  tone eval uses gpt-4-turbo as judge. Unvalidated against human labels.
  Judge model unpinned. Reclassified from Eval to Vibe. Its number has
  been quoted in three release notes.

WHAT SHIPS UNNOTICED  (ranked by cost)

  S1  Escalation stops firing.                        notice: days
      Tickets needing a human sit in the queue. No test, no monitor, no
      alert. Found only when a customer escalates a second time, angrily.

  S2  The system stops saying "I don't know."         notice: never
      With no floor on retrieval and no eval on refusal, a corpus gap
      becomes a confident wrong answer. Nothing in the system distinguishes
      that from a correct one. This is invisible by construction.

  S3  A prompt edit triples token cost.               notice: next invoice
      No cost eval. Quality tests pass. Found in accounting.

  S4  Retrieval quality drops after an index rebuild. notice: never
      Nothing checks retrieval. Answers get worse gradually and the team
      concludes the model got worse.

CHEAPEST EVALS THAT PAY

  E1  Escalation decision.  ~60 examples, 2 hours.
      Source: last quarter's tickets, already labeled by whether a human
      took over. Threshold: recall on should-escalate above 0.9, gate the
      deploy. Converts S1 from days-to-notice into build-blocking.

  E2  Refusal on no-answer questions.  ~40 examples, 3 hours.
      Source: write 40 questions the corpus provably cannot answer.
      Threshold: says it doesn't know on 95 percent. Kills S2.

  E3  Cost per request.  ~20 examples, 30 minutes.
      Assert mean tokens per request under a ceiling. Cheapest check in
      this report and it never stops earning.

RECOMMENDED NEXT STEP
  One thing: build E1. The examples already exist and are already labeled.
  It is the only silent failure in this report that is currently costing
  money every week.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository. Emit it even when coverage is good.

```
--- M3n0ko0g skill receipt ---
skill:       eval-or-vibes
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <n> behaviors, <n> checks found      # shape only, never test content
tally:       eval <n> / smoke <n> / vibe <n> / stale <n> / none <n> / unknown <n>
silent:      <n> failures that would ship unnoticed (<n> marked notice: never)
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

`human` starts at `pending` and is only ever set by a person.

## Rules

Never count a Smoke test as an Eval because the file is named `eval_something.py`. The bucket is decided by what the check does, never by what it's called.

Never report a coverage percentage. Percentages invite an argument about the denominator and hide which specific thing is uncovered. The table and the silent failure list carry the message.

Never mark something covered without checking whether it runs and whether it gates. A green suite that nobody runs is not coverage.

Never recommend "build a comprehensive eval suite." It's true, it's useless, and nobody does it. Name two or three specific evals with a source of examples.

Never call an unvalidated LLM judge an Eval. Say what validating it would take: a sample size and a human-agreement number.

Never soften a None. If nothing tests the refusal path, write None and write the failure it allows. Softening it is how the report gets filed and forgotten.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Model Swap Blast Radius** (which runs after this, since a swap without evals is a swap you can't verify) and **Agent Gate Review**.

LAHA, Love All Humans Always.
