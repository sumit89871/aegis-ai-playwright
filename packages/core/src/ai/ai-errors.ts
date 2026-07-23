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
  "provider-response-invalid",
  "structured-output-invalid",
  "provider-failure",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  public readonly code: AiErrorCode;
  public readonly transient: boolean;
  public readonly retryAfterMs?: number;
  public readonly httpStatus?: number;

  public constructor(options: {
    readonly code: AiErrorCode;
    readonly message: string;
    readonly transient?: boolean;
    readonly retryAfterMs?: number;
    readonly httpStatus?: number;
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
