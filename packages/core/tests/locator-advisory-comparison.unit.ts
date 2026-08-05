import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  buildLocatorAdvisoryRerankingInput,
  completeLocatorAdvisoryComparison,
  createAiClient,
  createLocatorAdvisoryComparisonAggregateSummary,
  createLocatorBlindReviewArtifacts,
  defaultAiConfiguration,
  importLocatorDiagnosisObservation,
  inspectLocatorAdvisoryRerankingOutput,
  LOCATOR_ADVISORY_RERANKING_CAPABILITY,
  LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
  MockAiProvider,
  rankLocatorCandidates,
  renderLocatorAdvisoryComparisonMarkdown,
  renderLocatorAdvisoryComparisonTerminal,
  runLocatorAdvisoryComparisonPhase,
  runLocatorBlindHoldoutEvaluation,
  validateLocatorAdvisoryRerankingOutput,
  detectTerminalCapabilities,
  diagnoseLocatorFailure,
} from "../src/index.ts";
import type {
  AiClient,
  AiGenerationRequest,
  AiGenerationResult,
  AiProvider,
  LocatorAdvisoryComparisonAnswerRecord,
  LocatorBlindReview,
  LocatorBlindReviewBundle,
  LocatorDiagnosisReport,
  LocatorObservation,
} from "../src/index.ts";

async function diagnosis(candidateCount = 3): Promise<LocatorDiagnosisReport> {
  const candidates = rankLocatorCandidates(
    Array.from({ length: candidateCount }, (_, index) => ({
      strategy: index === 0 ? ("role" as const) : ("text" as const),
      ...(index === 0
        ? { role: "link", name: "Saved items" }
        : { value: index === 1 ? "Wishlist" : `Option ${String(index + 1)}` }),
      exact: true,
      scopeHint: index === 2 ? "account navigation" : null,
      tagName: "a",
      matchCount: 1,
      visible: true,
      enabled: true,
      editable: false,
      hasBoundingBox: true,
    })),
    {
      operation: "click",
      strategy: "role",
      role: "link",
      name: "Wishlist",
    },
  );
  return diagnoseLocatorFailure({
    evidence: {
      errorMessage:
        "getByRole('link', { name: 'Wishlist' }) resolved to no elements",
      pageReady: true,
      pageAvailable: true,
    },
    candidateInventory: {
      status: "collected",
      candidates: candidates.candidates,
      droppedCandidateCount: candidates.dropped,
      scannedElementCount: candidateCount,
      intent: {
        operation: "click",
        strategy: "role",
        role: "link",
        name: "Wishlist",
      },
    },
  });
}

async function observation(candidateCount = 3): Promise<LocatorObservation> {
  const imported = importLocatorDiagnosisObservation(
    await diagnosis(candidateCount),
    {
      applicationAlias: "comparison-fixture",
      sourceType: "synthetic-test-fixture",
    },
  );
  assert.equal(imported.status, "imported");
  return imported.observation;
}

function completedReview(
  artifacts: LocatorBlindReviewBundle,
  acceptableOriginalId: string,
  forbiddenOriginalIds: readonly string[],
): LocatorBlindReview {
  const aliasFor = (original: string): string => {
    const alias = artifacts.mapping.aliases.find(
      ({ originalCandidateId }) => originalCandidateId === original,
    )?.blindCandidateId;
    assert.ok(alias);
    return alias;
  };
  return Object.freeze({
    ...structuredClone(artifacts.review),
    reviewStatus: "reviewed",
    expectedClassification: "selector-no-match",
    expectedRecommendationStatus: "candidates-available",
    acceptableBlindCandidateIds: Object.freeze([
      aliasFor(acceptableOriginalId),
    ]),
    preferredBlindCandidateIds: Object.freeze([aliasFor(acceptableOriginalId)]),
    forbiddenBlindCandidateIds: Object.freeze(
      forbiddenOriginalIds.map(aliasFor),
    ),
    minimumAcceptableConfidence: "medium",
    reviewerRationale:
      "Independent human review selected the semantically aligned candidate.",
  });
}

function client(output: Readonly<Record<string, unknown>>): AiClient {
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-comparison-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      maxInputCharacters: 30_000,
      maxOutputTokens: 512,
    }),
    {
      providers: [new MockAiProvider({ structuredOutput: output })],
      environment: Object.freeze({}),
    },
  );
}

