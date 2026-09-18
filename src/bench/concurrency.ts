import { callSystemOne, mean } from "../client.js";
import { writeResult } from "./util.js";

// Docs publish a rate limit (250k tokens/sec, 1200 req/min = 20 req/sec)
// but not how the API behaves as you approach it: does latency degrade
// gracefully, or does it hard-fail with 429 right at the edge?

const BURST_SIZES = [1, 5, 10, 20, 40];

const STATE = { text: "This product exceeded my expectations in every way." };

function request() {
  return callSystemOne({
    state: STATE,
    model: "jev-latest",
    questions: {
      sentiment: {
        type: "choice",
        instructions: "Is the sentiment positive or negative?",
        criteria: { positive: "Net positive.", negative: "Net negative." },
      },
    },
  });
}

async function runBurst(size: number) {
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: size }, () => request()));
  const wallMs = performance.now() - start;

  const ok = results.filter((r) => r.ok);
  const rateLimited = results.filter((r) => r.status === 429);
  const overloaded = results.filter((r) => r.status === 529);
  const otherFail = results.filter((r) => !r.ok && r.status !== 429 && r.status !== 529);

  console.log(
    `\nBurst size ${size}: wall=${wallMs.toFixed(0)}ms ok=${ok.length} ` +
      `429=${rateLimited.length} 529=${overloaded.length} other_fail=${otherFail.length} ` +
      `mean_latency_of_ok=${ok.length ? mean(ok.map((r) => r.latencyMs)).toFixed(0) : "n/a"}ms`
  );
  if (otherFail.length > 0) {
    console.log(
      "  other failures:",
      otherFail.map((r) => `${r.status}:${r.error ?? r.rawText.slice(0, 100)}`)
    );
  }

  return {
    size,
    wallMs,
    ok: ok.length,
    rateLimited: rateLimited.length,
    overloaded: overloaded.length,
    otherFail: otherFail.length,
    latencies: ok.map((r) => r.latencyMs),
  };
}

async function main() {
  console.log("Testing concurrent-burst behavior at increasing sizes...");
  const results = [];
  for (const size of BURST_SIZES) {
    results.push(await runBurst(size));
    // brief pause between bursts so one burst's rate-limit state doesn't
    // bleed into the next
    await new Promise((r) => setTimeout(r, 2000));
  }
  writeResult("concurrency", results);
}

await main();
