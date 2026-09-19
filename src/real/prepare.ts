import { mkdirSync, writeFileSync } from "node:fs";
import { loadItems } from "./common.js";

// Blind batches for the Claude subagents: gold labels are stripped, so a
// subagent that only reads its batch file cannot see the answers.
const BATCH_SIZE = 25;
mkdirSync("data/batches", { recursive: true });
const items = loadItems();
const byDiscipline = new Map<string, typeof items>();
for (const it of items) (byDiscipline.get(it.discipline) ?? byDiscipline.set(it.discipline, []).get(it.discipline)!).push(it);

const manifest: string[] = [];
for (const [disc, list] of byDiscipline) {
  const nBatches = Math.ceil(list.length / BATCH_SIZE);
  const per = Math.ceil(list.length / nBatches);
  for (let b = 0; b < nBatches; b++) {
    const slice = list.slice(b * per, (b + 1) * per).map(({ gold: _g, dataset: _d, ...blind }) => blind);
    const path = `data/batches/${disc}_${b + 1}.json`;
    writeFileSync(path, JSON.stringify(slice, null, 1));
    manifest.push(`${path} (${slice.length} items)`);
  }
}
console.log(manifest.join("\n"));
