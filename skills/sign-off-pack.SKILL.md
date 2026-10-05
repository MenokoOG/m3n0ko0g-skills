---
name: sign-off-pack
version: 0.1.0
description: Assembles the evidence a named human needs to approve an AI system going live or gaining authority. Turns scattered findings into one document with a scope statement, an evidence table, explicit residual risk, named owners, a rollback plan, and a signature block. Refuses to produce a recommendation, because a pack that recommends approval is a pack that has done the approver's job for them. Use before a go-live, before an agent gets write access, at a stage gate, or when approval keeps stalling because nobody knows what they would be signing.
license: Released by Lawrence Jefferson II for public use.
---

# Sign-Off Pack

There's a meeting where someone has to say yes. A director, a risk owner, a head of engineering. And the thing in front of them is a Slack thread, two dashboards, a confidence that the team has tested it, and a deadline.

So they ask the only question available: "are we comfortable?" Everyone says yes, because nobody wants to be the person who said no without a specific reason, and nobody has been handed the specific reasons.

That's not a governance failure. It's a documentation failure that looks like a governance failure. The evidence usually exists, scattered across six places, and nobody assembled it into something a person could actually sign.

This skill assembles it. It does not recommend. An approval pack that ends with "we recommend approval" has quietly made the decision and reduced the approver to a countersignature, which is exactly the thing that makes a sign-off worthless when it's examined later.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* The pack's job is to make the unknowns impossible to miss at the moment of signing. A pack that reads clean because the gaps were smoothed over is worse than no pack, because it converts an informal risk into a documented false assurance with a name on it.

## When to use this

Before an AI system goes live. Before an agent gets write access, spend authority, customer contact, or any irreversible action. At a stage gate. Before a scope expansion, like moving from internal users to customers, or from one region to several. After an incident, before turning the thing back on. During procurement, when you're the one being asked to sign for a vendor's system.

Also use it when approval keeps stalling. Stalling usually means the approver can't tell what they'd be accountable for. A pack with an explicit scope statement and an explicit residual risk list unblocks more decisions than another demo does.

Don't use it to manufacture approval. If the evidence isn't there, the pack shows that it isn't there. A pack whose evidence table is mostly Unknown is a valid output and a useful one, and it should be delivered rather than padded.

## The method

### Step 1: Write the scope statement first

Before gathering anything, write exactly what's being approved. One paragraph, then three lists.

The paragraph says what the system does and what changes on approval. "Approval permits the support agent to send outbound emails to customers without human review, for the accounts tier only, in the UK region, from the date of signature."

Then: what's in scope, what's explicitly out of scope, and what's assumed. Assumptions matter more than people expect, because an approval given under an assumption that later turns out false is a different decision, and the record needs to show which assumption it rested on.

Get the scope statement agreed before assembling evidence. Half the arguments in an approval meeting are actually scope disagreements surfacing at the worst moment.

### Step 2: State the authority the system holds

Approval is fundamentally about authority, so make the authority explicit and concrete.

What can the system do without a human? What can it do with a human? What can it never do, and is that enforced in code or merely intended? What's the blast radius of the worst single action it can take, and is that action reversible? Who can stop it, how fast, and has anyone tried?

That last question matters and it's almost never answered. "There's a kill switch" is a claim. "The kill switch was tested on 2026-08-14, took 40 seconds, and is documented at runbooks/stop-agent.md" is evidence.

If **Agent Gate Review** has been run, its ratings drop straight into this section and they're the strongest content in the pack.

### Step 3: Build the evidence table

One row per claim the approval rests on. Four columns: the claim, the evidence, the source, and the date.

Claims are things like: it answers correctly at an acceptable rate; it refuses out-of-scope questions; it doesn't expose personal data to the provider; it stays within a cost budget; it can be rolled back; it logs enough to diagnose a failure; it's been tested at expected load.

Evidence is a run, a score, a test, a trace, a document, or a signed statement from a named person. Evidence is not a design intention, an assurance in a meeting, or a plan to test it later.

Mark each row with a status and be strict about it.

**Evidenced.** Direct evidence exists, it's dated, and it's linked.

**Partial.** Some evidence, with a stated limit. "Load tested to 2x current peak. Expected peak after launch is 5x. Untested above 2x."

**Asserted.** Somebody says so and there's no artifact. Name who asserted it. An asserted claim with a name attached is legitimate content in an approval pack. An asserted claim presented as evidenced is not.

**Absent.** No evidence, and say what would produce it.

