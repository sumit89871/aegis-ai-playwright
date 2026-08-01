import { redactSensitiveText } from "../diagnostics/redaction.ts";
import type { LocatorCandidate } from "../locator-diagnosis/locator-candidate.ts";
import type { LocatorDiagnosisReport } from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorEvidenceInput } from "../locator-diagnosis/locator-evidence.ts";
import type { LocatorTargetIntent } from "../locator-diagnosis/locator-failure-classifier.ts";
import {
  createLocatorObservationId,
  LOCATOR_OBSERVATION_SCHEMA_VERSION,
  type LocatorObservation,
  type LocatorObservationSourceType,
} from "./locator-observation.ts";
import { validateLocatorObservation } from "./locator-observation-validator.ts";

export interface LocatorObservationImportOptions {
  readonly applicationAlias: string;
  readonly sourceType?: LocatorObservationSourceType;
}

export type LocatorObservationImportResult =
  | { readonly status: "imported"; readonly observation: LocatorObservation }
  | { readonly status: "ignored"; readonly reason: string };

function sanitizedText(
  value: string | undefined,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  return redactSensitiveText(value, maximum)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(
      /(?:\b[A-Za-z]:[\\/]|\\\\[^\\\s]+\\[^\\\s]+|(?:^|[\s('"`])\/(?!\/)(?:[^/\s]+\/)+)[^\s)]*/gu,
      "[LOCAL_PATH_REMOVED]",
    )
    .replace(/<[^>]{1,500}>/gu, "[DOM_SNIPPET_REMOVED]")
    .slice(0, maximum);
}

function requiredSanitizedText(value: string, maximum: number): string {
  return sanitizedText(value, maximum) ?? "";
}

function sanitizePlainData(value: unknown): unknown {
  if (typeof value === "string")
    return (sanitizedText(value, 1_000) ?? "")
      .replace(
        /\b(?:authorization|api[_-]?key|password|cookie)\s*[:=]\s*\[REDACTED\]/giu,
        "sensitive value removed",
      )
      .replace(/\blocator\([^)]*\)/giu, "locator description")
      .replace(
        /page\.(?:getBy\w+|locator)\([^)]*\)/giu,
        "candidate description",
      );
  if (Array.isArray(value)) return value.map(sanitizePlainData);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sanitizePlainData(entry),
    ]),
  );
}

function isReport(value: unknown): value is LocatorDiagnosisReport {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.status === "completed" &&
    typeof record.evidence === "object" &&
    typeof record.deterministicAnalysis === "object" &&
    Array.isArray(record.candidateInventory) &&
    typeof record.provenance === "object"
  );
}

function safeCandidate(candidate: LocatorCandidate): LocatorCandidate {
  const clone = structuredClone(candidate);
  const optional = (
    value: string | undefined,
    maximum = 120,
  ): string | undefined => sanitizedText(value, maximum);
  return Object.freeze({
    ...clone,
    ...(clone.role === undefined
      ? {}
      : { role: requiredSanitizedText(clone.role, 80) }),
    ...(clone.name === undefined
      ? {}
      : { name: requiredSanitizedText(clone.name, 120) }),
    ...(clone.value === undefined
      ? {}
      : { value: requiredSanitizedText(clone.value, 120) }),
    scopeHint:
      clone.scopeHint === null ? null : (optional(clone.scopeHint) ?? null),
    tagName: optional(clone.tagName, 40) ?? "unknown",
    rationale: Object.freeze(
      clone.rationale.map((entry) => sanitizedText(entry, 200) ?? ""),
    ),
    ...(clone.countError === undefined
      ? {}
      : { countError: requiredSanitizedText(clone.countError, 200) }),
  });
}

