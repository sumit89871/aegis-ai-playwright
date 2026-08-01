import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAiClient,
  defaultAiConfiguration,
  LOCATOR_CALIBRATION_DATASET,
  LOCATOR_VALIDATION_DATASET,
  MockAiProvider,
  PRE_CALIBRATION_LOCATOR_EVALUATION,
  renderLocatorEvaluationMarkdown,
  runLocatorEvaluationDataset,
} from "../src/index.ts";
import type { AiClient } from "../src/index.ts";

function invalidClient(): AiClient {
  const provider = new MockAiProvider({
    structuredOutput: {
      classification: "selector-no-match",
      confidence: "high",
      recommendationStatus: "candidates-available",
      summary: "Invalid candidate should be rejected.",
      originalLocatorAssessment: { strategy: "css", issue: "No match." },
      pageStateAssessment: { ready: true, reason: "Ready." },
      rankedCandidates: [
        {
          candidateId: "LOCATOR-999",
          rank: 1,
          confidence: "high",
          reason: "Unknown candidate.",
        },
      ],
      recommendedNextStep: "Review manually.",
      missingEvidence: [],
      limitations: [],
    },
  });
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-invalid-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: ["ui-locator-diagnosis"],
    }),
    { providers: [provider], environment: Object.freeze({}) },
  );
}

await describe("locator evaluation runner", async () => {
  await it("passes the calibration pack in deterministic-only mode", async () => {
    const result = await runLocatorEvaluationDataset(
      LOCATOR_CALIBRATION_DATASET,
    );
    assert.equal(result.mode, "deterministic-only");
    assert.equal(result.status, "pass");
    assert.equal(result.dataset.caseCount, 20);
    assert.deepEqual(result.failedCaseIds, []);
  });

  await it("passes the independent validation pack without regression", async () => {
    const result = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
    );
    assert.equal(result.status, "pass");
    assert.equal(result.metrics.classification.accuracy.value, 1);
    assert.equal(result.metrics.recommendation.accuracy.value, 1);
    assert.equal(result.metrics.safety.unsafeRecommendationRate.value, 0);
  });

  await it("runs mock AI offline and preserves deterministic facts", async () => {
    const result = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
      { mode: "mock-ai" },
    );
    assert.equal(result.status, "pass");
    assert.equal(result.aiComparison.classificationConflicts, 0);
    assert.equal(result.aiComparison.rejectedOutputs, 0);
    assert.equal(result.aiComparison.rankingWorsened, 0);
  });

  await it("never resolves an AI client in deterministic-only mode", async () => {
    let factoryCalls = 0;
    const result = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
      {
        mode: "deterministic-only",
        aiClientFactory: () => {
          factoryCalls += 1;
          throw new Error("Deterministic evaluation must not create AI.");
        },
      },
    );
    assert.equal(result.status, "pass");
    assert.equal(factoryCalls, 0);
  });

  await it("falls back safely on invalid mock output", async () => {
    const result = await runLocatorEvaluationDataset(
      LOCATOR_CALIBRATION_DATASET,
      {
        mode: "mock-ai",
        aiClientFactory: () => invalidClient(),
      },
    );
    assert.ok(result.aiComparison.rejectedOutputs > 0);
    assert.equal(result.metrics.safety.unknownCandidateIdCount, 0);
  });

  await it("continues after a single case factory failure", async () => {
    let calls = 0;
    const result = await runLocatorEvaluationDataset(
      LOCATOR_CALIBRATION_DATASET,
      {
        mode: "mock-ai",
        aiClientFactory: () => {
          calls += 1;
          if (calls === 1) throw new Error("Synthetic factory failure.");
          return invalidClient();
        },
      },
    );
    assert.equal(result.cases.length, 20);
    assert.ok(result.cases.some(({ actual }) => actual === null));
  });

  await it("is deterministic and JSON serializable", async () => {
    const first = await runLocatorEvaluationDataset(LOCATOR_VALIDATION_DATASET);
    const second = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
    );
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.doesNotThrow(() => JSON.stringify(first));
  });

  await it("records the original benchmark and the justified improvement", async () => {
    const calibration = await runLocatorEvaluationDataset(
      LOCATOR_CALIBRATION_DATASET,
    );
    const validation = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
    );
    assert.equal(
      PRE_CALIBRATION_LOCATOR_EVALUATION.calibration.recommendationAccuracy,
      0.95,
    );
    assert.equal(calibration.metrics.recommendation.accuracy.value, 1);
    assert.equal(
      calibration.cases.find(({ caseId }) => caseId === "LOC-EVAL-CAL-019")
        ?.actual?.recommendationStatus,
      "insufficient-evidence",
    );
    assert.equal(
      PRE_CALIBRATION_LOCATOR_EVALUATION.validation.classificationAccuracy,
      0.95,
    );
    assert.equal(validation.metrics.classification.accuracy.value, 1);
    assert.equal(
      validation.cases.find(({ caseId }) => caseId === "LOC-EVAL-VAL-014")
        ?.actual?.classification,
      "selector-no-match",
    );
    assert.equal(
      validation.cases.find(({ caseId }) => caseId === "LOC-EVAL-VAL-019")
        ?.actual?.recommendationStatus,
      "insufficient-evidence",
    );
    assert.equal(validation.metrics.safety.unsafeRecommendationRate.value, 0);
  });
});

await describe("locator evaluation report", async () => {
  await it("renders stable bounded Markdown with a confusion matrix", async () => {
    const result = await runLocatorEvaluationDataset(
      LOCATOR_VALIDATION_DATASET,
    );
    const first = renderLocatorEvaluationMarkdown(
      result,
      PRE_CALIBRATION_LOCATOR_EVALUATION.validation,
    );
    const second = renderLocatorEvaluationMarkdown(
      result,
      PRE_CALIBRATION_LOCATOR_EVALUATION.validation,
    );
    assert.equal(first, second);
    assert.match(first, /Confusion matrix/u);
    assert.match(first, /controlled repository-visible benchmark/u);
    assert.doesNotMatch(first, /<script|```(?:sh|bash|powershell)/iu);
    assert.ok(first.length < 100_000);
  });
});
