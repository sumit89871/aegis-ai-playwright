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
