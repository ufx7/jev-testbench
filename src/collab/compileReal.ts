import { readFileSync } from "node:fs";
import { loadAllSessions } from "./sessionToEpisode.js";
import { printReport, saveReport } from "./report.js";
import { EpisodeResult } from "./types.js";

// Merges the independent-subagent-played llm_autonomous/llm_plus_jev
// episodes (results/interactive/*.json session files) with the
// automated scripted_plus_jev run (results/interactive/scripted_plus_jev.json)
// into one report, using the same stats pipeline as the mock demo.

const interactive = loadAllSessions("results/interactive").filter(
  (e) => e.arm === "llm_autonomous" || e.arm === "llm_plus_jev"
);
const scripted: EpisodeResult[] = JSON.parse(
  readFileSync("results/interactive/scripted_plus_jev.json", "utf-8")
);

// Only the ambiguous level has all three arms with matched n -- the
// straightforward level was deliberately skipped for the interactive
// arms (forced single legal action, already a known ceiling case, not
// worth subagent budget). Report both, but flag that only the
// ambiguous level supports the pairwise arm comparison.
const all = [...interactive, ...scripted];

console.log(
  `Loaded ${interactive.length} independently-played episodes (llm_autonomous + llm_plus_jev, real subagents) ` +
    `+ ${scripted.length} automated scripted_plus_jev episodes.\n` +
    `NOTE: straightforward level only has scripted_plus_jev data (interactive arms skipped as a known trivial ceiling case).\n`
);

printReport(all);
saveReport(all);
