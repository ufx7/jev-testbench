import { readFileSync, readdirSync } from "node:fs";

export interface RealItem {
  id: string;
  discipline: string;
  dataset: string;
  passage: string;
  question: string;
  options: Record<string, string>;
  gold: string;
}

export function loadItems(): RealItem[] {
  return readdirSync("data")
    .filter((f) => f.startsWith("sample_") && f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) =>
      readFileSync(`data/${f}`, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RealItem)
    );
}

export interface JevRecord {
  id: string;
  discipline: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
  inputTokens: number;
}

export interface ClaudeRecord {
  id: string;
  label: string;
  confidence: number; // 0-100, Claude's stated probability of being correct
}
