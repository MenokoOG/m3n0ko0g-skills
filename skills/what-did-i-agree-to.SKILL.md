---
name: what-did-i-agree-to
version: 0.1.0
description: Extract every commitment you made from a thread, transcript, or meeting notes, who you owe it to, by when, and which ones are dangerously vague. Separates what you actually promised from what someone may have heard as a promise. Use after a long email thread, a call you half-remember, a Slack channel you were tagged into, or any meeting that ended with "great, sounds good."
license: Released by Lawrence Jefferson II for public use.
---

# What Did I Agree To

Most dropped balls are not forgotten tasks. They are sentences that sounded like thinking out loud to the person saying them and sounded like a commitment to the person hearing them.

"I'll take a look at that" is not a promise. It is also, reliably, received as one.

This skill reads a thread, a transcript, or a pile of notes, and gives you back what you are now on the hook for, including the parts you would not have written down, because you did not notice you had agreed to them.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Where no date was stated, this skill says "no date stated." It never invents a deadline, never upgrades a maybe into a yes, and never guesses at an owner. A fabricated due date is worse than no due date, because you will trust it.

## When to use this

Run it after a long email thread closes, after a call where a lot was covered quickly, at the end of a week across your sent messages, before a status update where you need to be honest about what is outstanding, or the moment you get a sinking feeling that you said yes to something and cannot remember what.

It is also worth running *before* a meeting, over the previous meeting's notes, so you walk in knowing what you already owe.

Do not use it as a task manager. It extracts commitments; it does not track them. Put the output somewhere that does.

## What counts as a commitment

A commitment is a future action attributable to a specific person. It has three parts, and any of them may be missing from the source, which is itself the useful finding.

**The action.** What will be done. Vague verbs are a warning sign: "look into", "circle back on", "think about", "get some clarity on". These get flagged rather than dropped, because vague verbs are precisely where expectations diverge.

**The owner.** Who does it. "We should" almost never means "I will," and it is one of the most common sources of a task that nobody picks up. If a commitment is phrased in the collective and never assigned, that is a finding.

**The deadline.** When. Note the difference between a stated date ("by Thursday"), a relative date ("end of next week", resolve it only if the source is dated, and say what you resolved it against), a soft date ("soon", "shortly", "once the other thing lands"), and no date at all. Never promote a soft date to a hard one.

## The method

### Step 1: Establish who "I" is

Ask, or determine from the source, whose commitments are being extracted. In a thread with six people this is the whole basis of the analysis, and getting it wrong makes the output worse than useless.

Also note the date of the source. Without it, every relative deadline stays unresolved, and it should.

### Step 2: Read for commitment language, not for topics

Go through the source in order and mark every future-tense statement, every acceptance of a request, and every silence that followed a direct ask.

That last one matters. When somebody writes "can you have that to me by Friday?" and the reply is about something else entirely, no commitment was made and no refusal was given either. That is an open loop, and open loops belong in the output.

### Step 3: Sort into four buckets

**You committed.** Clear, attributable, future action by you. Include the quote.

**Others committed to you.** The reverse, things you are waiting on. These are what you chase, and people consistently forget to track them.

**Ambiguous.** You said something that could reasonably be read as a commitment and could reasonably be read as musing. This is the highest-value bucket in the whole output. For each one, give the quote, say how it could be read both ways, and name the person most likely to be holding you to it.

**Open loops.** A direct ask that was never answered either way.

### Step 4: Quote, never paraphrase

Every item carries the source quote verbatim. Paraphrase is how a soft statement quietly becomes a hard one between the source and the summary, which is exactly the failure this skill exists to prevent.

If the source is long, cite location as well: message number, timestamp, or speaker turn.

### Step 5: Do not resolve the ambiguity for them

It is not this skill's job to decide whether "I'll take a look" was a yes. It is this skill's job to surface that the question exists and let a person answer it.

Where an ambiguous item looks consequential, suggest the one-line message that would settle it. Do not send it, and do not assume the answer.

## The output

```
SOURCE     #product-launch, 47 messages, 3–7 Aug 2026
YOU        Dana Okafor
DATED      Yes, relative deadlines resolved against 7 Aug

YOU COMMITTED (3)

  1. Send Marcus the revised pricing sheet
     Owed to   Marcus Bell
     Due       Tue 11 Aug          (stated: "start of next week")
     Quote     "yep, I'll get you the revised sheet start of next week"
     Where     msg 31

  2. Review the onboarding copy
     Owed to   Priya Raman
     Due       NO DATE STATED
     Quote     "happy to review the onboarding copy when it's ready"
     Where     msg 12
     Note      Conditional on Priya sending it. She has not yet.

WAITING ON YOU FROM OTHERS (1)

  1. Marcus to confirm the vendor discount before you can finish the sheet
     Due       NO DATE STATED
     Quote     "let me check what discount we can actually offer"
     Where     msg 29
     Note      This blocks your item 1. Chase it before Monday.

AMBIGUOUS: READ THESE FIRST (2)

  1. "I can probably pull the Q3 numbers together too"
     Where     msg 38
     Reads as  Musing about capacity, if you wrote it.
     Reads as  A yes, if Priya read it, she replied "amazing, thank you!"
               and has not mentioned it since.
     Held by   Priya Raman
     Settle    "Just to check, did you want the Q3 numbers from me, and
               by when?"

OPEN LOOPS (1)

  1. Marcus asked whether launch slips if legal review runs long.
     Where     msg 44
     Status    Never answered by anyone. Still open.
```

Lead with `YOU COMMITTED` because it is what people came for. Put `AMBIGUOUS` above `OPEN LOOPS` because it is where the damage actually happens.

If a bucket is empty, print it with `(none)`. An empty ambiguity list is information, it means the thread was unusually clear, and that is worth knowing.

## Run record

Every run emits a receipt, per `TRACEABILITY.md` in this repository.

```
--- M3n0ko0g skill receipt ---
skill:       what-did-i-agree-to
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <source type>, <n> messages, <date range>   # shape only, never content
findings:    committed=<n> waiting=<n> ambiguous=<n> open=<n>
unknowns:    <n>   # every NO DATE STATED and unresolved owner counts here
recommended: <review-ambiguous | none>
human:       <pending | accepted | rejected>
---
```

The receipt never contains message content. It records that a run happened, over how much, and what it produced. Anyone auditing later can see the shape of the work without reading a private thread, which is the difference between telemetry and surveillance.

## Rules

Never invent a deadline. "No date stated" is the correct output and it is more useful than a guess.

Never promote a soft commitment to a hard one. If the words were soft, the output says soft and the item goes in Ambiguous.

Never drop an item because it seems minor. The forgotten small promise is the one that costs trust.

Never attribute a commitment to someone whose name does not appear next to it in the source.

Never paraphrase a quote. Copy it.

If the source is missing a date and contains relative deadlines, say that resolution was not possible rather than picking a date.

---

Part of the free skills library by M3n0ko0g.

LAHA: Love All Humans Always.
