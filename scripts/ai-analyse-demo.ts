import {
  analyseUiFailure,
  createAiClient,
  defaultAiConfiguration,
  defaultFailureAnalysisConfiguration,
  MockAiProvider,
  renderFailureAnalysisMarkdown,
} from "@aegis/core";

const arguments_ = process.argv.slice(2);
const unsupported = arguments_.find((argument) => argument !== "--json");
if (unsupported !== undefined) {
  throw new Error(`Unsupported AI analysis demo option '${unsupported}'.`);
}

const advisory = Object.freeze({
  summary: "The synthetic assertion differs from the supplied UI state.",
  primaryCategory: "assertion-failure",
  confidence: "medium",
  probableCauses: Object.freeze([
    Object.freeze({
      cause: "The cited assertion did not match the synthetic observed state.",
      confidence: "medium",
      evidenceIds: Object.freeze(["ASSERTION-001"]),
    }),
  ]),
  recommendedActions: Object.freeze([
    Object.freeze({
      priority: "medium",
      action:
        "Review the cited assertion and synthetic state without weakening the check.",
      owner: "tester",
    }),
  ]),
  locatorAssessment: Object.freeze({
    status: "no-change-recommended",
    reason: "The synthetic evidence does not identify a locator failure.",
  }),
  missingEvidence: Object.freeze([]),
  limitations: Object.freeze([
    "This offline demonstration uses synthetic evidence and a mock provider.",
  ]),
});

const provider = new MockAiProvider({
  structuredOutput: advisory,
  usage: Object.freeze({
    inputTokens: 100,
    outputTokens: 80,
    totalTokens: 180,
  }),
});
const aiClient = createAiClient(
  defaultAiConfiguration({
    enabled: true,
    provider: "mock",
    model: "mock-deterministic-v1",
    allowNetworkCalls: false,
    mockOnly: true,
    enabledCapabilities: ["ui-failure-analysis"],
  }),
  { providers: [provider], environment: Object.freeze({}) },
);
const report = await analyseUiFailure({
  evidence: Object.freeze({
    test: Object.freeze({
      testId: "TC-SYNTHETIC-001",
      title: "Synthetic button state is correct",
      feature: "synthetic-ui",
      suite: "smoke",
      risk: "medium",
      layer: "ui",
      requirementIds: Object.freeze(["REQ-SYNTHETIC-001"]),
    }),
    error: Object.freeze({
      name: "AssertionError",
      message: "Expected synthetic state enabled but received disabled.",
    }),
  }),
  configuration: defaultFailureAnalysisConfiguration({ mode: "mock-ai" }),
  aiClient,
});

if (
  report.provenance.providerId !== "mock" ||
  !report.provenance.aiResponseValidated
) {
  throw new Error(
    "Offline failure-analysis demo did not validate mock output.",
  );
}

const output = Object.freeze({
  status: "pass",
  networkCalls: 0,
  apiKeyRequired: false,
  report,
  markdown: renderFailureAnalysisMarkdown(report),
});

if (arguments_.includes("--json")) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log("AegisAI advisory failure-analysis demo: PASS");
  console.log("Provider: mock");
  console.log("Network calls: 0");
  console.log("API key required: no");
  console.log(`Classification: ${report.conclusion.primaryCategory}`);
  console.log(
    `Evidence: ${[...new Set(report.conclusion.probableCauses.flatMap((cause) => cause.evidenceIds))].join(", ")}`,
  );
}
