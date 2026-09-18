import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EpisodeResult } from "./types.js";
import { ambiguousLevel, straightforwardLevel, bfsOptimalSteps } from "./example/gridTask.js";

const OPTIMAL_STEPS: Record<string, number> = {
  [straightforwardLevel.id]: bfsOptimalSteps(straightforwardLevel),
  [ambiguousLevel.id]: bfsOptimalSteps(ambiguousLevel),
};

const DIFFICULTY: Record<string, string> = {
  [straightforwardLevel.id]: straightforwardLevel.difficulty,
  [ambiguousLevel.id]: ambiguousLevel.difficulty,
};

export function sessionFileToEpisode(path: string): EpisodeResult {
  const s = JSON.parse(readFileSync(path, "utf-8"));
  return {
    arm: s.arm,
    taskId: s.levelId,
    difficulty: DIFFICULTY[s.levelId],
    episode: s.episode,
    success: !!s.success,
    stepsTaken: s.stepIndex,
    optimalSteps: OPTIMAL_STEPS[s.levelId],
    illegalActionCount: s.illegalActionCount,
    escalationCount: s.escalationCount,
    steps: s.steps,
  };
}

export function loadAllSessions(dir: string): EpisodeResult[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => sessionFileToEpisode(join(dir, f)));
}
