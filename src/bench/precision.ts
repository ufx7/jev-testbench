import { callSystemOne } from "../client.js";
import { writeResult } from "./util.js";

// Probes the parts of the response contract the docs don't fully pin down:
// - do choice probabilities sum to 1, and does `choice` equal argmax?
// - what does `confidence` actually compute to, for each question type?
// - does `noul` expose a probabilities map, or just a single number?
// - is `score` an expected value over levels, or the argmax level index?

const STATE = {
  review:
    "The battery lasts forever and the screen is gorgeous, but honestly " +
    "the price is so high I'm not sure I'd buy it again, and customer " +
    "support never got back to me.",
};

async function main() {
  const result = await callSystemOne({
    state: STATE,
    model: "jev-latest",
    questions: {
      sentiment_choice: {
        type: "choice",
        instructions: "Is the overall sentiment toward the product positive or negative?",
        criteria: {
          positive: "Net satisfied, would recommend.",
          negative: "Net dissatisfied, would not recommend.",
        },
      },
      is_positive: {
        type: "noul",
        instructions: "Is the reviewer net satisfied with the product?",
        criteria: {
          true: "Reviewer is net satisfied.",
          false: "Reviewer is net dissatisfied.",
        },
      },
      satisfaction_score: {
        type: "score",
        instructions: "Rate the reviewer's overall satisfaction with the product.",
        criteria: [
          "Very dissatisfied, would actively warn others away.",
          "Dissatisfied, would not repurchase.",
          "Mixed, has real complaints alongside real praise.",
          "Satisfied, would repurchase despite minor issues.",
          "Very satisfied, unreserved praise.",
        ],
      },
    },
  });

  if (!result.ok || !result.body) {
    console.error("Request failed:", result.status, result.error ?? result.rawText);
    return;
  }

  console.log("Raw response:\n", JSON.stringify(result.body, null, 2));

  const findings: Record<string, unknown> = {};

  const choiceAns = result.body.answers.sentiment_choice;
  if (choiceAns.probabilities) {
    const probs = Object.values(choiceAns.probabilities);
    const sum = probs.reduce((a, b) => a + b, 0);
    const argmax = Object.entries(choiceAns.probabilities).sort((a, b) => b[1] - a[1])[0][0];
    findings.choice_prob_sum = sum;
    findings.choice_matches_argmax = argmax === choiceAns.choice;
    findings.choice_confidence_equals_top_prob =
      choiceAns.confidence != null &&
      Math.abs(choiceAns.confidence - Math.max(...probs)) < 1e-9;
    console.log(`\n[choice] probabilities sum to ${sum} (expect ~1)`);
    console.log(`[choice] choice field matches argmax(probabilities): ${findings.choice_matches_argmax}`);
    console.log(
      `[choice] confidence (${choiceAns.confidence}) equals top probability (${Math.max(...probs)}): ` +
        `${findings.choice_confidence_equals_top_prob}`
    );
  } else {
    console.log("[choice] no `probabilities` map returned");
  }

  const noulAns = result.body.answers.is_positive;
  findings.noul_has_probabilities_map = noulAns.probabilities != null;
  findings.noul_confidence_relation =
    noulAns.confidence != null && noulAns.noul != null
      ? Math.abs(noulAns.confidence - Math.abs(noulAns.noul - 0.5) * 2)
      : null;
  console.log(`\n[noul] value=${noulAns.noul} confidence=${noulAns.confidence}`);
  console.log(`[noul] has separate probabilities map: ${findings.noul_has_probabilities_map}`);
  console.log(
    `[noul] |confidence - foldedDistanceFromHalf|: ${findings.noul_confidence_relation} ` +
      "(0 would mean confidence = 2*|p-0.5|)"
  );

  const scoreAns = result.body.answers.satisfaction_score;
  console.log(`\n[score] score=${scoreAns.score} confidence=${scoreAns.confidence}`);
  console.log(`[score] probabilities: ${JSON.stringify(scoreAns.probabilities)}`);
  console.log(`[score] legend: ${JSON.stringify(scoreAns.legend)}`);
  if (scoreAns.probabilities) {
    const entries = Object.entries(scoreAns.probabilities);
    const sum = entries.reduce((a, [, p]) => a + p, 0);
    // If keys are numeric level indices/labels, check whether `score` looks
    // like an expected value (sum(level * p)) vs. the argmax level.
    const numericLevels = entries.every(([k]) => !Number.isNaN(Number(k)));
    findings.score_prob_sum = sum;
    if (numericLevels) {
      const expected = entries.reduce((a, [k, p]) => a + Number(k) * p, 0);
      findings.score_matches_expected_value = Math.abs(expected - (scoreAns.score ?? NaN)) < 0.05;
      console.log(
        `[score] probabilities sum to ${sum}; expected value over numeric levels = ${expected} ` +
          `(matches score field within 0.05: ${findings.score_matches_expected_value})`
      );
    }
  }

  writeResult("precision", { raw: result.body, findings });
}

await main();
