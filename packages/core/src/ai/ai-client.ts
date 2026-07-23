import { AiError, toSafeAiError } from "./ai-errors.ts";
import type { AiEventSink } from "./ai-events.ts";
import { AiEventRecorder } from "./ai-events.ts";
import type { AiConfiguration } from "./ai-configuration.ts";
import {
  isAiCapabilityEnabled,
  validateAiConfiguration,
} from "./ai-configuration.ts";
import type { AiProvider } from "./ai-provider.ts";
import { validateAiProviderId } from "./ai-provider.ts";
import type {
  AiClientResult,
  AiGenerationRequest,
  AiResponseFormat,
  ModelPricing,
} from "./ai-types.ts";
import type { PromptTemplate, PromptVariableValue } from "./prompt-template.ts";
import { renderPromptTemplate } from "./prompt-template.ts";
import { resolveAiApiKey } from "./secret-resolution.ts";
import { parseAiOutput } from "./structured-output.ts";
import { enforceAiUsageLimits } from "./usage-limits.ts";

export type AiSecretEnvironment = Readonly<Record<string, string | undefined>>;

export interface AiClientRequest {
  readonly template: PromptTemplate;
  readonly variables: Readonly<Record<string, PromptVariableValue>>;
  readonly responseFormat: AiResponseFormat;
  readonly capability?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly correlationId?: string;
}

export interface AiClientDependencies {
  readonly providers: readonly AiProvider[];
  readonly environment?: AiSecretEnvironment;
  readonly eventSink?: AiEventSink;
  readonly pricing?: ModelPricing;
  readonly now?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export interface AiClient {
  readonly configuration: AiConfiguration;
  generate(request: AiClientRequest): Promise<AiClientResult>;
}

const defaultDelay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

function retryDelay(error: AiError, retryNumber: number): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  return Math.min(250 * 2 ** Math.max(retryNumber - 1, 0), 10_000);
}

function validateClientRequest(
  request: AiClientRequest,
  configuration: AiConfiguration,
): { readonly temperature: number; readonly maxOutputTokens: number } {
  const model = request.model ?? configuration.model;
  if (!validateAiProviderId(model)) {
    throw new AiError({
      code: "request-invalid",
      message: "AI request model must use a normalized identifier.",
    });
  }
  if (
    request.correlationId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.correlationId)
  ) {
    throw new AiError({
      code: "request-invalid",
      message: "AI request correlationId must use a bounded safe identifier.",
    });
  }
  const temperature = request.temperature ?? configuration.defaultTemperature;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new AiError({
      code: "request-invalid",
      message: "AI request temperature must be between 0 and 2.",
    });
  }
  const maxOutputTokens =
    request.maxOutputTokens ?? configuration.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new AiError({
      code: "request-invalid",
      message: "AI request maxOutputTokens must be a positive integer.",
    });
  }
  return { temperature, maxOutputTokens };
}

function actualApproximateCost(
  pricing: ModelPricing | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  if (pricing === undefined) {
    return undefined;
  }
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }
  return (
    ((inputTokens ?? 0) * pricing.inputCostPerMillionTokens +
      (outputTokens ?? 0) * pricing.outputCostPerMillionTokens) /
    1_000_000
  );
}

