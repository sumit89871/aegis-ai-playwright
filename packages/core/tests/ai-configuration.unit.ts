import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  defaultAiConfiguration,
  validateAiConfiguration,
} from "../src/index.ts";

function validConfiguration(): ReturnType<typeof defaultAiConfiguration> {
  return defaultAiConfiguration({
    enabled: true,
    provider: "openrouter",
    model: "vendor/model-v1",
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    allowNetworkCalls: true,
    mockOnly: false,
  });
}

await describe("AI configuration", async () => {
  await it("is disabled and offline by default", () => {
    const configuration = defaultAiConfiguration();
    assert.equal(configuration.enabled, false);
    assert.equal(configuration.allowNetworkCalls, false);
    assert.equal(configuration.mockOnly, true);
    assert.equal("apiKey" in configuration, false);
  });

  await it("accepts a valid provider-neutral configuration", () => {
    const configuration = validConfiguration();
    assert.equal(configuration.provider, "openrouter");
    assert.equal(configuration.apiKeyEnvironmentVariable, "OPENROUTER_API_KEY");
    const serialized = JSON.parse(JSON.stringify(configuration)) as Record<
      string,
      unknown
    >;
    assert.equal(serialized.apiKey, undefined);
  });

  for (const [name, override] of [
    ["provider", { provider: "Invalid Provider" }],
    ["model", { model: "invalid model" }],
    ["timeout", { requestTimeoutMs: 99 }],
    ["retries", { maxRetries: 6 }],
    ["characters", { maxInputCharacters: 0 }],
    ["tokens", { maxOutputTokens: 0 }],
    ["temperature", { defaultTemperature: 2.1 }],
    ["cost", { maxEstimatedCostUsd: 0 }],
  ] as const) {
    await it(`rejects invalid ${name}`, () => {
      assert.throws(
        () => defaultAiConfiguration(override),
        (error: unknown) =>
          error instanceof AiError && error.code === "configuration-invalid",
      );
    });
  }

  await it("rejects direct API keys without echoing the value", () => {
    const secret = "synthetic-direct-secret-value";
    const input = { ...validConfiguration(), apiKey: secret };
    assert.throws(
      () => validateAiConfiguration(input),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "configuration-invalid" &&
        !error.message.includes(secret),
    );
  });

  await it("rejects unsafe endpoints", () => {
    assert.throws(() =>
      defaultAiConfiguration({ endpoint: "http://remote.example.test/v1" }),
    );
    assert.throws(() =>
      defaultAiConfiguration({
        endpoint: "https://user:password@example.test/v1",
      }),
    );
    assert.throws(() =>
      defaultAiConfiguration({
        endpoint: "https://example.test/v1?token=secret",
      }),
    );
  });

  await it("allows explicitly configured localhost HTTP", () => {
    const configuration = defaultAiConfiguration({
      endpoint: "http://127.0.0.1:8081/v1",
      allowInsecureLocalhost: true,
    });
    assert.equal(configuration.endpoint, "http://127.0.0.1:8081/v1");
  });

  await it("does not mutate its input", () => {
    const input = {
      ...validConfiguration(),
      enabledCapabilities: ["second-capability", "first-capability"],
    };
    const before = structuredClone(input);
    validateAiConfiguration(input);
    assert.deepEqual(input, before);
  });
});
