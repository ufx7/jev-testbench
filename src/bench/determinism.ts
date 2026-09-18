import { callSystemOne, mean, stddev } from "../client.js";
import { writeResult } from "./util.js";

// Deliberately ambiguous state: a review that could plausibly read as
// either positive or negative. If the model is sampling near a decision
// boundary, this is where non-determinism should show up first — a
// clearly one-sided example would look "deterministic" even if it isn't.
const AMBIGUOUS_STATE = {
  review:
    "The battery lasts forever and the screen is gorgeous, but honestly " +
    "the price is so high I'm not sure I'd buy it again, and customer " +
    "support never got back to me.",
};

const RUNS = Number(process.argv[2] ?? 30);

async function main() {
  console.log(`Running determinism check: ${RUNS} identical requests...`);

  const choices: string[] = [];
  const confidences: number[] = [];
  const probsByOption: Record<string, number[]> = {};
  const rawResponses: unknown[] = [];

  for (let i = 0; i < RUNS; i++) {
    const result = await callSystemOne({
      state: AMBIGUOUS_STATE,
      model: "jev-latest",
      questions: {
        sentiment: {
          type: "choice",
          instructions:
            "Given `review`, is the overall sentiment toward the product positive or negative?",
          criteria: {
            positive: "The reviewer is net satisfied and would likely recommend it.",
            negative: "The reviewer is net dissatisfied and would likely not recommend it.",
          },
        },
      },
    });

    if (!result.ok || !result.body) {
      console.error(
        `Run ${i}: request failed (status ${result.status})`,
        result.error ?? result.rawText
      );
      continue;
    }

    const ans = result.body.answers.sentiment;
    choices.push(ans.choice ?? "?");
    confidences.push(ans.confidence ?? NaN);
    rawResponses.push(ans);

    for (const [opt, p] of Object.entries(ans.probabilities ?? {})) {
      (probsByOption[opt] ??= []).push(p);
    }

    process.stdout.write(
      `run ${i}: choice=${ans.choice} confidence=${ans.confidence?.toFixed(4)} ` +
        `probs=${JSON.stringify(ans.probabilities)}\n`
    );
  }

  const uniqueChoices = new Set(choices);
  console.log("\n--- Determinism summary ---");
  console.log(`Requests: ${choices.length}/${RUNS} succeeded`);
  console.log(`Distinct choices returned: ${[...uniqueChoices].join(", ")}`);
  console.log(
    uniqueChoices.size === 1
      ? "Choice was IDENTICAL across all runs."
      : "Choice VARIED across runs — not deterministic for this input."
  );
  console.log(
    `Confidence: mean=${mean(confidences).toFixed(4)} stddev=${stddev(
      confidences
    ).toFixed(6)}`
  );
  for (const [opt, ps] of Object.entries(probsByOption)) {
    console.log(
      `P(${opt}): mean=${mean(ps).toFixed(4)} stddev=${stddev(ps).toFixed(6)} ` +
        `min=${Math.min(...ps).toFixed(4)} max=${Math.max(...ps).toFixed(4)}`
    );
  }

  writeResult("determinism", {
    runs: RUNS,
    succeeded: choices.length,
    choices,
    confidences,
    probsByOption,
    uniqueChoiceCount: uniqueChoices.size,
  });
}

await main();
