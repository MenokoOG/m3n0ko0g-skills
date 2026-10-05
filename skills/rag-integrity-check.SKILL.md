---
name: rag-integrity-check
version: 0.1.0
description: Audits a retrieval-augmented generation pipeline you inherited. Checks the chunking, the embedding model, index freshness, the retrieval-to-answer gap, and whether citations point at text that actually says the thing. Reports which failures are retrieval failures and which are generation failures, because the fix is completely different. Use when a RAG system gives confident wrong answers and nobody can tell which stage broke.
license: Released by Lawrence Jefferson II for public use.
---

# RAG Integrity Check

RAG v1 got built fast, in 2023, by someone who read a tutorial. Split on 1,000 characters, embed with whatever was default, stuff the top 5 into the prompt, ship it. And it worked well enough in the demo that nobody went back.

Two years later it gives a confident wrong answer to a customer and the room splits into two camps. One says the model hallucinated. The other says the search is bad. Both are guessing, because the system logs an answer and never logs what it retrieved.

This skill settles that argument with evidence. It separates retrieval failures from generation failures, because a retrieval failure and a generation failure look identical from the outside and have nothing in common as fixes.

**Operating law:** *unknown data must increase decision discipline, not model confidence.* Reading a pipeline's code tells you how it's wired. It cannot tell you whether the right chunk was in the index, whether the embedding model still matches the one that built it, or whether users are asking the questions you tested on. Where that's unknown, this skill writes Unknown and says what measurement would resolve it.

## When to use this

When a RAG system gives wrong answers and nobody can say which stage failed. Before swapping the embedding model, which is the highest-risk change in a RAG system and the one most often done casually. Before an audit that asks "where did this answer come from." When the corpus has grown 10x since launch and nobody re-tuned anything. When retrieval was tuned on a document set that no longer resembles what's in there.

Also when someone proposes fine-tuning to fix accuracy. Most of the time the problem is retrieval and the fine-tune is an expensive way to not fix it. Run this first.

Don't use it as a benchmark. It doesn't produce a recall number unless you have labeled data, and if you don't have labeled data, that absence is itself the top finding.

## The method

### Step 1: Establish the five things you can't see from the code

Write these down before analyzing anything, and carry any that stay unanswered into the report.

What questions do users actually ask? Not the ones in the test fixture. The real distribution.

What's the corpus now: how many documents, what formats, what date range, how fast does it change, and how stale is the index against the source?

Is there any labeled data at all, meaning question-to-correct-document pairs? If not, nobody in this system can measure retrieval quality, and every statement about it is a guess.

Does the pipeline log retrieved chunks alongside the answer? If it doesn't, no past failure can ever be diagnosed. That's usually the most important finding in the whole report.

What does a wrong answer cost here? A wrong answer in an internal search tool and a wrong answer on a medical dosage question are the same bug with wildly different budgets.

### Step 2: Read the ingestion path

Walk the pipeline from source document to stored vector.

**Parsing.** What extracts text, and what does it lose? PDF extraction routinely destroys tables, drops multi-column layout into interleaved nonsense, and silently produces nothing for scanned pages. HTML extraction often keeps navigation and cookie banners, which then embed as content and pollute retrieval. Check whether any document produced zero or near-zero text, and whether anyone would know if it had.

**Chunking.** Record the strategy, size, overlap, and whether it respects structure. Fixed-size character splitting cuts sentences and tables in half. A chunk that starts mid-sentence retrieves badly and reads worse when the model quotes it. Check whether headings, section titles, or document titles survive into the chunk. A chunk that says "it must be renewed within 30 days" with no indication of what "it" is will retrieve for the wrong query and answer the wrong question.

**Metadata.** What's stored beside the vector: source id, title, section, date, permissions, version? Missing date metadata means the system can't prefer current over superseded. Missing permission metadata means retrieval can't be filtered by who's asking, which is a security finding, not a quality one.

**Embedding.** Record the exact model and version used to build the index, and the exact model used at query time. If they differ in any way, that's the top finding and everything else is noise until it's fixed. Also check: is the index versioned against the embedding model at all, or would a library upgrade silently change the query embedding while leaving the stored vectors as they were?

