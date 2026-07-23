import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  createAiClient,
  defaultAiConfiguration,
  MockAiProvider,
  OpenRouterAiProvider,
  trustedPromptValue,
} from "../src/index.ts";
import type {
  AiClientRequest,
  AiLifecycleEvent,
  PromptTemplate,
} from "../src/index.ts";

const template: PromptTemplate = Object.freeze({
  id: "synthetic-classification",
  version: "1.0.0",
  purpose: "Classify synthetic input.",
  systemTemplate: "Return {{format}}.",
  userTemplate: "Event: {{event}}",
  requiredVariables: Object.freeze(["event", "format"]),
  maximumRenderedLength: 1_000,
});
const request: AiClientRequest = Object.freeze({
  template,
  variables: Object.freeze({
    event: trustedPromptValue("navigation"),
    format: trustedPromptValue("JSON"),
  }),
  responseFormat: Object.freeze({ type: "json_object" }),
  capability: "synthetic-classification",
});

function enabledMockConfiguration(): ReturnType<typeof defaultAiConfiguration> {
  return defaultAiConfiguration({
    enabled: true,
    provider: "mock",
    allowNetworkCalls: false,
    mockOnly: true,
    enabledCapabilities: ["synthetic-classification"],
  });
}

await describe("AI client", async () => {
  await it("returns a disabled result without resolving a provider or secret", async () => {
    const result = await createAiClient(defaultAiConfiguration(), {
      providers: [],
      environment: new Proxy(
        {},
        {
          get: (): never => {
            throw new Error("secret must not be read");
          },
        },
      ),
    }).generate(request);
    assert.equal(result.status, "disabled");
    assert.equal(result.events[0]?.type, "ai-disabled");
  });

  await it("returns capability-disabled before provider execution", async () => {
    const provider = new MockAiProvider({ structuredOutput: { result: "ok" } });
    const result = await createAiClient(
      defaultAiConfiguration({
        enabled: true,
        enabledCapabilities: [],
      }),
      { providers: [provider] },
    ).generate(request);
    assert.equal(result.status, "disabled");
    assert.equal(provider.inspections().length, 0);
  });

  await it("executes mock-only structured output and emits safe events", async () => {
    const secret = "synthetic-key-never-visible";
    const events: AiLifecycleEvent[] = [];
    const result = await createAiClient(enabledMockConfiguration(), {
      providers: [new MockAiProvider({ structuredOutput: { result: "ok" } })],
      environment: { UNUSED_KEY: secret },
      eventSink: (event) => events.push(event),
      now: (() => {
        let value = 10;
        return (): number => value++;
      })(),
    }).generate(request);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.structuredOutput, { result: "ok" });
    assert.deepEqual(
      result.events.map(({ type }) => type),
      ["request-started", "mock-response-used", "request-completed"],
    );
    assert.doesNotMatch(
      JSON.stringify({ result, events }),
      new RegExp(secret, "u"),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  await it("retries transient mock failures within the configured limit", async () => {
    const delays: number[] = [];
    const result = await createAiClient(
      defaultAiConfiguration({
        ...enabledMockConfiguration(),
        maxRetries: 1,
      }),
      {
        providers: [
          new MockAiProvider({
            structuredOutput: { result: "ok" },
            transientFailuresBeforeSuccess: 1,
          }),
        ],
        delay: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      },
    ).generate(request);
    assert.equal(result.status, "completed");
    assert.equal(result.retryCount, 1);
    assert.deepEqual(delays, [250]);
  });

  await it("preserves a permanent provider failure", async () => {
    await assert.rejects(
      createAiClient(enabledMockConfiguration(), {
        providers: [new MockAiProvider({ failureMode: "permanent" })],
      }).generate(request),
      (error: unknown) =>
        error instanceof AiError && error.code === "provider-failure",
    );
  });

  await it("blocks a real provider while networking is disabled", async () => {
    const events: AiLifecycleEvent[] = [];
    await assert.rejects(
      createAiClient(
        defaultAiConfiguration({
          enabled: true,
          provider: "openrouter",
          model: "vendor/model-v1",
          apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
          allowNetworkCalls: false,
          mockOnly: false,
          enabledCapabilities: ["synthetic-classification"],
        }),
        {
          providers: [new OpenRouterAiProvider()],
          environment: { OPENROUTER_API_KEY: "synthetic-secret" },
          eventSink: (event) => events.push(event),
        },
      ).generate(request),
      (error: unknown) =>
        error instanceof AiError && error.code === "network-disabled",
    );
    assert.deepEqual(
      events.map(({ type }) => type),
      ["request-blocked"],
    );
    assert.doesNotMatch(JSON.stringify(events), /synthetic-secret/u);
  });

  await it("blocks usage limits before calling the provider", async () => {
    const provider = new MockAiProvider({ structuredOutput: { result: "ok" } });
    await assert.rejects(
      createAiClient(
        defaultAiConfiguration({
          ...enabledMockConfiguration(),
          maxInputCharacters: 1,
        }),
        { providers: [provider] },
      ).generate(request),
      (error: unknown) =>
        error instanceof AiError && error.code === "request-blocked",
    );
    assert.equal(provider.inspections().length, 0);
  });

  await it("allows a capability to tighten timeout and retry limits", async () => {
    const provider = new MockAiProvider({ structuredOutput: { result: "ok" } });
    const result = await createAiClient(enabledMockConfiguration(), {
      providers: [provider],
    }).generate({
      ...request,
      requestTimeoutMs: 1_000,
      maxRetries: 0,
    });
    assert.equal(result.status, "completed");
  });

  await it("rejects request limits that exceed configured policy", async () => {
    await assert.rejects(
      createAiClient(enabledMockConfiguration(), {
        providers: [new MockAiProvider()],
      }).generate({
        ...request,
        requestTimeoutMs: 60_000,
      }),
      (error: unknown) =>
        error instanceof AiError && error.code === "request-invalid",
    );
  });

  await it("does not let an event sink failure change execution", async () => {
    const result = await createAiClient(enabledMockConfiguration(), {
      providers: [new MockAiProvider({ structuredOutput: { result: "ok" } })],
      eventSink: () => {
        throw new Error("optional sink failed");
      },
    }).generate(request);
    assert.equal(result.status, "completed");
  });

  await it("sanitizes unexpected provider errors and failure events", async () => {
    const secret = "synthetic-unlabelled-provider-secret";
    const events: AiLifecycleEvent[] = [];
    const provider = {
      id: "mock",
      networkAccess: "none" as const,
      requiresApiKey: false,
      generate: (): Promise<never> => Promise.reject(new Error(secret)),
    };
    await assert.rejects(
      createAiClient(enabledMockConfiguration(), {
        providers: [provider],
        eventSink: (event) => events.push(event),
      }).generate(request),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-failure" &&
        !error.message.includes(secret),
    );
    assert.equal(events.at(-1)?.type, "request-failed");
    assert.doesNotMatch(JSON.stringify(events), new RegExp(secret, "u"));
  });
});