function output(
  rankedCandidateIds: readonly string[],
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: "1.0.0",
    recommendationStatus:
      rankedCandidateIds.length === 0
        ? "insufficient-evidence"
        : "candidates-available",
    rankedCandidateIds: Object.freeze([...rankedCandidateIds]),
    confidence: "high",
    summary: "The leading supplied candidate best matches the target intent.",
    ...overrides,
  });
}

function answerRecord(
  observationValue: LocatorObservation,
  artifacts: LocatorBlindReviewBundle,
  review: LocatorBlindReview,
): LocatorAdvisoryComparisonAnswerRecord {
  return Object.freeze({
    observation: observationValue,
    packet: artifacts.packet,
    mapping: artifacts.mapping,
    review,
  });
}

class CapturingProvider implements AiProvider {
  public readonly id = "mock";
  public readonly networkAccess = "none" as const;
  public readonly requiresApiKey = false;
  public request?: AiGenerationRequest;
  private readonly response: Readonly<Record<string, unknown>>;
  public constructor(response: Readonly<Record<string, unknown>>) {
    this.response = response;
  }
  public generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    this.request = request;
    return Promise.resolve(
      Object.freeze({
        providerId: this.id,
        model: request.model,
        text: JSON.stringify(this.response),
        usage: Object.freeze({
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        }),
        finishReason: "stop",
        durationMs: 12,
        retryCount: 0,
      }),
    );
  }
}

class FailingProvider implements AiProvider {
  public readonly id = "mock";
  public readonly networkAccess = "none" as const;
  public readonly requiresApiKey = false;
  private readonly code: "provider-timeout" | "provider-unavailable";

  public constructor(code: "provider-timeout" | "provider-unavailable") {
    this.code = code;
  }

  public generate(): Promise<AiGenerationResult> {
    return Promise.reject(
      new AiError({
        code: this.code,
        message: "Synthetic provider failure.",
      }),
    );
  }
}

function failingClient(
  code: "provider-timeout" | "provider-unavailable",
): AiClient {
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-comparison-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      maxInputCharacters: 30_000,
      maxOutputTokens: 512,
    }),
    {
      providers: [new FailingProvider(code)],
      environment: Object.freeze({}),
    },
  );
}

await describe("locator advisory reranking contract", async () => {
  await it("builds an explicit neutral allowlist without deterministic or human fields", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const input = buildLocatorAdvisoryRerankingInput(artifacts.packet);
    const serialized = JSON.stringify(input);
    assert.deepEqual(Object.keys(input).sort(), [
      "candidates",
      "failure",
      "schemaVersion",
      "targetIntent",
    ]);
    assert.equal(input.candidates.length, value.candidateInventory.length);
    assert.ok(
      input.candidates.every(({ candidateId }) =>
        candidateId.startsWith("BLIND-CANDIDATE-"),
      ),
    );
    assert.doesNotMatch(
      serialized,
      /LOCATOR-|deterministicScore|stability|rationale|expectedClassification|expectedRecommendation|acceptableCandidate|preferredCandidate|forbiddenCandidate|reviewer|mapping|<html|innerHTML|outerHTML|password|cookie|authorization|C:\\Users|\/home\//iu,
    );
  });

  await it("preserves neutral order reproducibly without deterministic rank anchoring", async () => {
    const value = await observation();
    const first = createLocatorBlindReviewArtifacts(value);
    const second = createLocatorBlindReviewArtifacts(value);
    assert.deepEqual(first.packet.candidates, second.packet.candidates);
    assert.notDeepEqual(
      first.mapping.aliases.map(
        ({ originalCandidateId }) => originalCandidateId,
      ),
      value.candidateInventory.map(({ candidateId }) => candidateId),
    );
  });

  await it("validates the narrow versioned output and supplied aliases", () => {
    const valid = output(["BLIND-CANDIDATE-002"]);
    assert.deepEqual(
      validateLocatorAdvisoryRerankingOutput(valid, [
        "BLIND-CANDIDATE-001",
        "BLIND-CANDIDATE-002",
      ]).rankedCandidateIds,
      ["BLIND-CANDIDATE-002"],
    );
    assert.equal(LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION, "1.1.0");
  });

  for (const [title, invalid] of [
    ["invented alias", output(["BLIND-CANDIDATE-999"])],
    ["duplicate alias", output(["BLIND-CANDIDATE-001", "BLIND-CANDIDATE-001"])],
    ["unknown field", output([], { unexpected: true })],
    [
      "candidate-less available",
      output([], { recommendationStatus: "candidates-available" }),
    ],
    [
      "ranked abstention",
      output(["BLIND-CANDIDATE-001"], {
        recommendationStatus: "insufficient-evidence",
      }),
    ],
    [
      "prohibited output",
      output([], {
        summary: "Run page.locator('xpath=//a').first() with force: true",
      }),
    ],
  ] as const)
    await it(`rejects ${title}`, () => {
      const inspection = inspectLocatorAdvisoryRerankingOutput(invalid, [
        "BLIND-CANDIDATE-001",
      ]);
      assert.equal(inspection.valid, false);
      assert.ok(inspection.issues.length > 0);
    });

  await it("supports empty and maximum bounded inventories", async () => {
    const empty = createLocatorBlindReviewArtifacts(await observation(0));
    assert.equal(
      buildLocatorAdvisoryRerankingInput(empty.packet).candidates.length,
      0,
    );
    const maximum = createLocatorBlindReviewArtifacts(await observation(50));
    assert.equal(
      buildLocatorAdvisoryRerankingInput(maximum.packet).candidates.length,
      50,
    );
  });
});

