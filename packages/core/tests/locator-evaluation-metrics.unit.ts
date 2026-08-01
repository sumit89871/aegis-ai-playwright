import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateLocatorEvaluationMetrics,
  evaluateLocatorEvaluationThresholds,
  LOCATOR_EVALUATION_BASELINE,
  validateLocatorEvaluationThresholds,
} from "../src/index.ts";
import type {
  LocatorDiagnosisConclusion,
  LocatorEvaluationCaseResult,
} from "../src/index.ts";

const emptySafety = Object.freeze({
  inventedCandidateCount: 0,
  unknownCandidateIdCount: 0,
  xpathRecommendationCount: 0,
  positionalRepairCount: 0,
  forceRecommendationCount: 0,
  sourcePatchRecommendationCount: 0,
  shellCommandRecommendationCount: 0,
});

function conclusion(
  classification: LocatorDiagnosisConclusion["classification"],
  recommendationStatus: LocatorDiagnosisConclusion["recommendationStatus"],
  candidateIds: readonly string[] = [],
  confidence: LocatorDiagnosisConclusion["confidence"] = "high",
): LocatorDiagnosisConclusion {
  return {
    classification,
    recommendationStatus,
    confidence,
    summary: "Reviewed result.",
    originalLocatorAssessment: { strategy: "role", issue: "Reviewed." },
    pageStateAssessment: { ready: true, reason: "Ready." },
    rankedCandidates: candidateIds.map((candidateId, index) => ({
      candidateId,
      rank: index + 1,
      confidence,
      reason: "Reviewed candidate.",
    })),
    recommendedNextStep: "Review manually.",
    missingEvidence: [],
    limitations: [],
  };
}

function result(
  caseId: string,
  expectedClassification: LocatorDiagnosisConclusion["classification"],
  expectedStatus: LocatorDiagnosisConclusion["recommendationStatus"],
  actual: LocatorDiagnosisConclusion,
  options: {
    readonly locatorChangeAllowed?: boolean;
    readonly acceptable?: readonly string[];
    readonly preferred?: readonly string[];
    readonly forbidden?: readonly string[];
    readonly safety?: LocatorEvaluationCaseResult["safety"];
  } = {},
): LocatorEvaluationCaseResult {
  return {
    caseId,
    title: caseId,
    category: options.locatorChangeAllowed ? "locator-change" : "no-change",
    expected: {
      classification: expectedClassification,
      recommendationStatus: expectedStatus,
      acceptableCandidateIds: options.acceptable ?? [],
      preferredCandidateIds: options.preferred ?? [],
      forbiddenCandidateIds: options.forbidden ?? [],
      locatorChangeAllowed: options.locatorChangeAllowed ?? false,
      minimumConfidence: "low",
    },
    actual,
    deterministic: actual,
    candidateIds: actual.rankedCandidates.map(({ candidateId }) => candidateId),
    safety: options.safety ?? emptySafety,
    aiComparison: {
      rankingChanged: false,
      rankingImproved: false,
      rankingWorsened: false,
      classificationConflict: false,
      outputRejected: false,
      fallbackUsed: false,
    },
  };
}

const sample = [
  result(
    "A",
    "selector-no-match",
    "candidates-available",
    conclusion("selector-no-match", "candidates-available", [
      "LOCATOR-002",
      "LOCATOR-001",
    ]),
    {
      locatorChangeAllowed: true,
      acceptable: ["LOCATOR-001"],
      preferred: ["LOCATOR-001"],
      forbidden: ["LOCATOR-002"],
    },
  ),
  result(
    "B",
    "element-not-enabled",
    "no-change-recommended",
    conclusion("element-not-enabled", "no-change-recommended"),
  ),
  result(
    "C",
    "not-a-locator-failure",
    "not-applicable",
    conclusion("not-a-locator-failure", "not-applicable", [], "medium"),
  ),
  result(
    "D",
    "selector-no-match",
    "insufficient-evidence",
    conclusion("unknown-locator-failure", "insufficient-evidence", [], "low"),
  ),
] as const;

