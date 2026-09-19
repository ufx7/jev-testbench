import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { calibration } from "../collab/calibration.js";
import { exactMcNemar, wilsonInterval } from "../collab/stats.js";
import { ClaudeRecord, JevRecord, loadItems } from "./common.js";

const items = loadItems();
const jev = new Map<string, JevRecord>(
  (JSON.parse(readFileSync("results/real/jev.json", "utf-8")) as JevRecord[]).map((r) => [r.id, r])
);
const claude = new Map<string, ClaudeRecord>();
for (const f of readdirSync("results/real").filter((f) => f.startsWith("claude_"))) {
  for (const r of JSON.parse(readFileSync(`results/real/${f}`, "utf-8")) as ClaudeRecord[]) claude.set(r.id, r);
}

const complete = items.filter((i) => jev.has(i.id) && claude.has(i.id));
console.log(`items with both arms: ${complete.length}/${items.length}`);
const disciplines = [...new Set(complete.map((i) => i.discipline))];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const ci = (k: number, n: number) => {
  const w = wilsonInterval(k, n);
  return `${pct(k / n)} [${pct(w.low)}-${pct(w.high)}]`;
};

interface Row { id: string; d: string; gold: string; c: string; cc: number; j: string; jc: number; jp: Record<string, number> }
const rows: Row[] = complete.map((i) => ({
  id: i.id, d: i.discipline, gold: i.gold,
  c: claude.get(i.id)!.label, cc: claude.get(i.id)!.confidence / 100,
  j: jev.get(i.id)!.choice, jc: jev.get(i.id)!.confidence, jp: jev.get(i.id)!.probabilities,
}));
const badLabels = rows.filter((r) => !(r.c in items.find((i) => i.id === r.id)!.options));
if (badLabels.length) console.log(`WARNING: ${badLabels.length} Claude labels not in option set (counted wrong):`, badLabels.slice(0, 3).map((r) => r.c));

console.log("\n=== Accuracy vs gold (95% Wilson CI) and paired test ===");
const summary: Record<string, unknown> = {};
for (const d of [...disciplines, "ALL"]) {
  const rs = d === "ALL" ? rows : rows.filter((r) => r.d === d);
  const cOK = rs.map((r) => r.c === r.gold), jOK = rs.map((r) => r.j === r.gold);
  const kc = cOK.filter(Boolean).length, kj = jOK.filter(Boolean).length;
  const both = rs.filter((_, i) => cOK[i] && jOK[i]).length;
  const onlyC = rs.filter((_, i) => cOK[i] && !jOK[i]).length;
  const onlyJ = rs.filter((_, i) => !cOK[i] && jOK[i]).length;
  const neither = rs.length - both - onlyC - onlyJ;
  const mc = exactMcNemar(cOK, jOK);
  const majorityCount = (xs: Row[]) =>
    Math.max(...Object.values(xs.reduce((a: Record<string, number>, r) => ((a[r.gold] = (a[r.gold] ?? 0) + 1), a), {})));
  const majority =
    (d === "ALL" ? disciplines.reduce((s, dd) => s + majorityCount(rows.filter((r) => r.d === dd)), 0) : majorityCount(rs)) /
    rs.length;
  console.log(
    `${d.padEnd(9)} n=${rs.length} claude=${ci(kc, rs.length)} jev=${ci(kj, rs.length)} majority-baseline=${pct(majority)} | ` +
      `both=${both} onlyClaude=${onlyC} onlyJev=${onlyJ} neither=${neither} | McNemar p=${mc.pValue.toFixed(4)}${mc.significant ? " *" : ""}`
  );
  summary[d] = { n: rs.length, claude: kc / rs.length, jev: kj / rs.length, both, onlyC, onlyJ, neither, p: mc.pValue };
}

console.log("\n=== Calibration (does stated confidence predict being right?) ===");
for (const d of [...disciplines, "ALL"]) {
  const rs = d === "ALL" ? rows : rows.filter((r) => r.d === d);
  const cal = (conf: (r: Row) => number, ok: (r: Row) => boolean) => {
    const c = calibration(rs.map((r) => ({ confidence: conf(r), correct: ok(r) })), 5);
    const meanConf = rs.reduce((a, r) => a + conf(r), 0) / rs.length;
    const acc = rs.filter(ok).length / rs.length;
    return `meanConf=${pct(meanConf)} acc=${pct(acc)} ECE=${c.ece.toFixed(3)}`;
  };
  console.log(`${d.padEnd(9)} claude: ${cal((r) => r.cc, (r) => r.c === r.gold)} | jev: ${cal((r) => r.jc, (r) => r.j === r.gold)}`);
}

console.log("\n=== Arm: jev_first_cascade (Jev answers; below threshold -> Claude) ===");
console.log("threshold | " + [...disciplines, "ALL"].map((d) => `${d}: acc / toClaude`).join(" | "));
for (const t of [0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.01]) {
  const cells = [...disciplines, "ALL"].map((d) => {
    const rs = d === "ALL" ? rows : rows.filter((r) => r.d === d);
    const routed = rs.filter((r) => r.jc < t);
    const correct = rs.filter((r) => (r.jc < t ? r.c : r.j) === r.gold).length;
    return `${pct(correct / rs.length)} / ${pct(routed.length / rs.length)}`;
  });
  console.log(`${t.toFixed(2).padStart(9)} | ${cells.join(" | ")}`);
}

console.log("\n=== Arm: claude_first_check (Claude answers; Jev's probability on Claude's label flags disagreement) ===");
console.log("flag if P_jev(claude label) < s. 'flagged' items would go to a human/second look.");
for (const s of [0.1, 0.2, 0.3, 0.5]) {
  const line = [...disciplines, "ALL"].map((d) => {
    const rs = d === "ALL" ? rows : rows.filter((r) => r.d === d);
    const flagged = rs.filter((r) => (r.jp[r.c] ?? 0) < s);
    const kept = rs.filter((r) => (r.jp[r.c] ?? 0) >= s);
    const errFlag = flagged.filter((r) => r.c !== r.gold).length;
    const accKept = kept.length ? kept.filter((r) => r.c === r.gold).length / kept.length : NaN;
    return `${d}: flagged ${flagged.length} (${errFlag} were Claude errors), acc on rest ${pct(accKept)}`;
  });
  console.log(`s=${s}: ${line.join(" | ")}`);
}

const jevTokens = [...jev.values()].reduce((a, r) => a + r.inputTokens, 0);
const jevLat = [...jev.values()].map((r) => r.latencyMs).sort((a, b) => a - b);
console.log(`\nJev: ${jev.size} calls, ${jevTokens} input tokens = $${((jevTokens / 1e6) * 0.042).toFixed(4)}, median latency ${jevLat[Math.floor(jevLat.length / 2)].toFixed(0)}ms`);
writeFileSync("results/real/summary.json", JSON.stringify(summary, null, 1));
