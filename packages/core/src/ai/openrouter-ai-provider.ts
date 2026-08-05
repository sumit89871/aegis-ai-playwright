import { redactSensitiveText } from "../diagnostics/redaction.ts";
import { AiError, toSafeAiError } from "./ai-errors.ts";
import type { AiProviderResponseMetadata } from "./ai-errors.ts";
import type { AiProvider, AiProviderExecutionContext } from "./ai-provider.ts";
import { validateAiModelId } from "./ai-provider.ts";
import { validateAiResponseFormat } from "./ai-response-format.ts";
import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiTokenUsage,
} from "./ai-types.ts";

type FetchImplementation = typeof fetch;

export interface OpenRouterAiProviderDependencies {
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
}

interface OpenRouterResponseBody {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

const MAXIMUM_OUTPUT_CHARACTERS = 1_000_000;
const MAXIMUM_RESPONSE_CHARACTERS = 1_100_000;

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), 30_000);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.min(Math.max(date - Date.now(), 0), 30_000);
}

function errorFromStatus(
  status: number,
  retryAfter: string | null,
  strictSchemaRequested: boolean,
): AiError {
  const responseMetadata = Object.freeze({
    httpCategory: "failure" as const,
  });
  if (status === 401 || status === 403) {
    return new AiError({
      code: "authentication-failed",
      message: "OpenRouter rejected the request credentials.",
      httpStatus: status,
      responseMetadata,
    });
  }
  if (strictSchemaRequested && status === 404) {
    return new AiError({
      code: "provider-parameters-unsupported",
      message:
        "OpenRouter found no endpoint compatible with the required structured-output parameters.",
      httpStatus: status,
      responseMetadata,
    });
  }
  if (strictSchemaRequested && (status === 400 || status === 422)) {
    return new AiError({
      code: "provider-schema-rejected",
      message: "OpenRouter rejected the required JSON Schema request.",
      httpStatus: status,
      responseMetadata,
    });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AiError({
      code: "request-invalid",
      message: `OpenRouter rejected the request with HTTP ${String(status)}.`,
      httpStatus: status,
      responseMetadata,
    });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfter);
    return new AiError({
      code: "rate-limited",
      message: "OpenRouter rate-limited the request.",
      transient: true,
      httpStatus: status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      responseMetadata,
    });
  }
  if (status >= 500) {
    return new AiError({
      code: "provider-unavailable",
      message: `OpenRouter is unavailable with HTTP ${String(status)}.`,
      transient: true,
      httpStatus: status,
      responseMetadata,
    });
  }
  return new AiError({
    code: "provider-failure",
    message: `OpenRouter request failed with HTTP ${String(status)}.`,
    httpStatus: status,
    responseMetadata,
  });
}

function parseUsage(value: unknown): AiTokenUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const directReasoningTokens = usage.reasoning_tokens;
  const completionDetails = usage.completion_tokens_details;
  const detailedReasoningTokens =
    typeof completionDetails === "object" &&
    completionDetails !== null &&
    !Array.isArray(completionDetails)
      ? (completionDetails as Record<string, unknown>).reasoning_tokens
      : undefined;
  const reasoningTokens =
    typeof detailedReasoningTokens === "number"
      ? detailedReasoningTokens
      : directReasoningTokens;
  const totalTokens = usage.total_tokens;
  const result: AiTokenUsage = {
    ...(typeof inputTokens === "number" && Number.isFinite(inputTokens)
      ? { inputTokens }
      : {}),
    ...(typeof outputTokens === "number" && Number.isFinite(outputTokens)
      ? { outputTokens }
      : {}),
    ...(typeof reasoningTokens === "number" && Number.isFinite(reasoningTokens)
      ? { reasoningTokens }
      : {}),
    ...(typeof totalTokens === "number" && Number.isFinite(totalTokens)
      ? { totalTokens }
      : {}),
  };
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function safeProviderRequestId(
  bodyId: unknown,
  headerRequestId: string | null,
): string | undefined {
  const candidate = typeof bodyId === "string" ? bodyId : headerRequestId;
  return candidate !== null &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(candidate)
    ? redactSensitiveText(candidate, 200)
    : undefined;
}

function contentKind(
  message: Readonly<Record<string, unknown>>,
): NonNullable<AiProviderResponseMetadata["contentKind"]> {
  if (!Object.hasOwn(message, "content")) {
    return "missing";
  }
  if (message.content === null) {
    return "null";
  }
  if (typeof message.content === "string") {
    return "string";
  }
  if (Array.isArray(message.content)) {
    return "array";
  }
  return "unsupported";
}