**Freshness.** How does a changed source document reach the index? A nightly full rebuild, an event-driven update, or a manual script someone ran in 2024? Deletion is the one people forget. If a document is removed at the source and the vector stays, the system will keep citing a document that no longer exists.

### Step 3: Read the retrieval path

**The query.** Is the user's raw text embedded directly, or rewritten first? Raw-text embedding fails hard on short queries, on follow-ups that reference prior turns ("what about for contractors?"), and on keyword-shaped queries like an error code or a part number. Note whether there's any hybrid keyword search. Pure dense retrieval misses exact-match queries, and exact-match queries are a large share of real traffic.

**Top-k and thresholds.** Record k, any similarity floor, and any reranking. A fixed k with no floor means the system always returns 5 chunks, including when nothing in the corpus is relevant. That's the mechanism behind most confident wrong answers: the model gets 5 irrelevant chunks and no signal that they're irrelevant, so it answers from them.

**Filtering.** Does retrieval respect permissions, date, or document status? Check the code path, not the design doc. A permission filter applied in the UI but not in retrieval means the model saw text the user isn't allowed to see, and models quote what they're given.

**The assembly.** How do retrieved chunks land in the prompt? Are they delimited, labeled with a source id, ordered by score, truncated? Check what happens when the chunks exceed the context budget. Silent truncation of the last chunk is common and means the system sometimes drops the most relevant result without a word.

### Step 4: Read the generation path against the retrieval

This is where the two failure classes separate.

Take a sample of real failures if you can get them. For each one, answer in order:

Was the answer-bearing text in the corpus at all? If no, it's a corpus gap. Not a model problem, not a retrieval problem. Add the document.

Was it in the corpus but not retrieved? Retrieval failure. Fix chunking, embedding, query rewriting, hybrid search, or k.

Was it retrieved but the model answered wrong anyway? Generation failure. Fix the prompt, the model, or the instruction about what to do with conflicting sources.

Was it retrieved, the model answered right, but the citation points somewhere else? Citation failure. Often the worst kind, because the answer is correct and the audit trail is fiction, which is exactly the failure that survives review.

If you can't run that decomposition because retrieved chunks were never logged, stop and say so. That is the finding. Everything downstream is speculation, and speculation dressed as analysis is worse than no analysis.

### Step 5: Check the citations against the text

For a sample of answers, open the cited chunk and read it. Does it contain the claim?

Three failure shapes show up. The citation is a real chunk that doesn't support the claim, which is a model stitching two sources into one sentence. The citation is a chunk id that doesn't exist, which is the model inventing a plausible id. And the citation is right but points at the chunk rather than at a page or section a human could find, which makes it unverifiable in practice even though it's technically correct.

Report the sample size. "3 of 20 sampled citations did not support their claim" is a finding. "Citations are sometimes wrong" is not.

## What to look for

The recurring ones, in rough order of how often they turn out to be the actual cause:

**Embedding model mismatch between index build and query time.** Silent, total, and looks like the model got dumber.

**No similarity floor.** The system cannot say "I don't know" because it always has 5 chunks.

**Chunks with no context.** Headings stripped, so a chunk is a paragraph with unresolvable pronouns.

**Stale index with no deletion path.** The system cites documents that were removed months ago.

**No hybrid search** in a corpus full of identifiers, error codes, part numbers, or names.

**Follow-up queries embedded raw**, so turn 2 of any conversation retrieves badly.

**Retrieved chunks not logged**, making every past incident permanently undiagnosable.

**Permission filtering in the UI only.**

**Evaluation consisting of a handful of questions somebody tried by hand in 2023**, checked in as a markdown file, never run since.

**A reranker added later that nobody measured**, which may be helping, hurting, or doing nothing, and costs money either way.

## The output

Write `RAG-INTEGRITY.md`. Lead with the Unknowns, then the stage-by-stage verdict, then findings ranked by how much of the failure they explain.

