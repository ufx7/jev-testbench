import "dotenv/config";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface QuestionSpec {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria: unknown;
}

export interface SystemOneRequest {
  state: unknown;
  model?: string;
  questions: Record<string, QuestionSpec>;
}

export interface SystemOneAnswer {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  confidence?: number;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface CallResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  body: SystemOneResponse | null;
  rawText: string;
  headers: Record<string, string>;
  error?: string;
}

function apiKey(): string {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Copy .env.example to .env and fill in your key."
    );
  }
  return key;
}

export async function callSystemOne(
  req: SystemOneRequest,
  opts: { timeoutMs?: number } = {}
): Promise<CallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 30_000
  );

  const start = performance.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    const latencyMs = performance.now() - start;
    const rawText = await res.text();

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));

    let body: SystemOneResponse | null = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      // non-JSON body, leave body null and keep rawText for inspection
    }

    return {
      ok: res.ok,
      status: res.status,
      latencyMs,
      body,
      rawText,
      headers,
    };
  } catch (err) {
    const latencyMs = performance.now() - start;
    return {
      ok: false,
      status: 0,
      latencyMs,
      body: null,
      rawText: "",
      headers: {},
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}
