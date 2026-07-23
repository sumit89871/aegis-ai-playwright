import type { FailureEvidence } from "./failure-evidence.ts";

export const FAILURE_ANALYSIS_CATEGORIES = [
  "assertion-failure",
  "locator-failure",
  "page-readiness-failure",
  "application-defect",
  "network-failure",
  "browser-error",
  "accessibility-failure",
  "test-data-failure",
  "environment-failure",
  "framework-failure",
  "unknown",
] as const;
export type FailureAnalysisCategory =
  (typeof FAILURE_ANALYSIS_CATEGORIES)[number];

export const FAILURE_ANALYSIS_CONFIDENCES = ["high", "medium", "low"] as const;
export type FailureAnalysisConfidence =
  (typeof FAILURE_ANALYSIS_CONFIDENCES)[number];

export const FAILURE_RECOMMENDATION_OWNERS = [
  "tester",
  "developer",
  "environment",
  "framework-maintainer",
  "accessibility-owner",
  "unknown",
] as const;
export type FailureRecommendationOwner =
  (typeof FAILURE_RECOMMENDATION_OWNERS)[number];

export type LocatorAssessmentStatus =
  "no-change-recommended" | "review-recommended";

export interface FailureProbableCause {
  readonly cause: string;
  readonly confidence: FailureAnalysisConfidence;
  readonly evidenceIds: readonly string[];
}

export interface FailureRecommendedAction {
  readonly priority: "high" | "medium" | "low";
  readonly action: string;
  readonly owner: FailureRecommendationOwner;
}

export interface FailureAnalysisConclusion {
  readonly summary: string;
  readonly primaryCategory: FailureAnalysisCategory;
  readonly confidence: FailureAnalysisConfidence;
  readonly probableCauses: readonly FailureProbableCause[];
  readonly recommendedActions: readonly FailureRecommendedAction[];
  readonly locatorAssessment: {
    readonly status: LocatorAssessmentStatus;
    readonly reason: string;
  };
  readonly missingEvidence: readonly string[];
  readonly limitations: readonly string[];
}

export const FAILURE_ANALYSIS_MODES = [
  "disabled",
  "deterministic-only",
  "ai-advisory",
  "mock-ai",
] as const;
export type FailureAnalysisMode = (typeof FAILURE_ANALYSIS_MODES)[number];

export interface FailureAnalysisConfiguration {
  readonly enabled: boolean;
  readonly mode: FailureAnalysisMode;
  readonly attachJson: boolean;
  readonly attachMarkdown: boolean;
  readonly maximumEvidenceEntries: number;
  readonly maximumAnalysisDurationMs: number;
  readonly includeAccessibilitySummary: boolean;
  readonly includeReadinessResult: boolean;
  readonly includeNetworkEvidence: boolean;
  readonly includeConsoleEvidence: boolean;
  readonly aiCapability: string;
  readonly deterministicFallbackEnabled: boolean;
}

export interface FailureAnalysisProvenance {
  readonly mode: FailureAnalysisMode;
  readonly aiAttempted: boolean;
  readonly providerId?: string;
  readonly model?: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly aiResponseValidated: boolean;
  readonly fallbackUsed: boolean;
  readonly evidenceCategories: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly lifecycleOutcome: string;
  readonly approximateCostUsd?: number;
}

export interface FailureAnalysisReport {
  readonly status: "completed";
  readonly conclusion: FailureAnalysisConclusion;
  readonly deterministicAnalysis: FailureAnalysisConclusion;
  readonly aiAdvisoryAnalysis?: FailureAnalysisConclusion;
  readonly disagreements: readonly string[];
  readonly evidence: FailureEvidence;
  readonly provenance: FailureAnalysisProvenance;
}

