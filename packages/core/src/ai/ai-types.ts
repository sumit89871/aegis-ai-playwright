export const AI_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export interface AiPromptMessage {
  readonly role: AiMessageRole;
  readonly content: string;
}

export type StructuredOutputValidator = (
  value: Readonly<Record<string, unknown>>,
) => boolean | { readonly valid: boolean; readonly errors?: readonly string[] };

export type AiResponseFormat =
  | { readonly type: "text" }
  | {
      readonly type: "json_object";
      readonly validator?: StructuredOutputValidator;
      readonly validatorId?: string;
      readonly retainRawText?: boolean;
    };

export interface AiRequestMetadata {
  readonly correlationId?: string;
  readonly promptTemplateId?: string;
  readonly promptTemplateVersion?: string;
  readonly capability?: string;
}

export interface AiGenerationRequest {
  readonly systemInstruction?: string;
  readonly messages: readonly AiPromptMessage[];
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly responseFormat: AiResponseFormat;
  readonly timeoutMs: number;
  readonly metadata?: AiRequestMetadata;
}

export interface AiTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiGenerationResult {
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly structuredOutput?: Readonly<Record<string, unknown>>;
  readonly usage?: AiTokenUsage;
  readonly finishReason: string;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly providerRequestId?: string;
}

export type AiClientResult =
  | {
      readonly status: "disabled";
      readonly reason: "ai-disabled" | "capability-disabled";
      readonly events: readonly AiLifecycleEvent[];
    }
  | {
      readonly status: "completed";
      readonly providerId: string;
      readonly model: string;
      readonly text?: string;
      readonly structuredOutput?: Readonly<Record<string, unknown>>;
      readonly usage?: AiTokenUsage;
      readonly finishReason: string;
      readonly durationMs: number;
      readonly retryCount: number;
      readonly providerRequestId?: string;
      readonly approximateCostUsd?: number;
      readonly events: readonly AiLifecycleEvent[];
    };

export interface ModelPricing {
  readonly inputCostPerMillionTokens: number;
  readonly outputCostPerMillionTokens: number;
}
import type { AiLifecycleEvent } from "./ai-events.ts";
