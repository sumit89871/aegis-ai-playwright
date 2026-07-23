import {
  containsSensitiveUrlData,
  sanitizeUrl,
} from "../diagnostics/redaction.ts";
import { AiError } from "./ai-errors.ts";

export interface AiConfiguration {
  readonly enabled: boolean;
  readonly provider: string;
  readonly model: string;
  readonly apiKeyEnvironmentVariable?: string;
  readonly endpoint: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly maxInputCharacters: number;
  readonly maxOutputTokens: number;
  readonly maxEstimatedCostUsd?: number;
  readonly defaultTemperature: number;
  readonly allowNetworkCalls: boolean;
  readonly applicationName?: string;
  readonly enabledCapabilities: readonly string[];
  readonly mockOnly: boolean;
  readonly allowInsecureLocalhost: boolean;
}

export const DEFAULT_OPENROUTER_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;
const ALLOWED_FIELDS = new Set([
  "enabled",
  "provider",
  "model",
  "apiKeyEnvironmentVariable",
  "endpoint",
  "requestTimeoutMs",
  "maxRetries",
  "maxInputCharacters",
  "maxOutputTokens",
  "maxEstimatedCostUsd",
  "defaultTemperature",
  "allowNetworkCalls",
  "applicationName",
  "enabledCapabilities",
  "mockOnly",
  "allowInsecureLocalhost",
]);

function configurationError(message: string): never {
  throw new AiError({ code: "configuration-invalid", message });
}

function assertPlainObject(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    configurationError("AI configuration must be a plain serializable object.");
  }
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    configurationError(`${field} must be a boolean.`);
  }
  return value;
}

