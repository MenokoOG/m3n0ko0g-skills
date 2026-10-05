/* Fixture: a support agent of the kind assembled in 2023 and never revisited.
 *
 * This exists so the scout can be tested against a system with the exact
 * problems the skills describe. It is deliberately flawed. Do not copy any of it.
 *
 * Every defect here is one the scout is expected to find:
 *   - an unpinned model alias
 *   - retrieval with a fixed k and no similarity floor
 *   - retrieved chunks never logged
 *   - a while loop containing a model call with no iteration cap
 *   - JSON.parse with no stated output contract
 *   - a prompt assembled by template interpolation from a customer record
 *   - tool definitions sent on every call
 *   - all-caps scar tissue in the system prompt
 *
 * Note for the scout: the word "while" appears in this comment and inside the
 * system prompt below. Neither is a loop. A scanner that matched raw text would
 * report both.
 */

import OpenAI from "openai";

const client = new OpenAI();

// Scar tissue. Nobody remembers why the emphasis is there.
const SYSTEM_PROMPT = `You are a support assistant for a warranty company.
You MUST answer only from the context provided below.
You MUST NEVER speculate about coverage.
DO NOT apologize or add preamble before your answer.
Always include the source document id.
Keep responses under two sentences and omit references unless asked.
Think step by step before answering.
Use the <policy> tags to find the relevant section.
Wait while the customer reads, then continue.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "getAccount",
      description: "Fetch the full customer account record by id.",
      parameters: { type: "object", properties: { id: { type: "string" } } },
    },
  },
];

export async function buildIndex(documents: any[], store: any) {
  for (const doc of documents) {
    const vector = await client.embeddings.create({
      model: "text-embedding-ada-002",
      input: doc.text,
    });
    await store.upsert(doc.id, vector.data[0].embedding);
  }
}

export async function retrieve(store: any, question: string) {
  // k is fixed and there is no score threshold, so this always returns five
  // chunks even when nothing relevant exists.
  return store.similaritySearch(question, 5);
}

export async function answer(question: string, customer: any, store: any) {
  const chunks = await retrieve(store, question);
  const context = chunks.map((c: any) => c.text).join("\n");

  // The customer's name and plan tier reach the model on every request.
  const prompt = `You are helping ${customer.name}, who is on the ${customer.plan} plan.
Their account notes say: ${customer.notes}
Answer their question using only the context below.
Context:
${context}
Question: ${question}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    tools: TOOLS,
    temperature: 0.9,
  });

  // Nothing in either prompt states a JSON contract. This works today.
  return JSON.parse(response.choices[0].message.content as string);
}

export async function agentLoop(goal: string) {
  // Runs until the model says it is done. Nothing else bounds it.
  let done = false;
  const history: any[] = [];
  while (!done) {
    const step = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: goal }, ...history],
    });
    const text = step.choices[0].message.content ?? "";
    history.push({ role: "assistant", content: text });
    done = text.includes("FINISHED");
  }
  return history;
}

// A bounded loop, for contrast. The scout must not flag this one.
export async function summarizeAll(items: string[]) {
  const out: string[] = [];
  let i = 0;
  while (i < items.length) {
    const res = await client.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [{ role: "user", content: items[i] }],
    });
    out.push(res.choices[0].message.content ?? "");
    i++;
  }
  return out;
}

// Some calls never touch an SDK. The scout must still see them.
export async function askRaw(question: string, model: string) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, messages: [{ role: "user", content: question }] }),
  });
}
