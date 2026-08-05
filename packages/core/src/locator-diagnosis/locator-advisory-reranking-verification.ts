import type { AiClient, AiTokenUsage } from "../ai/index.ts";
import {
  LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
  LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
} from "./locator-advisory-reranking-schema.ts";
import {
  type LocatorAdvisoryValidationIssueCode,
  type LocatorAdvisoryRerankingInput,
  runLocatorAdvisoryReranking,
} from "./locator-advisory-reranking.ts";
import { LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION } from "./locator-advisory-reranking-prompt.ts";

export interface LocatorAdvisoryVerificationResult {
  readonly status: "pass" | "fail";
  readonly provider: string;
  readonly requestedModel: string;
  readonly returnedModel: string;
  readonly schemaName: typeof LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME;
  readonly promptVersion: typeof LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION;
  readonly responseSchemaVersion: typeof LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION;
  readonly recommendationStatus?: string;
  readonly rankedCandidateCount?: number;
  readonly suppliedIdValidation: "pass" | "not-completed";
  readonly typescriptBusinessValidation: "pass" | "not-completed";
  readonly usage?: AiTokenUsage;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly finishReason?: string;
  readonly errorCode?: string;
  readonly validationIssueCodes: readonly LocatorAdvisoryValidationIssueCode[];
  readonly locatorApplications: 0;
  readonly automaticHealing: false;
}

export function createSyntheticLocatorAdvisoryVerificationInput(): LocatorAdvisoryRerankingInput {
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    targetIntent: Object.freeze({
      operation: "click",
      strategy: "role",
      role: "link",
      name: "Saved items",
      locatorDescription: "A saved-items destination in account navigation.",
    }),
    failure: Object.freeze({
      summary: "The intended saved-items destination was not found.",
      pageAvailable: true,
      pageReady: true,
      candidateCollectionStatus: "collected",
    }),
    candidates: Object.freeze([
      Object.freeze({
        candidateId: "BLIND-CANDIDATE-001",
        strategy: "role" as const,
        role: "link",
        name: "Shopping cart",
        exact: true,
        scopeHint: "account navigation",
        tagName: "a",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      }),
      Object.freeze({
        candidateId: "BLIND-CANDIDATE-002",
        strategy: "role" as const,
        role: "link",
        name: "Wishlist",
        exact: true,
        scopeHint: "account navigation",
        tagName: "a",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      }),
      Object.freeze({
        candidateId: "BLIND-CANDIDATE-003",
        strategy: "role" as const,
        role: "link",
        name: "My account",
        exact: true,
        scopeHint: "account navigation",
        tagName: "a",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      }),
    ]),
  });
}

export async function verifyLocatorAdvisoryStructuredOutput(
  client: AiClient,
): Promise<LocatorAdvisoryVerificationResult> {
  const execution = await runLocatorAdvisoryReranking(
    createSyntheticLocatorAdvisoryVerificationInput(),
    client,
  );
  const common = {
    provider: execution.providerId ?? "unavailable",
    requestedModel: execution.requestedModel,
    returnedModel: execution.returnedModel ?? "unavailable",
    schemaName: LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
    promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
    responseSchemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    ...(execution.usage === undefined ? {} : { usage: execution.usage }),
    durationMs: execution.durationMs,
    retryCount: execution.retryCount,
    ...(execution.finishReason === undefined
      ? {}
      : { finishReason: execution.finishReason }),
    validationIssueCodes: execution.validationIssueCodes ?? Object.freeze([]),
    locatorApplications: 0 as const,
    automaticHealing: false as const,
  } as const;
  if (execution.status === "completed" && execution.output !== undefined)
    return Object.freeze({
      status: "pass",
      ...common,
      recommendationStatus: execution.output.recommendationStatus,
      rankedCandidateCount: execution.output.rankedCandidateIds.length,
      suppliedIdValidation: "pass",
      typescriptBusinessValidation: "pass",
    });
  return Object.freeze({
    status: "fail",
    ...common,
    suppliedIdValidation: "not-completed",
    typescriptBusinessValidation: "not-completed",
    errorCode: execution.errorCode ?? execution.status,
  });
}

export function renderLocatorAdvisoryVerificationResult(
  result: LocatorAdvisoryVerificationResult,
): string {
  return (
    [
      `Locator advisory structured-output verification: ${result.status.toUpperCase()}`,
      `Provider: ${result.provider}`,
      `Requested model: ${result.requestedModel}`,
      `Returned model: ${result.returnedModel}`,
      `Schema name: ${result.schemaName}`,
      `Prompt version: ${result.promptVersion}`,
      `Response schema version: ${result.responseSchemaVersion}`,
      ...(result.recommendationStatus === undefined
        ? []
        : [`Recommendation status: ${result.recommendationStatus}`]),
      ...(result.rankedCandidateCount === undefined
        ? []
        : [`Ranked candidate count: ${String(result.rankedCandidateCount)}`]),
      `Supplied-ID validation: ${result.suppliedIdValidation.toUpperCase()}`,
      `TypeScript business validation: ${result.typescriptBusinessValidation.toUpperCase()}`,
      `Input tokens: ${String(result.usage?.inputTokens ?? "unavailable")}`,
      `Output tokens: ${String(result.usage?.outputTokens ?? "unavailable")}`,
      `Reasoning tokens: ${String(result.usage?.reasoningTokens ?? "unavailable")}`,
      `Duration ms: ${String(result.durationMs)}`,
      `Retry count: ${String(result.retryCount)}`,
      `Finish reason: ${result.finishReason ?? "unavailable"}`,
      ...(result.errorCode === undefined
        ? []
        : [`Safe error code: ${result.errorCode}`]),
      ...(result.validationIssueCodes.length === 0
        ? []
        : [
            `Validation issue categories: ${result.validationIssueCodes.join(", ")}`,
          ]),
      "Locator application: absent",
      "Automatic healing: absent",
    ].join("\n") + "\n"
  );
}
