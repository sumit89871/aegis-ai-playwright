import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyseFailureDeterministically,
  defaultFailureAnalysisConfiguration,
  normalizeFailureEvidence,
  validateFailureAnalysisConclusion,
  validateFailureAnalysisConfiguration,
} from "../src/index.ts";
import type { FailureEvidenceInput } from "../src/index.ts";

const syntheticAbsolutePath = ["C:", "Users", "person", "repo", "test.ts"].join(
  "\\",
);

function evidence(
  overrides: Omit<FailureEvidenceInput, "test"> = {},
): ReturnType<typeof normalizeFailureEvidence> {
  return normalizeFailureEvidence({
    test: { testId: "TC-SYNTHETIC-001", title: "Synthetic failure" },
    error: { name: "Error", message: "Expected true to be false" },
    ...overrides,
  });
}

function validConclusion(): Readonly<Record<string, unknown>> & {
  readonly probableCauses: readonly Readonly<Record<string, unknown>>[];
} {
  return {
    summary: "The observed assertion failed.",
    primaryCategory: "assertion-failure",
    confidence: "low",
    probableCauses: [
      {
        cause: "The observed state did not match the assertion.",
        confidence: "low",
        evidenceIds: ["ASSERTION-001"],
      },
    ],
    recommendedActions: [
      {
        priority: "high",
        action: "Review the cited evidence.",
        owner: "tester",
      },
    ],
    locatorAssessment: {
      status: "no-change-recommended",
      reason: "No locator failure was supplied.",
    },
    missingEvidence: [],
    limitations: ["This is advisory."],
  };
}

await describe("failure analysis validation", async () => {
  await it("accepts a valid cited result", () => {
    assert.equal(
      validateFailureAnalysisConclusion(validConclusion(), ["ASSERTION-001"])
        .primaryCategory,
      "assertion-failure",
    );
  });

  for (const [field, value] of [
    ["primaryCategory", "imagined-failure"],
    ["confidence", "certain"],
  ] as const) {
    await it(`rejects invalid ${field}`, () => {
      assert.throws(
        () =>
          validateFailureAnalysisConclusion(
            { ...validConclusion(), [field]: value },
            ["ASSERTION-001"],
          ),
        /unsupported value/u,
      );
    });
  }

  await it("rejects nonexistent evidence references", () => {
    const value = validConclusion();
    assert.throws(
      () =>
        validateFailureAnalysisConclusion(
          {
            ...value,
            probableCauses: [
              { ...value.probableCauses[0], evidenceIds: ["HTTP-999"] },
            ],
          },
          ["ASSERTION-001"],
        ),
      /unknown evidence ID/u,
    );
  });

  for (const unsafe of [
    "Run PowerShell to delete the test.",
    "```ts\nexpect(true).toBe(true)\n```",
    `Inspect ${syntheticAbsolutePath}`,
    "Use <script>alert(1)</script>",
    "Authorization: Bearer synthetic-secret",
  ]) {
    await it(`rejects unsafe output: ${unsafe.slice(0, 18)}`, () => {
      assert.throws(
        () =>
          validateFailureAnalysisConclusion(
            { ...validConclusion(), summary: unsafe },
            ["ASSERTION-001"],
          ),
        /Invalid failure-analysis result/u,
      );
    });
  }

  await it("bounds result text", () => {
    assert.throws(
      () =>
        validateFailureAnalysisConclusion(
          { ...validConclusion(), summary: "x".repeat(1_001) },
          ["ASSERTION-001"],
        ),
      /bounded/u,
    );
  });

  await it("validates immutable default configuration", () => {
    const configuration = defaultFailureAnalysisConfiguration();
    assert.equal(configuration.mode, "deterministic-only");
    assert.equal(configuration.enabled, true);
    assert.ok(Object.isFrozen(configuration));
  });

  await it("rejects inconsistent disabled configuration", () => {
    assert.throws(
      () =>
        validateFailureAnalysisConfiguration({
          ...defaultFailureAnalysisConfiguration(),
          enabled: false,
        }),
      /mode disabled/u,
    );
  });

  await it("requires the deterministic advisory safety net", () => {
    assert.throws(
      () =>
        validateFailureAnalysisConfiguration({
          ...defaultFailureAnalysisConfiguration(),
          deterministicFallbackEnabled: false,
        }),
      /must remain true/u,
    );
  });

  await it("does not mutate configuration input", () => {
    const inputConfiguration = {
      ...defaultFailureAnalysisConfiguration(),
    };
    const before = structuredClone(inputConfiguration);
    validateFailureAnalysisConfiguration(inputConfiguration);
    assert.deepEqual(inputConfiguration, before);
  });
});

