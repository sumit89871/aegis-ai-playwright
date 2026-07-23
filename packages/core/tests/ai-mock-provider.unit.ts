import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiError, MockAiProvider } from "../src/index.ts";
import type { AiGenerationRequest } from "../src/index.ts";

const request: AiGenerationRequest = Object.freeze({
  messages: Object.freeze([
    { role: "user" as const, content: "synthetic input" },
  ]),
  model: "mock-deterministic-v1",
  temperature: 0,
  maxOutputTokens: 100,
  responseFormat: { type: "text" as const },
  timeoutMs: 1_000,
});
const context = Object.freeze({ endpoint: "https://example.test/v1" });

await describe("mock AI provider", async () => {
  await it("returns deterministic text, usage, and safe inspection", async () => {
    const provider = new MockAiProvider({
      text: "deterministic",
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    });
    const first = await provider.generate(request, context);
    const second = await new MockAiProvider({
      text: "deterministic",
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    }).generate(request, context);
    assert.deepEqual(first, second);
    assert.equal(provider.inspections()[0]?.inputCharacterCount, 15);
    assert.doesNotMatch(
      JSON.stringify(provider.inspections()),
      /synthetic input/u,
    );
  });

  await it("serializes predetermined structured output", async () => {
    const provider = new MockAiProvider({ structuredOutput: { result: "ok" } });
    assert.equal(
      (await provider.generate(request, context)).text,
      '{"result":"ok"}',
    );
  });

  await it("redacts unsafe request-inspection metadata", async () => {
    const provider = new MockAiProvider();
    await provider.generate(
      {
        ...request,
        metadata: { correlationId: "password=synthetic-secret" },
      },
      context,
    );
    assert.equal(
      provider.inspections()[0]?.metadata.correlationId,
      "[REDACTED]",
    );
    assert.doesNotMatch(
      JSON.stringify(provider.inspections()),
      /synthetic-secret/u,
    );
  });

  for (const [mode, code] of [
    ["timeout", "provider-timeout"],
    ["transient", "provider-unavailable"],
    ["permanent", "provider-failure"],
  ] as const) {
    await it(`simulates ${mode} failure`, async () => {
      const provider = new MockAiProvider({ failureMode: mode });
      await assert.rejects(
        provider.generate(request, context),
        (error: unknown) => error instanceof AiError && error.code === code,
      );
    });
  }

  await it("fails transiently a deterministic number of times", async () => {
    const provider = new MockAiProvider({ transientFailuresBeforeSuccess: 1 });
    await assert.rejects(provider.generate(request, context));
    assert.equal(
      (await provider.generate(request, context)).text,
      "mock response",
    );
  });
});
