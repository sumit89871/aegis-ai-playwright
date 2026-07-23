import { redactSensitiveText } from "../diagnostics/redaction.ts";
import { AiError } from "./ai-errors.ts";
import type { AiResponseFormat } from "./ai-types.ts";

export interface ParsedAiOutput {
  readonly text?: string;
  readonly structuredOutput?: Readonly<Record<string, unknown>>;
}

function structuredError(message: string): never {
  throw new AiError({
    code: "structured-output-invalid",
    message: redactSensitiveText(message, 500),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function parseAiOutput(
  text: string,
  format: AiResponseFormat,
): ParsedAiOutput {
  if (format.type === "text") {
    return Object.freeze({ text });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return structuredError("AI output is not valid JSON.");
  }
  if (!isPlainObject(parsed)) {
    return structuredError("AI structured output must be a JSON object.");
  }
  if (format.validator !== undefined) {
    const validation = format.validator(parsed);
    const valid =
      typeof validation === "boolean" ? validation : validation.valid;
    if (!valid) {
      return structuredError(
        "AI structured output failed the supplied validator.",
      );
    }
  }
  return Object.freeze({
    ...(format.retainRawText === true ? { text } : {}),
    structuredOutput: Object.freeze(parsed),
  });
}