**Stale.** Evidence exists but predates a relevant change. Give both dates. Stale is the most dangerous status, because it reads as Evidenced at a glance.

Date every row. Undated evidence in an approval pack is a hazard, since the approver can't tell whether it describes the system in front of them.

### Step 4: Write the residual risk list

Every Absent, Partial, Stale, and Unknown from the pack becomes a residual risk. This is the section the approver is actually signing against, so it gets the most care.

Each entry needs four things: what could happen, stated concretely rather than as a category; roughly how likely, with your basis; what it would cost; and what compensating control exists, or none.

"Model drift" isn't a risk entry. This is:

*"The provider can update the model behind our pinned alias with 30 days notice. If it changes refusal behavior, the agent may begin answering questions it currently declines. There's no eval on the refusal path, so we'd find out from a customer complaint. Estimated time to notice: days to weeks. Compensating control: none. Reducing this means building the refusal eval, estimated 3 hours."*

Rank by cost times likelihood, and put the worst first. Don't bury a serious one in the middle of a list of twelve.

Include the risks of not approving, when they're real. A deprecation deadline, a contractual commitment, a manual process that's failing. An approver weighing only one side isn't being given the decision either.

### Step 5: Write the rollback and the trigger

Three things, specific.

How the change is reverted, precisely. The command, the flag, the deploy. And how long it takes.

What blocks a clean revert. Usually data: records the system wrote, emails sent, state in a downstream system. A rollback that stops the behavior but leaves 400 bad records is a partial rollback and the pack should say so.

What triggers a rollback, defined in advance with numbers and a named person who can call it without convening a meeting. A trigger agreed before launch is a decision made calmly. A trigger invented during an incident is a decision made by whoever is most senior in the room at the time.

### Step 6: Name the owners

Approval with no named owner evaporates on contact with the first problem.

Name a person, not a team, for each of: the decision to approve, ongoing operation, the rollback call, the response if it fails, and the date of the next review. A team name in any of these rows is a finding, and the pack should say so rather than accept it.

The review date deserves particular attention. An approval with no expiry becomes permanent, and a system approved in 2024 under 2024's conditions is still running in 2026 on that same signature. Put a date on it.

### Step 7: Assemble, and do not recommend

Put it together and stop. No executive summary that says it looks good. No "we believe the residual risk is acceptable," because acceptable is the approver's word and using it in the pack takes the decision from them.

The pack presents. The human decides. That separation is the entire point, and it's what makes the signature mean something if anyone examines it in two years.

## What to look for

**Evidence that's actually a plan.** "Evals will be added in Q4" is a residual risk, not evidence.

**Stale evidence.** Test results predating the last prompt change. Check the dates against the git history rather than trusting the document.

**A team named where a person is required.**

**An untested kill switch.**

**A rollback that doesn't address written data.**

**Scope creep between the demo and the pack.** The demo was internal users. The pack says customers. Different decision.

**A risk register copied from another project**, with generic entries and no specifics. Easy to spot: nothing in it mentions this system's actual mechanisms.

**No expiry date.**

**The approver not being told what they can't verify.** If the pack has six Unknowns, the approver needs those on the first page, not in an appendix.

**An assumption that a vendor's certification covers your use.** A provider's compliance posture is about their infrastructure, and it says nothing about what your system sends them or what your prompt does with it.

## The output

Write `SIGN-OFF-PACK.md`. Scope, authority, evidence, residual risk, rollback, owners, signature. The residual risk section goes above the fold, never in an appendix.

