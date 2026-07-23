import { AiError } from "./ai-errors.ts";

export type AiSecretSource = Readonly<Record<string, string | undefined>>;

export function resolveAiApiKey(
  environmentVariableName: string,
  source: AiSecretSource,
): string {
  const value = source[environmentVariableName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AiError({
      code: "secret-missing",
      message:
        "AI provider is enabled, but the configured API-key environment variable is missing.",
    });
  }
  return value;
}
