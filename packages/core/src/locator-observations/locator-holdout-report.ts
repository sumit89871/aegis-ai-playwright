import type { EvaluationRate } from "../locator-evaluation/evaluation-metrics.ts";
import type { LocatorHoldoutResult } from "./locator-holdout-runner.ts";

function percentage(rate: EvaluationRate): string {
  return rate.value === null
    ? "N/A (0 eligible observations)"
    : `${(rate.value * 100).toFixed(1)}% (${String(rate.numerator)}/${String(rate.denominator)})`;
}

function safe(value: string): string {
  return value
    .replace(/[<>]/gu, "")
    .replace(/[`|]/gu, "\\$&")
    .replace(/\r?\n/gu, " ")
    .slice(0, 500);
}

export function renderLocatorHoldoutMarkdown(
  result: LocatorHoldoutResult,
): string {
  const metrics = result.metrics;
  const lines = [
    "# Locator-diagnosis pilot/calibration evaluation",
    "",
    "## Executive summary",
    "",
    `- Status: ${result.status}`,
    `- Reviewed observations: ${String(result.reviewedObservationCount)}`,
    `- Analysis mode: ${result.mode}`,
    `- Meaningful sample: ${result.meaningful ? "yes" : "no"}`,
    `- Notice: ${safe(result.notice)}`,
    "",
    "## Source composition",
    "",
    ...Object.entries(result.sourceCounts).map(
      ([source, count]) => `- ${source}: ${String(count)}`,
    ),
    "",
    "## Metrics",
    "",
    `- Classification accuracy: ${percentage(metrics.classification.accuracy)}`,
    `- Recommendation-status accuracy: ${percentage(metrics.recommendation.accuracy)}`,
    `- No-change precision: ${percentage(metrics.recommendation.noChangePrecision)}`,
    `- No-change recall: ${percentage(metrics.recommendation.noChangeRecall)}`,
    `- Top-1 acceptable candidate: ${percentage(metrics.ranking.top1AcceptableRate)}`,
    `- Top-3 acceptable candidate: ${percentage(metrics.ranking.top3AcceptableRate)}`,
    `- Unsafe recommendation rate: ${percentage(metrics.safety.unsafeRecommendationRate)}`,
    `- High-confidence incorrect: ${String(metrics.confidence.highConfidenceIncorrect)}`,
    "",
    "## Excluded reviews",
    "",
    `- Pending: ${String(result.excluded.pending)}`,
    `- Rejected: ${String(result.excluded.rejected)}`,
    `- Needs more evidence: ${String(result.excluded.needsMoreEvidence)}`,
    `- Missing review: ${String(result.excluded.missingReview)}`,
    "",
    "## Observation results",
    "",
    ...(result.cases.length === 0
      ? ["- No reviewed observations were evaluated."]
      : result.cases.map(
          (entry) =>
            `- ${entry.observationId}: expected ${entry.expected.classification}/${entry.expected.recommendationStatus}; actual ${entry.actual?.classification ?? "evaluation-error"}/${entry.actual?.recommendationStatus ?? "evaluation-error"}.`,
        )),
    "",
    "## Limitations",
    "",
    "- Controlled and synthetic observations are test fixtures, not real-world accuracy evidence.",
    "- Legacy reviews expose Aegis diagnosis and ranked candidate IDs, so they are pilot/calibration evidence rather than unbiased blind holdout evidence.",
    "- A repository-visible reviewed sample is not a guarantee of future production behavior.",
    "- The evaluator never applies a locator, retries an action, or modifies source.",
  ];
  return lines.join("\n").slice(0, 100_000);
}
