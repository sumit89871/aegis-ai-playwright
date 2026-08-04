import type { EvaluationRate } from "./evaluation-metrics.ts";
import type { LocatorEvaluationRunResult } from "./evaluation-runner.ts";
import type { LocatorEvaluationMetricSnapshot } from "./evaluation-calibration.ts";

function percentage(metric: EvaluationRate): string {
  return metric.value === null
    ? `N/A (0 eligible cases)`
    : `${(metric.value * 100).toFixed(1)}% (${String(metric.numerator)}/${String(metric.denominator)})`;
}

function safe(value: string): string {
  return value
    .replace(/[<>]/gu, "")
    .replace(/[`|]/gu, "\\$&")
    .replace(/\r?\n/gu, " ")
    .slice(0, 500);
}

function failedCaseReason(
  entry: LocatorEvaluationRunResult["cases"][number],
): string {
  if (entry.actual === null) return entry.error ?? "evaluation failed safely";
  if (entry.actual.classification !== entry.expected.classification)
    return "classification mismatch";
  if (entry.actual.recommendationStatus !== entry.expected.recommendationStatus)
    return "recommendation-status mismatch";
  const confidenceOrder = { low: 0, medium: 1, high: 2 } as const;
  if (
    confidenceOrder[entry.actual.confidence] <
    confidenceOrder[entry.expected.minimumConfidence]
  )
    return `confidence ${entry.actual.confidence} is below reviewed minimum ${entry.expected.minimumConfidence}`;
  return "no acceptable candidate appeared in the first three ranks";
}

export function renderLocatorEvaluationMarkdown(
  result: LocatorEvaluationRunResult,
  baselineComparison?: LocatorEvaluationMetricSnapshot,
): string {
  const metrics = result.metrics;
  const failed = result.cases.filter(({ caseId }) =>
    result.failedCaseIds.includes(caseId),
  );
  const lines = [
    "# Locator-diagnosis evaluation",
    "",
    "## Executive summary",
    "",
    `- Status: ${result.status.toUpperCase()}`,
    `- Dataset: ${result.dataset.id} ${result.dataset.version}`,
    `- Cases: ${String(result.dataset.caseCount)}`,
    `- Mode: ${result.mode}`,
    "- Scope: controlled repository-visible benchmark; this does not prove production accuracy.",
    "",
    "## Threshold results",
    "",
    ...result.thresholdEvaluation.results.map(
      (entry) =>
        `- ${entry.passed ? "PASS" : "FAIL"} ${entry.id}: ${entry.actual === null ? "N/A" : String(entry.actual)} (${entry.expected})`,
    ),
    "",
    "## Classification metrics",
    "",
    `- Exact accuracy: ${percentage(metrics.classification.accuracy)}`,
    `- Unknown/abstention rate: ${percentage(metrics.classification.abstentionRate)}`,
    "",
    "| Classification | Precision | Recall |",
    "| --- | ---: | ---: |",
    ...metrics.classification.perClass.map(
      ({ classification, precision, recall }) =>
        `| ${safe(classification)} | ${percentage(precision)} | ${percentage(recall)} |`,
    ),
    "",
    "## Recommendation metrics",
    "",
    `- Exact status accuracy: ${percentage(metrics.recommendation.accuracy)}`,
    `- No-change precision: ${percentage(metrics.recommendation.noChangePrecision)}`,
    `- No-change recall: ${percentage(metrics.recommendation.noChangeRecall)}`,
    `- Candidates-available accuracy: ${percentage(metrics.recommendation.candidatesAvailableAccuracy)}`,
    `- Not-applicable accuracy: ${percentage(metrics.recommendation.notApplicableAccuracy)}`,
    `- Insufficient-evidence accuracy: ${percentage(metrics.recommendation.insufficientEvidenceAccuracy)}`,
    `- Collection-unavailable accuracy: ${percentage(metrics.recommendation.collectionUnavailableAccuracy)}`,
    "",
    "## Candidate-ranking metrics",
    "",
    `- Top-1 acceptable: ${percentage(metrics.ranking.top1AcceptableRate)}`,
    `- Top-3 acceptable: ${percentage(metrics.ranking.top3AcceptableRate)}`,
    `- Preferred top-1: ${percentage(metrics.ranking.preferredTop1Rate)}`,
    `- Mean first acceptable rank: ${metrics.ranking.meanFirstAcceptableRank === null ? "N/A" : String(metrics.ranking.meanFirstAcceptableRank)}`,
    `- No acceptable candidate returned: ${String(metrics.ranking.noAcceptableCandidateReturned)}`,
    `- Forbidden candidate at top 1: ${percentage(metrics.ranking.forbiddenCandidatePromotionRate)}`,
    `- Forbidden candidate within top 3: ${percentage(metrics.ranking.forbiddenCandidateTop3PromotionRate)}`,
    "",
    "## Safety metrics",
    "",
    `- Unsafe recommendation rate: ${percentage(metrics.safety.unsafeRecommendationRate)}`,
    `- Invented/unknown candidates: ${String(metrics.safety.inventedCandidateCount)}/${String(metrics.safety.unknownCandidateIdCount)}`,
    `- XPath/positional/force: ${String(metrics.safety.xpathRecommendationCount)}/${String(metrics.safety.positionalRepairCount)}/${String(metrics.safety.forceRecommendationCount)}`,
    `- Patches/commands: ${String(metrics.safety.sourcePatchRecommendationCount)}/${String(metrics.safety.shellCommandRecommendationCount)}`,
    "",
    "## Confidence metrics",
    "",
    `- High-confidence correct: ${String(metrics.confidence.highConfidenceCorrect)}`,
    `- High-confidence incorrect: ${String(metrics.confidence.highConfidenceIncorrect)}`,
    `- Distribution: high ${String(metrics.confidence.distribution.high)}, medium ${String(metrics.confidence.distribution.medium)}, low ${String(metrics.confidence.distribution.low)}`,
    `- Accuracy by confidence: high ${percentage(metrics.confidence.accuracyByLevel.high)}, medium ${percentage(metrics.confidence.accuracyByLevel.medium)}, low ${percentage(metrics.confidence.accuracyByLevel.low)}`,
    `- Confidence-floor agreement: ${percentage(metrics.confidence.floorAgreement)}`,
    "",
    "## Abstention metrics",
    "",
    `- Correct abstention decisions: ${percentage(metrics.abstention.correctness)}`,
    `- Appropriate abstentions: ${String(metrics.abstention.appropriateCount)}`,
    `- Inappropriate abstentions: ${String(metrics.abstention.inappropriateCount)}`,
    `- Expected abstention but recommendation returned: ${String(metrics.abstention.expectedButRecommendationMadeCount)}`,
    "",
    "## Confusion matrix",
    "",
    "| Expected | Actual | Count |",
    "| --- | --- | ---: |",
    ...metrics.classification.confusionMatrix.map(
      ({ expected, actual, count }) =>
        `| ${safe(expected)} | ${safe(actual)} | ${String(count)} |`,
    ),
    "",
    "## Failed cases",
    "",
    ...(failed.length === 0
      ? ["- None."]
      : failed.map((entry) => {
          const ranks =
            entry.actual?.rankedCandidates
              .map(({ candidateId, rank }) => `${candidateId}:${String(rank)}`)
              .join(", ") ?? "none";
          return `- ${entry.caseId}: expected ${entry.expected.classification}/${entry.expected.recommendationStatus}; actual ${entry.actual?.classification ?? "evaluation-error"}/${entry.actual?.recommendationStatus ?? "evaluation-error"}; ranks ${safe(ranks)}; reason: ${safe(failedCaseReason(entry))}.`;
        })),
    "",
    "## Deterministic versus AI comparison",
    "",
    `- Rankings changed: ${String(result.aiComparison.rankingChanged)}`,
    `- Rankings improved: ${String(result.aiComparison.rankingImproved)}`,
    `- Rankings worsened: ${String(result.aiComparison.rankingWorsened)}`,
    `- Classification conflicts: ${String(result.aiComparison.classificationConflicts)}`,
    `- Rejected AI outputs: ${String(result.aiComparison.rejectedOutputs)}`,
    `- Safe fallbacks: ${String(result.aiComparison.fallbackCount)}`,
    "",
    "## Before/after calibration comparison",
    "",
    ...(baselineComparison === undefined
      ? ["- No comparison supplied for this report."]
      : [
          `- Classification: ${(baselineComparison.classificationAccuracy * 100).toFixed(1)}% -> ${percentage(metrics.classification.accuracy)}`,
          `- Recommendation status: ${(baselineComparison.recommendationAccuracy * 100).toFixed(1)}% -> ${percentage(metrics.recommendation.accuracy)}`,
          `- Unsafe recommendation rate: ${(baselineComparison.unsafeRecommendationRate * 100).toFixed(1)}% -> ${percentage(metrics.safety.unsafeRecommendationRate)}`,
          `- Baseline failed cases: ${baselineComparison.failedCaseIds.join(", ") || "none"}`,
        ]),
    "",
    "## Remaining weaknesses",
    "",
    "- Synthetic and controlled cases cannot reproduce every production UI state.",
    "- Candidate correctness still requires human confirmation of business intent.",
    "- Mock-AI comparisons do not represent a real model.",
    "",
    "## Recommended next action",
    "",
    "Review failed cases and add independent shadow-mode observations before considering any isolated healing experiment.",
    "",
    "The evaluator never applies a locator, retries an action, or modifies source.",
  ];
  return lines.join("\n").slice(0, 100_000);
}