await describe("blind advisory execution isolation", async () => {
  await it("captures no review, mapping, deterministic score, original ID, DOM, or secret in the provider request", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const alias = artifacts.packet.candidates[0]?.blindCandidateId;
    assert.ok(alias);
    const provider = new CapturingProvider(output([alias]));
    const aiClient = createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        model: "capture-v1",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
        requestTimeoutMs: 1_000,
        maxRetries: 0,
        maxInputCharacters: 30_000,
        maxOutputTokens: 512,
      }),
      { providers: [provider], environment: Object.freeze({}) },
    );
    await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      { mode: "mock-ai", aiClientFactory: () => aiClient },
    );
    assert.ok(provider.request);
    assert.equal(provider.request.responseFormat.type, "json_schema");
    assert.equal(provider.request.responseFormat.strict, true);
    assert.equal(
      provider.request.responseFormat.name,
      "locator_advisory_reranking_v1",
    );
    const serialized = JSON.stringify(provider.request);
    assert.match(serialized, /BLIND-CANDIDATE-/u);
    assert.doesNotMatch(
      serialized,
      /LOCATOR-\d{3}|"deterministicScore"|"stability"|"reviewerRationale"|"expectedClassification"|"expectedRecommendationStatus"|"acceptableCandidateIds"|"preferredCandidateIds"|"forbiddenCandidateIds"|"originalCandidateId"|API[_-]?KEY|authorization|<html|innerHTML|outerHTML|C:\\Users|\/home\//u,
    );
  });

  await it("loads human answers only in the later comparison phase", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const alias = artifacts.packet.candidates[0]?.blindCandidateId;
    assert.ok(alias);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      { mode: "mock-ai", aiClientFactory: () => client(output([alias])) },
    );
    assert.doesNotMatch(
      JSON.stringify(phase),
      /reviewerRationale|acceptableBlind|forbiddenBlind|expectedClassification/u,
    );
  });
});

