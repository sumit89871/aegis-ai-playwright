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
  ) => void | Promise<void>,
): Promise<LocalServer> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    void Promise.resolve(handler(request, response, requests.length)).catch(
      () => {
        response.destroy();
      },
    );
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

async function readJsonRequest(
  request: IncomingMessage,
): Promise<Readonly<Record<string, unknown>>> {
  request.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const requestChunk of request) {
    const chunk: unknown = requestChunk;
    if (typeof chunk !== "string") {
      throw new Error("Temporary AI test server received a non-text chunk.");
    }
    chunks.push(chunk);
  }
  return JSON.parse(chunks.join("")) as Readonly<Record<string, unknown>>;
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
const strictSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    result: Object.freeze({ type: "string", const: "ok" }),
  }),
  required: Object.freeze(["result"]),
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

function completionBody(content: unknown = '{"result":"ok"}'): string {
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
    let requestBody: Readonly<Record<string, unknown>> = Object.freeze({});
    const server = await startServer(async (request, response) => {
      authorization = request.headers.authorization ?? "";
      requestBody = await readJsonRequest(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody());
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: server.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(authorization, "Bearer synthetic-test-key");
    assert.equal(requestBody.max_completion_tokens, 100);
    assert.equal(requestBody.max_tokens, undefined);
    assert.deepEqual(requestBody.reasoning, {
      effort: "none",
      exclude: true,
    });
    assert.deepEqual(requestBody.response_format, { type: "json_object" });
    assert.equal(requestBody.provider, undefined);
    assert.equal(result.text, '{"result":"ok"}');
    assert.doesNotMatch(JSON.stringify(result), /synthetic-test-key/u);
  });

  await it("maps strict JSON Schema and requires compatible provider parameters", async () => {
    let requestBody: Readonly<Record<string, unknown>> = Object.freeze({});
    const server = await startServer(async (request, response) => {
      requestBody = await readJsonRequest(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody());
    });
    await new OpenRouterAiProvider().generate(
      {
        ...providerRequest,
        responseFormat: {
          type: "json_schema",
          name: "synthetic_contract_v1",
          strict: true,
          schema: strictSchema,
        },
      },
      { endpoint: server.endpoint, apiKey: "synthetic-test-key" },
    );
    assert.deepEqual(requestBody.response_format, {
      type: "json_schema",
      json_schema: {
        name: "synthetic_contract_v1",
        strict: true,
        schema: strictSchema,
      },
    });
    assert.deepEqual(requestBody.provider, { require_parameters: true });
  });

  await it("does not add structured parameters to text requests", async () => {
    let requestBody: Readonly<Record<string, unknown>> = Object.freeze({});
    const server = await startServer(async (request, response) => {
      requestBody = await readJsonRequest(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody("plain text"));
    });
    await new OpenRouterAiProvider().generate(
      { ...providerRequest, responseFormat: { type: "text" } },
      { endpoint: server.endpoint, apiKey: "synthetic-test-key" },
    );
    assert.equal(requestBody.response_format, undefined);
    assert.equal(requestBody.provider, undefined);
  });

  await it("classifies strict-schema capability and schema rejection safely", async () => {
    for (const [status, code] of [
      [404, "provider-parameters-unsupported"],
      [422, "provider-schema-rejected"],
    ] as const) {
      const server = await startServer((_request, response) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end('{"private":"schema and key must not escape"}');
      });
      await assert.rejects(
        new OpenRouterAiProvider().generate(
          {
            ...providerRequest,
            responseFormat: {
              type: "json_schema",
              name: "synthetic_contract_v1",
              strict: true,
              schema: strictSchema,
            },
          },
          { endpoint: server.endpoint, apiKey: "synthetic-test-key" },
        ),
        (error: unknown) =>
          error instanceof AiError &&
          error.code === code &&
          !JSON.stringify(error).includes("synthetic-test-key") &&
          !JSON.stringify(error).includes("private"),
      );
    }
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
        error instanceof AiError &&
        error.code === "provider-response-malformed",
    );
  });

  await it("joins recognized array text parts deterministically", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        completionBody([
          { type: "text", text: '{"result":' },
          { type: "text", text: '"ok"}' },
        ]),
      );
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: server.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(result.text, '{"result":"ok"}');
  });

  await it("rejects null final content without using private reasoning", async () => {
    const privateReasoning = "private-reasoning-must-not-escape";
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "request-safe-null",
          model: "router/selected-model",
          choices: [
            {
              message: { content: null, reasoning: privateReasoning },
              finish_reason: "stop",
              native_finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 12,
            reasoning_tokens: 12,
            total_tokens: 22,
          },
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.code, "provider-response-empty");
        assert.deepEqual(error.responseMetadata, {
          httpCategory: "success",
          returnedModel: "router/selected-model",
          completionTokens: 12,
          reasoningTokens: 12,
          providerRequestId: "request-safe-null",
          choicesCount: 1,
          finishReason: "stop",
          nativeFinishReason: "stop",
          contentKind: "null",
          reasoningPresent: true,
        });
        assert.doesNotMatch(
          `${error.message}${JSON.stringify(error)}`,
          new RegExp(privateReasoning, "u"),
        );
        return true;
      },
    );
  });

  await it("rejects empty final content explicitly", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody(""));
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-response-empty" &&
        error.responseMetadata?.contentKind === "string" &&
        error.responseMetadata.contentCharacterCount === 0,
    );
  });

  await it("reports missing final content without inspecting other fields", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: {}, finish_reason: "stop" }],
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-response-empty" &&
        error.responseMetadata?.contentKind === "missing",
    );
  });

  await it("rejects unsupported scalar final content", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody(42));
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-response-malformed" &&
        error.responseMetadata?.contentKind === "unsupported",
    );
  });

  await it("classifies finish_reason length as output truncation", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "request-truncated",
          model: "vendor/model-v1",
          choices: [
            {
              message: { content: '{"result":' },
              finish_reason: "length",
              native_finish_reason: "max_tokens",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 100,
            completion_tokens_details: { reasoning_tokens: 70 },
            total_tokens: 110,
          },
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-output-truncated" &&
        error.responseMetadata?.finishReason === "length" &&
        error.responseMetadata.nativeFinishReason === "max_tokens" &&
        error.responseMetadata.completionTokens === 100 &&
        error.responseMetadata.reasoningTokens === 70,
    );
  });

  await it("classifies an error finish state separately", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: "error" }],
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError && error.code === "provider-finish-error",
    );
  });

  for (const [name, body, expectedChoices] of [
    ["missing choices", { model: "vendor/model-v1" }, undefined],
    ["an empty choices array", { choices: [] }, 0],
    ["a malformed message", { choices: [{ message: "invalid" }] }, 1],
  ] as const) {
    await it(`rejects ${name} as a malformed response`, async () => {
      const server = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
      await assert.rejects(
        new OpenRouterAiProvider().generate(providerRequest, {
          endpoint: server.endpoint,
          apiKey: "synthetic-test-key",
        }),
        (error: unknown) =>
          error instanceof AiError &&
          error.code === "provider-response-malformed" &&
          error.responseMetadata?.choicesCount === expectedChoices,
      );
    });
  }

  await it("rejects valid final content above the safe character limit", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(completionBody("x".repeat(1_000_001)));
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "provider-output-oversized" &&
        error.responseMetadata?.contentCharacterCount === 1_000_001,
    );
  });

  await it("rejects unsupported array content parts", async () => {
    const unsafeArguments = "private-tool-arguments";
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        completionBody([{ type: "tool_call", arguments: unsafeArguments }]),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.code, "provider-response-malformed");
        assert.doesNotMatch(
          `${error.message}${JSON.stringify(error)}`,
          new RegExp(unsafeArguments, "u"),
        );
        return true;
      },
    );
  });

  await it("handles a provider error inside an HTTP-success response", async () => {
    const providerDetail = "private-provider-detail";
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "request-provider-error",
          model: "vendor/model-v1",
          error: { message: providerDetail },
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.code, "provider-finish-error");
        assert.doesNotMatch(
          `${error.message}${JSON.stringify(error)}`,
          new RegExp(providerDetail, "u"),
        );
        return true;
      },
    );
  });

  await it("retains safe reasoning-token usage and the selected router model", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "generation-safe-1",
          model: "selected/free-model-v2",
          choices: [
            { message: { content: '{"result":"ok"}' }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 9,
            completion_tokens_details: { reasoning_tokens: 3 },
            total_tokens: 20,
          },
        }),
      );
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: server.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(result.model, "selected/free-model-v2");
    assert.deepEqual(result.usage, {
      inputTokens: 11,
      outputTokens: 9,
      reasoningTokens: 3,
      totalTokens: 20,
    });
    assert.equal(result.providerRequestId, "generation-safe-1");
  });

  await it("retains a normalized returned model variant consistently", async () => {
    const returnedModel = "openai/gpt-oss-20b:free";
    const successServer = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "generation-variant-1",
          model: returnedModel,
          choices: [
            { message: { content: '{"result":"ok"}' }, finish_reason: "stop" },
          ],
        }),
      );
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: successServer.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(result.model, returnedModel);

    const failureServer = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          model: returnedModel,
          choices: [{ message: { content: null }, finish_reason: "stop" }],
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: failureServer.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError &&
        error.responseMetadata?.returnedModel === returnedModel,
    );
  });

  await it("ignores an unsafe returned model consistently", async () => {
    const unsafeModel = "unsafe model?token=private-value";
    const successServer = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          model: unsafeModel,
          choices: [
            { message: { content: '{"result":"ok"}' }, finish_reason: "stop" },
          ],
        }),
      );
    });
    const result = await new OpenRouterAiProvider().generate(providerRequest, {
      endpoint: successServer.endpoint,
      apiKey: "synthetic-test-key",
    });
    assert.equal(result.model, providerRequest.model);
    assert.doesNotMatch(JSON.stringify(result), /private-value/u);

    const failureServer = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          model: unsafeModel,
          choices: [{ message: { content: null }, finish_reason: "stop" }],
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: failureServer.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.responseMetadata?.returnedModel, undefined);
        assert.doesNotMatch(JSON.stringify(error), /private-value/u);
        return true;
      },
    );
  });

  await it("recognizes token exhaustion when empty content consumes the limit", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: "" }, finish_reason: "stop" }],
          usage: { completion_tokens: 100 },
        }),
      );
    });
    await assert.rejects(
      new OpenRouterAiProvider().generate(providerRequest, {
        endpoint: server.endpoint,
        apiKey: "synthetic-test-key",
      }),
      (error: unknown) =>
        error instanceof AiError && error.code === "provider-output-truncated",
    );
  });
});
