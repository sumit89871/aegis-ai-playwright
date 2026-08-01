import {
  LOCATOR_RECOMMENDATION_STATUSES,
  type LocatorDiagnosisConfidence,
  type LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import {
  LOCATOR_FAILURE_CLASSIFICATIONS,
  type LocatorFailureClassification,
} from "../locator-diagnosis/locator-failure-classifier.ts";
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

function fail(message: string): never {
  throw new Error(`Invalid locator observation review: ${message}`);
}
function uniqueIds(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) return fail(`${field} must be an array.`);
  const entries: readonly unknown[] = value;
  if (
    entries.some(
      (entry) => typeof entry !== "string" || !/^LOCATOR-\d{3}$/u.test(entry),
    )
  )
    return fail(`${field} contains an invalid candidate ID.`);
  const ids = entries.map((entry) => String(entry));
  if (new Set(ids).size !== ids.length)
    return fail(`${field} must contain unique IDs.`);
  return Object.freeze(ids.sort());
}

export function validateLocatorObservationReview(
  review: LocatorObservationReview,
  observation: LocatorObservation,
): LocatorObservationReview {
  const clone = structuredClone(review);
  const allowed = new Set([
    "observationId",
    "reviewStatus",
    "candidateIds",
    "expectedClassification",
    "expectedRecommendationStatus",
    "acceptableCandidateIds",
    "preferredCandidateIds",
    "forbiddenCandidateIds",
    "minimumAcceptableConfidence",
    "reviewerRationale",
    "reviewVersion",
    "reviewNotes",
  ]);
  const unknown = Object.keys(clone).find((key) => !allowed.has(key));
  if (unknown !== undefined) return fail(`field ${unknown} is unsupported.`);
  if (clone.observationId !== observation.observationId)
    return fail("observationId does not identify the supplied observation.");
  if (!LOCATOR_OBSERVATION_REVIEW_STATUSES.includes(clone.reviewStatus))
    return fail("reviewStatus is unsupported.");
  if (!/^\d+\.\d+\.\d+$/u.test(clone.reviewVersion))
    return fail("reviewVersion must be semantic version text.");
  const available = observation.candidateInventory
    .map(({ candidateId }) => candidateId)
    .sort();
  const templateIds = uniqueIds(clone.candidateIds, "candidateIds");
  if (JSON.stringify(templateIds) !== JSON.stringify(available))
    return fail("candidateIds must match the observation inventory.");
  const acceptable = uniqueIds(
    clone.acceptableCandidateIds,
    "acceptableCandidateIds",
  );
  const preferred = uniqueIds(
    clone.preferredCandidateIds,
    "preferredCandidateIds",
  );
  const forbidden = uniqueIds(
    clone.forbiddenCandidateIds,
    "forbiddenCandidateIds",
  );
  for (const id of [...acceptable, ...preferred, ...forbidden])
    if (!available.includes(id))
      return fail(`candidate ${id} does not exist in the observation.`);
  for (const id of preferred)
    if (!acceptable.includes(id))
      return fail("preferred candidates must also be acceptable.");
  if (acceptable.some((id) => forbidden.includes(id)))
    return fail("a candidate cannot be acceptable and forbidden.");
  if (
    clone.expectedClassification !== null &&
    !LOCATOR_FAILURE_CLASSIFICATIONS.includes(clone.expectedClassification)
  )
    return fail("expected classification is unsupported.");
  if (
    clone.expectedRecommendationStatus !== null &&
    !LOCATOR_RECOMMENDATION_STATUSES.includes(
      clone.expectedRecommendationStatus,
    )
  )
    return fail("expected recommendation status is unsupported.");
  if (
    clone.minimumAcceptableConfidence !== null &&
    !["high", "medium", "low"].includes(clone.minimumAcceptableConfidence)
  )
    return fail("minimum confidence is unsupported.");
  if (clone.reviewStatus === "reviewed") {
    if (
      clone.expectedClassification === null ||
      !LOCATOR_FAILURE_CLASSIFICATIONS.includes(clone.expectedClassification)
    )
      return fail("a reviewed case requires a valid expected classification.");
    if (
      clone.expectedRecommendationStatus === null ||
      !LOCATOR_RECOMMENDATION_STATUSES.includes(
        clone.expectedRecommendationStatus,
      )
    )
      return fail(
        "a reviewed case requires a valid expected recommendation status.",
      );
    if (
      clone.minimumAcceptableConfidence === null ||
      !["high", "medium", "low"].includes(clone.minimumAcceptableConfidence)
    )
      return fail("a reviewed case requires minimum confidence.");
    if (
      clone.expectedRecommendationStatus === "candidates-available" &&
      acceptable.length === 0
    )
      return fail(
        "a reviewed locator-change case requires an acceptable candidate.",
      );
    if (
      clone.reviewerRationale.trim().length < 10 ||
      clone.reviewerRationale.length > 1_000
    )
      return fail("a reviewed case requires a bounded human rationale.");
  }
  const text = `${clone.reviewerRationale} ${clone.reviewNotes ?? ""}`;
  if (
    /<\/?\w+\b|authorization\s*[:=]|bearer\s+|password\s*[:=]|(?:\b[A-Za-z]:\\|\/(?:home|Users)\/)/iu.test(
      text,
    )
  )
    return fail("review text contains unsafe content.");
  return Object.freeze({
    ...clone,
    candidateIds: templateIds,
    acceptableCandidateIds: acceptable,
    preferredCandidateIds: preferred,
    forbiddenCandidateIds: forbidden,
  });
}
