import { redactSensitiveText } from "../diagnostics/redaction.ts";
import { AiError } from "./ai-errors.ts";
import type { AiProvider, AiProviderExecutionContext } from "./ai-provider.ts";
import type {
  AiGenerationRequest,
  AiGenerationResult,
  AiTokenUsage,
} from "./ai-types.ts";

export type MockAiFailureMode = "none" | "timeout" | "transient" | "permanent";

export interface MockAiProviderOptions {
  readonly text?: string;
  readonly structuredOutput?: Readonly<Record<string, unknown>>;
  readonly model?: string;
  readonly finishReason?: string;
  readonly usage?: AiTokenUsage;
  readonly failureMode?: MockAiFailureMode;
  readonly transientFailuresBeforeSuccess?: number;
  readonly durationMs?: number;
}

export interface MockAiRequestInspection {
  readonly model: string;
  readonly messageCount: number;
  readonly inputCharacterCount: number;
  readonly requestedOutputTokens: number;
  readonly responseFormat: "text" | "json_object";
  readonly metadata: Readonly<Record<string, string>>;
}

function serializeStructuredOutput(
  value: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(value);
}

function safeInspectionValue(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
    ? redactSensitiveText(value, 128)
    : "[REDACTED]";
}

export class MockAiProvider implements AiProvider {
  public readonly id = "mock";
  public readonly networkAccess = "none" as const;
  public readonly requiresApiKey = false;
  readonly #options: Required<
    Pick<
      MockAiProviderOptions,
      | "model"
      | "finishReason"
      | "failureMode"
      | "transientFailuresBeforeSuccess"
      | "durationMs"
    >
  > &
    Pick<MockAiProviderOptions, "text" | "structuredOutput" | "usage">;
  readonly #inspections: MockAiRequestInspection[] = [];
  #attempts = 0;

  public constructor(options: MockAiProviderOptions = {}) {
    const transientFailuresBeforeSuccess =
      options.transientFailuresBeforeSuccess ?? 0;
    if (
      !Number.isInteger(transientFailuresBeforeSuccess) ||
      transientFailuresBeforeSuccess < 0 ||
      transientFailuresBeforeSuccess > 100
    ) {
      throw new AiError({
        code: "configuration-invalid",
        message:
          "Mock transientFailuresBeforeSuccess must be between 0 and 100.",
      });
    }
    this.#options = Object.freeze({
      ...(options.text === undefined ? {} : { text: options.text }),
      ...(options.structuredOutput === undefined
        ? {}
        : { structuredOutput: options.structuredOutput }),
      ...(options.usage === undefined ? {} : { usage: options.usage }),
      model: options.model ?? "mock-deterministic-v1",
      finishReason: options.finishReason ?? "stop",
      failureMode: options.failureMode ?? "none",
      transientFailuresBeforeSuccess,
      durationMs: options.durationMs ?? 0,
    });
  }

  public inspections(): readonly MockAiRequestInspection[] {
    return Object.freeze([...this.#inspections]);
  }

  public async generate(
    request: AiGenerationRequest,
    context: AiProviderExecutionContext,
  ): Promise<AiGenerationResult> {
    await Promise.resolve();
    void context;
    this.#attempts += 1;
    const inputCharacterCount =
      (request.systemInstruction?.length ?? 0) +
      request.messages.reduce(
        (total, message) => total + message.content.length,
        0,
      );
    this.#inspections.push(
      Object.freeze({
        model: request.model,
        messageCount: request.messages.length,
        inputCharacterCount,
        requestedOutputTokens: request.maxOutputTokens,
        responseFormat: request.responseFormat.type,
        metadata: Object.freeze({
          ...(request.metadata?.correlationId === undefined
            ? {}
            : {
                correlationId: safeInspectionValue(
                  request.metadata.correlationId,
                ),
              }),
          ...(request.metadata?.promptTemplateId === undefined
            ? {}
            : {
                promptTemplateId: safeInspectionValue(
                  request.metadata.promptTemplateId,
                ),
              }),
          ...(request.metadata?.promptTemplateVersion === undefined
            ? {}
            : {
                promptTemplateVersion: safeInspectionValue(
                  request.metadata.promptTemplateVersion,
                ),
              }),
          ...(request.metadata?.capability === undefined
            ? {}
            : { capability: safeInspectionValue(request.metadata.capability) }),
        }),
      }),
    );

    if (this.#options.failureMode === "timeout") {
      throw new AiError({
        code: "provider-timeout",
        message: "The mock AI provider timed out.",
        transient: true,
      });
    }
    if (
      this.#options.failureMode === "transient" ||
      this.#attempts <= this.#options.transientFailuresBeforeSuccess
    ) {
      throw new AiError({
        code: "provider-unavailable",
        message: "The mock AI provider is temporarily unavailable.",
        transient: true,
      });
    }
    if (this.#options.failureMode === "permanent") {
      throw new AiError({
        code: "provider-failure",
        message: "The mock AI provider failed permanently.",
      });
    }

    const text =
      this.#options.structuredOutput === undefined
        ? (this.#options.text ?? "mock response")
        : serializeStructuredOutput(this.#options.structuredOutput);
    return Object.freeze({
      providerId: this.id,
      model: this.#options.model,
      text,
      ...(this.#options.usage === undefined
        ? {}
        : { usage: this.#options.usage }),
      finishReason: this.#options.finishReason,
      durationMs: this.#options.durationMs,
      retryCount: 0,
      providerRequestId: `mock-${String(this.#attempts)}`,
    });
  }
}
