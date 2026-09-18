import { CollabAction, CollabState, CollabTask } from "../types.js";

// A tiny worked example so the harness is runnable and checkable without
// wiring up a real LLM first. Copy this file's shape to plug in your own
// task: rooms/state can be anything, as long as describe() gives Jev (and
// your LLM) enough natural-language context to judge from.

interface RoomExit {
  targetId: string;
  actionLabel: string;
  hint: string; // what the room description implies about this exit — can be misleading
}

interface RoomDef {
  id: string;
  description: string;
  exits: RoomExit[];
}

export interface LevelDef {
  id: string;
  difficulty: "straightforward" | "ambiguous";
  goalId: string;
  rooms: Record<string, RoomDef>;
  startId: string;
}

class GridAction implements CollabAction {
  constructor(public id: string, private hint: string) {}
  describe(): string {
    return this.hint;
  }
}

class GridState implements CollabState {
  constructor(public roomId: string, private level: LevelDef) {}
  describe(): string {
    const room = this.level.rooms[this.roomId];
    return (
      `You are in: ${room.description}\n` +
      `Goal: reach the room described as "${this.level.rooms[this.level.goalId].description}".`
    );
  }
}

export function bfsOptimalSteps(level: LevelDef): number {
  const seen = new Set([level.startId]);
  let frontier = [level.startId];
  let steps = 0;
  while (frontier.length > 0) {
    if (frontier.includes(level.goalId)) return steps;
    const next: string[] = [];
    for (const id of frontier) {
      for (const exit of level.rooms[id].exits) {
        if (!seen.has(exit.targetId)) {
          seen.add(exit.targetId);
          next.push(exit.targetId);
        }
      }
    }
    frontier = next;
    steps++;
  }
  throw new Error(`Level ${level.id} has no path from start to goal`);
}

export function buildGridTask(level: LevelDef): CollabTask<GridState, GridAction> {
  const optimalSteps = bfsOptimalSteps(level);
  return {
    id: level.id,
    difficulty: level.difficulty,
    optimalSteps,
    maxSteps: optimalSteps * 3 + 4,
    createInitialState: () => new GridState(level.startId, level),
    legalActions: (state) =>
      level.rooms[state.roomId].exits.map((e) => new GridAction(e.actionLabel, e.hint)),
    applyAction: (state, action) => {
      const exit = level.rooms[state.roomId].exits.find((e) => e.actionLabel === action.id);
      if (!exit) throw new Error(`Illegal action ${action.id} applied — this should never happen`);
      return new GridState(exit.targetId, level);
    },
    isTerminal: (state) => ({
      done: state.roomId === level.goalId,
      success: state.roomId === level.goalId,
    }),
  };
}

// One straightforward level: descriptions point unambiguously the right way.
export const straightforwardLevel: LevelDef = {
  id: "F-NAV-01-straightforward",
  difficulty: "straightforward",
  startId: "hall",
  goalId: "library",
  rooms: {
    hall: {
      id: "hall",
      description: "a hall with a single lit doorway leading toward the library",
      exits: [{ targetId: "library", actionLabel: "go_through_lit_doorway", hint: "the lit doorway toward the library" }],
    },
    library: { id: "library", description: "the library, your destination", exits: [] },
  },
};

// One ambiguous level: one exit's hint sounds promising but is a dead end;
// the correct exit's hint is less flattering. This is where we expect an
// autonomous LLM to sometimes get fooled, and where Jev's judgment (or a
// scripted policy backed by it) is hypothesized to earn its keep.
export const ambiguousLevel: LevelDef = {
  id: "F-NAV-02-ambiguous",
  difficulty: "ambiguous",
  startId: "atrium",
  goalId: "archive",
  rooms: {
    atrium: {
      id: "atrium",
      description: "an atrium with two doors: one grand and gilded, one plain and unmarked",
      exits: [
        {
          targetId: "deadend",
          actionLabel: "go_through_grand_door",
          hint: "the grand, gilded door — it looks like the important way forward",
        },
        {
          targetId: "corridor",
          actionLabel: "go_through_plain_door",
          hint: "the plain, unmarked door — nothing about it suggests it matters",
        },
      ],
    },
    deadend: {
      id: "deadend",
      description: "a storage closet with no other exits — a dead end",
      exits: [],
    },
    corridor: {
      id: "corridor",
      description: "a narrow corridor leading toward the archive",
      exits: [{ targetId: "archive", actionLabel: "continue_corridor", hint: "continue down the corridor" }],
    },
    archive: { id: "archive", description: "the archive, your destination", exits: [] },
  },
};
