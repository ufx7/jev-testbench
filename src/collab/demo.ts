import "dotenv/config";
import { buildGridTask, straightforwardLevel, ambiguousLevel } from "./example/gridTask.js";
import { mockDirectActor, mockProposer } from "./example/mockLLM.js";
import { runArm } from "./runner.js";
import { printReport, saveReport } from "./report.js";
import { EpisodeResult } from "./types.js";

const EPISODES_PER_ARM = Number(process.argv[2] ?? 8);
const CONFIDENCE_THRESHOLD = Number(process.argv[3] ?? 0.75);

async function main() {
  console.log(
    `Running collab bench demo: ${EPISODES_PER_ARM} episodes/arm/level, ` +
      `confidence threshold=${CONFIDENCE_THRESHOLD}\n` +
      `NOTE: this demo uses a MOCK LLM stand-in (src/collab/example/mockLLM.ts), not real Claude. ` +
      `Swap in a real LLM adapter to get results that mean something about Claude specifically.\n`
  );

  const levels = [straightforwardLevel, ambiguousLevel];
  const allResults: EpisodeResult[] = [];

  for (const level of levels) {
    const task = buildGridTask(level);
    const cfg = {
      task,
      llmActDirectly: mockDirectActor,
      llmPropose: mockProposer,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      maxEscalationRetries: 1,
      jevInstructions:
        "Given the current situation and goal, which action makes the most progress toward the stated goal?",
    };

    console.log(`-- level: ${level.id} (optimal steps: ${task.optimalSteps}) --`);
    for (const arm of ["llm_autonomous", "scripted_plus_jev", "llm_plus_jev"] as const) {
      const results = await runArm(cfg, arm, EPISODES_PER_ARM);
      allResults.push(...results);
      console.log(`  ${arm}: ${results.length} episodes done`);
    }
  }

  printReport(allResults);
  saveReport(allResults);
}

main();
