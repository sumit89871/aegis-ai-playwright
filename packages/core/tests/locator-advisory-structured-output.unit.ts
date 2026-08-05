import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAiClient,
  createLocatorAdvisoryRerankingJsonSchema,
  createSyntheticLocatorAdvisoryVerificationInput,
  defaultAiConfiguration,
  LOCATOR_ADVISORY_RERANKING_CAPABILITY,
  LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
  LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
  LOCATOR_ADVISORY_RERANKING_PROMPT,
  LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
  LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
  LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
  LOCATOR_RECOMMENDATION_STATUSES,
  MAX_LOCATOR_CANDIDATES,
  MockAiProvider,
  renderLocatorAdvisoryVerificationResult,
  runLocatorAdvisoryReranking,
  verifyLocatorAdvisoryStructuredOutput,
} from "../src/index.ts";
import type { AiClient } from "../src/index.ts";

function output(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    recommendationStatus: "candidates-available",
    rankedCandidateIds: Object.freeze(["BLIND-CANDIDATE-002"]),
    confidence: "high",
    summary: "The supplied semantic link best matches the intended action.",
    ...overrides,
  });
}

function client(structuredOutput: Readonly<Record<string, unknown>>): {
  readonly client: AiClient;
  readonly provider: MockAiProvider;
} {
  const provider = new MockAiProvider({
    structuredOutput,
    usage: {
      inputTokens: 100,
      outputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 130,
    },
    durationMs: 25,
  });
  return {
    provider,
    client: createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        model: "mock-locator-schema-v1",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
        requestTimeoutMs: LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
        maxRetries: 0,
        maxInputCharacters: 30_000,
        maxOutputTokens: LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
        defaultTemperature: 0,
      }),
      { providers: [provider] },
    ),
  };
}

