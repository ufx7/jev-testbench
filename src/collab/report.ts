import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArmName, EpisodeResult } from "./types.js";
import { exactMcNemar, McNemarResult, wilsonInterval, WilsonInterval } from "./stats.js";

interface GroupStats {
  arm: ArmName;
  difficulty: string;
  n: number;
  successRate: number;
  successCI: WilsonInterval;
  meanPathEfficiency: number | null; // stepsTaken / optimalSteps, successful episodes only
  illegalActionRate: number; // fraction of episodes with >=1 illegal/hallucinated action
  meanEscalationsPerEpisode: number;
  meanLlmCallsPerEpisode: number;
  meanJevCallsPerEpisode: number;
  meanLlmLatencyMsPerEpisode: number;
  meanJevLatencyMsPerEpisode: number;
  meanLlmCostUsdPerEpisode: number | null; // null = pricing not supplied, not "zero"
  meanJevCostUsdPerEpisode: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function sumDefined(xs: (number | undefined)[]): number | null {
  const defined = xs.filter((x): x is number => x != null);
  if (defined.length === 0) return null;
  return defined.reduce((a, b) => a + b, 0);
}

export function summarize(results: EpisodeResult[]): GroupStats[] {
  const groups = new Map<string, EpisodeResult[]>();
  for (const r of results) {
    const key = `${r.arm}::${r.difficulty ?? "unlabeled"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const out: GroupStats[] = [];
  for (const [key, group] of groups) {
    const [arm, difficulty] = key.split("::") as [ArmName, string];
    const successes = group.filter((r) => r.success);
    const pathEff = successes
      .filter((r) => r.optimalSteps != null && r.optimalSteps > 0)
      .map((r) => r.stepsTaken / (r.optimalSteps as number));

    const llmCostsPerEpisode = group.map((r) => sumDefined(r.steps.map((s) => s.llmCostUsd)));
    const jevCostsPerEpisode = group.map((r) => sumDefined(r.steps.map((s) => s.jevCostUsd)) ?? 0);
    const anyLlmCostKnown = llmCostsPerEpisode.some((c) => c != null);

    out.push({
      arm,
      difficulty,
      n: group.length,
      successRate: successes.length / group.length,
      successCI: wilsonInterval(successes.length, group.length),
      meanPathEfficiency: pathEff.length ? mean(pathEff) : null,
      illegalActionRate: group.filter((r) => r.illegalActionCount > 0).length / group.length,
      meanEscalationsPerEpisode: mean(group.map((r) => r.escalationCount)),
      meanLlmCallsPerEpisode: mean(group.map((r) => r.steps.reduce((a, s) => a + s.llmCalls, 0))),
      meanJevCallsPerEpisode: mean(group.map((r) => r.steps.reduce((a, s) => a + s.jevCalls, 0))),
      meanLlmLatencyMsPerEpisode: mean(
        group.map((r) => r.steps.reduce((a, s) => a + s.llmLatencyMs, 0))
      ),
      meanJevLatencyMsPerEpisode: mean(
        group.map((r) => r.steps.reduce((a, s) => a + s.jevLatencyMs, 0))
      ),
      meanLlmCostUsdPerEpisode: anyLlmCostKnown
        ? mean(llmCostsPerEpisode.filter((c): c is number => c != null))
        : null,
      meanJevCostUsdPerEpisode: mean(jevCostsPerEpisode),
    });
  }
  return out;
}

interface PairwiseComparison {
  taskId: string;
  armA: ArmName;
  armB: ArmName;
  result: McNemarResult;
}

/**
 * Runs exact McNemar per LEVEL (taskId), matched by episode index --
 * never pooled across levels, which would conflate a level's inherent
 * difficulty with the arm effect. This is the actual "is arm A better
 * than arm B" test; successRate deltas alone are not.
 */
export function pairwiseComparisons(results: EpisodeResult[]): PairwiseComparison[] {
  const byTaskArm = new Map<string, EpisodeResult[]>();
  for (const r of results) {
    const key = `${r.taskId}::${r.arm}`;
    (byTaskArm.get(key) ?? byTaskArm.set(key, []).get(key)!).push(r);
  }
  const taskIds = [...new Set(results.map((r) => r.taskId))];
  const arms: ArmName[] = ["llm_autonomous", "scripted_plus_jev", "llm_plus_jev"];
  const out: PairwiseComparison[] = [];

  for (const taskId of taskIds) {
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const a = byTaskArm.get(`${taskId}::${arms[i]}`);
        const b = byTaskArm.get(`${taskId}::${arms[j]}`);
        if (!a || !b || a.length !== b.length) continue; // unequal n: can't pair safely
        const aSorted = [...a].sort((x, y) => x.episode - y.episode);
        const bSorted = [...b].sort((x, y) => x.episode - y.episode);
        out.push({
          taskId,
          armA: arms[i],
          armB: arms[j],
          result: exactMcNemar(
            aSorted.map((r) => r.success),
            bSorted.map((r) => r.success)
          ),
        });
      }
    }
  }
  return out;
}

/** Flags buckets where every arm scored 0% or 100% -- no arm can be
 * distinguished from another there (zero discordant pairs possible),
 * and reporting a "finding" on such a bucket is exactly the mistake
 * agent-loom-e10 made before it looked at the secondary metrics. */
export function ceilingEffectWarnings(results: EpisodeResult[]): string[] {
  const byTask = new Map<string, EpisodeResult[]>();
  for (const r of results) (byTask.get(r.taskId) ?? byTask.set(r.taskId, []).get(r.taskId)!).push(r);
  const warnings: string[] = [];
  for (const [taskId, group] of byTask) {
    const byArm = new Map<ArmName, EpisodeResult[]>();
    for (const r of group) (byArm.get(r.arm) ?? byArm.set(r.arm, []).get(r.arm)!).push(r);
    const rates = [...byArm.values()].map((g) => g.filter((r) => r.success).length / g.length);
    if (rates.length > 1 && rates.every((r) => r === rates[0]) && (rates[0] === 0 || rates[0] === 1)) {
      warnings.push(
        `${taskId}: every arm scored ${rates[0] === 1 ? "100%" : "0%"} — this level has no discriminative ` +
          `power for success rate; look at illegal-action rate, cost, and latency instead, or make the level harder/easier.`
      );
    }
  }
  return warnings;
}

export function printReport(results: EpisodeResult[]) {
  const stats = summarize(results);
  console.log("\n=== Collaboration bench report ===\n");
  const difficulties = [...new Set(stats.map((s) => s.difficulty))];

  for (const difficulty of difficulties) {
    console.log(`-- difficulty: ${difficulty} --`);
    const rows = stats.filter((s) => s.difficulty === difficulty);
    for (const s of rows) {
      const ci = `[${(s.successCI.low * 100).toFixed(0)}-${(s.successCI.high * 100).toFixed(0)}%]`;
      const llmCost = s.meanLlmCostUsdPerEpisode != null ? `$${s.meanLlmCostUsdPerEpisode.toFixed(4)}` : "n/a (no llm pricing supplied)";
      console.log(
        `  ${s.arm.padEnd(18)} n=${s.n} success=${(s.successRate * 100).toFixed(0)}% (95% CI ${ci}) ` +
          `pathEff=${s.meanPathEfficiency?.toFixed(2) ?? "n/a"} illegalRate=${(
            s.illegalActionRate * 100
          ).toFixed(0)}% escalations/ep=${s.meanEscalationsPerEpisode.toFixed(2)}`
      );
      console.log(
        `    ${" ".repeat(18)}llmCalls/ep=${s.meanLlmCallsPerEpisode.toFixed(1)} jevCalls/ep=${s.meanJevCallsPerEpisode.toFixed(
          1
        )} llmMs/ep=${s.meanLlmLatencyMsPerEpisode.toFixed(0)} jevMs/ep=${s.meanJevLatencyMsPerEpisode.toFixed(
          0
        )} llmCost/ep=${llmCost} jevCost/ep=$${s.meanJevCostUsdPerEpisode.toFixed(6)}`
      );
    }
    console.log();
  }

  console.log("-- ceiling-effect check --");
  const warnings = ceilingEffectWarnings(results);
  if (warnings.length === 0) {
    console.log("  none detected — every level shows at least one arm differing from another.");
  } else {
    for (const w of warnings) console.log(`  WARNING: ${w}`);
  }
  console.log();

  console.log("-- pairwise significance (exact McNemar, per level, matched episodes) --");
  const pairwise = pairwiseComparisons(results);
  if (pairwise.length === 0) {
    console.log("  no comparable pairs (arms had unequal episode counts on the same level).");
  }
  for (const p of pairwise) {
    const r = p.result;
    const verdict = r.significant
      ? `SIGNIFICANT (p=${r.pValue.toFixed(4)}, ${r.discordantAOnly + r.discordantBOnly} discordant pairs)`
      : `not significant (p=${r.pValue.toFixed(4)}, only ${r.discordantAOnly + r.discordantBOnly} discordant pairs — ` +
        `run more episodes before concluding anything either way)`;
    console.log(
      `  ${p.taskId}: ${p.armA} vs ${p.armB} — ${p.armA} won ${r.discordantAOnly}, ${p.armB} won ${r.discordantBOnly} → ${verdict}`
    );
  }
  console.log();
}

export function saveReport(results: EpisodeResult[]) {
  mkdirSync("results", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join("results", `collab-report-${timestamp}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        results,
        stats: summarize(results),
        pairwiseComparisons: pairwiseComparisons(results),
        ceilingEffectWarnings: ceilingEffectWarnings(results),
      },
      null,
      2
    )
  );
  console.log(`Saved full report (including raw episode logs) to ${path}`);
}
