import type {
  LocatorDiagnosisConfidence,
  LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorFailureClassification } from "../locator-diagnosis/locator-failure-classifier.ts";
import type { LocatorObservation } from "./locator-observation.ts";

export const LOCATOR_OBSERVATION_REVIEW_STATUSES = [
  "pending",
  "reviewed",
  "rejected",
  "needs-more-evidence",
] as const;
export type LocatorObservationReviewStatus =
  (typeof LOCATOR_OBSERVATION_REVIEW_STATUSES)[number];

export interface LocatorObservationReview {
  readonly observationId: string;
  readonly reviewStatus: LocatorObservationReviewStatus;
  readonly candidateIds: readonly string[];
  readonly expectedClassification: LocatorFailureClassification | null;
  readonly expectedRecommendationStatus: LocatorRecommendationStatus | null;
  readonly acceptableCandidateIds: readonly string[];
  readonly preferredCandidateIds: readonly string[];
  readonly forbiddenCandidateIds: readonly string[];
  readonly minimumAcceptableConfidence: LocatorDiagnosisConfidence | null;
  readonly reviewerRationale: string;
  readonly reviewVersion: string;
  readonly reviewNotes?: string;
}

export function createLocatorObservationReviewTemplate(
  observation: LocatorObservation,
): LocatorObservationReview {
  return Object.freeze({
    observationId: observation.observationId,
    reviewStatus: "pending",
    candidateIds: Object.freeze(
      observation.candidateInventory
        .map(({ candidateId }) => candidateId)
        .sort(),
    ),
    expectedClassification: null,
    expectedRecommendationStatus: null,
    acceptableCandidateIds: Object.freeze([]),
    preferredCandidateIds: Object.freeze([]),
    forbiddenCandidateIds: Object.freeze([]),
    minimumAcceptableConfidence: null,
    reviewerRationale: "",
    reviewVersion: "1.0.0",
  });
}
