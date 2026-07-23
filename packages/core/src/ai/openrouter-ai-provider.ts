import { redactSensitiveText } from "../diagnostics/redaction.ts";
import { AiError, toSafeAiError } from "./ai-errors.ts";
import type { AiProvider, AiProviderExecutionContext } from "./ai-provider.ts";
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

const MAXIMUM_RESPONSE_CHARACTERS = 1_000_000;

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

function errorFromStatus(status: number, retryAfter: string | null): AiError {
  if (status === 401 || status === 403) {
    return new AiError({
      code: "authentication-failed",
      message: "OpenRouter rejected the request credentials.",
      httpStatus: status,
    });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new AiError({
      code: "request-invalid",
      message: `OpenRouter rejected the request with HTTP ${String(status)}.`,
      httpStatus: status,
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
    });
  }
  if (status >= 500) {
    return new AiError({
      code: "provider-unavailable",
      message: `OpenRouter is unavailable with HTTP ${String(status)}.`,
      transient: true,
      httpStatus: status,
    });
  }
  return new AiError({
    code: "provider-failure",
    message: `OpenRouter request failed with HTTP ${String(status)}.`,
    httpStatus: status,
  });
}

function parseUsage(value: unknown): AiTokenUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;
  const result: AiTokenUsage = {
    ...(typeof inputTokens === "number" && Number.isFinite(inputTokens)
      ? { inputTokens }
      : {}),
    ...(typeof outputTokens === "number" && Number.isFinite(outputTokens)
      ? { outputTokens }
      : {}),
    ...(typeof totalTokens === "number" && Number.isFinite(totalTokens)
      ? { totalTokens }
      : {}),
  };
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function parseResponse(
  body: OpenRouterResponseBody,
  request: AiGenerationRequest,
  durationMs: number,
  headerRequestId: string | null,
): AiGenerationResult {
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    throw new AiError({
      code: "provider-response-invalid",
      message: "OpenRouter response did not contain a completion choice.",
    });
  }
  const choices: readonly unknown[] = body.choices;
  const choice: unknown = choices[0];
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
    throw new AiError({
      code: "provider-response-invalid",
      message: "OpenRouter returned an invalid completion choice.",
    });
  }
  const record = choice as Record<string, unknown>;
  const message = record.message;
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    throw new AiError({
      code: "provider-response-invalid",
      message: "OpenRouter response did not contain a completion message.",
    });
  }
  const content = (message as Record<string, unknown>).content;
  if (
    typeof content !== "string" ||
    content.length > MAXIMUM_RESPONSE_CHARACTERS
  ) {
    throw new AiError({
      code: "provider-response-invalid",
      message: "OpenRouter returned missing or oversized text output.",
    });
  }
  const usage = parseUsage(body.usage);
  const candidateRequestId =
    typeof body.id === "string" ? body.id : (headerRequestId ?? undefined);
  const providerRequestId =
    candidateRequestId !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(candidateRequestId)
      ? redactSensitiveText(candidateRequestId, 200)
      : undefined;
  return Object.freeze({
    providerId: "openrouter",
    model:
      typeof body.model === "string"
        ? redactSensitiveText(body.model, 128)
        : request.model,
    text: content,
    ...(usage === undefined ? {} : { usage }),
    finishReason:
      typeof record.finish_reason === "string"
        ? redactSensitiveText(record.finish_reason, 100)
        : "unknown",
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
          ...(request.responseFormat.type === "json_object"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw errorFromStatus(
          response.status,
          response.headers.get("retry-after"),
        );
      }
      const responseText = await response.text();
      if (responseText.length > MAXIMUM_RESPONSE_CHARACTERS) {
        throw new AiError({
          code: "provider-response-invalid",
          message: "OpenRouter returned an oversized response.",
        });
      }
      let body: OpenRouterResponseBody;
      try {
        body = JSON.parse(responseText) as OpenRouterResponseBody;
      } catch {
        throw new AiError({
          code: "provider-response-invalid",
          message: "OpenRouter returned malformed JSON.",
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
