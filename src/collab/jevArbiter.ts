import { callSystemOne } from "../client.js";
import { CollabAction } from "./types.js";

export interface ArbitrationResult {
  pickedId: string;
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Builds a Choice question on the fly from an arbitrary candidate list
 * and asks Jev to pick among them. This is the one reusable primitive
 * every arm that touches Jev is built from — code always supplies the
 * candidate set, Jev never generates outside it.
 */
export async function jevArbitrate<A extends CollabAction>(
  stateDescription: string,
  candidates: A[],
  instructions: string
): Promise<ArbitrationResult> {
  if (candidates.length === 0) {
    throw new Error("jevArbitrate called with zero candidates");
  }
  if (candidates.length === 1) {
    // Degenerate but real case: don't burn a call on a forced choice.
    return {
      pickedId: candidates[0].id,
      confidence: 1,
      probabilities: { [candidates[0].id]: 1 },
      latencyMs: 0,
    };
  }

  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.id] = c.describe();

  const result = await callSystemOne({
    state: { situation: stateDescription },
    model: "jev-latest",
    questions: {
      pick: {
        type: "choice",
        instructions,
        criteria,
      },
    },
  });

  if (!result.ok || !result.body) {
    throw new Error(
      `Jev arbitration failed: status=${result.status} ${result.error ?? result.rawText}`
    );
  }

  const ans = result.body.answers.pick;
  return {
    pickedId: ans.choice ?? candidates[0].id,
    confidence: ans.confidence ?? 0,
    probabilities: ans.probabilities ?? {},
    latencyMs: result.latencyMs,
    inputTokens: result.body.usage?.input_tokens,
    outputTokens: result.body.usage?.output_tokens,
  };
}
