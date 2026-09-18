import { CollabAction, CollabState, LLMDirectActor, LLMProposer } from "../types.js";

// A MOCK stand-in for a real LLM, used only to prove the harness works
// end-to-end without an ANTHROPIC_API_KEY. It is deliberately biased
// toward whichever candidate's hint text contains a "salience" word
// ("grand", "important", "lit") to simulate an LLM getting fooled by
// surface wording — do not read anything from this mock's numbers as a
// claim about real Claude behavior. Swap this file out for a real
// Anthropic API call (or any other LLM) to get real results.

const SALIENT_WORDS = ["grand", "gilded", "important", "lit"];

function salience(text: string): number {
  const lower = text.toLowerCase();
  return SALIENT_WORDS.reduce((score, w) => score + (lower.includes(w) ? 1 : 0), 0);
}

export const mockDirectActor: LLMDirectActor<CollabState, CollabAction> = async (
  _state,
  legalActions
) => {
  const ranked = [...legalActions].sort((a, b) => salience(b.describe()) - salience(a.describe()));
  const picked = ranked[0];
  return {
    actionId: picked.id,
    rationale: `Picked based on wording salience (mock actor, not a real LLM).`,
    selfReportedUncertainty: ranked.length > 1 ? "medium" : "low",
  };
};

export const mockProposer: LLMProposer<CollabState, CollabAction> = async (
  _state,
  legalActions,
  k
) => {
  const ranked = [...legalActions].sort((a, b) => salience(b.describe()) - salience(a.describe()));
  return {
    proposals: ranked.slice(0, k).map((action) => ({
      action,
      rationale: `Mock candidate, ranked by wording salience.`,
    })),
    // no usage: this is a mock, not a real billed call
  };
};
