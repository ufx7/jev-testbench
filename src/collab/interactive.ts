import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { jevArbitrate } from "./jevArbiter.js";
import {
  ambiguousLevel,
  buildGridTask,
  straightforwardLevel,
  LevelDef,
} from "./example/gridTask.js";
import { ArmName, StepLog } from "./types.js";

// CLI driven step-by-step by an independent subagent (a real LLM, via
// the Agent tool) over separate Bash calls, so each session captures a
// genuinely independent decision process rather than me answering the
// same question twice in one continuous context. State lives in a JSON
// session file between calls.

const LEVELS: Record<string, LevelDef> = {
  [straightforwardLevel.id]: straightforwardLevel,
  [ambiguousLevel.id]: ambiguousLevel,
};

const CONFIDENCE_THRESHOLD = Number(process.env.COLLAB_CONFIDENCE_THRESHOLD ?? 0.75);
const MAX_ESCALATION_RETRIES = 1;
const JEV_INSTRUCTIONS =
  "Given the current situation and goal, which action makes the most progress toward the stated goal?";

interface Session {
  arm: ArmName;
  levelId: string;
  episode: number;
  roomId: string;
  stepIndex: number;
  attemptsThisStep: number;
  done: boolean;
  success: boolean;
  illegalActionCount: number;
  escalationCount: number;
  steps: StepLog[];
}

