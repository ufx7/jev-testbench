export interface ConfidenceOutcome {
  confidence: number;
  correct: boolean;
}

export interface ReliabilityBucket {
  rangeLow: number;
  rangeHigh: number;
  n: number;
  meanConfidence: number;
  empiricalAccuracy: number;
}

/**
 * Standard reliability diagram + Expected Calibration Error. Domain-
 * agnostic: works equally on Jev's `confidence` field or on an LLM's
 * self-reported certainty, IF you can map that self-report to a number
 * (see llmUncertaintyToScore below) — which is itself part of what this
 * tool is for: finding out whether that mapping is even meaningful.
 */
export function calibration(
  pairs: ConfidenceOutcome[],
  numBuckets = 10
): { buckets: ReliabilityBucket[]; ece: number } {
  const buckets: ReliabilityBucket[] = [];
  for (let i = 0; i < numBuckets; i++) {
    const lo = i / numBuckets;
    const hi = (i + 1) / numBuckets;
    const inBucket = pairs.filter(
      (p) => p.confidence >= lo && (i === numBuckets - 1 ? p.confidence <= hi : p.confidence < hi)
    );
    if (inBucket.length === 0) {
      buckets.push({ rangeLow: lo, rangeHigh: hi, n: 0, meanConfidence: NaN, empiricalAccuracy: NaN });
      continue;
    }
    const meanConfidence = inBucket.reduce((a, p) => a + p.confidence, 0) / inBucket.length;
    const empiricalAccuracy = inBucket.filter((p) => p.correct).length / inBucket.length;
    buckets.push({ rangeLow: lo, rangeHigh: hi, n: inBucket.length, meanConfidence, empiricalAccuracy });
  }

  const total = pairs.length;
  const ece = buckets.reduce((sum, b) => {
    if (b.n === 0) return sum;
    return sum + (b.n / total) * Math.abs(b.empiricalAccuracy - b.meanConfidence);
  }, 0);

  return { buckets, ece };
}

export interface ThresholdPoint {
  threshold: number;
  autoActRate: number;
  accuracyWhenAutoActing: number;
  escalationRate: number;
}

/**
 * Sweeps a confidence threshold over already-logged (confidence, correct)
 * pairs. This costs zero extra API calls — it's answering "what threshold
 * would we have used" against data you already collected, so run this
 * before ever tuning the threshold live against the API.
 */
export function thresholdSweep(
  pairs: ConfidenceOutcome[],
  steps = 20
): ThresholdPoint[] {
  const points: ThresholdPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const threshold = i / steps;
    const autoActed = pairs.filter((p) => p.confidence >= threshold);
    const escalated = pairs.length - autoActed.length;
    points.push({
      threshold,
      autoActRate: autoActed.length / pairs.length,
      accuracyWhenAutoActing:
        autoActed.length === 0 ? NaN : autoActed.filter((p) => p.correct).length / autoActed.length,
      escalationRate: escalated / pairs.length,
    });
  }
  return points;
}
