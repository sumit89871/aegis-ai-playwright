import type {
  LocatorCandidate,
  LocatorCandidateInventory,
} from "./locator-candidate.ts";
import type { LocatorFailureEvidence } from "./locator-evidence.ts";
import type { LocatorFailureClassification } from "./locator-failure-classifier.ts";

export const LOCATOR_RECOMMENDATION_STATUSES = [
  "candidates-available",
  "no-change-recommended",
  "insufficient-evidence",
  "collection-unavailable",
  "not-applicable",
] as const;
export type LocatorRecommendationStatus =
  (typeof LOCATOR_RECOMMENDATION_STATUSES)[number];
export type LocatorDiagnosisConfidence = "high" | "medium" | "low";
export const LOCATOR_DIAGNOSIS_MODES = [
  "disabled",
  "deterministic-only",
  "ai-advisory",
  "mock-ai",
] as const;
export type LocatorDiagnosisMode = (typeof LOCATOR_DIAGNOSIS_MODES)[number];

export interface RankedLocatorCandidate {
  readonly candidateId: string;
  readonly rank: number;
  readonly confidence: LocatorDiagnosisConfidence;
  readonly reason: string;
}

export interface LocatorDiagnosisConclusion {
  readonly classification: LocatorFailureClassification;
  readonly confidence: LocatorDiagnosisConfidence;
  readonly recommendationStatus: LocatorRecommendationStatus;
  readonly summary: string;
  readonly originalLocatorAssessment: {
    readonly strategy: string;
    readonly issue: string;
  };
  readonly pageStateAssessment: {
    readonly ready: boolean | null;
    readonly reason: string;
  };
  readonly rankedCandidates: readonly RankedLocatorCandidate[];
  readonly recommendedNextStep: string;
  readonly missingEvidence: readonly string[];
  readonly limitations: readonly string[];
}

export interface LocatorDiagnosisProvenance {
  readonly mode: LocatorDiagnosisMode;
  readonly deterministicAnalysisUsed: true;
  readonly aiAttempted: boolean;
  readonly providerId?: string;
  readonly model?: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly candidateCollectionStatus: LocatorCandidateInventory["status"];
  readonly candidatesCollected: number;
  readonly candidatesDropped: number;
  readonly aiOutputValidated: boolean;
  readonly fallbackUsed: boolean;
  readonly conflictDetected: boolean;
  readonly lifecycleOutcome: string;
  readonly approximateCostUsd?: number;
}

export interface LocatorDiagnosisReport {
  readonly status: "completed";
  readonly conclusion: LocatorDiagnosisConclusion;
  readonly deterministicAnalysis: LocatorDiagnosisConclusion;
  readonly aiAdvisoryAnalysis?: LocatorDiagnosisConclusion;
  readonly disagreements: readonly string[];
  readonly evidence: LocatorFailureEvidence;
  readonly candidateInventory: readonly LocatorCandidate[];
  readonly provenance: LocatorDiagnosisProvenance;
}

export interface LocatorDiagnosisConfiguration {
  readonly enabled: boolean;
  readonly deterministicEnabled: boolean;
  readonly mode: LocatorDiagnosisMode;
  readonly aiAdvisoryEnabled: boolean;
  readonly maximumDurationMs: number;
  readonly maximumCandidates: number;
  readonly maximumCandidateTextLength: number;
  readonly attachJson: boolean;
  readonly attachMarkdown: boolean;
  readonly includeHiddenCandidates: boolean;
  readonly includeDisabledCandidates: boolean;
  readonly aiCapability: string;
}

export function defaultLocatorDiagnosisConfiguration(
  overrides: Partial<LocatorDiagnosisConfiguration> = {},
): LocatorDiagnosisConfiguration {
  return validateLocatorDiagnosisConfiguration({
    enabled: true,
    deterministicEnabled: true,
    mode: "deterministic-only",
    aiAdvisoryEnabled: false,
    maximumDurationMs: 3_000,
    maximumCandidates: 50,
    maximumCandidateTextLength: 120,
    attachJson: true,
    attachMarkdown: true,
    includeHiddenCandidates: false,
    includeDisabledCandidates: true,
    aiCapability: "ui-locator-diagnosis",
    ...overrides,
  });
}

export function validateLocatorDiagnosisConfiguration(
  value: unknown,
): LocatorDiagnosisConfiguration {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Locator-diagnosis configuration must be a plain object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "enabled",
    "deterministicEnabled",
    "mode",
    "aiAdvisoryEnabled",
    "maximumDurationMs",
    "maximumCandidates",
    "maximumCandidateTextLength",
    "attachJson",
    "attachMarkdown",
    "includeHiddenCandidates",
    "includeDisabledCandidates",
    "aiCapability",
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown !== undefined)
    throw new Error(
      `Locator-diagnosis configuration field ${unknown} is unsupported.`,
    );
  for (const field of [
    "enabled",
    "deterministicEnabled",
    "aiAdvisoryEnabled",
    "attachJson",
    "attachMarkdown",
    "includeHiddenCandidates",
    "includeDisabledCandidates",
  ] as const)
    if (typeof input[field] !== "boolean")
      throw new Error(`${field} must be a boolean.`);
  if (
    typeof input.mode !== "string" ||
    !LOCATOR_DIAGNOSIS_MODES.includes(input.mode as LocatorDiagnosisMode)
  )
    throw new Error("mode is not a supported locator-diagnosis mode.");
  for (const [field, minimum, maximum] of [
    ["maximumDurationMs", 100, 10_000],
    ["maximumCandidates", 1, 100],
    ["maximumCandidateTextLength", 20, 300],
  ] as const) {
    if (
      typeof input[field] !== "number" ||
      !Number.isInteger(input[field]) ||
      input[field] < minimum ||
      input[field] > maximum
    )
      throw new Error(
        `${field} must be between ${String(minimum)} and ${String(maximum)}.`,
      );
  }
  if (
    typeof input.aiCapability !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.aiCapability)
  )
    throw new Error("aiCapability must use lowercase kebab-case.");
  if (input.deterministicEnabled !== true)
    throw new Error("deterministicEnabled must remain true in advisory mode.");
  if (input.enabled === false && input.mode !== "disabled")
    throw new Error("Disabled locator diagnosis must use mode disabled.");
  if (
    input.aiAdvisoryEnabled === false &&
    ["ai-advisory", "mock-ai"].includes(input.mode)
  )
    throw new Error("AI modes require aiAdvisoryEnabled.");
  return Object.freeze(input as unknown as LocatorDiagnosisConfiguration);
}

export function emptyCandidateInventory(
  intent: LocatorCandidateInventory["intent"],
  status: "not-requested" | "unavailable" = "not-requested",
  error?: string,
): LocatorCandidateInventory {
  return Object.freeze({
    status,
    candidates: Object.freeze([]),
    droppedCandidateCount: 0,
    scannedElementCount: 0,
    intent,
    ...(error === undefined ? {} : { error }),
  });
}