await describe("locator evaluation metrics", async () => {
  await it("calculates accuracy, confusion, precision, and recall", () => {
    const metrics = calculateLocatorEvaluationMetrics(sample);
    assert.equal(metrics.classification.accuracy.value, 0.75);
    assert.ok(
      metrics.classification.confusionMatrix.some(
        (entry) =>
          entry.expected === "selector-no-match" &&
          entry.actual === "unknown-locator-failure",
      ),
    );
    const noMatch = metrics.classification.perClass.find(
      (entry) => entry.classification === "selector-no-match",
    );
    assert.ok(noMatch);
    assert.equal(noMatch.precision.value, 1);
    assert.equal(noMatch.recall.value, 0.5);
  });

  await it("calculates recommendation and no-change precision/recall", () => {
    const metrics = calculateLocatorEvaluationMetrics(sample);
    assert.equal(metrics.recommendation.accuracy.value, 1);
    assert.equal(metrics.recommendation.noChangePrecision.value, 1);
    assert.equal(metrics.recommendation.noChangeRecall.value, 1);
  });

  await it("calculates top ranks, mean rank, and forbidden promotion", () => {
    const metrics = calculateLocatorEvaluationMetrics(sample);
    assert.equal(metrics.ranking.top1AcceptableRate.value, 0);
    assert.equal(metrics.ranking.top3AcceptableRate.value, 1);
    assert.equal(metrics.ranking.meanFirstAcceptableRank, 2);
    assert.equal(metrics.ranking.forbiddenCandidatePromotionRate.value, 1);
  });

  await it("calculates safety and confidence metrics", () => {
    const unsafe = result(
      "E",
      "element-not-enabled",
      "no-change-recommended",
      conclusion("element-not-enabled", "candidates-available"),
      { safety: { ...emptySafety, xpathRecommendationCount: 1 } },
    );
    const metrics = calculateLocatorEvaluationMetrics([...sample, unsafe]);
    assert.equal(metrics.safety.xpathRecommendationCount, 1);
    assert.equal(metrics.safety.incorrectLocatorChangeCount, 1);
    assert.equal(metrics.confidence.highConfidenceIncorrect, 2);
  });

  await it("treats a forbidden top rank as unsafe and high-confidence incorrect", () => {
    const metrics = calculateLocatorEvaluationMetrics([sample[0]]);
    assert.equal(metrics.safety.unsafeRecommendationRate.value, 1);
    assert.equal(metrics.confidence.highConfidenceIncorrect, 1);
  });

  await it("represents zero denominators as null, never a fake percentage", () => {
    const metrics = calculateLocatorEvaluationMetrics([sample[1]]);
    assert.equal(metrics.ranking.top1AcceptableRate.value, null);
    assert.equal(metrics.ranking.top1AcceptableRate.denominator, 0);
  });

  await it("orders equivalent metric input deterministically", () => {
    assert.deepEqual(
      calculateLocatorEvaluationMetrics(sample),
      calculateLocatorEvaluationMetrics([...sample].reverse()),
    );
  });
});

await describe("locator evaluation thresholds", async () => {
  await it("passes compliant metrics and returns stable IDs", () => {
    const perfect = calculateLocatorEvaluationMetrics([
      result(
        "A",
        "element-not-enabled",
        "no-change-recommended",
        conclusion("element-not-enabled", "no-change-recommended"),
      ),
      result(
        "B",
        "selector-no-match",
        "candidates-available",
        conclusion("selector-no-match", "candidates-available", [
          "LOCATOR-001",
        ]),
        {
          locatorChangeAllowed: true,
          acceptable: ["LOCATOR-001"],
          preferred: ["LOCATOR-001"],
        },
      ),
    ]);
    assert.equal(evaluateLocatorEvaluationThresholds(perfect).status, "pass");
  });

  await it("fails quality and safety thresholds explicitly", () => {
    const evaluation = evaluateLocatorEvaluationThresholds(
      calculateLocatorEvaluationMetrics(sample),
    );
    assert.equal(evaluation.status, "fail");
    assert.ok(
      evaluation.failedThresholdIds.includes("classification-accuracy"),
    );
    assert.ok(evaluation.failedThresholdIds.includes("top-1-acceptable-rate"));
  });

  await it("rejects invalid or missing threshold values", () => {
    assert.throws(
      () =>
        validateLocatorEvaluationThresholds({
          ...LOCATOR_EVALUATION_BASELINE,
          minimumClassificationAccuracy: 2,
        }),
      /between 0 and 1/u,
    );
    assert.throws(
      () =>
        validateLocatorEvaluationThresholds({
          ...LOCATOR_EVALUATION_BASELINE,
          schemaVersion: "2.0.0",
        }),
      /unsupported/u,
    );
    assert.throws(
      () =>
        validateLocatorEvaluationThresholds({
          ...LOCATOR_EVALUATION_BASELINE,
          maximumUnsafeRecommendationRate: 0.01,
        }),
      /must remain zero/u,
    );
  });
});
