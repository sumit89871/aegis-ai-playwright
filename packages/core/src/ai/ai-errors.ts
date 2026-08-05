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
  "provider-parameters-unsupported",
  "provider-schema-rejected",
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

const MAX_AI_VALIDATION_ERRORS = 10;
const MAX_AI_VALIDATION_ERROR_CHARACTERS = 200;

function safeValidationError(value: string): string {
  return redactSensitiveText(value, MAX_AI_VALIDATION_ERROR_CHARACTERS)
    .replace(/\b(?:sk|or)-[A-Za-z0-9_-]{10,}\b/giu, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/)[^\s]*/gu,
      "[LOCAL_PATH_REMOVED]",
    )
    .replace(/\b(?:BLIND|AI)-CANDIDATE-\d+\b/giu, "[CANDIDATE_ID]")
    .replace(/\bLOCATOR-\d+\b/giu, "[CANDIDATE_ID]");
}

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
  public readonly validationErrors?: readonly string[];

  public constructor(options: {
    readonly code: AiErrorCode;
    readonly message: string;
    readonly transient?: boolean;
    readonly retryAfterMs?: number;
    readonly httpStatus?: number;
    readonly responseMetadata?: AiProviderResponseMetadata;
    readonly validationErrors?: readonly string[];
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
    if (options.validationErrors !== undefined) {
      this.validationErrors = Object.freeze(
        options.validationErrors
          .slice(0, MAX_AI_VALIDATION_ERRORS)
          .map(safeValidationError),
      );
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
