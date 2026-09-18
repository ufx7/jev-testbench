import {
  ArmName,
  CollabAction,
  CollabState,
  CollabTask,
  DEFAULT_JEV_PRICING,
  EpisodeResult,
  LLMDirectActor,
  LLMProposer,
  Pricing,
  StepLog,
} from "./types.js";
import { jevArbitrate } from "./jevArbiter.js";

export interface RunnerConfig<S extends CollabState, A extends CollabAction> {
  task: CollabTask<S, A>;
  llmPropose?: LLMProposer<S, A>;
  llmActDirectly?: LLMDirectActor<S, A>;
  /** Below this Jev confidence, llm_plus_jev escalates instead of acting. */
  confidenceThreshold: number;
  /** How many times to ask the LLM for fresh candidates before giving up
   * and logging "would escalate to human". */
  maxEscalationRetries: number;
  /** Instructions passed to Jev for the arbitration question. Keep this
   * task-specific: "pick the action that makes the most progress toward
   * the stated goal" only works if your task states a goal in describe(). */
  jevInstructions: string;
  /** LLM rates default to undefined -- cost for the LLM side is reported
   * as "n/a" unless you supply them, rather than silently assuming a
   * price that isn't your model's. */
  pricing?: Pricing;
}

function cost(tokens: number | undefined, perMillion: number | undefined): number | undefined {
  if (tokens == null || perMillion == null) return undefined;
  return (tokens / 1_000_000) * perMillion;
}

async function runEpisode<S extends CollabState, A extends CollabAction>(
  cfg: RunnerConfig<S, A>,
  arm: ArmName,
  episode: number
): Promise<EpisodeResult> {
  const { task } = cfg;
  const pricing: Pricing = { ...DEFAULT_JEV_PRICING, ...cfg.pricing };
  let state = task.createInitialState();
  const steps: StepLog[] = [];
  let illegalActionCount = 0;
  let escalationCount = 0;
  let stepIndex = 0;

  while (stepIndex < task.maxSteps) {
    const legalActions = task.legalActions(state);
    if (legalActions.length === 0) {
      // Walked into a state with no legal actions and it isn't terminal
      // (e.g. a dead end) — a genuine stuck-failure, not a crash.
      break;
    }
    const legalIds = new Set(legalActions.map((a) => a.id));
    let chosen: A | undefined;
    let wasLegal = true;
    const log: Partial<StepLog> = {
      arm,
      taskId: task.id,
      episode,
      step: stepIndex,
      llmCalls: 0,
      jevCalls: 0,
      llmLatencyMs: 0,
      jevLatencyMs: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      jevInputTokens: 0,
      jevOutputTokens: 0,
    };

    if (arm === "llm_autonomous") {
      if (!cfg.llmActDirectly) throw new Error("llm_autonomous requires llmActDirectly");
      const start = performance.now();
      const result = await cfg.llmActDirectly(state, legalActions);
      log.llmLatencyMs = performance.now() - start;
      log.llmCalls = 1;
      log.llmSelfReportedUncertainty = result.selfReportedUncertainty;
      log.llmInputTokens = result.usage?.inputTokens;
      log.llmOutputTokens = result.usage?.outputTokens;
      chosen = legalActions.find((a) => a.id === result.actionId);
      wasLegal = chosen != null;
      if (!wasLegal) illegalActionCount++;
    } else if (arm === "scripted_plus_jev") {
      const arb = await jevArbitrate(state.describe(), legalActions, cfg.jevInstructions);
      log.jevCalls = 1;
      log.jevLatencyMs = arb.latencyMs;
      log.jevConfidence = arb.confidence;
      log.jevProbabilities = arb.probabilities;
      log.jevInputTokens = arb.inputTokens;
      log.jevOutputTokens = arb.outputTokens;
      chosen = legalActions.find((a) => a.id === arb.pickedId);
      wasLegal = chosen != null; // should always be true by construction
      if (!wasLegal) illegalActionCount++;
    } else if (arm === "llm_plus_jev") {
      if (!cfg.llmPropose) throw new Error("llm_plus_jev requires llmPropose");
      let attempt = 0;
      let escalated = false;
      while (attempt <= cfg.maxEscalationRetries) {
        const start = performance.now();
        const { proposals, usage } = await cfg.llmPropose(state, legalActions, 3);
        log.llmLatencyMs = (log.llmLatencyMs ?? 0) + (performance.now() - start);
        log.llmCalls = (log.llmCalls ?? 0) + 1;
        log.llmInputTokens = (log.llmInputTokens ?? 0) + (usage?.inputTokens ?? 0);
        log.llmOutputTokens = (log.llmOutputTokens ?? 0) + (usage?.outputTokens ?? 0);

        const candidates = proposals.map((p) => p.action).filter((a) => legalIds.has(a.id));
        if (candidates.length === 0) {
          attempt++;
          escalated = true;
          continue;
        }

        const arb = await jevArbitrate(state.describe(), candidates, cfg.jevInstructions);
        log.jevCalls = (log.jevCalls ?? 0) + 1;
        log.jevLatencyMs = (log.jevLatencyMs ?? 0) + arb.latencyMs;
        log.jevConfidence = arb.confidence;
        log.jevProbabilities = arb.probabilities;
        log.jevInputTokens = (log.jevInputTokens ?? 0) + (arb.inputTokens ?? 0);
        log.jevOutputTokens = (log.jevOutputTokens ?? 0) + (arb.outputTokens ?? 0);

        if (arb.confidence >= cfg.confidenceThreshold) {
          chosen = candidates.find((a) => a.id === arb.pickedId);
          break;
        }
        attempt++;
        escalated = true;
      }
      log.escalated = escalated;
      if (escalated) escalationCount++;
      wasLegal = chosen != null;
      if (!chosen) {
        // Exhausted retries below threshold: this is the "would escalate
        // to a human" case. We stop the episode here rather than guess.
        log.actionId = null;
        log.llmCostUsd = cost(log.llmInputTokens, pricing.llmInputPerMillion);
        log.jevCostUsd = cost(log.jevInputTokens, pricing.jevInputPerMillion);
        steps.push(log as StepLog);
        break;
      }
    }

    log.actionId = chosen?.id ?? null;
    log.wasLegal = wasLegal;
    log.llmCostUsd = cost(log.llmInputTokens, pricing.llmInputPerMillion);
    log.jevCostUsd = cost(log.jevInputTokens, pricing.jevInputPerMillion);
    steps.push(log as StepLog);

    if (!chosen) break; // illegal/hallucinated action ends the episode
    state = task.applyAction(state, chosen);
    stepIndex++;

    const terminal = task.isTerminal(state);
    if (terminal.done) {
      return {
        arm,
        taskId: task.id,
        difficulty: task.difficulty,
        episode,
        success: terminal.success,
        stepsTaken: stepIndex,
        optimalSteps: task.optimalSteps,
        illegalActionCount,
        escalationCount,
        steps,
      };
    }
  }

  return {
    arm,
    taskId: task.id,
    difficulty: task.difficulty,
    episode,
    success: false,
    stepsTaken: stepIndex,
    optimalSteps: task.optimalSteps,
    illegalActionCount,
    escalationCount,
    steps,
  };
}

export async function runArm<S extends CollabState, A extends CollabAction>(
  cfg: RunnerConfig<S, A>,
  arm: ArmName,
  episodes: number
): Promise<EpisodeResult[]> {
  const results: EpisodeResult[] = [];
  for (let e = 0; e < episodes; e++) {
    results.push(await runEpisode(cfg, arm, e));
  }
  return results;
}
