import { AiError } from "./ai-errors.ts";
import type { AiJsonSchema, AiResponseFormat } from "./ai-types.ts";

export const MAX_AI_JSON_SCHEMA_BYTES = 32_000;
export const AI_JSON_SCHEMA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

function invalidResponseFormat(message: string): never {
  throw new AiError({ code: "request-invalid", message });
}

function assertJsonCompatible(
  value: unknown,
  seen: Set<object>,
  depth: number,
): void {
  if (depth > 40)
    invalidResponseFormat("AI JSON Schema nesting exceeds the safe bound.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      invalidResponseFormat("AI JSON Schema numbers must be finite.");
    return;
  }
  if (typeof value !== "object")
    invalidResponseFormat("AI JSON Schema must contain only JSON values.");
  if (seen.has(value))
    invalidResponseFormat("AI JSON Schema must not contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype)
      invalidResponseFormat("AI JSON Schema arrays must use plain prototypes.");
    if (Object.getOwnPropertySymbols(value).length > 0)
      invalidResponseFormat("AI JSON Schema must not contain symbol keys.");
    for (const entry of value) assertJsonCompatible(entry, seen, depth + 1);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      invalidResponseFormat(
        "AI JSON Schema objects must use plain prototypes.",
      );
    if (Object.getOwnPropertySymbols(value).length > 0)
      invalidResponseFormat("AI JSON Schema must not contain symbol keys.");
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    ))
      if (
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      )
        invalidResponseFormat(
          "AI JSON Schema properties must be enumerable data values.",
        );
    for (const [key, entry] of Object.entries(value)) {
      if (key.length === 0 || key.length > 200)
        invalidResponseFormat("AI JSON Schema property names must be bounded.");
      assertJsonCompatible(entry, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function deepFreezeJson<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const entry of Object.values(value)) deepFreezeJson(entry);
  return Object.freeze(value);
}

export function validateAiJsonSchema(input: unknown): AiJsonSchema {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    return invalidResponseFormat("AI JSON Schema must be a plain object.");
  assertJsonCompatible(input, new Set<object>(), 0);
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AI_JSON_SCHEMA_BYTES)
    return invalidResponseFormat("AI JSON Schema exceeds the safe size bound.");
  return deepFreezeJson(structuredClone(input) as AiJsonSchema);
}

export function validateAiResponseFormat(
  input: AiResponseFormat,
): AiResponseFormat {
  if (input.type === "text") return Object.freeze({ type: "text" });
  if (input.validator !== undefined && typeof input.validator !== "function")
    return invalidResponseFormat(
      "AI response validator must be a callable function.",
    );
  if (
    input.retainRawText !== undefined &&
    typeof input.retainRawText !== "boolean"
  )
    return invalidResponseFormat(
      "AI response retainRawText must be a boolean.",
    );
  const common = Object.freeze({
    ...(input.validator === undefined ? {} : { validator: input.validator }),
    ...(input.validatorId === undefined
      ? {}
      : { validatorId: input.validatorId }),
    ...(input.retainRawText === undefined
      ? {}
      : { retainRawText: input.retainRawText }),
  });
  if (
    input.validatorId !== undefined &&
    (typeof input.validatorId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.validatorId))
  )
    return invalidResponseFormat(
      "AI response validatorId must use a bounded safe identifier.",
    );
  if (input.type === "json_object")
    return Object.freeze({ type: "json_object", ...common });
  if (!AI_JSON_SCHEMA_NAME_PATTERN.test(input.name))
    return invalidResponseFormat(
      "AI JSON Schema name must use a bounded normalized identifier.",
    );
  if (typeof input.strict !== "boolean")
    return invalidResponseFormat("AI JSON Schema strict must be a boolean.");
  return Object.freeze({
    type: "json_schema",
    name: input.name,
    strict: input.strict,
    schema: validateAiJsonSchema(input.schema),
    ...common,
  });
}
