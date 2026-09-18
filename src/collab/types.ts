// Generic interfaces so this bench can measure "Jev + any LLM" on
// *your* task, not just our one navigation demo. Plug in a task and an
// LLM adapter; the runner and report generator are domain-agnostic.

export interface CollabAction {
  id: string;
  describe(): string;
}

export interface CollabState {
  describe(): string;
}

export interface CollabTask<
  S extends CollabState = CollabState,
  A extends CollabAction = CollabAction
> {
  id: string;
  /** Free-form label you choose, e.g. "straightforward" | "ambiguous".
   * The report breaks results down by this — don't skip setting it,
   * an aggregate-only report hides exactly the effect worth finding. */
  difficulty?: string;
  createInitialState(): S;
  legalActions(state: S): A[];
  applyAction(state: S, action: A): S;
  isTerminal(state: S): { done: boolean; success: boolean };
  /** Ground truth, computed by your own code (e.g. BFS), not guessed. */
  optimalSteps?: number;
  maxSteps: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Claude/GPT/whatever proposes k candidate actions with rationale.
 * Used by the "llm_plus_jev" arm. Usage is reported once per CALL
 * (one call typically yields several candidates), not per candidate --
 * without this the tool cannot report real cost, which defeats half
 * the point of running it. */
export type LLMProposer<
  S extends CollabState = CollabState,
  A extends CollabAction = CollabAction
> = (
  state: S,
  legalActions: A[],
  k: number
) => Promise<{ proposals: ProposedAction<A>[]; usage?: TokenUsage }>;

export interface ProposedAction<A extends CollabAction> {
  action: A;
  rationale?: string;
}

/** LLM picks one action directly and unconstrained — it may name
 * something outside legalActions, which is exactly what we want to
 * measure for the "llm_autonomous" arm (hallucination/illegal-action
 * rate is a primary outcome, not something to prevent here). */
export type LLMDirectActor<
  S extends CollabState = CollabState,
  A extends CollabAction = CollabAction
> = (
  state: S,
  legalActions: A[]
) => Promise<{
  actionId: string;
  rationale?: string;
  selfReportedUncertainty?: string;
  usage?: TokenUsage;
}>;

/** $ per million tokens. Jev's defaults come from its published pricing
 * page (verified against our own measured usage in the precision bench).
 * LLM rates have no safe default -- you must supply your own model's
 * pricing, or cost is reported as "n/a" rather than silently wrong. */
export interface Pricing {
  jevInputPerMillion: number;
  jevOutputPerMillion: number;
  llmInputPerMillion?: number;
  llmOutputPerMillion?: number;
}

export const DEFAULT_JEV_PRICING: Pick<Pricing, "jevInputPerMillion" | "jevOutputPerMillion"> = {
  jevInputPerMillion: 0.042,
  jevOutputPerMillion: 0,
};

export type ArmName = "llm_autonomous" | "scripted_plus_jev" | "llm_plus_jev";

export interface StepLog {
  arm: ArmName;
  taskId: string;
  episode: number;
  step: number;
  actionId: string | null;
  wasLegal: boolean;
  jevConfidence?: number;
  jevProbabilities?: Record<string, number>;
  escalated?: boolean;
  llmSelfReportedUncertainty?: string;
  llmCalls: number;
  jevCalls: number;
  llmLatencyMs: number;
  jevLatencyMs: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  jevInputTokens?: number;
  jevOutputTokens?: number;
  llmCostUsd?: number;
  jevCostUsd?: number;
}

export interface EpisodeResult {
  arm: ArmName;
  taskId: string;
  difficulty?: string;
  episode: number;
  success: boolean;
  stepsTaken: number;
  optimalSteps?: number;
  illegalActionCount: number;
  escalationCount: number;
  steps: StepLog[];
}