```
SIGN-OFF PACK
system:    <name> <version>        prepared: <ISO-8601>
decision:  <what approval permits, one line>
prepared by: <name>                for signature by: <name, role>

SCOPE
  Approval permits <system> to <action> for <population>, in <region>,
  from the date of signature until the review date below.

  In scope:      <list>
  Out of scope:  <list, explicit>
  Assumed:       <list. If any assumption is false, this approval does
                 not cover the resulting system.>

AUTHORITY GRANTED
  without a human    <list>
  with a human       <list>
  never              <list>   enforced in code: <yes / no, per item>
  worst single action  <concrete>   reversible: <yes / no / partially>
  stop authority     <named person>   mechanism: <how>   tested: <date or NEVER>

EVIDENCE
  claim                          status     source                      date
  answers correctly at <rate>    Partial    eval-run-2291, n=180,       2026-09-11
                                            answer path only
  refuses out of scope           Absent     no eval exists. See R1.     -
  no personal data to provider   Asserted   stated by <name>,           2026-09-02
                                            eng lead. No trace run.
  stays in cost budget           Evidenced  TOKEN-BILL.md, projected    2026-09-09
                                            and measured 14 days
  rollback works                 Evidenced  rehearsed, 40s, runbook     2026-08-14
  diagnosable on failure         Absent     retrieved chunks not        -
                                            logged. See R2.
  load tested                    Partial    to 2x peak. Launch peak     2026-08-30
                                            projected 5x. Untested.
  tone and format                Stale      eval last run 2025-04-02.   2025-04-02
                                            Prompt changed 2026-06-19.

RESIDUAL RISK      (what you are signing against)

  R1  The agent answers a question it should decline.
      Nothing tests the refusal path. With no similarity floor on
      retrieval, a corpus gap becomes a confident wrong answer sent to a
      customer with no human review.
      Likelihood: observed 2 of 12 in the failure sample.
      Cost: incorrect statement to a customer, in writing, unreviewed.
      Compensating control: none.
      To reduce: refusal eval, ~3 hours, 40 examples.

  R2  If it goes wrong, we will not be able to say why.
      Retrieved chunks are not logged. A past incident could not be
      reconstructed (see INCIDENT-REPLAY.md, cause not determinable).
      Likelihood: certain, on any retrieval-related failure.
      Cost: an incident we cannot explain to a customer or an auditor.
      Compensating control: none.
      To reduce: one log line, retriever.py:52.

  R3  Personal data reaching the provider is asserted, not traced.
      Nobody has run the trace. The claim in the evidence table rests on
      one person's recollection.
      To reduce: run the data flow trace, half a day.

  R4  Launch load is 5x anything tested.

  RISK OF NOT APPROVING
      The current manual process has a 3 day backlog and two people
      doing it. One leaves in November. This is a real cost and it
      belongs in the decision.

ROLLBACK
  how:      feature flag `agent_outbound`, off. Takes effect in 30s.
  tested:   2026-08-14, 40 seconds end to end.
  blocked:  emails already sent cannot be recalled. Tickets written can
            be reverted from the audit table.
  trigger:  any one of: a customer-reported incorrect statement; parse
            failure rate above 0.5 percent; escalation rate moving more
            than 20 percent. <Named person> calls it, no meeting needed.

OWNERS
  approves           <name, role>
  operates           <name>
  can call rollback  <name>
  responds on call   <name>
  next review        <date, maximum 90 days from signature>

WHAT THIS PACK DOES NOT TELL YOU
  R1 through R4 above are unresolved at the time of signing. This pack
  makes no recommendation. It presents what is evidenced, what is
  asserted, and what is absent.

SIGNATURE
  name:      ______________________
  role:      ______________________
  date:      ______________________
  approving the scope above, with residual risks R1-R4 accepted as
  stated, to the review date above.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       sign-off-pack
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
system:      <name and version>
evidence:    evidenced <n> / partial <n> / asserted <n> / absent <n> / stale <n>
residual:    <n> risks, <n> with no compensating control
rollback:    <tested <date> | untested | none>
owners:      <n> named persons / <n> rows left as a team
review_due:  <date or NONE SET>
human:       <pending | signed | declined>
---
```

Here `human` is the signature itself. This is the one receipt in the library where that field is the deliverable rather than an acknowledgement. It's never set by the skill, and it's never set by anyone other than the named approver.

## Rules

Never recommend approval or refusal. Present the evidence. The decision belongs to the person signing, and a pack that decides for them destroys the value of the signature.

Never write "residual risk is acceptable." Acceptable is the approver's judgment. The pack states the risk. They state the acceptance.

Never present an asserted claim as evidence. Name who asserted it and leave the status as Asserted.

Never bury the Unknowns. They go above the fold. The approver's exposure is precisely the set of things they can't verify.

Never accept a team name where a person is required. Escalate it as a finding in the pack itself.

Never issue an approval with no review date. An approval without an expiry is a permanent one, granted under conditions that will change.

Never pad a thin pack. If the evidence isn't there, deliver the pack with Absent rows. That's a true and useful document, and it's more useful than a full-looking one built on assertions.

Never let the demo's scope and the pack's scope differ without saying so in the scope statement.

---

Part of the free skills library by M3n0ko0g.

This is the pack the rest of the library feeds. **Agent Gate Review**, **Eval or Vibes**, **Data In The Prompt**, **Token Bill**, **RAG Integrity Check**, and **Incident Replay** each produce evidence rows and residual risks that drop straight into it.

LAHA, Love All Humans Always.
