import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, it } from "node:test";

import {
  AiError,
  createAiClient,
  defaultAiConfiguration,
  OpenRouterAiProvider,
  trustedPromptValue,
} from "../src/index.ts";
import type {
  AiClientRequest,
  AiGenerationRequest,
  PromptTemplate,
} from "../src/index.ts";

interface LocalServer {
  readonly endpoint: string;
  readonly requests: IncomingMessage[];
  close(): Promise<void>;
}

const servers: LocalServer[] = [];

async function startServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    count: number,
  ) => void,
): Promise<LocalServer> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    handler(request, response, requests.length);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Temporary AI test server did not expose a TCP port.");
  }
  const result: LocalServer = {
    endpoint: `http://127.0.0.1:${String(address.port)}/v1/chat/completions`,
    requests,
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
  servers.push(result);
  return result;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await server.close();
    }),
  );
});

const providerRequest: AiGenerationRequest = Object.freeze({
  systemInstruction: "Return a synthetic result.",
  messages: Object.freeze([
    { role: "user" as const, content: "synthetic event" },
  ]),
  model: "vendor/model-v1",
  temperature: 0,
  maxOutputTokens: 100,
  responseFormat: Object.freeze({ type: "json_object" }),
  timeoutMs: 1_000,
});
const template: PromptTemplate = Object.freeze({
  id: "synthetic-event",
  version: "1.0.0",
  purpose: "Classify a synthetic event.",
  systemTemplate: "Return JSON for {{category}}.",
  userTemplate: "Event: {{event}}",
  requiredVariables: Object.freeze(["category", "event"]),
  maximumRenderedLength: 1_000,
});
const clientRequest: AiClientRequest = Object.freeze({
  template,
  variables: Object.freeze({
    category: trustedPromptValue("navigation"),
    event: trustedPromptValue("opened"),
  }),
  responseFormat: Object.freeze({ type: "json_object" }),
  capability: "synthetic-classification",
});

function completionBody(content = '{"result":"ok"}'): string {
  return JSON.stringify({
    id: "request-safe-1",
    model: "vendor/model-v1",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  });
}

function clientFor(
  endpoint: string,
  maxRetries = 0,
): ReturnType<typeof createAiClient> {
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "openrouter",
      model: "vendor/model-v1",
      apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
      endpoint,
      requestTimeoutMs: 500,
      maxRetries,
      allowNetworkCalls: true,
      mockOnly: false,
      allowInsecureLocalhost: true,
      enabledCapabilities: ["synthetic-classification"],
    }),
    {
      providers: [new OpenRouterAiProvider()],
      environment: { OPENROUTER_API_KEY: "synthetic-test-key" },
      delay: () => Promise.resolve(),
    },
  );
}

await describe("OpenRouter AI provider", async () => {
  await it("sends bearer authentication and returns bounded provider data", async () => {
    let authorization = "";
    const server = await startServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody());
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: server.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(authorization, "Bearer synthetic-test-key");
    assert.equal(result.text, '{"result":"ok"}');
    assert.doesNotMatch(JSON.stringify(result), /synthetic-test-key/u);
  });

  await it("parses structured JSON through the generic client", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody());
    });
    const result = await clientFor(server.endpoint).generate(clientRequest);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.structuredOutput, { result: "ok" });
  });

  for (const [status, expectedCode] of [
    [401, "authentication-failed"],
    [400, "request-invalid"],
  ] as const) {
    await it(`does not retry HTTP ${String(status)}`, async () => {
      const server = await startServer((_request, response) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end('{"error":"authorization=synthetic-test-key"}');
      });
      await assert.rejects(
        clientFor(server.endpoint, 2).generate(clientRequest),
        (error: unknown) =>
          error instanceof AiError &&
          error.code === expectedCode &&
          !error.message.includes("synthetic-test-key"),
      );
      assert.equal(server.requests.length, 1);
    });
  }

  for (const status of [429, 500]) {
    await it(`retries transient HTTP ${String(status)}`, async () => {
      const server = await startServer((_request, response, count) => {
        if (count === 1) {
          response.writeHead(status, {
            "content-type": "application/json",
            ...(status === 429 ? { "retry-after": "0" } : {}),
          });
          response.end('{"error":"temporary"}');
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(completionBody());
      });
      const result = await clientFor(server.endpoint, 1).generate(
        clientRequest,
      );
      assert.equal(result.status, "completed");
      assert.equal(result.retryCount, 1);
      assert.equal(server.requests.length, 2);
    });
  }

  await it("honors bounded Retry-After metadata", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(429, { "retry-after": "2" });
      response.end();
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "rate-limited" &&
        error.retryAfterMs === 2_000,
    );
  });

  await it("maps request timeout without retaining response content", async () => {
    const server = await startServer(() => {
      // Intentionally leave the bounded local request pending until it is aborted.
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(
        { ...providerRequest, timeoutMs: 100 },
        { endpoint: server.endpoint, apiKey: "synthetic-test-key" },
      ),
      (error: unknown) =>
        error instanceof AiError && error.code === "provider-timeout",
    );
  });

  await it("rejects malformed and oversized-safe response shapes", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"unexpected":true}');
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError && error.code === "provider-response-invalid",
    );
  });
});