```
RAG INTEGRITY CHECK
system:   <name>              date: <ISO-8601>
corpus:   <n> docs / <n> chunks / index built <date>
sampled:  <n> real failures, <n> citations checked

UNKNOWNS  (read these first)
  U1  Retrieved chunks are not logged with answers. No past failure in this
      system can be diagnosed. Failure decomposition below is based on 12
      cases reproduced by hand, not on production traffic.
  U2  No labeled question-to-document pairs exist. Retrieval quality cannot
      be measured, only observed case by case.
  U3  Real query distribution unknown. Tuning was done against 30 questions
      written by the team in 2023.

STAGE VERDICTS       (Sound | Weak | Broken | Unknown)
  parsing            Weak      41 PDFs produced under 200 chars. Likely scans.
  chunking           Weak      Fixed 1000 chars, no overlap, headings dropped.
  metadata           Broken    No date, no version, no permission field.
  embedding          Sound     text-embedding-3-small, pinned, matches at query.
  freshness          Broken    Manual rebuild script. Last run 2025-11-04.
                               No deletion path. 3 retracted policies still live.
  query handling     Weak      Raw text embedded. No rewriting, no hybrid.
  top-k / threshold  Broken    k=5, no floor. Always returns 5.
  assembly           Weak      Chunks joined with newlines, no source labels.
  generation prompt  Sound     States "answer only from context" and cites.
  citations          Weak      3 of 20 sampled did not support the claim.

WHERE THE FAILURES ACTUALLY ARE   (12 reproduced cases)
  corpus gap          2
  retrieval failure   7   <-- dominant
  generation failure  1
  citation failure    2

FINDINGS  (ranked by share of failure explained)

  F1  NO SIMILARITY FLOOR          explains ~5 of 12
      retriever.py:44  k=5, no min score. When nothing relevant exists the
      system hands the model 5 unrelated chunks and an instruction to answer
      from context. The model complies. That is the confident wrong answer.
      Smallest fix: add a floor, and a path that returns "not found" above it.

  F2  STALE INDEX, NO DELETION     explains ~2 of 12, plus compliance exposure
      3 retracted policy documents are still retrievable and still cited.

  F3  HEADINGS DROPPED IN CHUNKING explains ~2 of 12
      ingest.py:71 splits raw text. Chunks begin mid-sentence with pronouns
      that have no referent in the chunk.

  F4  NO RETRIEVAL LOGGING         explains 0, prevents diagnosing all of them
      Not a cause. It is the reason this report needed 12 hand-built cases
      instead of 12 months of production evidence.

RECOMMENDED NEXT STEP
  One thing: log the retrieved chunk ids and scores next to every answer.
  It is a one-line change and it converts every future failure from an
  argument into a lookup. Do it before any tuning, or you will not be able
  to tell whether the tuning helped.
```

## Run record

Every run ends with a receipt, per `TRACEABILITY.md` in this repository. Emit it even when every stage reads Sound.

```
--- M3n0ko0g skill receipt ---
skill:       rag-integrity-check
version:     0.1.0
id:          <12 random hex chars, corrections point at this, never at run_at>
run_at:      <ISO-8601 UTC>
input:       <n> docs, <n> chunks, <n> failures sampled   # shape only, never content
verdicts:    sound <n> / weak <n> / broken <n> / unknown <n>
dominant:    <corpus-gap | retrieval | generation | citation | undiagnosable>
unknowns:    <n>
recommended: <single next step, one line>
human:       <pending | accepted | rejected>
---
```

Never put query text, document content, or chunk text in the receipt. Corpora are usually the most confidential asset in the system.

`human` starts at `pending` and is only ever set by a person.

## Rules

Never blame the model without checking what was retrieved. That's the single most common wrong diagnosis in RAG work, and it sends teams to buy a bigger model for a search problem.

Never report retrieval quality as a number without labeled data. Say "not measurable, here is what would make it measurable."

Never mark a stage Sound because the code looks reasonable. Sound means you found evidence it works. Everything else is Unknown.

Never recommend a chunking change and an embedding change in the same step. Change one, measure, then change the other. Changing both means you learn nothing about either.

Never treat a reranker, a bigger k, or a better model as a fix for a corpus gap. If the answer isn't in there, no amount of retrieval tuning finds it.

If retrieved chunks aren't logged, say that first and say it plainly. A system that can't show its work can't be audited, and that outranks every quality finding in the report.

---

Part of the free skills library by M3n0ko0g.

Pairs with **Prompt Archaeology** (what the system tells the model) and **Eval or Vibes** (whether anyone would notice if this broke).

LAHA, Love All Humans Always.