function requireString(value: unknown, field: string, maximum = 200): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    configurationError(`${field} must be a bounded non-empty trimmed string.`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    configurationError(
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}

function validateEndpoint(
  value: unknown,
  allowInsecureLocalhost: boolean,
): string {
  const endpoint = requireString(value, "endpoint", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return configurationError("endpoint must be an absolute URL.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return configurationError("endpoint must not contain credentials.");
  }
  if (containsSensitiveUrlData(endpoint)) {
    return configurationError(
      "endpoint must not contain sensitive query parameters.",
    );
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const localHttp =
    parsed.protocol === "http:" && localHostnames.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowInsecureLocalhost && localHttp)) {
    return configurationError(
      "endpoint must use HTTPS; localhost HTTP requires allowInsecureLocalhost.",
    );
  }
  return sanitizeUrl(parsed.toString());
}

export function defaultAiConfiguration(
  overrides: Partial<AiConfiguration> = {},
): AiConfiguration {
  return validateAiConfiguration({
    enabled: false,
    provider: "mock",
    model: "mock-deterministic-v1",
    endpoint: DEFAULT_OPENROUTER_ENDPOINT,
    requestTimeoutMs: 30_000,
    maxRetries: 2,
    maxInputCharacters: 40_000,
    maxOutputTokens: 2_000,
    defaultTemperature: 0,
    allowNetworkCalls: false,
    enabledCapabilities: [],
    mockOnly: true,
    allowInsecureLocalhost: false,
    ...overrides,
  });
}

export function validateAiConfiguration(value: unknown): AiConfiguration {
  assertPlainObject(value);
  const unknownField = Object.keys(value).find(
    (field) => !ALLOWED_FIELDS.has(field),
  );
  if (unknownField !== undefined) {
    return configurationError(
      `AI configuration contains unsupported field ${unknownField}.`,
    );
  }

  const enabled = requireBoolean(value.enabled, "enabled");
  const provider = requireString(value.provider, "provider", 128);
  const model = requireString(value.model, "model", 128);
  if (!IDENTIFIER_PATTERN.test(provider)) {
    return configurationError(
      "provider must use a normalized provider identifier.",
    );
  }
  if (!IDENTIFIER_PATTERN.test(model)) {
    return configurationError("model must use a normalized model identifier.");
  }
  const allowInsecureLocalhost = requireBoolean(
    value.allowInsecureLocalhost,
    "allowInsecureLocalhost",
  );
  const endpoint = validateEndpoint(value.endpoint, allowInsecureLocalhost);
  const requestTimeoutMs = requireInteger(
    value.requestTimeoutMs,
    "requestTimeoutMs",
    100,
    120_000,
  );
  const maxRetries = requireInteger(value.maxRetries, "maxRetries", 0, 5);
  const maxInputCharacters = requireInteger(
    value.maxInputCharacters,
    "maxInputCharacters",
    1,
    1_000_000,
  );
  const maxOutputTokens = requireInteger(
    value.maxOutputTokens,
    "maxOutputTokens",
    1,
    100_000,
  );
  if (
    typeof value.defaultTemperature !== "number" ||
    !Number.isFinite(value.defaultTemperature) ||
    value.defaultTemperature < 0 ||
    value.defaultTemperature > 2
  ) {
    return configurationError("defaultTemperature must be between 0 and 2.");
  }
  if (
    value.maxEstimatedCostUsd !== undefined &&
    (typeof value.maxEstimatedCostUsd !== "number" ||
      !Number.isFinite(value.maxEstimatedCostUsd) ||
      value.maxEstimatedCostUsd <= 0 ||
      value.maxEstimatedCostUsd > 10_000)
  ) {
    return configurationError(
      "maxEstimatedCostUsd must be greater than 0 and no more than 10000.",
    );
  }
  const apiKeyEnvironmentVariable =
    value.apiKeyEnvironmentVariable === undefined
      ? undefined
      : requireString(
          value.apiKeyEnvironmentVariable,
          "apiKeyEnvironmentVariable",
          128,
        );
  if (
    apiKeyEnvironmentVariable !== undefined &&
    !ENVIRONMENT_VARIABLE_PATTERN.test(apiKeyEnvironmentVariable)
  ) {
    return configurationError(
      "apiKeyEnvironmentVariable must be an uppercase environment-variable name.",
    );
  }
  if (
    provider !== "mock" &&
    enabled &&
    apiKeyEnvironmentVariable === undefined
  ) {
    return configurationError(
      "An enabled network provider requires apiKeyEnvironmentVariable.",
    );
  }
  const applicationName =
    value.applicationName === undefined
      ? undefined
      : requireString(value.applicationName, "applicationName", 100);
  if (!Array.isArray(value.enabledCapabilities)) {
    return configurationError("enabledCapabilities must be an array.");
  }
  const enabledCapabilities = value.enabledCapabilities.map((entry, index) => {
    const capability = requireString(
      entry,
      `enabledCapabilities[${String(index)}]`,
      100,
    );
    if (!SLUG_PATTERN.test(capability)) {
      return configurationError(
        "enabledCapabilities must contain lowercase kebab-case values.",
      );
    }
    return capability;
  });
  if (new Set(enabledCapabilities).size !== enabledCapabilities.length) {
    return configurationError(
      "enabledCapabilities must contain unique values.",
    );
  }

  return Object.freeze({
    enabled,
    provider,
    model,
    ...(apiKeyEnvironmentVariable === undefined
      ? {}
      : { apiKeyEnvironmentVariable }),
    endpoint,
    requestTimeoutMs,
    maxRetries,
    maxInputCharacters,
    maxOutputTokens,
    ...(value.maxEstimatedCostUsd === undefined
      ? {}
      : { maxEstimatedCostUsd: value.maxEstimatedCostUsd }),
    defaultTemperature: value.defaultTemperature,
    allowNetworkCalls: requireBoolean(
      value.allowNetworkCalls,
      "allowNetworkCalls",
    ),
    ...(applicationName === undefined ? {} : { applicationName }),
    enabledCapabilities: Object.freeze([...enabledCapabilities].sort()),
    mockOnly: requireBoolean(value.mockOnly, "mockOnly"),
    allowInsecureLocalhost,
  });
}

export function isAiCapabilityEnabled(
  configuration: AiConfiguration,
  capability: string,
): boolean {
  return (
    configuration.enabled &&
    configuration.enabledCapabilities.includes(capability)
  );
}