function textFromContent(
  content: unknown,
  metadata: AiProviderResponseMetadata,
): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    throw new AiError({
      code: "provider-response-empty",
      message: "OpenRouter returned no final message content.",
      responseMetadata: metadata,
    });
  }
  if (!Array.isArray(content)) {
    throw new AiError({
      code: "provider-response-malformed",
      message: "OpenRouter returned an unsupported final content value.",
      responseMetadata: metadata,
    });
  }
  const textParts: string[] = [];
  let characterCount = 0;
  for (const part of content) {
    if (typeof part !== "object" || part === null || Array.isArray(part)) {
      throw new AiError({
        code: "provider-response-malformed",
        message: "OpenRouter returned an unsupported final content part.",
        responseMetadata: metadata,
      });
    }
    const record = part as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") {
      throw new AiError({
        code: "provider-response-malformed",
        message: "OpenRouter returned an unsupported final content part.",
        responseMetadata: metadata,
      });
    }
    characterCount += record.text.length;
    if (characterCount > MAXIMUM_OUTPUT_CHARACTERS) {
      throw new AiError({
        code: "provider-output-oversized",
        message: "OpenRouter final text exceeded the safe output limit.",
        responseMetadata: Object.freeze({
          ...metadata,
          contentCharacterCount: characterCount,
        }),
      });
    }
    textParts.push(record.text);
  }
  return textParts.join("");
}

function parseResponse(
  body: OpenRouterResponseBody,
  request: AiGenerationRequest,
  durationMs: number,
  headerRequestId: string | null,
): AiGenerationResult {
  const usage = parseUsage(body.usage);
  const providerRequestId = safeProviderRequestId(body.id, headerRequestId);
  const returnedModel =
    typeof body.model === "string" && validateAiModelId(body.model)
      ? redactSensitiveText(body.model, 128)
      : undefined;
  const commonMetadata = Object.freeze({
    httpCategory: "success" as const,
    ...(returnedModel === undefined ? {} : { returnedModel }),
    ...(usage?.outputTokens === undefined
      ? {}
      : { completionTokens: usage.outputTokens }),
    ...(usage?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
  });
  if (body.error !== undefined && body.error !== null) {
    throw new AiError({
      code: "provider-finish-error",
      message: "OpenRouter reported a provider error in a successful response.",
      responseMetadata: commonMetadata,
    });
  }
  if (!Array.isArray(body.choices)) {
    throw new AiError({
      code: "provider-response-malformed",
      message: "OpenRouter response did not contain a choices array.",
      responseMetadata: commonMetadata,
    });
  }
  if (body.choices.length === 0) {
    throw new AiError({
      code: "provider-response-malformed",
      message: "OpenRouter response contained no completion choices.",
      responseMetadata: Object.freeze({ ...commonMetadata, choicesCount: 0 }),
    });
  }
  const choices: readonly unknown[] = body.choices;
  const choice: unknown = choices[0];
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
    throw new AiError({
      code: "provider-response-malformed",
      message: "OpenRouter returned an invalid completion choice.",
      responseMetadata: Object.freeze({
        ...commonMetadata,
        choicesCount: choices.length,
      }),
    });
  }
  const record = choice as Record<string, unknown>;
  const finishReason =
    typeof record.finish_reason === "string"
      ? redactSensitiveText(record.finish_reason, 100)
      : "unknown";
  const nativeFinishReason =
    typeof record.native_finish_reason === "string"
      ? redactSensitiveText(record.native_finish_reason, 100)
      : undefined;
  const message = record.message;
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    throw new AiError({
      code: "provider-response-malformed",
      message: "OpenRouter response did not contain a completion message.",
      responseMetadata: Object.freeze({
        ...commonMetadata,
        choicesCount: choices.length,
        finishReason,
        ...(nativeFinishReason === undefined ? {} : { nativeFinishReason }),
        contentKind: "missing",
      }),
    });
  }
  const messageRecord = message as Record<string, unknown>;
  const kind = contentKind(messageRecord);
  const reasoningPresent =
    (typeof messageRecord.reasoning === "string" &&
      messageRecord.reasoning.length > 0) ||
    (Array.isArray(messageRecord.reasoning_details) &&
      messageRecord.reasoning_details.length > 0);
  const metadata: AiProviderResponseMetadata = Object.freeze({
    ...commonMetadata,
    choicesCount: choices.length,
    finishReason,
    ...(nativeFinishReason === undefined ? {} : { nativeFinishReason }),
    contentKind: kind,
    ...(typeof messageRecord.content === "string"
      ? { contentCharacterCount: messageRecord.content.length }
      : {}),
    reasoningPresent,
  });
  if (finishReason === "length") {
    throw new AiError({
      code: "provider-output-truncated",
      message:
        "OpenRouter exhausted the bounded completion-token allowance; increase the verifier allowance within policy limits.",
      responseMetadata: metadata,
    });
  }
  if (finishReason === "error") {
    throw new AiError({
      code: "provider-finish-error",
      message: "OpenRouter reported an unsuccessful completion finish state.",
      responseMetadata: metadata,
    });
  }
  const content = textFromContent(messageRecord.content, metadata);
  const completedMetadata = Object.freeze({
    ...metadata,
    contentCharacterCount: content.length,
  });
  if (content.length > MAXIMUM_OUTPUT_CHARACTERS) {
    throw new AiError({
      code: "provider-output-oversized",
      message: "OpenRouter final text exceeded the safe output limit.",
      responseMetadata: completedMetadata,
    });
  }
  if (content.trim().length === 0) {
    const tokenLimitReached =
      usage?.outputTokens !== undefined &&
      usage.outputTokens >= request.maxOutputTokens;
    throw new AiError({
      code: tokenLimitReached
        ? "provider-output-truncated"
        : "provider-response-empty",
      message: tokenLimitReached
        ? "OpenRouter exhausted the bounded completion-token allowance without final text; increase the verifier allowance within policy limits."
        : "OpenRouter returned empty final message content.",
      responseMetadata: completedMetadata,
    });
  }
  return Object.freeze({
    providerId: "openrouter",
    model: returnedModel ?? request.model,
    text: content,
    ...(usage === undefined ? {} : { usage }),
    finishReason,
    durationMs,
    retryCount: 0,
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
  });
}

