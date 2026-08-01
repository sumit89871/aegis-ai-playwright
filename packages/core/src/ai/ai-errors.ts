import { redactSensitiveText } from "../diagnostics/redaction.ts";

export const AI_ERROR_CODES = [
  "ai-disabled",
  "capability-disabled",
  "network-disabled",
  "mock-only-policy",
  "configuration-invalid",
  "secret-missing",
  "provider-not-found",
  "request-blocked",
  "authentication-failed",
  "request-invalid",
  "rate-limited",
  "provider-unavailable",
  "provider-timeout",
  "provider-response-empty",
  "provider-output-truncated",
  "provider-response-malformed",
  "provider-output-oversized",
  "provider-finish-error",
  "provider-response-invalid",
  "structured-output-invalid",
  "provider-failure",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AiProviderResponseMetadata {
  readonly httpCategory: "success" | "failure";
  readonly choicesCount?: number;
  readonly returnedModel?: string;
  readonly finishReason?: string;
  readonly nativeFinishReason?: string;
  readonly completionTokens?: number;
  readonly reasoningTokens?: number;
  readonly contentKind?:
    "string" | "array" | "null" | "missing" | "unsupported";
  readonly contentCharacterCount?: number;
  readonly reasoningPresent?: boolean;
  readonly providerRequestId?: string;
}

export class AiError extends Error {
  public readonly code: AiErrorCode;
  public readonly transient: boolean;
  public readonly retryAfterMs?: number;
  public readonly httpStatus?: number;
  public readonly responseMetadata?: AiProviderResponseMetadata;

  public constructor(options: {
    readonly code: AiErrorCode;
    readonly message: string;
    readonly transient?: boolean;
    readonly retryAfterMs?: number;
    readonly httpStatus?: number;
    readonly responseMetadata?: AiProviderResponseMetadata;
  }) {
    super(redactSensitiveText(options.message, 500));
    this.name = "AiError";
    this.code = options.code;
    this.transient = options.transient ?? false;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
    if (options.responseMetadata !== undefined) {
      this.responseMetadata = Object.freeze({ ...options.responseMetadata });
    }
  }
}

export function toSafeAiError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  return new AiError({
    code: "provider-failure",
    message: "The AI provider failed unexpectedly.",
  });
}