await describe("locator advisory strict structured output", async () => {
  await it("builds the exact bounded locator JSON Schema", () => {
    const ids = ["BLIND-CANDIDATE-003", "BLIND-CANDIDATE-001"];
    const schema = createLocatorAdvisoryRerankingJsonSchema(ids);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, [
      "schemaVersion",
      "recommendationStatus",
      "rankedCandidateIds",
      "confidence",
      "summary",
    ]);
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    assert.equal(
      properties.schemaVersion?.const,
      LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    );
    const recommendationStatus = properties.recommendationStatus;
    const confidence = properties.confidence;
    const ranking = properties.rankedCandidateIds;
    const summary = properties.summary;
    assert.ok(recommendationStatus);
    assert.ok(confidence);
    assert.ok(ranking);
    assert.ok(summary);
    assert.deepEqual(
      recommendationStatus.enum,
      LOCATOR_RECOMMENDATION_STATUSES,
    );
    assert.deepEqual(confidence.enum, ["high", "medium", "low"]);
    assert.equal(ranking.uniqueItems, true);
    assert.equal(ranking.maxItems, MAX_LOCATOR_CANDIDATES);
    assert.deepEqual((ranking.items as Record<string, unknown>).enum, ids);
    assert.equal(summary.minLength, 1);
    assert.equal(summary.maxLength, 500);
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(
      serialized,
      /LOCATOR-\d{3}|deterministicScore|reviewerRationale|expectedClassification|Wishlist|Saved items/u,
    );
  });

  await it("supports empty, one, and maximum neutral inventories", () => {
    const empty = createLocatorAdvisoryRerankingJsonSchema([]);
    const emptyRanking = (empty.properties as Record<string, unknown>)
      .rankedCandidateIds as Record<string, unknown>;
    assert.equal(emptyRanking.maxItems, 0);
    assert.equal(
      (emptyRanking.items as Record<string, unknown>).enum,
      undefined,
    );
    assert.doesNotThrow(() =>
      createLocatorAdvisoryRerankingJsonSchema(["BLIND-CANDIDATE-001"]),
    );
    const maximum = Array.from(
      { length: MAX_LOCATOR_CANDIDATES },
      (_, index) => `BLIND-CANDIDATE-${String(index + 1).padStart(3, "0")}`,
    );
    const maximumSchema = createLocatorAdvisoryRerankingJsonSchema(maximum);
    const maximumRanking = (maximumSchema.properties as Record<string, unknown>)
      .rankedCandidateIds as Record<string, unknown>;
    assert.deepEqual(
      (maximumRanking.items as Record<string, unknown>).enum,
      maximum,
    );
    assert.ok(JSON.stringify(maximumSchema).length < 32_000);
    assert.throws(() =>
      createLocatorAdvisoryRerankingJsonSchema([
        ...maximum,
        "BLIND-CANDIDATE-051",
      ]),
    );
  });

  await it("documents the exact five-field prompt contract", () => {
    assert.equal(LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION, "1.1.0");
    const prompt = LOCATOR_ADVISORY_RERANKING_PROMPT.systemTemplate;
    for (const field of [
      "schemaVersion",
      "recommendationStatus",
      "rankedCandidateIds",
      "confidence",
      "summary",
    ])
      assert.match(prompt, new RegExp(field, "u"));
    for (const status of LOCATOR_RECOMMENDATION_STATUSES)
      assert.match(prompt, new RegExp(status, "u"));
    assert.match(prompt, /high, medium, or low/u);
    assert.match(prompt, /at most 500 characters/u);
    assert.match(prompt, /must be empty for every other status/u);
    assert.match(prompt, /Never invent an ID or selector/u);
    assert.match(
      prompt,
      /Playwright code|XPath|force actions|source patches|shell commands/u,
    );
    assert.doesNotMatch(
      prompt,
      /LOCATOR-\d{3}|BLIND-CANDIDATE-\d{3}|reviewerRationale|expectedClassification|C:\\Users|\/home\//u,
    );
  });

  await it("uses strict schema and completes a valid synthetic verification", async () => {
    assert.equal(LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS, 2_000);
    assert.equal(LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS, 30_000);
    const configured = client(output());
    const verification = await verifyLocatorAdvisoryStructuredOutput(
      configured.client,
    );
    assert.equal(verification.status, "pass");
    assert.equal(
      verification.schemaName,
      LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
    );
    assert.equal(verification.rankedCandidateCount, 1);
    assert.equal(verification.suppliedIdValidation, "pass");
    assert.equal(verification.typescriptBusinessValidation, "pass");
    assert.equal(configured.provider.inspections().length, 1);
    assert.equal(
      configured.provider.inspections()[0]?.requestedOutputTokens,
      2_000,
    );
    assert.equal(
      configured.provider.inspections()[0]?.requestedTimeoutMs,
      30_000,
    );
    assert.equal(
      configured.client.configuration.requestTimeoutMs,
      LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
    );
    assert.equal(
      configured.provider.inspections()[0]?.responseFormat,
      "json_schema",
    );
    assert.doesNotMatch(
      JSON.stringify(verification),
      /BLIND-CANDIDATE-|"summary"|raw response|"prompt"|LOCATOR-/u,
    );
    const rendered = renderLocatorAdvisoryVerificationResult(verification);
    assert.match(
      rendered,
      /Locator advisory structured-output verification: PASS/u,
    );
    assert.match(rendered, /Supplied-ID validation: PASS/u);
    assert.match(rendered, /TypeScript business validation: PASS/u);
    assert.match(rendered, /Reasoning tokens: 10/u);
    assert.match(rendered, /Locator application: absent/u);
    assert.match(rendered, /Automatic healing: absent/u);
    assert.doesNotMatch(
      rendered,
      /BLIND-CANDIDATE-|LOCATOR-|summary|raw response|prompt:|C:\\Users|\/home\//u,
    );
  });

  await it("fails a timed-out synthetic verification closed without retrying or parsing output", async () => {
    const provider = new MockAiProvider({ failureMode: "timeout" });
    const configured = createAiClient(
      defaultAiConfiguration({
        enabled: true,
        provider: "mock",
        model: "mock-locator-timeout-v1",
        allowNetworkCalls: false,
        mockOnly: true,
        enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
        requestTimeoutMs: LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
        maxRetries: 0,
        maxInputCharacters: 30_000,
        maxOutputTokens: LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
        defaultTemperature: 0,
      }),
      { providers: [provider] },
    );
    const verification =
      await verifyLocatorAdvisoryStructuredOutput(configured);
    assert.equal(provider.inspections().length, 1);
    assert.equal(verification.status, "fail");
    assert.equal(verification.errorCode, "provider-timeout");
    assert.equal(verification.retryCount, 0);
    assert.equal(verification.suppliedIdValidation, "not-completed");
    assert.equal(verification.typescriptBusinessValidation, "not-completed");
    assert.equal(verification.locatorApplications, 0);
    assert.equal(verification.automaticHealing, false);
  });

  await it("renders invalid synthetic verification using safe categories only", async () => {
    const verification = await verifyLocatorAdvisoryStructuredOutput(
      client(
        output({
          rankedCandidateIds: ["BLIND-CANDIDATE-999"],
          confidence: "certain",
        }),
      ).client,
    );
    assert.equal(verification.status, "fail");
    const rendered = renderLocatorAdvisoryVerificationResult(verification);
    assert.match(rendered, /verification: FAIL/u);
    assert.match(rendered, /unknown-candidate-id/u);
    assert.match(rendered, /unsupported-confidence/u);
    assert.doesNotMatch(
      rendered,
      /BLIND-CANDIDATE-|certain|raw response|C:\\Users|\/home\//u,
    );
  });

  for (const [name, invalid, issueCode] of [
    [
      "unknown candidate",
      output({ rankedCandidateIds: ["BLIND-CANDIDATE-999"] }),
      "unknown-candidate-id",
    ],
    [
      "duplicate candidate",
      output({
        rankedCandidateIds: ["BLIND-CANDIDATE-002", "BLIND-CANDIDATE-002"],
      }),
      "duplicate-candidate-id",
    ],
    ["unsupported field", { ...output(), extra: true }, "unsupported-field"],
    [
      "schema version",
      output({ schemaVersion: "2.0.0" }),
      "unsupported-schema-version",
    ],
    [
      "recommendation status",
      output({ recommendationStatus: "replace-now" }),
      "unsupported-recommendation-status",
    ],
    ["confidence", output({ confidence: "certain" }), "unsupported-confidence"],
    [
      "empty available ranking",
      output({ rankedCandidateIds: [] }),
      "candidates-available-without-candidate",
    ],
    [
      "ranked abstention",
      output({ recommendationStatus: "insufficient-evidence" }),
      "ranked-candidates-with-abstention",
    ],
    [
      "unsafe summary",
      output({ summary: "Use page.locator('//div').first() with force: true" }),
      "unsafe-summary",
    ],
  ] as const)
    await it(`preserves the safe issue code for ${name}`, async () => {
      const execution = await runLocatorAdvisoryReranking(
        createSyntheticLocatorAdvisoryVerificationInput(),
        client(invalid).client,
      );
      assert.equal(execution.status, "invalid-output");
      assert.ok(execution.validationIssueCodes?.includes(issueCode));
      const serialized = JSON.stringify(execution);
      assert.doesNotMatch(
        serialized,
        /BLIND-CANDIDATE-999|page\.locator|\/\/div|force: true/u,
      );
    });
});
