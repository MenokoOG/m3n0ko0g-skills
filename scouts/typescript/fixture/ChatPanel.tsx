/* Fixture: the frontend leak. A Vite/React bundle is public, so this key
   is readable by anyone who opens devtools. The scout must catch it. */

import { useState } from "react";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

export default function ChatPanel() {
  const [answer, setAnswer] = useState("");

  async function ask(question: string) {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });
    setAnswer(res.choices[0].message.content ?? "");
  }

  return <div onClick={() => ask("hello")}>{answer}</div>;
}
