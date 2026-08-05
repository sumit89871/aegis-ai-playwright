import type { AiGenerationRequest, AiGenerationResult } from "./ai-types.ts";

export interface AiProviderExecutionContext {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly applicationName?: string;
}

export interface AiProvider {
  readonly id: string;
  readonly networkAccess: "none" | "required";
  readonly requiresApiKey: boolean;
  generate(
    request: AiGenerationRequest,
    context: AiProviderExecutionContext,
  ): Promise<AiGenerationResult>;
}

export function validateAiProviderId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(id);
}

export function validateAiModelId(id: string): boolean {
  if (id.length === 0 || id.length > 128) return false;
  const parts = id.split(":");
  if (parts.length > 2) return false;
  const [base, variant] = parts;
  if (base === undefined || !/^[a-z0-9][a-z0-9._/-]*$/u.test(base))
    return false;
  return variant === undefined || /^[a-z0-9][a-z0-9._-]*$/u.test(variant);
}
