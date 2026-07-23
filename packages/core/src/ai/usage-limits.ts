import { AiError } from "./ai-errors.ts";
import type { AiConfiguration } from "./ai-configuration.ts";
import type { ModelPricing } from "./ai-types.ts";

export interface AiCostEstimate {
  readonly approximate: true;
  readonly estimatedInputTokens: number;
  readonly maximumOutputTokens: number;
  readonly estimatedMaximumCostUsd: number;
  readonly method: "conservative-character-approximation";
}

export interface AiUsageLimitInput {
  readonly inputCharacters: number;
  readonly requestedOutputTokens: number;
  readonly pricing?: ModelPricing;
}

export function estimateInputTokensConservatively(
  inputCharacters: number,
): number {
  if (!Number.isInteger(inputCharacters) || inputCharacters < 0) {
    throw new AiError({
      code: "request-invalid",
      message: "inputCharacters must be a non-negative integer.",
    });
  }
  return Math.ceil(inputCharacters / 3);
}

function validatePricing(pricing: ModelPricing): void {
  for (const [name, value] of Object.entries(pricing)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new AiError({
        code: "configuration-invalid",
        message: `${name} must be a finite non-negative price.`,
      });
    }
  }
}

export function estimateMaximumAiCost(
  inputCharacters: number,
  maximumOutputTokens: number,
  pricing: ModelPricing,
): AiCostEstimate {
  validatePricing(pricing);
  const estimatedInputTokens =
    estimateInputTokensConservatively(inputCharacters);
  const estimatedMaximumCostUsd =
    (estimatedInputTokens * pricing.inputCostPerMillionTokens +
      maximumOutputTokens * pricing.outputCostPerMillionTokens) /
    1_000_000;
  return Object.freeze({
    approximate: true,
    estimatedInputTokens,
    maximumOutputTokens,
    estimatedMaximumCostUsd,
    method: "conservative-character-approximation",
  });
}

export function enforceAiUsageLimits(
  configuration: AiConfiguration,
  input: AiUsageLimitInput,
): AiCostEstimate | undefined {
  if (input.inputCharacters > configuration.maxInputCharacters) {
    throw new AiError({
      code: "request-blocked",
      message: "AI request exceeds the configured input-character limit.",
    });
  }
  if (input.requestedOutputTokens > configuration.maxOutputTokens) {
    throw new AiError({
      code: "request-blocked",
      message: "AI request exceeds the configured output-token limit.",
    });
  }
  if (configuration.maxEstimatedCostUsd === undefined) {
    return input.pricing === undefined
      ? undefined
      : estimateMaximumAiCost(
          input.inputCharacters,
          input.requestedOutputTokens,
          input.pricing,
        );
  }
  if (input.pricing === undefined) {
    throw new AiError({
      code: "request-blocked",
      message:
        "AI cost limit is configured, but no model pricing was supplied.",
    });
  }
  const estimate = estimateMaximumAiCost(
    input.inputCharacters,
    input.requestedOutputTokens,
    input.pricing,
  );
  if (estimate.estimatedMaximumCostUsd > configuration.maxEstimatedCostUsd) {
    throw new AiError({
      code: "request-blocked",
      message: "AI request exceeds the configured estimated-cost limit.",
    });
  }
  return estimate;
}
