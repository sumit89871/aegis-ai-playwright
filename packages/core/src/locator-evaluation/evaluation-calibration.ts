export interface LocatorEvaluationMetricSnapshot {
  readonly datasetId: "calibration" | "validation";
  readonly datasetVersion: string;
  readonly classificationAccuracy: number;
  readonly recommendationAccuracy: number;
  readonly noChangePrecision: number;
  readonly noChangeRecall: number;
  readonly top1AcceptableRate: number;
  readonly top3AcceptableRate: number;
  readonly unsafeRecommendationRate: number;
  readonly highConfidenceIncorrect: number;
  readonly failedCaseIds: readonly string[];
}

// Captured from the reviewed 1.0.0 packs before the two case-backed
// calibration changes. This contains no timings or environment-dependent data.
export const PRE_CALIBRATION_LOCATOR_EVALUATION = Object.freeze({
  calibration: Object.freeze({
    datasetId: "calibration" as const,
    datasetVersion: "1.0.0",
    classificationAccuracy: 1,
    recommendationAccuracy: 0.95,
    noChangePrecision: 1,
    noChangeRecall: 1,
    top1AcceptableRate: 1,
    top3AcceptableRate: 1,
    unsafeRecommendationRate: 0.05,
    highConfidenceIncorrect: 1,
    failedCaseIds: Object.freeze(["LOC-EVAL-CAL-019"]),
  }),
  validation: Object.freeze({
    datasetId: "validation" as const,
    datasetVersion: "1.0.0",
    classificationAccuracy: 0.95,
    recommendationAccuracy: 0.9,
    noChangePrecision: 6 / 7,
    noChangeRecall: 1,
    top1AcceptableRate: 1,
    top3AcceptableRate: 1,
    unsafeRecommendationRate: 0.05,
    highConfidenceIncorrect: 1,
    failedCaseIds: Object.freeze(["LOC-EVAL-VAL-014", "LOC-EVAL-VAL-019"]),
  }),
});