await describe("deterministic versus advisory comparison", async () => {
  await it("preserves the exact deterministic blind baseline", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const review = completedReview(artifacts, "LOCATOR-002", ["LOCATOR-001"]);
    const records = [answerRecord(value, artifacts, review)];
    const baseline = await runLocatorBlindHoldoutEvaluation(records, {
      mode: "deterministic-only",
    });
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      { mode: "deterministic-only" },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, records);
    assert.deepEqual(comparison.deterministicMetrics, baseline.holdout.metrics);
  });

  await it("reports AI improvement when an acceptable semantic candidate is promoted", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const review = completedReview(artifacts, "LOCATOR-002", ["LOCATOR-001"]);
    const acceptableAlias = artifacts.mapping.aliases.find(
      ({ originalCandidateId }) => originalCandidateId === "LOCATOR-002",
    )?.blindCandidateId;
    assert.ok(acceptableAlias);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      {
        mode: "mock-ai",
        aiClientFactory: () => client(output([acceptableAlias])),
      },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(value, artifacts, review),
    ]);
    const summary = createLocatorAdvisoryComparisonAggregateSummary(comparison);
    assert.equal(summary.advisory.ranking.top1Acceptable.value, 1);
    assert.equal(summary.deltas.top1Acceptable.outcome, "improved");
    assert.equal(summary.deltas.forbiddenAtTop1.outcome, "improved");
  });

  await it("reports AI regression and lower-is-better deltas correctly", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const review = completedReview(artifacts, "LOCATOR-001", ["LOCATOR-002"]);
    const forbiddenAlias = artifacts.mapping.aliases.find(
      ({ originalCandidateId }) => originalCandidateId === "LOCATOR-002",
    )?.blindCandidateId;
    assert.ok(forbiddenAlias);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      {
        mode: "mock-ai",
        aiClientFactory: () => client(output([forbiddenAlias])),
      },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(value, artifacts, review),
    ]);
    const summary = createLocatorAdvisoryComparisonAggregateSummary(comparison);
    assert.equal(summary.deltas.top1Acceptable.outcome, "worsened");
    assert.equal(summary.deltas.forbiddenAtTop1.outcome, "worsened");
  });

  await it("keeps invalid output as unavailable without ending the batch", async () => {
    const first = await observation();
    const second = await observation(2);
    const firstArtifacts = createLocatorBlindReviewArtifacts(first);
    const secondArtifacts = createLocatorBlindReviewArtifacts(second);
    const firstReview = completedReview(firstArtifacts, "LOCATOR-001", [
      "LOCATOR-002",
    ]);
    const secondReview = completedReview(secondArtifacts, "LOCATOR-001", [
      "LOCATOR-002",
    ]);
    const validAlias = secondArtifacts.mapping.aliases.find(
      ({ originalCandidateId }) => originalCandidateId === "LOCATOR-001",
    )?.blindCandidateId;
    assert.ok(validAlias);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [
        { observation: first, packet: firstArtifacts.packet },
        { observation: second, packet: secondArtifacts.packet },
      ],
      {
        mode: "mock-ai",
        aiClientFactory: (_input, index) =>
          index === 0
            ? client(output(["BLIND-CANDIDATE-999"]))
            : client(output([validAlias])),
      },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(first, firstArtifacts, firstReview),
      answerRecord(second, secondArtifacts, secondReview),
    ]);
    assert.equal(comparison.counts.advisoryCompleted, 1);
    assert.equal(comparison.counts.advisoryUnavailable, 1);
    assert.equal(comparison.provider.invalidStructuredOutputCount, 1);
    assert.deepEqual(comparison.provider.validationIssueCounts, {
      "unknown-candidate-id": 1,
    });
    assert.equal(comparison.advisoryMetrics.safety.unknownCandidateIdCount, 1);
    assert.equal(comparison.effectiveMode, "partial-ai-advisory");
  });

  await it("keeps an all-invalid advisory batch unavailable with aggregate diagnostics", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const review = completedReview(artifacts, "LOCATOR-001", ["LOCATOR-002"]);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      {
        mode: "mock-ai",
        aiClientFactory: () =>
          client(
            output(["BLIND-CANDIDATE-999"], {
              confidence: "certain",
            }),
          ),
      },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(value, artifacts, review),
    ]);
    const summary = createLocatorAdvisoryComparisonAggregateSummary(comparison);
    assert.equal(comparison.effectiveMode, "ai-unavailable");
    assert.equal(comparison.counts.advisoryCompleted, 0);
    assert.deepEqual(summary.provider.validationIssueCounts, {
      "unknown-candidate-id": 1,
      "unsupported-confidence": 1,
    });
    const publicOutput = `${renderLocatorAdvisoryComparisonTerminal(
      summary,
      detectTerminalCapabilities({
        arguments: ["--plain"],
        stdoutIsTty: false,
        stderrIsTty: false,
        platform: "linux",
      }),
      1,
    )}\n${renderLocatorAdvisoryComparisonMarkdown(summary)}\n${JSON.stringify(summary)}`;
    assert.match(publicOutput, /unknown-candidate-id/u);
    assert.match(publicOutput, /unsupported-confidence/u);
    assert.doesNotMatch(publicOutput, /BLIND-CANDIDATE-|certain/u);
  });

  await it("supports zero and maximum candidate inventories through comparison", async () => {
    const emptyObservation = await observation(0);
    const emptyArtifacts = createLocatorBlindReviewArtifacts(emptyObservation);
    const emptyReview: LocatorBlindReview = Object.freeze({
      ...structuredClone(emptyArtifacts.review),
      reviewStatus: "reviewed",
      expectedClassification: "selector-no-match",
      expectedRecommendationStatus: "insufficient-evidence",
      acceptableBlindCandidateIds: Object.freeze([]),
      preferredBlindCandidateIds: Object.freeze([]),
      forbiddenBlindCandidateIds: Object.freeze([]),
      minimumAcceptableConfidence: "low",
      reviewerRationale:
        "The bounded evidence contains no candidate that can be assessed.",
    });
    const maximumObservation = await observation(50);
    const maximumArtifacts =
      createLocatorBlindReviewArtifacts(maximumObservation);
    const maximumReview = completedReview(
      maximumArtifacts,
      "LOCATOR-050",
      Array.from(
        { length: 49 },
        (_, index) => `LOCATOR-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    const phase = await runLocatorAdvisoryComparisonPhase(
      [
        { observation: emptyObservation, packet: emptyArtifacts.packet },
        { observation: maximumObservation, packet: maximumArtifacts.packet },
      ],
      { mode: "mock-ai" },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(emptyObservation, emptyArtifacts, emptyReview),
      answerRecord(maximumObservation, maximumArtifacts, maximumReview),
    ]);
    assert.equal(comparison.counts.advisoryCompleted, 2);
    assert.equal(comparison.provider.successfulRequestCount, 2);
    assert.equal(comparison.advisoryMetrics.totalCases, 2);
  });

  await it("reports provider unavailability and timeout as partial safe failures", async () => {
    const first = await observation(1);
    const second = await observation(2);
    const firstArtifacts = createLocatorBlindReviewArtifacts(first);
    const secondArtifacts = createLocatorBlindReviewArtifacts(second);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [
        { observation: first, packet: firstArtifacts.packet },
        { observation: second, packet: secondArtifacts.packet },
      ],
      {
        mode: "mock-ai",
        aiClientFactory: (_input, index) =>
          failingClient(
            index === 0 ? "provider-unavailable" : "provider-timeout",
          ),
      },
    );
    const comparison = await completeLocatorAdvisoryComparison(phase, [
      answerRecord(
        first,
        firstArtifacts,
        completedReview(firstArtifacts, "LOCATOR-001", []),
      ),
      answerRecord(
        second,
        secondArtifacts,
        completedReview(secondArtifacts, "LOCATOR-001", []),
      ),
    ]);
    assert.equal(comparison.counts.advisoryCompleted, 0);
    assert.equal(comparison.counts.advisoryUnavailable, 2);
    assert.equal(comparison.provider.failedRequestCount, 2);
    assert.deepEqual(comparison.provider.statuses, {
      "provider-unavailable": 1,
      timeout: 1,
    });
    assert.deepEqual(comparison.provider.failureCodes, {
      "provider-timeout": 1,
      "provider-unavailable": 1,
    });
    assert.equal(comparison.effectiveMode, "ai-unavailable");
  });

  await it("contains aggregate-only public terminal and Markdown reports", async () => {
    const value = await observation();
    const artifacts = createLocatorBlindReviewArtifacts(value);
    const review = completedReview(artifacts, "LOCATOR-001", ["LOCATOR-002"]);
    const alias = artifacts.mapping.aliases.find(
      ({ originalCandidateId }) => originalCandidateId === "LOCATOR-001",
    )?.blindCandidateId;
    assert.ok(alias);
    const phase = await runLocatorAdvisoryComparisonPhase(
      [{ observation: value, packet: artifacts.packet }],
      { mode: "mock-ai", aiClientFactory: () => client(output([alias])) },
    );
    const summary = createLocatorAdvisoryComparisonAggregateSummary(
      await completeLocatorAdvisoryComparison(phase, [
        answerRecord(value, artifacts, review),
      ]),
    );
    const terminal = renderLocatorAdvisoryComparisonTerminal(
      summary,
      detectTerminalCapabilities({
        arguments: ["--plain"],
        stdoutIsTty: false,
        stderrIsTty: false,
        platform: "win32",
      }),
      10,
    );
    const markdown = renderLocatorAdvisoryComparisonMarkdown(summary);
    const rich = renderLocatorAdvisoryComparisonTerminal(
      summary,
      detectTerminalCapabilities({
        arguments: [],
        environment: { TERM: "xterm-256color" },
        stdoutIsTty: true,
        stderrIsTty: true,
        columns: 120,
        platform: "linux",
      }),
      10,
    );
    assert.equal(rich.includes("\u001B["), true);
    assert.match(rich, /PROVIDER EXECUTION|Provider execution/u);
    const publicOutput = `${terminal}\n${rich}\n${markdown}\n${JSON.stringify(summary)}`;
    assert.match(publicOutput, /Top-1 acceptable|top1Acceptable/u);
    assert.doesNotMatch(
      publicOutput,
      /LOC-OBS-|BLIND-PACKET-|BLIND-CANDIDATE-|LOCATOR-\d{3}|reviewerRationale|expectedClassification|actualClassification|"deterministicScore"|"rankedCandidates"|"aliases"|"originalCandidateId"|errorMessage|C:\\Users|\/home\//u,
    );
  });
});