export function importLocatorDiagnosisObservation(
  artifact: unknown,
  options: LocatorObservationImportOptions,
): LocatorObservationImportResult {
  if (!isReport(artifact))
    throw new Error("Locator-diagnosis artifact is malformed.");
  if (
    artifact.deterministicAnalysis.classification === "not-a-locator-failure" ||
    artifact.deterministicAnalysis.recommendationStatus === "not-applicable"
  )
    return Object.freeze({
      status: "ignored",
      reason: "The artifact is not an applicable locator failure.",
    });
  const source = artifact.evidence;
  const failure: LocatorEvidenceInput = Object.freeze({
    errorMessage: requiredSanitizedText(source.errorMessage, 1_000),
    ...(source.pageReady === null ? {} : { pageReady: source.pageReady }),
    ...(source.pageReadinessReason === undefined
      ? {}
      : {
          pageReadinessReason: requiredSanitizedText(
            source.pageReadinessReason,
            300,
          ),
        }),
    pageAvailable: source.pageAvailable,
    ...(source.projectName === undefined
      ? {}
      : { projectName: requiredSanitizedText(source.projectName, 100) }),
    retry: source.retry,
    ...(source.testId === undefined
      ? {}
      : { testId: requiredSanitizedText(source.testId, 100) }),
    ...(source.feature === undefined
      ? {}
      : { feature: requiredSanitizedText(source.feature, 100) }),
    requirementIds: Object.freeze(
      source.requirementIds
        .map((entry) => sanitizedText(entry, 100) ?? "")
        .sort(),
    ),
  });
  const targetIntent: LocatorTargetIntent = Object.freeze({
    operation: source.attemptedOperation,
    strategy: source.originalLocatorStrategy,
    ...(source.originalLocatorDescription === undefined
      ? {}
      : {
          locatorDescription: requiredSanitizedText(
            source.originalLocatorDescription,
            300,
          ),
        }),
    ...(source.expectedTarget === undefined
      ? {}
      : { value: requiredSanitizedText(source.expectedTarget, 120) }),
  });
  const candidates = Object.freeze(
    artifact.candidateInventory.map(safeCandidate),
  );
  const draft = {
    schemaVersion: LOCATOR_OBSERVATION_SCHEMA_VERSION,
    applicationAlias: options.applicationAlias,
    sourceType: options.sourceType ?? "real-shadow",
    failure,
    pageReadinessState: source.pageReady,
    targetIntent,
    candidateCollectionStatus: artifact.provenance.candidateCollectionStatus,
    candidateInventory: candidates,
    droppedCandidateCount: artifact.provenance.candidatesDropped,
    deterministicDiagnosis: sanitizePlainData(
      artifact.deterministicAnalysis,
    ) as LocatorDiagnosisReport["deterministicAnalysis"],
    provenance: Object.freeze({
      mode: artifact.provenance.mode,
      deterministicAnalysisUsed: true as const,
      candidateCollectionStatus: artifact.provenance.candidateCollectionStatus,
      candidatesCollected: artifact.provenance.candidatesCollected,
      candidatesDropped: artifact.provenance.candidatesDropped,
      fallbackUsed: artifact.provenance.fallbackUsed,
      conflictDetected: artifact.provenance.conflictDetected,
      lifecycleOutcome:
        sanitizedText(artifact.provenance.lifecycleOutcome, 120) ?? "unknown",
    }),
    missingEvidence: Object.freeze(
      artifact.deterministicAnalysis.missingEvidence
        .map((entry) => sanitizedText(entry, 200) ?? "")
        .sort(),
    ),
    collectionLimitations: Object.freeze(
      artifact.deterministicAnalysis.limitations
        .map((entry) => sanitizedText(entry, 200) ?? "")
        .sort(),
    ),
  };
  const observation = {
    ...draft,
    observationId: createLocatorObservationId(draft),
  } as LocatorObservation;
  return Object.freeze({
    status: "imported",
    observation: validateLocatorObservation(observation),
  });
}

export function deduplicateLocatorObservations(
  observations: readonly LocatorObservation[],
): readonly LocatorObservation[] {
  const byId = new Map<string, LocatorObservation>();
  for (const observation of observations) {
    const validated = validateLocatorObservation(observation);
    const existing = byId.get(validated.observationId);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(validated)
    )
      throw new Error(
        `Locator observation ID collision detected for ${validated.observationId}.`,
      );
    byId.set(validated.observationId, validated);
  }
  return Object.freeze(
    [...byId.values()].sort((a, b) =>
      a.observationId.localeCompare(b.observationId),
    ),
  );
}
