import { redactSensitiveText, sanitizeUrl } from "../diagnostics/redaction.ts";
import type { LocatorCandidateInventory } from "./locator-candidate.ts";
import type { LocatorFailureClassificationResult } from "./locator-failure-classifier.ts";

function safeEvidenceText(value: string, maximum: number): string {
  return redactSensitiveText(value, maximum * 2)
    .replace(/<[^>]{1,500}>/gu, "[DOM_SNIPPET_REMOVED]")
    .replace(
      /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/)[^\s)]+/gu,
      "[LOCAL_PATH_REMOVED]",
    )
    .slice(0, maximum);
}

export interface LocatorEvidenceInput {
  readonly errorMessage?: string;
  readonly pageUrl?: string;
  readonly pageReady?: boolean;
  readonly pageReadinessReason?: string;
  readonly pageAvailable: boolean;
  readonly projectName?: string;
  readonly retry?: number;
  readonly testId?: string;
  readonly feature?: string;
  readonly requirementIds?: readonly string[];
}

export interface LocatorFailureEvidence {
  readonly evidenceId: "LOCATOR-FAILURE-001";
  readonly classification: LocatorFailureClassificationResult["classification"];
  readonly confidence: LocatorFailureClassificationResult["confidence"];
  readonly attemptedOperation: LocatorFailureClassificationResult["intent"]["operation"];
  readonly originalLocatorStrategy: LocatorFailureClassificationResult["intent"]["strategy"];
  readonly originalLocatorDescription?: string;
  readonly expectedTarget?: string;
  readonly errorMessage: string;
  readonly pageReady: boolean | null;
  readonly pageReadinessReason?: string;
  readonly currentUrl?: string;
  readonly pageAvailable: boolean;
  readonly projectName?: string;
  readonly retry: number;
  readonly testId?: string;
  readonly feature?: string;
  readonly requirementIds: readonly string[];
  readonly candidateCollectionStatus: LocatorCandidateInventory["status"];
  readonly candidateCount: number;
  readonly droppedCandidateCount: number;
}

export function normalizeLocatorEvidence(
  input: LocatorEvidenceInput,
  classification: LocatorFailureClassificationResult,
  inventory: LocatorCandidateInventory,
): LocatorFailureEvidence {
  const expectedTarget =
    classification.intent.name ?? classification.intent.value;
  return Object.freeze({
    evidenceId: "LOCATOR-FAILURE-001",
    classification: classification.classification,
    confidence: classification.confidence,
    attemptedOperation: classification.intent.operation,
    originalLocatorStrategy: classification.intent.strategy,
    ...(classification.intent.locatorDescription === undefined
      ? {}
      : {
          originalLocatorDescription: safeEvidenceText(
            classification.intent.locatorDescription,
            300,
          ),
        }),
    ...(expectedTarget === undefined
      ? {}
      : { expectedTarget: safeEvidenceText(expectedTarget, 120) }),
    errorMessage: safeEvidenceText(
      input.errorMessage ?? "Failure message unavailable.",
      1_000,
    ),
    pageReady: input.pageReady ?? null,
    ...(input.pageReadinessReason === undefined
      ? {}
      : {
          pageReadinessReason: safeEvidenceText(input.pageReadinessReason, 300),
        }),
    ...(input.pageUrl === undefined
      ? {}
      : { currentUrl: sanitizeUrl(input.pageUrl, 1_024) }),
    pageAvailable: input.pageAvailable,
    ...(input.projectName === undefined
      ? {}
      : { projectName: redactSensitiveText(input.projectName, 100) }),
    retry:
      Number.isInteger(input.retry) && (input.retry ?? 0) >= 0
        ? (input.retry ?? 0)
        : 0,
    ...(input.testId === undefined
      ? {}
      : { testId: redactSensitiveText(input.testId, 100) }),
    ...(input.feature === undefined
      ? {}
      : { feature: redactSensitiveText(input.feature, 100) }),
    requirementIds: Object.freeze(
      [...new Set(input.requirementIds ?? [])]
        .map((value) => redactSensitiveText(value, 100))
        .sort(),
    ),
    candidateCollectionStatus: inventory.status,
    candidateCount: inventory.candidates.length,
    droppedCandidateCount: inventory.droppedCandidateCount,
  });
}
