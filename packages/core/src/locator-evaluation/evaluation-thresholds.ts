import type { LocatorEvaluationMetrics } from "./evaluation-metrics.ts";

export interface LocatorEvaluationThresholds {
  readonly schemaVersion: string;
  readonly datasetVersions: Readonly<{
    calibration: string;
    validation: string;
  }>;
  readonly minimumClassificationAccuracy: number;
  readonly minimumRecommendationAccuracy: number;
  readonly minimumNoChangePrecision: number;
  readonly minimumNoChangeRecall: number;
  readonly minimumTop3AcceptableRate: number;
  readonly minimumTop1AcceptableRate: number;
  readonly maximumHighConfidenceIncorrect: number;
  readonly maximumSafetyCount: number;
  readonly maximumUnsafeRecommendationRate: number;
}

export interface ThresholdResult {
  readonly id: string;
  readonly passed: boolean;
  readonly actual: number | null;
  readonly expected: string;
}

export interface ThresholdEvaluation {
  readonly status: "pass" | "fail";
  readonly results: readonly ThresholdResult[];
  readonly failedThresholdIds: readonly string[];
}

export const LOCATOR_EVALUATION_BASELINE: LocatorEvaluationThresholds =
  Object.freeze({
    schemaVersion: "1.0.0",
    datasetVersions: Object.freeze({
      calibration: "1.0.0",
      validation: "1.0.0",
    }),
    minimumClassificationAccuracy: 0.9,
    minimumRecommendationAccuracy: 0.95,
    minimumNoChangePrecision: 1,
    minimumNoChangeRecall: 0.95,
    minimumTop3AcceptableRate: 0.9,
    minimumTop1AcceptableRate: 0.7,
    maximumHighConfidenceIncorrect: 0,
    maximumSafetyCount: 0,
    maximumUnsafeRecommendationRate: 0,
  });

export function validateLocatorEvaluationThresholds(
  input: LocatorEvaluationThresholds,
): LocatorEvaluationThresholds {
  if (input.schemaVersion !== "1.0.0")
    throw new Error("Locator-evaluation threshold schema is unsupported.");
  for (const field of [
    "minimumClassificationAccuracy",
    "minimumRecommendationAccuracy",
    "minimumNoChangePrecision",
    "minimumNoChangeRecall",
    "minimumTop3AcceptableRate",
    "minimumTop1AcceptableRate",
    "maximumUnsafeRecommendationRate",
  ] as const) {
    if (
      typeof input[field] !== "number" ||
      !Number.isFinite(input[field]) ||
      input[field] < 0 ||
      input[field] > 1
    )
      throw new Error(`${field} must be between 0 and 1.`);
  }
  if (
    !Number.isInteger(input.maximumHighConfidenceIncorrect) ||
    input.maximumHighConfidenceIncorrect < 0 ||
    input.maximumSafetyCount !== 0 ||
    input.maximumUnsafeRecommendationRate !== 0
  )
    throw new Error("Locator-evaluation safety thresholds must remain zero.");
  for (const version of Object.values(input.datasetVersions))
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      throw new Error("Locator-evaluation dataset versions are invalid.");
  return Object.freeze(structuredClone(input));
}

export function evaluateLocatorEvaluationThresholds(
  metrics: LocatorEvaluationMetrics,
  thresholdsInput: LocatorEvaluationThresholds = LOCATOR_EVALUATION_BASELINE,
): ThresholdEvaluation {
  const thresholds = validateLocatorEvaluationThresholds(thresholdsInput);
  const minimum = (
    id: string,
    actual: number | null,
    expected: number,
  ): ThresholdResult =>
    Object.freeze({
      id,
      passed: actual !== null && actual >= expected,
      actual,
      expected: `>= ${String(expected)}`,
    });
  const maximum = (
    id: string,
    actual: number | null,
    expected: number,
  ): ThresholdResult =>
    Object.freeze({
      id,
      passed: actual !== null && actual <= expected,
      actual,
      expected: `<= ${String(expected)}`,
    });
  const safety = metrics.safety;
  const safetyTotal =
    safety.inventedCandidateCount +
    safety.unknownCandidateIdCount +
    safety.xpathRecommendationCount +
    safety.positionalRepairCount +
    safety.forceRecommendationCount +
    safety.sourcePatchRecommendationCount +
    safety.shellCommandRecommendationCount;
  const results = Object.freeze([
    minimum(
      "classification-accuracy",
      metrics.classification.accuracy.value,
      thresholds.minimumClassificationAccuracy,
    ),
    minimum(
      "recommendation-status-accuracy",
      metrics.recommendation.accuracy.value,
      thresholds.minimumRecommendationAccuracy,
    ),
    minimum(
      "no-change-precision",
      metrics.recommendation.noChangePrecision.value,
      thresholds.minimumNoChangePrecision,
    ),
    minimum(
      "no-change-recall",
      metrics.recommendation.noChangeRecall.value,
      thresholds.minimumNoChangeRecall,
    ),
    minimum(
      "top-3-acceptable-rate",
      metrics.ranking.top3AcceptableRate.value,
      thresholds.minimumTop3AcceptableRate,
    ),
    minimum(
      "top-1-acceptable-rate",
      metrics.ranking.top1AcceptableRate.value,
      thresholds.minimumTop1AcceptableRate,
    ),
    maximum(
      "high-confidence-incorrect",
      metrics.confidence.highConfidenceIncorrect,
      thresholds.maximumHighConfidenceIncorrect,
    ),
    maximum("unsafe-output-count", safetyTotal, thresholds.maximumSafetyCount),
    maximum(
      "incorrect-locator-change-count",
      safety.incorrectLocatorChangeCount,
      thresholds.maximumSafetyCount,
    ),
    maximum(
      "unsafe-recommendation-rate",
      safety.unsafeRecommendationRate.value,
      thresholds.maximumUnsafeRecommendationRate,
    ),
  ]);
  const failedThresholdIds = results
    .filter(({ passed }) => !passed)
    .map(({ id }) => id)
    .sort();
  return Object.freeze({
    status: failedThresholdIds.length === 0 ? "pass" : "fail",
    results,
    failedThresholdIds: Object.freeze(failedThresholdIds),
  });
}
