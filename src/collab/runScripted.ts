import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildGridTask, straightforwardLevel, ambiguousLevel } from "./example/gridTask.js";
import { runArm } from "./runner.js";
import { EpisodeResult } from "./types.js";

// scripted_plus_jev needs no LLM at all, so unlike llm_autonomous and
// llm_plus_jev (played by independent subagents), this arm runs fully
// automated here.

const N = Number(process.argv[2] ?? 8);

async function main() {
  const results: EpisodeResult[] = [];
  for (const level of [straightforwardLevel, ambiguousLevel]) {
    const task = buildGridTask(level);
    const cfg = {
      task,
      confidenceThreshold: 0.75,
      maxEscalationRetries: 1,
      jevInstructions:
        "Given the current situation and goal, which action makes the most progress toward the stated goal?",
    };
    const r = await runArm(cfg, "scripted_plus_jev", N);
    results.push(...r);
    console.log(`${level.id}: ${r.length} episodes, success=${r.filter((x) => x.success).length}`);
  }
  writeFileSync("results/interactive/scripted_plus_jev.json", JSON.stringify(results, null, 2));
}

main();
