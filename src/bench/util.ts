import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESULTS_DIR = "results";

export function writeResult(name: string, data: unknown) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RESULTS_DIR, `${name}-${timestamp}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`\nSaved raw results to ${path}`);
}
