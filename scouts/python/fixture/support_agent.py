"""Fixture: a support agent of the kind assembled in 2023 and never revisited.

This exists so the scout can be tested against a system with the exact problems
the skills describe. It is deliberately flawed. Do not copy any of it.

Every defect here is one the scout is expected to find:
  - an unpinned model alias
  - retrieval with a fixed k and no similarity floor
  - retrieved chunks never logged
  - a while loop containing a model call with no iteration cap
  - json parsing with no stated output contract
  - a prompt assembled by interpolation from a customer record
  - tool definitions sent on every call
  - all-caps scar tissue in the system prompt
  - a chunking setting that ignores document structure
"""

import json

import openai

client = openai.OpenAI()

# Scar tissue. Nobody remembers why the emphasis is there.
SYSTEM_PROMPT = """You are a support assistant for a warranty company.
You MUST answer only from the context provided below.
You MUST NEVER speculate about coverage.
DO NOT apologize or add preamble before your answer.
Always include the source document id.
Keep responses under two sentences and omit references unless asked.
Think step by step before answering.
Use the <policy> tags to find the relevant section.
"""

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 0

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_account",
            "description": "Fetch the full customer account record by id.",
            "parameters": {"type": "object", "properties": {"id": {"type": "string"}}},
        },
    },
]


def build_index(documents, store):
    """Embed everything on every deploy. No hashing, no deletion path."""
    for doc in documents:
        vector = client.embeddings.create(model="text-embedding-ada-002", input=doc.text)
        store.upsert(doc.id, vector.data[0].embedding)


def retrieve(store, question):
    # k is fixed and there is no score threshold, so this always returns five
    # chunks even when nothing relevant exists.
    return store.similarity_search(question, k=5)


def answer(question, customer, store):
    chunks = retrieve(store, question)
    context = "\n".join(c.text for c in chunks)

    # The customer's name and plan tier reach the model on every request.
    prompt = f"""You are helping {customer.name}, who is on the {customer.plan} plan.
Their account notes say: {customer.notes}
Answer their question using only the context below.
Context:
{context}
Question: {question}
"""

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        tools=TOOLS,
        temperature=0.9,
    )

    # Nothing in either prompt states a JSON contract. This works today.
    return json.loads(response.choices[0].message.content)


def agent_loop(goal, store):
    """Runs until the model says it is done. Nothing else bounds it."""
    done = False
    history = []
    while not done:
        step = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": goal}] + history,
        )
        history.append({"role": "assistant", "content": step.choices[0].message.content})
        done = "FINISHED" in step.choices[0].message.content
    return history


def ask_raw(question):
    """Some calls never touch an SDK. The scout must still see them."""
    import requests

    return requests.post(
        "https://api.openai.com/v1/chat/completions",
        json={"model": MODEL_NAME, "messages": [{"role": "user", "content": question}]},
    )
