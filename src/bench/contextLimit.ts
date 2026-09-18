import { callSystemOne } from "../client.js";
import { writeResult } from "./util.js";

// ~14 words / ~19 tokens per repeat, calibrated against the actual
// usage.input_tokens reported back by the API rather than assumed.
const FILLER =
  "The customer reported an issue with their recent order and asked for a refund. ";

function stateFor(reps: number) {
  return { text: FILLER.repeat(reps) };
}

async function probe(reps: number) {
  const result = await callSystemOne(
    {
      state: stateFor(reps),
      model: "jev-latest",
      questions: {
        sentiment: {
          type: "choice",
          instructions: "Is the sentiment of `text` positive or negative?",
          criteria: { positive: "Net positive tone.", negative: "Net negative tone." },
        },
      },
    },
    { timeoutMs: 60_000 }
  );
  return result;
}

async function main() {
  console.log("Searching for the practical max input size (exponential ramp then binary search)...");

  let reps = 200;
  let lastGood: { reps: number; tokens: number } | null = null;
  let firstBad: { reps: number; status: number; body: string } | null = null;
  const trail: Array<{ reps: number; ok: boolean; status: number; tokens?: number }> = [];

  // Exponential ramp-up until failure or an absurd cap.
  while (reps < 2_000_000) {
    const result = await probe(reps);
    const tokens = result.body?.usage?.input_tokens;
    trail.push({ reps, ok: result.ok, status: result.status, tokens });
    console.log(
      `reps=${reps} -> status=${result.status} ok=${result.ok} input_tokens=${tokens ?? "?"} ` +
        `latency=${result.latencyMs.toFixed(0)}ms`
    );

    if (result.ok && tokens != null) {
      lastGood = { reps, tokens };
      reps *= 2;
    } else {
      firstBad = { reps, status: result.status, body: result.rawText.slice(0, 500) };
      break;
    }
  }

  if (!firstBad) {
    console.log(
      "\nNo failure found before the safety cap (2,000,000 repeats). Either there is no " +
        "practical limit in this range, or something else (cost, timeout) should stop the ramp."
    );
    writeResult("context-limit", { trail, lastGood, firstBad: null });
    return;
  }

  // Binary search between last known-good and first known-bad rep count.
  let lo = lastGood?.reps ?? 0;
  let hi = firstBad.reps;
  for (let i = 0; i < 8 && hi - lo > Math.max(1, Math.floor(lo * 0.02)); i++) {
    const mid = Math.floor((lo + hi) / 2);
    const result = await probe(mid);
    const tokens = result.body?.usage?.input_tokens;
    trail.push({ reps: mid, ok: result.ok, status: result.status, tokens });
    console.log(
      `[binary search] reps=${mid} -> status=${result.status} ok=${result.ok} ` +
        `input_tokens=${tokens ?? "?"}`
    );
    if (result.ok && tokens != null) {
      lo = mid;
      lastGood = { reps: mid, tokens };
    } else {
      hi = mid;
      firstBad = { reps: mid, status: result.status, body: result.rawText.slice(0, 500) };
    }
  }

  console.log("\n--- Context limit summary ---");
  console.log(`Last successful request: ~${lastGood?.tokens ?? "?"} input tokens (reps=${lastGood?.reps})`);
  console.log(`First failing request: reps=${firstBad.reps} status=${firstBad.status}`);
  console.log(`Failure body (truncated): ${firstBad.body}`);

  writeResult("context-limit", { trail, lastGood, firstBad });
}

await main();
