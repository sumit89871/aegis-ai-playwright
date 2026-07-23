import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyseUiFailure,
  createAiClient,
  defaultAiConfiguration,
  defaultFailureAnalysisConfiguration,
  MockAiProvider,
  renderFailureAnalysisMarkdown,
} from "../src/index.ts";
import type {
  FailureAnalysisConclusion,
  FailureEvidenceInput,
} from "../src/index.ts";

const input: FailureEvidenceInput = Object.freeze({
  test: Object.freeze({
    testId: "TC-SYNTHETIC-001",
    title: "Synthetic assertion",
    feature: "synthetic-ui",
  }),
  error: Object.freeze({ name: "Error", message: "Expected true to be false" }),
});

function advisory(
  category: FailureAnalysisConclusion["primaryCategory"] = "assertion-failure",
): FailureAnalysisConclusion {
  return {
    summary: "The assertion differs from the observed state.",
    primaryCategory: category,
    confidence: "medium",
    probableCauses: [
      {
        cause: "The cited assertion did not match the observed state.",
        confidence: "medium",
        evidenceIds: ["ASSERTION-001"],
      },
    ],
    recommendedActions: [
      {
        priority: "medium",
        action:
          "Review the application state represented by the cited assertion.",
        owner: "tester",
      },
    ],
    locatorAssessment: {
      status: "no-change-recommended",
      reason: "No locator failure is present in the evidence.",
    },
    missingEvidence: [],
    limitations: ["The recommendation is advisory."],
  };
}

function mockClient(
  output: unknown,
  delay?: (milliseconds: number) => Promise<void>,
): ReturnType<typeof createAiClient> {
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-deterministic-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: ["ui-failure-analysis"],
      maxRetries: 0,
    }),
    {
      providers: [
        new MockAiProvider({
          structuredOutput: output as Readonly<Record<string, unknown>>,
        }),
      ],
      ...(delay === undefined ? {} : { delay }),
    },
  );
}

await describe("failure-analysis orchestration", async () => {
  await it("runs deterministic-only analysis without an AI client", async () => {
    const report = await analyseUiFailure({ evidence: input });
    assert.equal(report.conclusion.primaryCategory, "assertion-failure");
    assert.equal(report.provenance.aiAttempted, false);
    assert.equal(report.provenance.mode, "deterministic-only");
  });

  await it("retains deterministic analysis when the AI configuration is disabled", async () => {
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({
        enabled: false,
        mode: "disabled",
      }),
      aiClient: mockClient(advisory()),
    });
    assert.equal(report.provenance.aiAttempted, false);
    assert.equal(report.conclusion.primaryCategory, "assertion-failure");
  });

  await it("accepts validated mock advisory enrichment", async () => {
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: mockClient(advisory()),
    });
    assert.equal(report.provenance.aiAttempted, true);
    assert.equal(report.provenance.aiResponseValidated, true);
    assert.equal(report.provenance.providerId, "mock");
    assert.equal(
      report.aiAdvisoryAnalysis?.primaryCategory,
      "assertion-failure",
    );
    assert.ok(report.conclusion.probableCauses.length >= 2);
  });

  await it("falls back when model output references nonexistent evidence", async () => {
    const invalid = advisory();
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: mockClient({
        ...invalid,
        probableCauses: [
          { ...invalid.probableCauses[0], evidenceIds: ["HTTP-999"] },
        ],
      }),
    });
    assert.equal(report.provenance.aiResponseValidated, false);
    assert.equal(report.provenance.lifecycleOutcome, "ai-advisory-failed");
    assert.equal(report.aiAdvisoryAnalysis, undefined);
  });

  await it("falls back on a provider failure without exposing its content", async () => {
    const client = createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: ["ui-failure-analysis"],
        maxRetries: 0,
      }),
      { providers: [new MockAiProvider({ failureMode: "permanent" })] },
    );
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: client,
    });
    assert.equal(report.conclusion.primaryCategory, "assertion-failure");
    assert.equal(report.provenance.lifecycleOutcome, "ai-advisory-failed");
  });

  await it("falls back on an AI timeout", async () => {
    const client = createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: ["ui-failure-analysis"],
        maxRetries: 0,
      }),
      { providers: [new MockAiProvider({ failureMode: "timeout" })] },
    );
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: client,
    });
    assert.equal(report.provenance.lifecycleOutcome, "ai-advisory-failed");
    assert.equal(report.conclusion.primaryCategory, "assertion-failure");
  });

  await it("falls back when cost policy blocks the request before provider use", async () => {
    const provider = new MockAiProvider({
      structuredOutput: { ...advisory() },
    });
    const client = createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: ["ui-failure-analysis"],
        maxEstimatedCostUsd: 0.000_001,
      }),
      {
        providers: [provider],
        pricing: {
          inputCostPerMillionTokens: 100,
          outputCostPerMillionTokens: 100,
        },
      },
    );
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: client,
    });
    assert.equal(report.provenance.lifecycleOutcome, "ai-advisory-failed");
    assert.equal(provider.inspections().length, 0);
  });

  await it("preserves deterministic facts on an AI category conflict", async () => {
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: mockClient(advisory("environment-failure")),
    });
    assert.equal(report.conclusion.primaryCategory, "assertion-failure");
    assert.equal(
      report.aiAdvisoryAnalysis?.primaryCategory,
      "environment-failure",
    );
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.conclusion.confidence, "low");
  });

  await it("records safe provenance without prompts or raw responses", async () => {
    const report = await analyseUiFailure({
      evidence: input,
      configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
      aiClient: mockClient(advisory()),
    });
    const serialized = JSON.stringify(report.provenance);
    assert.match(serialized, /ui-failure-analysis/u);
    assert.doesNotMatch(
      serialized,
      /systemInstruction|userMessage|probableCauses/u,
    );
  });

  await it("produces JSON serializable output", async () => {
    const report = await analyseUiFailure({ evidence: input });
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });

  await it("does not leak secrets from source evidence", async () => {
    const secret = "synthetic-analysis-secret";
    const report = await analyseUiFailure({
      evidence: {
        ...input,
        error: {
          name: "Error",
          message: `Authorization: Bearer ${secret}`,
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret, "u"));
  });
});

await describe("failure-analysis Markdown rendering", async () => {
  await it("renders stable bounded advisory Markdown", async () => {
    const report = await analyseUiFailure({ evidence: input });
    const first = renderFailureAnalysisMarkdown(report);
    const second = renderFailureAnalysisMarkdown(report);
    assert.equal(first, second);
    assert.match(first, /Advisory UI failure analysis/u);
    assert.match(first, /ASSERTION-001/u);
    assert.ok(first.length <= 20_000);
  });

  await it("escapes raw HTML and Markdown metacharacters", async () => {
    const report = await analyseUiFailure({
      evidence: {
        test: { title: "Synthetic <heading> *failure*" },
        error: { message: "Expected [value]" },
      },
    });
    const markdown = renderFailureAnalysisMarkdown(report);
    assert.doesNotMatch(markdown, /<heading>/u);
  });

  await it("does not render executable command blocks", async () => {
    const report = await analyseUiFailure({ evidence: input });
    const markdown = renderFailureAnalysisMarkdown(report);
    assert.doesNotMatch(markdown, /```/u);
  });
});