export function defaultFailureAnalysisConfiguration(
  overrides: Partial<FailureAnalysisConfiguration> = {},
): FailureAnalysisConfiguration {
  return validateFailureAnalysisConfiguration({
    enabled: true,
    mode: "deterministic-only",
    attachJson: true,
    attachMarkdown: true,
    maximumEvidenceEntries: 25,
    maximumAnalysisDurationMs: 5_000,
    includeAccessibilitySummary: true,
    includeReadinessResult: true,
    includeNetworkEvidence: true,
    includeConsoleEvidence: true,
    aiCapability: "ui-failure-analysis",
    deterministicFallbackEnabled: true,
    ...overrides,
  });
}

export function validateFailureAnalysisConfiguration(
  value: unknown,
): FailureAnalysisConfiguration {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("Failure-analysis configuration must be a plain object.");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    "enabled",
    "mode",
    "attachJson",
    "attachMarkdown",
    "maximumEvidenceEntries",
    "maximumAnalysisDurationMs",
    "includeAccessibilitySummary",
    "includeReadinessResult",
    "includeNetworkEvidence",
    "includeConsoleEvidence",
    "aiCapability",
    "deterministicFallbackEnabled",
  ]);
  const unknown = Object.keys(candidate).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw new Error(
      `Failure-analysis configuration field ${unknown} is unsupported.`,
    );
  }
  const booleanFields = [
    "enabled",
    "attachJson",
    "attachMarkdown",
    "includeAccessibilitySummary",
    "includeReadinessResult",
    "includeNetworkEvidence",
    "includeConsoleEvidence",
    "deterministicFallbackEnabled",
  ] as const;
  for (const field of booleanFields) {
    if (typeof candidate[field] !== "boolean") {
      throw new Error(`${field} must be a boolean.`);
    }
  }
  if (
    typeof candidate.mode !== "string" ||
    !FAILURE_ANALYSIS_MODES.includes(candidate.mode as FailureAnalysisMode)
  ) {
    throw new Error("mode is not a supported failure-analysis mode.");
  }
  if (
    typeof candidate.maximumEvidenceEntries !== "number" ||
    !Number.isInteger(candidate.maximumEvidenceEntries) ||
    candidate.maximumEvidenceEntries < 1 ||
    candidate.maximumEvidenceEntries > 100
  ) {
    throw new Error("maximumEvidenceEntries must be between 1 and 100.");
  }
  if (
    typeof candidate.maximumAnalysisDurationMs !== "number" ||
    !Number.isInteger(candidate.maximumAnalysisDurationMs) ||
    candidate.maximumAnalysisDurationMs < 100 ||
    candidate.maximumAnalysisDurationMs > 60_000
  ) {
    throw new Error("maximumAnalysisDurationMs must be between 100 and 60000.");
  }
  if (
    typeof candidate.aiCapability !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate.aiCapability)
  ) {
    throw new Error("aiCapability must use lowercase kebab-case.");
  }
  if (candidate.enabled === false && candidate.mode !== "disabled") {
    throw new Error("Disabled failure analysis must use mode disabled.");
  }
  if (candidate.deterministicFallbackEnabled !== true) {
    throw new Error(
      "deterministicFallbackEnabled must remain true in advisory mode.",
    );
  }
  return Object.freeze({
    enabled: candidate.enabled as boolean,
    mode: candidate.mode as FailureAnalysisMode,
    attachJson: candidate.attachJson as boolean,
    attachMarkdown: candidate.attachMarkdown as boolean,
    maximumEvidenceEntries: candidate.maximumEvidenceEntries,
    maximumAnalysisDurationMs: candidate.maximumAnalysisDurationMs,
    includeAccessibilitySummary:
      candidate.includeAccessibilitySummary as boolean,
    includeReadinessResult: candidate.includeReadinessResult as boolean,
    includeNetworkEvidence: candidate.includeNetworkEvidence as boolean,
    includeConsoleEvidence: candidate.includeConsoleEvidence as boolean,
    aiCapability: candidate.aiCapability,
    deterministicFallbackEnabled: candidate.deterministicFallbackEnabled,
  });
}