await describe("deterministic failure analysis", async () => {
  await it("classifies an accessibility policy failure", () => {
    const result = analyseFailureDeterministically(
      evidence({
        accessibility: {
          status: "fail",
          targetUrl: "https://example.test",
          policy: {
            critical: "fail",
            serious: "fail",
            moderate: "warn",
            minor: "info",
          },
          exclusionsApplied: [],
          summary: {
            status: "fail",
            totalViolationCount: 1,
            retainedViolationCount: 1,
            droppedViolationCount: 0,
            excludedViolationCount: 0,
            failingViolationCount: 1,
            warningViolationCount: 0,
            informationalViolationCount: 0,
            violationsByImpact: {
              critical: 0,
              serious: 1,
              moderate: 0,
              minor: 0,
            },
            retainedNodeCount: 0,
            droppedNodeCount: 15,
            durationMs: 1,
          },
          violations: [
            {
              ruleId: "color-contrast",
              impact: "serious",
              action: "fail",
              help: "Improve contrast",
              helpUrl: "https://example.test/help",
              affectedNodeCount: 15,
              retainedNodeCount: 0,
              droppedNodeCount: 15,
              nodes: [],
            },
          ],
        },
      }),
    );
    assert.equal(result.primaryCategory, "accessibility-failure");
    assert.equal(result.confidence, "high");
    assert.equal(result.locatorAssessment.status, "no-change-recommended");
    assert.deepEqual(result.probableCauses[0]?.evidenceIds, ["A11Y-001"]);
  });

  await it("classifies a readiness failure before a plain assertion", () => {
    const result = analyseFailureDeterministically(
      evidence({
        readiness: {
          status: "fail",
          definitionId: "sample-page",
          durationMs: 500,
          error: "heading unavailable",
        },
      }),
    );
    assert.equal(result.primaryCategory, "page-readiness-failure");
  });

  await it("classifies HTTP 500 as an application defect", () => {
    const result = analyseFailureDeterministically(
      evidence({
        error: {
          name: "Error",
          message: "Expected server response to succeed but request failed",
        },
        browserDiagnostics: {
          browserConsoleErrors: [],
          pageErrors: [],
          failedRequests: [],
          httpErrorResponses: [
            {
              timestamp: "x",
              method: "GET",
              url: "https://example.test/api",
              status: 500,
              statusText: "Error",
              resourceType: "fetch",
            },
          ],
          summary: {
            collectionStartedAt: "x",
            collectionEndedAt: "y",
            counts: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 0,
              httpErrorResponses: 1,
            },
            droppedEntries: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 0,
              httpErrorResponses: 0,
            },
            internalErrorCount: 0,
          },
        },
      }),
    );
    assert.equal(result.primaryCategory, "application-defect");
  });

  await it("classifies a failed request as a network failure", () => {
    const result = analyseFailureDeterministically(
      evidence({
        error: {
          name: "Error",
          message: "Expected network request to complete successfully",
        },
        browserDiagnostics: {
          browserConsoleErrors: [],
          pageErrors: [],
          httpErrorResponses: [],
          failedRequests: [
            {
              timestamp: "x",
              method: "GET",
              url: "https://example.test/api",
              resourceType: "fetch",
              failureText: "refused",
            },
          ],
          summary: {
            collectionStartedAt: "x",
            collectionEndedAt: "y",
            counts: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 1,
              httpErrorResponses: 0,
            },
            droppedEntries: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 0,
              httpErrorResponses: 0,
            },
            internalErrorCount: 0,
          },
        },
      }),
    );
    assert.equal(result.primaryCategory, "network-failure");
  });

  await it("does not treat an unrelated background request as the assertion cause", () => {
    const result = analyseFailureDeterministically(
      evidence({
        browserDiagnostics: {
          browserConsoleErrors: [],
          pageErrors: [],
          httpErrorResponses: [],
          failedRequests: [
            {
              timestamp: "x",
              method: "GET",
              url: "https://example.test/background",
              resourceType: "image",
              failureText: "cancelled",
            },
          ],
          summary: {
            collectionStartedAt: "x",
            collectionEndedAt: "y",
            counts: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 1,
              httpErrorResponses: 0,
            },
            droppedEntries: {
              browserConsoleErrors: 0,
              pageErrors: 0,
              failedRequests: 0,
              httpErrorResponses: 0,
            },
            internalErrorCount: 0,
          },
        },
      }),
    );
    assert.equal(result.primaryCategory, "assertion-failure");
  });

  await it("classifies an explicit locator error and recommends review only", () => {
    const result = analyseFailureDeterministically(
      evidence({
        error: {
          name: "Error",
          message: "strict mode violation: locator resolved to 2 elements",
        },
      }),
    );
    assert.equal(result.primaryCategory, "locator-failure");
    assert.equal(result.locatorAssessment.status, "review-recommended");
  });

  await it("uses a conservative assertion fallback", () => {
    const result = analyseFailureDeterministically(evidence());
    assert.equal(result.primaryCategory, "assertion-failure");
    assert.equal(result.confidence, "low");
  });

  await it("returns unknown when no failure record exists", () => {
    const result = analyseFailureDeterministically(
      normalizeFailureEvidence({ test: { title: "Unknown" } }),
    );
    assert.equal(result.primaryCategory, "unknown");
  });
});
