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
    readonly minimumConfidence?: LocatorDiagnosisConclusion["confidence"];
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
      minimumConfidence: options.minimumConfidence ?? "low",
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

  await it("reports exact classification and recommendation mismatches", () => {
    const correct = result(
      "MATCH",
      "selector-no-match",
      "candidates-available",
      conclusion("selector-no-match", "candidates-available", ["LOCATOR-001"]),
      {
        locatorChangeAllowed: true,
        acceptable: ["LOCATOR-001"],
      },
    );
    const mismatch = result(
      "MISMATCH",
      "selector-no-match",
      "candidates-available",
      conclusion("action-timeout", "no-change-recommended"),
    );
    const metrics = calculateLocatorEvaluationMetrics([correct, mismatch]);
    assert.equal(metrics.classification.accuracy.value, 0.5);
    assert.equal(metrics.recommendation.accuracy.value, 0.5);
    assert.equal(metrics.recommendation.candidatesAvailableAccuracy.value, 0.5);
  });

  await it("calculates top ranks, mean rank, and forbidden promotion", () => {
    const metrics = calculateLocatorEvaluationMetrics(sample);
    assert.equal(metrics.ranking.top1AcceptableRate.value, 0);
    assert.equal(metrics.ranking.top3AcceptableRate.value, 1);
    assert.equal(metrics.ranking.meanFirstAcceptableRank, 2);
    assert.equal(metrics.ranking.forbiddenCandidatePromotionRate.value, 1);
    assert.equal(metrics.ranking.forbiddenCandidateTop3PromotionRate.value, 1);
  });

  await it("distinguishes forbidden top-1 from forbidden top-3 promotion", () => {
    const metrics = calculateLocatorEvaluationMetrics([
      result(
        "TOP-THREE",
        "selector-no-match",
        "candidates-available",
        conclusion("selector-no-match", "candidates-available", [
          "LOCATOR-001",
          "LOCATOR-002",
          "LOCATOR-003",
        ]),
        {
          locatorChangeAllowed: true,
          acceptable: ["LOCATOR-001"],
          preferred: ["LOCATOR-001"],
          forbidden: ["LOCATOR-002"],
        },
      ),
    ]);
    assert.equal(metrics.ranking.top1AcceptableRate.value, 1);
    assert.equal(metrics.ranking.top3AcceptableRate.value, 1);
    assert.equal(metrics.ranking.forbiddenCandidatePromotionRate.value, 0);
    assert.equal(metrics.ranking.forbiddenCandidateTop3PromotionRate.value, 1);
  });

  await it("counts a zero-candidate result with no acceptable candidate", () => {
    const metrics = calculateLocatorEvaluationMetrics([
      result(
        "NO-CANDIDATE",
        "selector-no-match",
        "candidates-available",
        conclusion("selector-no-match", "insufficient-evidence"),
        {
          locatorChangeAllowed: true,
          acceptable: ["LOCATOR-001"],
          preferred: ["LOCATOR-001"],
        },
      ),
    ]);
    assert.equal(metrics.ranking.top1AcceptableRate.value, 0);
    assert.equal(metrics.ranking.top3AcceptableRate.value, 0);
    assert.equal(metrics.ranking.noAcceptableCandidateReturned, 1);
    assert.equal(metrics.ranking.forbiddenCandidatePromotionRate.value, 0);
    assert.equal(metrics.ranking.forbiddenCandidateTop3PromotionRate.value, 0);
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

  await it("measures confidence-floor agreement without exposing requirements", () => {
    const passing = result(
      "CONFIDENCE-PASS",
      "element-not-enabled",
      "no-change-recommended",
      conclusion("element-not-enabled", "no-change-recommended", [], "high"),
      { minimumConfidence: "medium" },
    );
    const failing = result(
      "CONFIDENCE-FAIL",
      "element-not-enabled",
      "no-change-recommended",
      conclusion("element-not-enabled", "no-change-recommended", [], "low"),
      { minimumConfidence: "high" },
    );
    assert.deepEqual(
      calculateLocatorEvaluationMetrics([passing, failing]).confidence
        .floorAgreement,
      { numerator: 1, denominator: 2, value: 0.5 },
    );
    assert.equal(
      calculateLocatorEvaluationMetrics([]).confidence.floorAgreement.value,
      null,
    );
  });

  await it("measures abstention correctness from recommendation semantics", () => {
    const appropriate = result(
      "ABSTAIN-CORRECT",
      "unknown-locator-failure",
      "insufficient-evidence",
      conclusion("unknown-locator-failure", "insufficient-evidence"),
    );
    const inappropriate = result(
      "ABSTAIN-INCORRECT",
      "selector-no-match",
      "candidates-available",
      conclusion("unknown-locator-failure", "collection-unavailable"),
    );
    const recommendationInstead = result(
      "ABSTAIN-MISSED",
      "unknown-locator-failure",
      "collection-unavailable",
      conclusion("selector-no-match", "candidates-available"),
    );
    const metrics = calculateLocatorEvaluationMetrics([
      appropriate,
      inappropriate,
      recommendationInstead,
    ]);
    assert.deepEqual(metrics.abstention, {
      appropriateCount: 1,
      inappropriateCount: 1,
      expectedButRecommendationMadeCount: 1,
      opportunityCount: 3,
      correctness: { numerator: 1, denominator: 3, value: 1 / 3 },
    });
    assert.equal(
      metrics.recommendation.collectionUnavailableAccuracy.denominator,
      1,
    );
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
    assert.equal(metrics.abstention.correctness.value, null);
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