export function createAiClient(
  configurationInput: AiConfiguration,
  dependencies: AiClientDependencies,
): AiClient {
  const configuration = validateAiConfiguration(configurationInput);
  const providers = new Map<string, AiProvider>();
  for (const provider of dependencies.providers) {
    if (providers.has(provider.id)) {
      throw new AiError({
        code: "configuration-invalid",
        message: `Duplicate AI provider registration for ${provider.id}.`,
      });
    }
    providers.set(provider.id, provider);
  }
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? defaultDelay;

  return Object.freeze({
    configuration,
    async generate(request: AiClientRequest): Promise<AiClientResult> {
      const recorder = new AiEventRecorder(dependencies.eventSink);
      const eventBase = {
        providerId: configuration.provider,
        model: request.model ?? configuration.model,
        promptTemplateId: request.template.id,
        promptTemplateVersion: request.template.version,
      } as const;
      if (!configuration.enabled) {
        recorder.emit({ type: "ai-disabled", ...eventBase });
        return Object.freeze({
          status: "disabled",
          reason: "ai-disabled",
          events: recorder.snapshot(),
        });
      }
      if (
        request.capability !== undefined &&
        !isAiCapabilityEnabled(configuration, request.capability)
      ) {
        recorder.emit({ type: "ai-disabled", ...eventBase });
        return Object.freeze({
          status: "disabled",
          reason: "capability-disabled",
          events: recorder.snapshot(),
        });
      }

      try {
        const provider = providers.get(configuration.provider);
        if (provider === undefined) {
          throw new AiError({
            code: "provider-not-found",
            message: `AI provider ${configuration.provider} is not registered.`,
          });
        }
        if (configuration.mockOnly && provider.networkAccess !== "none") {
          throw new AiError({
            code: "mock-only-policy",
            message: "AI policy permits only an offline mock provider.",
          });
        }
        if (
          provider.networkAccess === "required" &&
          !configuration.allowNetworkCalls
        ) {
          throw new AiError({
            code: "network-disabled",
            message: "AI network access is disabled by policy.",
          });
        }
        const rendered = renderPromptTemplate(
          request.template,
          request.variables,
        );
        const { temperature, maxOutputTokens } = validateClientRequest(
          request,
          configuration,
        );
        const estimate = enforceAiUsageLimits(configuration, {
          inputCharacters: rendered.totalCharacters,
          requestedOutputTokens: maxOutputTokens,
          ...(dependencies.pricing === undefined
            ? {}
            : { pricing: dependencies.pricing }),
        });
        const apiKey = provider.requiresApiKey
          ? resolveAiApiKey(
              configuration.apiKeyEnvironmentVariable ?? "",
              dependencies.environment ?? process.env,
            )
          : undefined;
        const providerRequest: AiGenerationRequest = Object.freeze({
          systemInstruction: rendered.systemInstruction,
          messages: Object.freeze([
            Object.freeze({
              role: "user" as const,
              content: rendered.userMessage,
            }),
          ]),
          model: request.model ?? configuration.model,
          temperature,
          maxOutputTokens,
          responseFormat: request.responseFormat,
          timeoutMs: configuration.requestTimeoutMs,
          metadata: Object.freeze({
            promptTemplateId: rendered.templateId,
            promptTemplateVersion: rendered.templateVersion,
            ...(request.capability === undefined
              ? {}
              : { capability: request.capability }),
            ...(request.correlationId === undefined
              ? {}
              : { correlationId: request.correlationId }),
          }),
        });
        const startedAt = now();
        let retryCount = 0;
        for (
          let attempt = 0;
          attempt <= configuration.maxRetries;
          attempt += 1
        ) {
          recorder.emit({
            type: "request-started",
            ...eventBase,
            inputCharacterCount: rendered.totalCharacters,
            requestedOutputTokens: maxOutputTokens,
            retryNumber: retryCount,
          });
          try {
            const providerResult = await provider.generate(providerRequest, {
              endpoint: configuration.endpoint,
              ...(apiKey === undefined ? {} : { apiKey }),
              ...(configuration.applicationName === undefined
                ? {}
                : { applicationName: configuration.applicationName }),
            });
            const parsed = parseAiOutput(
              providerResult.text,
              request.responseFormat,
            );
            const durationMs = Math.max(now() - startedAt, 0);
            const approximateCostUsd =
              actualApproximateCost(
                dependencies.pricing,
                providerResult.usage?.inputTokens,
                providerResult.usage?.outputTokens,
              ) ?? estimate?.estimatedMaximumCostUsd;
            if (provider.id === "mock") {
              recorder.emit({
                type: "mock-response-used",
                ...eventBase,
                retryNumber: retryCount,
              });
            }
            recorder.emit({
              type: "request-completed",
              ...eventBase,
              durationMs,
              retryNumber: retryCount,
              ...(providerResult.usage === undefined
                ? {}
                : { usage: providerResult.usage }),
              ...(approximateCostUsd === undefined
                ? {}
                : { approximateCostUsd }),
            });
            return Object.freeze({
              status: "completed",
              providerId: providerResult.providerId,
              model: providerResult.model,
              ...parsed,
              ...(providerResult.usage === undefined
                ? {}
                : { usage: providerResult.usage }),
              finishReason: providerResult.finishReason,
              durationMs,
              retryCount,
              ...(providerResult.providerRequestId === undefined
                ? {}
                : { providerRequestId: providerResult.providerRequestId }),
              ...(approximateCostUsd === undefined
                ? {}
                : { approximateCostUsd }),
              events: recorder.snapshot(),
            });
          } catch (error) {
            const safeError = toSafeAiError(error);
            if (
              !safeError.transient ||
              retryCount >= configuration.maxRetries
            ) {
              recorder.emit({
                type: "request-failed",
                ...eventBase,
                durationMs: Math.max(now() - startedAt, 0),
                retryNumber: retryCount,
                errorCode: safeError.code,
              });
              throw safeError;
            }
            retryCount += 1;
            recorder.emit({
              type: "retry-scheduled",
              ...eventBase,
              retryNumber: retryCount,
              errorCode: safeError.code,
            });
            await delay(retryDelay(safeError, retryCount));
          }
        }
        throw new AiError({
          code: "provider-failure",
          message: "AI retry loop ended unexpectedly.",
        });
      } catch (error) {
        const safeError = toSafeAiError(error);
        if (
          !recorder
            .snapshot()
            .some(
              (event) =>
                event.type === "request-failed" ||
                event.type === "request-blocked",
            )
        ) {
          recorder.emit({
            type: "request-blocked",
            ...eventBase,
            errorCode: safeError.code,
          });
        }
        throw safeError;
      }
    },
  });
}