export class OpenRouterAiProvider implements AiProvider {
  public readonly id = "openrouter";
  public readonly networkAccess = "required" as const;
  public readonly requiresApiKey = true;
  readonly #fetch: FetchImplementation;
  readonly #now: () => number;

  public constructor(dependencies: OpenRouterAiProviderDependencies = {}) {
    this.#fetch = dependencies.fetchImplementation ?? fetch;
    this.#now = dependencies.now ?? Date.now;
  }

  public async generate(
    request: AiGenerationRequest,
    context: AiProviderExecutionContext,
  ): Promise<AiGenerationResult> {
    if (context.apiKey === undefined || context.apiKey.length === 0) {
      throw new AiError({
        code: "secret-missing",
        message: "OpenRouter requires an API key at execution time.",
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);
    const startedAt = this.#now();
    const responseFormat = validateAiResponseFormat(request.responseFormat);
    try {
      const response = await this.#fetch(context.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${context.apiKey}`,
          "content-type": "application/json",
          ...(context.applicationName === undefined
            ? {}
            : { "x-title": context.applicationName }),
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            ...(request.systemInstruction === undefined
              ? []
              : [{ role: "system", content: request.systemInstruction }]),
            ...request.messages,
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          reasoning: { exclude: true },
          ...(responseFormat.type === "json_object"
            ? { response_format: { type: "json_object" } }
            : responseFormat.type === "json_schema"
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: responseFormat.name,
                      strict: responseFormat.strict,
                      schema: responseFormat.schema,
                    },
                  },
                  provider: { require_parameters: true },
                }
              : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw errorFromStatus(
          response.status,
          response.headers.get("retry-after"),
          responseFormat.type === "json_schema",
        );
      }
      const responseText = await response.text();
      if (responseText.length > MAXIMUM_RESPONSE_CHARACTERS) {
        throw new AiError({
          code: "provider-output-oversized",
          message: "OpenRouter response exceeded the safe response limit.",
          responseMetadata: Object.freeze({ httpCategory: "success" }),
        });
      }
      let body: OpenRouterResponseBody;
      try {
        body = JSON.parse(responseText) as OpenRouterResponseBody;
      } catch {
        throw new AiError({
          code: "provider-response-malformed",
          message: "OpenRouter returned malformed JSON.",
          responseMetadata: Object.freeze({ httpCategory: "success" }),
        });
      }
      return parseResponse(
        body,
        request,
        Math.max(this.#now() - startedAt, 0),
        response.headers.get("x-request-id"),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiError({
          code: "provider-timeout",
          message: "OpenRouter request timed out.",
          transient: true,
        });
      }
      if (error instanceof TypeError) {
        throw new AiError({
          code: "provider-unavailable",
          message: "OpenRouter could not be reached.",
          transient: true,
        });
      }
      throw toSafeAiError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
