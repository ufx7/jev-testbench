import { callSystemOne, mean, percentile, stddev } from "../client.js";
import { writeResult } from "./util.js";

const RUNS_PER_BUCKET = Number(process.argv[2] ?? 20);

// Repeat a filler sentence to build "medium" and "large" state without
// hand-writing huge blobs. Real text will behave somewhat differently,
// but this isolates the effect of raw size on latency.
const FILLER =
  "The customer reported an issue with their recent order and asked for a refund. ";

function repeatText(n: number): string {
  return FILLER.repeat(n);
}

const BUCKETS: { label: string; state: unknown }[] = [
  { label: "tiny (~15 tokens)", state: { text: "This product is great." } },
  { label: "small (~200 words)", state: { text: repeatText(15) } },
  { label: "medium (~2k words)", state: { text: repeatText(150) } },
  { label: "large (~10k words)", state: { text: repeatText(750) } },
];

async function runBucket(label: string, state: unknown) {
  const latencies: number[] = [];
  let failures = 0;

  for (let i = 0; i < RUNS_PER_BUCKET; i++) {
    const result = await callSystemOne({
      state,
      model: "jev-latest",
      questions: {
        sentiment: {
          type: "choice",
          instructions: "Is the sentiment of `text` positive or negative?",
          criteria: { positive: "Net positive tone.", negative: "Net negative tone." },
        },
      },
    });

    if (!result.ok) {
      failures++;
      console.error(`  [${label}] run ${i} failed: status=${result.status} ${result.error ?? result.rawText}`);
      continue;
    }
    latencies.push(result.latencyMs);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(`\n[${label}] ${latencies.length}/${RUNS_PER_BUCKET} ok, ${failures} failed`);
  if (latencies.length > 0) {
    console.log(
      `  mean=${mean(latencies).toFixed(1)}ms stddev=${stddev(latencies).toFixed(1)}ms ` +
        `p50=${percentile(sorted, 50).toFixed(1)}ms p90=${percentile(sorted, 90).toFixed(1)}ms ` +
        `p99=${percentile(sorted, 99).toFixed(1)}ms min=${sorted[0].toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`
    );
  }

  return { label, latencies, failures };
}

async function main() {
  console.log(`Running latency check: ${RUNS_PER_BUCKET} requests per size bucket...`);
  const results = [];
  for (const bucket of BUCKETS) {
    results.push(await runBucket(bucket.label, bucket.state));
  }
  writeResult("latency", results);
}

await main();
