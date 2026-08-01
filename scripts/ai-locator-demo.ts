import {
  createAiClient,
  defaultAiConfiguration,
  defaultLocatorDiagnosisConfiguration,
  diagnoseLocatorFailure,
  MockAiProvider,
  rankLocatorCandidates,
  renderLocatorDiagnosisMarkdown,
} from "@aegis/core";

const arguments_ = process.argv.slice(2);
const unsupported = arguments_.find((argument) => argument !== "--json");
if (unsupported !== undefined)
  throw new Error(`Unsupported AI locator demo option '${unsupported}'.`);

const intent = Object.freeze({
  operation: "click" as const,
  strategy: "css" as const,
  value: ".legacy-save",
});
const candidateInventory = Object.freeze({
  status: "collected" as const,
  candidates: rankLocatorCandidates(
    [
      {
        strategy: "role",
        role: "button",
        name: "Save changes",
        exact: true,
        scopeHint: null,
        tagName: "button",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
      {
        strategy: "test-id",
        value: "save-button",
        exact: true,
        scopeHint: null,
        tagName: "button",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
      {
        strategy: "text",
        value: "Save",
        exact: true,
        scopeHint: null,
        tagName: "span",
        matchCount: 2,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
    ],
    intent,
  ).candidates,
  droppedCandidateCount: 0,
  scannedElementCount: 3,
  intent,
});
const deterministicTopId = candidateInventory.candidates[0]?.candidateId;
if (deterministicTopId === undefined)
  throw new Error("Synthetic locator inventory was empty.");
const advisory = Object.freeze({
  classification: "selector-no-match",
  confidence: "high",
  recommendationStatus: "candidates-available",
  summary:
    "The supplied semantic role candidate is the strongest advisory option.",
  originalLocatorAssessment: Object.freeze({
    strategy: "css",
    issue: "The original synthetic CSS locator matched no element.",
  }),
  pageStateAssessment: Object.freeze({
    ready: true,
    reason: "The synthetic page was ready.",
  }),
  rankedCandidates: Object.freeze([
    {
      candidateId: deterministicTopId,
      rank: 1,
      confidence: "high",
      reason:
        "The supplied role candidate is unique, visible, enabled, and semantic.",
    },
  ]),
  recommendedNextStep:
    "Review the supplied role candidate manually in the owning Page Object.",
  missingEvidence: Object.freeze([]),
  limitations: Object.freeze([
    "This offline demonstration uses synthetic evidence.",
  ]),
});
const provider = new MockAiProvider({
  structuredOutput: advisory,
  usage: { inputTokens: 120, outputTokens: 90, totalTokens: 210 },
});
const aiClient = createAiClient(
  defaultAiConfiguration({
    enabled: true,
    provider: "mock",
    model: "mock-locator-v1",
    allowNetworkCalls: false,
    mockOnly: true,
    enabledCapabilities: ["ui-locator-diagnosis"],
  }),
  { providers: [provider], environment: Object.freeze({}) },
);
const report = await diagnoseLocatorFailure({
  evidence: {
    errorMessage: "locator('.legacy-save') resolved to no elements",
    pageUrl: "https://example.test/settings",
    pageReady: true,
    pageAvailable: true,
    testId: "TC-SYNTHETIC-LOCATOR-001",
    feature: "synthetic-ui",
    requirementIds: ["REQ-SYNTHETIC-001"],
  },
  candidateInventory,
  configuration: defaultLocatorDiagnosisConfiguration({
    mode: "mock-ai",
    aiAdvisoryEnabled: true,
  }),
  aiClient,
});
if (
  !report.provenance.aiOutputValidated ||
  report.provenance.providerId !== "mock" ||
  !report.conclusion.rankedCandidates.every(({ candidateId }) =>
    candidateInventory.candidates.some(
      (candidate) => candidate.candidateId === candidateId,
    ),
  )
)
  throw new Error(
    "Offline locator diagnosis did not validate supplied mock candidates.",
  );
const output = Object.freeze({
  status: "pass",
  networkCalls: 0,
  apiKeyRequired: false,
  report,
  markdown: renderLocatorDiagnosisMarkdown(report),
});
if (arguments_.includes("--json")) console.log(JSON.stringify(output, null, 2));
else {
  console.log("AegisAI advisory locator-diagnosis demo: PASS");
  console.log("Provider: mock");
  console.log("Network calls: 0");
  console.log("Source changes: none");
  console.log(`Classification: ${report.conclusion.classification}`);
  console.log(
    `Top supplied candidate: ${report.conclusion.rankedCandidates[0]?.candidateId ?? "none"}`,
  );
}