function loadSession(path: string): Session {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveSession(path: string, s: Session) {
  writeFileSync(path, JSON.stringify(s, null, 2));
}

function taskFor(session: Session) {
  const level = LEVELS[session.levelId];
  if (!level) throw new Error(`Unknown level ${session.levelId}`);
  return buildGridTask(level);
}

function printStatus(session: Session) {
  const task = taskFor(session);
  const level = LEVELS[session.levelId];
  const state = { roomId: session.roomId };
  const roomDescribe = () => {
    const room = level.rooms[state.roomId];
    return (
      `You are in: ${room.description}\n` +
      `Goal: reach the room described as "${level.rooms[level.goalId].description}".`
    );
  };
  if (session.done) {
    console.log(JSON.stringify({ done: true, success: session.success, stepsTaken: session.stepIndex }, null, 2));
    return;
  }
  const legal = level.rooms[state.roomId].exits.map((e) => ({ id: e.actionLabel, describe: e.hint }));
  console.log(
    JSON.stringify(
      {
        done: false,
        arm: session.arm,
        step: session.stepIndex,
        situation: roomDescribe(),
        legalActions: legal,
        instructions:
          session.arm === "llm_autonomous"
            ? "Call `act <sessionPath> <actionId>` with exactly one actionId from legalActions."
            : "Call `propose <sessionPath> <actionId1,actionId2,...>` with 1-3 actionIds from legalActions, ranked best first.",
      },
      null,
      2
    )
  );
  void task; // task only needed for optimalSteps/maxSteps bookkeeping elsewhere
}

function cmdNew(levelId: string, arm: ArmName, episode: number, path: string) {
  const level = LEVELS[levelId];
  if (!level) throw new Error(`Unknown level ${levelId}. Known: ${Object.keys(LEVELS).join(", ")}`);
  const session: Session = {
    arm,
    levelId,
    episode,
    roomId: level.startId,
    stepIndex: 0,
    attemptsThisStep: 0,
    done: false,
    success: false,
    illegalActionCount: 0,
    escalationCount: 0,
    steps: [],
  };
  saveSession(path, session);
  printStatus(session);
}

function cmdStatus(path: string) {
  printStatus(loadSession(path));
}

function isLegal(session: Session, actionId: string): boolean {
  const level = LEVELS[session.levelId];
  return level.rooms[session.roomId].exits.some((e) => e.actionLabel === actionId);
}

function applyAction(session: Session, actionId: string) {
  const level = LEVELS[session.levelId];
  const exit = level.rooms[session.roomId].exits.find((e) => e.actionLabel === actionId)!;
  session.roomId = exit.targetId;
  session.stepIndex++;
  if (session.roomId === level.goalId) {
    session.done = true;
    session.success = true;
  } else if (level.rooms[session.roomId].exits.length === 0) {
    session.done = true;
    session.success = false; // stuck, dead end
  }
}

function cmdAct(path: string, actionId: string, uncertainty?: string) {
  const session = loadSession(path);
  if (session.done) throw new Error("Episode already finished");
  const legal = isLegal(session, actionId);
  const log: StepLog = {
    arm: session.arm,
    taskId: session.levelId,
    episode: session.episode,
    step: session.stepIndex,
    actionId,
    wasLegal: legal,
    llmSelfReportedUncertainty: uncertainty,
    llmCalls: 1,
    jevCalls: 0,
    llmLatencyMs: 0,
    jevLatencyMs: 0,
  };
  session.steps.push(log);
  if (!legal) {
    session.illegalActionCount++;
    session.done = true;
    session.success = false;
  } else {
    applyAction(session, actionId);
  }
  saveSession(path, session);
  printStatus(session);
}

async function cmdPropose(path: string, actionIdsCsv: string) {
  const session = loadSession(path);
  if (session.done) throw new Error("Episode already finished");
  const level = LEVELS[session.levelId];
  const room = level.rooms[session.roomId];
  const goalRoom = level.rooms[level.goalId];
  const situation =
    `You are in: ${room.description}\n` + `Goal: reach the room described as "${goalRoom.description}".`;

  const proposedIds = actionIdsCsv.split(",").map((s) => s.trim());
  const candidates = room.exits
    .filter((e) => proposedIds.includes(e.actionLabel))
    .map((e) => ({ id: e.actionLabel, describe: () => e.hint }));

  if (candidates.length === 0) {
    session.attemptsThisStep++;
    session.escalationCount++;
    saveSession(path, session);
    console.log(
      JSON.stringify(
        {
          escalated: true,
          reason: "none of the proposed actionIds were legal",
          attempt: session.attemptsThisStep,
          maxRetries: MAX_ESCALATION_RETRIES,
        },
        null,
        2
      )
    );
    if (session.attemptsThisStep > MAX_ESCALATION_RETRIES) {
      session.done = true;
      session.success = false;
      saveSession(path, session);
      console.log(JSON.stringify({ done: true, success: false, reason: "escalation retries exhausted" }, null, 2));
    }
    return;
  }

  const arb = await jevArbitrate(situation, candidates, JEV_INSTRUCTIONS);
  const log: StepLog = {
    arm: session.arm,
    taskId: session.levelId,
    episode: session.episode,
    step: session.stepIndex,
    actionId: null,
    wasLegal: true,
    llmCalls: 1,
    jevCalls: 1,
    llmLatencyMs: 0,
    jevLatencyMs: arb.latencyMs,
    jevConfidence: arb.confidence,
    jevProbabilities: arb.probabilities,
    jevInputTokens: arb.inputTokens,
    jevOutputTokens: arb.outputTokens,
  };

  if (arb.confidence >= CONFIDENCE_THRESHOLD) {
    log.actionId = arb.pickedId;
    log.escalated = false;
    session.steps.push(log);
    applyAction(session, arb.pickedId);
    saveSession(path, session);
    console.log(
      JSON.stringify(
        { escalated: false, jevPicked: arb.pickedId, confidence: arb.confidence, probabilities: arb.probabilities },
        null,
        2
      )
    );
    printStatus(session);
  } else {
    log.escalated = true;
    session.steps.push(log);
    session.attemptsThisStep++;
    session.escalationCount++;
    const exhausted = session.attemptsThisStep > MAX_ESCALATION_RETRIES;
    if (exhausted) {
      session.done = true;
      session.success = false;
    }
    saveSession(path, session);
    console.log(
      JSON.stringify(
        {
          escalated: true,
          jevPicked: arb.pickedId,
          confidence: arb.confidence,
          probabilities: arb.probabilities,
          reason: `confidence ${arb.confidence} below threshold ${CONFIDENCE_THRESHOLD}`,
          attempt: session.attemptsThisStep,
          maxRetries: MAX_ESCALATION_RETRIES,
          instructionsIfNotExhausted: exhausted
            ? undefined
            : "Propose different or reordered candidates by calling `propose` again.",
          done: exhausted,
        },
        null,
        2
      )
    );
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "new") {
    const [levelId, arm, episodeStr, path] = args;
    cmdNew(levelId, arm as ArmName, Number(episodeStr), path);
  } else if (cmd === "status") {
    cmdStatus(args[0]);
  } else if (cmd === "act") {
    cmdAct(args[0], args[1], args[2]);
  } else if (cmd === "propose") {
    await cmdPropose(args[0], args[1]);
  } else if (cmd === "dump") {
    if (!existsSync(args[0])) throw new Error("session file not found");
    console.log(readFileSync(args[0], "utf-8"));
  } else {
    console.error(
      "Usage:\n" +
        "  tsx interactive.ts new <levelId> <arm> <episode> <sessionPath>\n" +
        "  tsx interactive.ts status <sessionPath>\n" +
        "  tsx interactive.ts act <sessionPath> <actionId> [uncertainty]\n" +
        "  tsx interactive.ts propose <sessionPath> <actionId1,actionId2,...>\n" +
        "  tsx interactive.ts dump <sessionPath>"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
