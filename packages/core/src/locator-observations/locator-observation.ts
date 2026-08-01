import { createHash } from "node:crypto";

import type { LocatorCandidate } from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorDiagnosisConclusion,
  LocatorDiagnosisProvenance,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorEvidenceInput } from "../locator-diagnosis/locator-evidence.ts";
import type { LocatorTargetIntent } from "../locator-diagnosis/locator-failure-classifier.ts";

export const LOCATOR_OBSERVATION_SCHEMA_VERSION = "1.0.0" as const;
export const LOCATOR_OBSERVATION_SOURCE_TYPES = [
  "real-shadow",
  "controlled-browser",
  "imported-sanitized",
  "synthetic-test-fixture",
] as const;
export type LocatorObservationSourceType =
  (typeof LOCATOR_OBSERVATION_SOURCE_TYPES)[number];

export interface LocatorObservation {
  readonly observationId: string;
  readonly schemaVersion: typeof LOCATOR_OBSERVATION_SCHEMA_VERSION;
  readonly applicationAlias: string;
  readonly sourceType: LocatorObservationSourceType;
  readonly failure: LocatorEvidenceInput;
  readonly pageReadinessState: boolean | null;
  readonly targetIntent: LocatorTargetIntent;
  readonly candidateCollectionStatus:
    "collected" | "unavailable" | "not-requested";
  readonly candidateInventory: readonly LocatorCandidate[];
  readonly droppedCandidateCount: number;
  readonly deterministicDiagnosis: LocatorDiagnosisConclusion;
  readonly provenance: Pick<
    LocatorDiagnosisProvenance,
    | "mode"
    | "deterministicAnalysisUsed"
    | "candidateCollectionStatus"
    | "candidatesCollected"
    | "candidatesDropped"
    | "fallbackUsed"
    | "conflictDetected"
    | "lifecycleOutcome"
  >;
  readonly missingEvidence: readonly string[];
  readonly collectionLimitations: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "observationId")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalLocatorObservationContent(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createLocatorObservationId(value: unknown): string {
  const digest = createHash("sha256")
    .update(canonicalLocatorObservationContent(value), "utf8")
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `LOC-OBS-${digest}`;
}
