import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { callSystemOne } from "../client.js";
import { JevRecord, loadItems } from "./common.js";

// Jev alone on every item: passage+question as state, the shared option
// descriptions as Choice criteria (identical text Claude sees).
const items = loadItems();
const out: JevRecord[] = new Array(items.length);
let next = 0;
let failures = 0;

async function worker() {
  while (true) {
    const i = next++;
    if (i >= items.length) return;
    const it = items[i];
    const r = await callSystemOne({
      state: { passage: it.passage, question: it.question },
      model: "jev-latest",
      questions: {
        answer: {
          type: "choice",
          instructions:
            "Using only `passage`, answer `question`: which option is correct?",
          criteria: it.options,
        },
      },
    });
    if (!r.ok || !r.body) {
      failures++;
      console.error(`item ${it.id} failed: ${r.status} ${r.error ?? r.rawText.slice(0, 200)}`);
      continue;
    }
    const a = r.body.answers.answer;
    out[i] = {
      id: it.id,
      discipline: it.discipline,
      choice: a.choice ?? "",
      confidence: a.confidence ?? 0,
      probabilities: a.probabilities ?? {},
      latencyMs: r.latencyMs,
      inputTokens: r.body.usage.input_tokens,
    };
  }
}

await Promise.all(Array.from({ length: 6 }, worker));
mkdirSync("results/real", { recursive: true });
const ok = out.filter(Boolean);
writeFileSync("results/real/jev.json", JSON.stringify(ok, null, 1));
console.log(`Jev done: ${ok.length}/${items.length} ok, ${failures} failed, tokens=${ok.reduce((a, r) => a + r.inputTokens, 0)}`);
