// Statistical rigor primitives. The point of adding these: a naive
// "arm A got 80% vs arm B's 70%" comparison on n=10 is close to
// meaningless, and reporting it as a finding is exactly the failure
// mode that makes LLM evals untrustworthy (see research notes in
// README-collab.md). Two standard tools fix this for our design:
//
// - Wilson score interval: better small-n coverage than a normal
//   approximation for a single success-rate estimate.
// - Exact McNemar's test: our episodes are PAIRED (same level, same
//   episode index, run under different arms), not independent samples,
//   so a paired test on the discordant pairs is the correct comparison,
//   not a two-sample test on raw totals.

export interface WilsonInterval {
  point: number;
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonInterval {
  if (n === 0) return { point: NaN, low: NaN, high: NaN };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    point: p,
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
  };
}

export interface McNemarResult {
  n: number;
  discordantAOnly: number; // arm A succeeded, arm B failed
  discordantBOnly: number; // arm B succeeded, arm A failed
  pValue: number;
  /** Requires BOTH p < 0.05 AND at least 5 discordant pairs -- McNemar's
   * test has low power with few discordant pairs even at large n, so a
   * "significant" p-value on 1-2 discordant pairs is not trustworthy. */
  significant: boolean;
}

function logNChooseK(n: number, k: number): number {
  let res = 0;
  for (let i = 1; i <= k; i++) res += Math.log(n - k + i) - Math.log(i);
  return res;
}

function binomialTwoSidedExactP(k: number, n: number, p = 0.5): number {
  if (n === 0) return 1;
  const pmf = (i: number) => Math.exp(logNChooseK(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  const observed = pmf(k);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const pi = pmf(i);
    if (pi <= observed * (1 + 1e-9)) total += pi;
  }
  return Math.min(1, total);
}

/**
 * pairsA/pairsB must be matched by episode index on the SAME level --
 * never pass results pooled across different levels here, that
 * conflates a level's inherent difficulty with the arm effect. Call
 * this once per (level, arm-pair); report per level, don't silently
 * pool p-values across levels of a difficulty bucket.
 */
export function exactMcNemar(pairsA: boolean[], pairsB: boolean[]): McNemarResult {
  if (pairsA.length !== pairsB.length) {
    throw new Error("exactMcNemar requires matched-length paired arrays (same episodes, same level)");
  }
  let aOnly = 0;
  let bOnly = 0;
  for (let i = 0; i < pairsA.length; i++) {
    if (pairsA[i] && !pairsB[i]) aOnly++;
    if (!pairsA[i] && pairsB[i]) bOnly++;
  }
  const discordant = aOnly + bOnly;
  const pValue = discordant === 0 ? 1 : binomialTwoSidedExactP(Math.min(aOnly, bOnly), discordant);
  return {
    n: pairsA.length,
    discordantAOnly: aOnly,
    discordantBOnly: bOnly,
    pValue,
    significant: discordant >= 5 && pValue < 0.05,
  };
}
