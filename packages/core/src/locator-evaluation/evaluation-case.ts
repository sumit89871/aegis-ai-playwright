import type {
  CandidateScoreInput,
  LocatorCandidate,
} from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorDiagnosisConfidence,
  LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorEvidenceInput } from "../locator-diagnosis/locator-evidence.ts";
import type {
  LocatorFailureClassification,
  LocatorOperation,
  LocatorTargetIntent,
} from "../locator-diagnosis/locator-failure-classifier.ts";

export const LOCATOR_EVALUATION_SOURCE_TYPES = [
  "synthetic",
  "controlled-browser",
  "sanitized-real-example",
] as const;
export type LocatorEvaluationSourceType =
  (typeof LOCATOR_EVALUATION_SOURCE_TYPES)[number];

export const LOCATOR_EVALUATION_CATEGORIES = [
  "locator-change",
  "no-change",
  "insufficient-evidence",
  "non-locator",
] as const;
export type LocatorEvaluationCategory =
  (typeof LOCATOR_EVALUATION_CATEGORIES)[number];

export interface ReviewedLocatorCandidate {
  readonly candidateId: string;
  readonly descriptor: CandidateScoreInput;
}

export interface LocatorEvaluationRuntimeInput {
  readonly failure: LocatorEvidenceInput;
  readonly pageReadinessState: boolean | null;
  readonly attemptedOperation: LocatorOperation;
  readonly originalLocatorDescription?: string;
  readonly targetIntent: LocatorTargetIntent;
  readonly candidateCollectionStatus:
    "collected" | "unavailable" | "not-requested";
  readonly candidateCollectionError?: string;
  readonly candidates: readonly ReviewedLocatorCandidate[];
}

export interface LocatorEvaluationExpectedAnswer {
  readonly classification: LocatorFailureClassification;
  readonly recommendationStatus: LocatorRecommendationStatus;
  readonly acceptableCandidateIds: readonly string[];
  readonly preferredCandidateIds: readonly string[];
  readonly forbiddenCandidateIds: readonly string[];
  readonly locatorChangeAllowed: boolean;
  readonly minimumConfidence: LocatorDiagnosisConfidence;
}

export interface LocatorEvaluationHumanReview {
  readonly classificationReason: string;
  readonly locatorChangeReason: string;
  readonly candidateReason: string;
  readonly uncertainty: string;
}

export interface LocatorEvaluationCase {
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly category: LocatorEvaluationCategory;
  readonly sourceType: LocatorEvaluationSourceType;
  readonly input: LocatorEvaluationRuntimeInput;
  readonly expected: LocatorEvaluationExpectedAnswer;
  readonly humanReview: LocatorEvaluationHumanReview;
  readonly tags: readonly string[];
  readonly datasetVersion: string;
}

export interface LocatorEvaluationDataset {
  readonly id: "calibration" | "validation";
  readonly version: string;
  readonly description: string;
  readonly cases: readonly LocatorEvaluationCase[];
}

export interface LocatorEvaluationAnalysisInput {
  readonly evidence: LocatorEvidenceInput;
  readonly candidateInventory: {
    readonly status: "collected" | "unavailable" | "not-requested";
    readonly candidates: readonly LocatorCandidate[];
    readonly droppedCandidateCount: number;
    readonly scannedElementCount: number;
    readonly intent: LocatorTargetIntent;
    readonly error?: string;
  };
}
