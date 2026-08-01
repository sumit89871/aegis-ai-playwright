import type { CandidateScoreInput } from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorEvaluationAnalysisInput,
  LocatorEvaluationCase,
  LocatorEvaluationDataset,
} from "../locator-evaluation/evaluation-case.ts";
import type { LocatorEvaluationMetrics } from "../locator-evaluation/evaluation-metrics.ts";
import { calculateLocatorEvaluationMetrics } from "../locator-evaluation/evaluation-metrics.ts";
import {
  runLocatorEvaluationDataset,
  type LocatorEvaluationCaseResult,
  type LocatorEvaluationMode,
} from "../locator-evaluation/evaluation-runner.ts";
import type { LocatorObservation } from "./locator-observation.ts";
import type { LocatorObservationReview } from "./locator-observation-review.ts";
import { validateLocatorObservationReview } from "./locator-observation-review.ts";
import { validateLocatorObservation } from "./locator-observation-validator.ts";

export const MINIMUM_MEANINGFUL_HOLDOUT_SAMPLE_SIZE = 30;
export const DEFAULT_LOCATOR_HOLDOUT_MODE: LocatorEvaluationMode =
  "deterministic-only";

export interface LocatorHoldoutCaseResult extends LocatorEvaluationCaseResult {
  readonly observationId: string;
  readonly sourceType: LocatorObservation["sourceType"];
}

export interface LocatorHoldoutResult {
  readonly schemaVersion: "1.0.0";
  readonly mode: LocatorEvaluationMode;
  readonly status:
    "no-reviewed-observations" | "insufficient-sample" | "evaluated";
  readonly meaningful: boolean;
  readonly reviewedObservationCount: number;
  readonly excluded: {
    readonly pending: number;
    readonly rejected: number;
    readonly needsMoreEvidence: number;
    readonly missingReview: number;
  };
  readonly sourceCounts: Readonly<
    Record<LocatorObservation["sourceType"], number>
  >;
  readonly metrics: LocatorEvaluationMetrics;
  readonly cases: readonly LocatorHoldoutCaseResult[];
  readonly notice: string;
}

function candidateDescriptor(
  candidate: LocatorObservation["candidateInventory"][number],
): CandidateScoreInput {
  return Object.freeze({
    strategy: candidate.strategy,
    ...(candidate.role === undefined ? {} : { role: candidate.role }),
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
    exact: candidate.exact,
    scopeHint: candidate.scopeHint,
    tagName: candidate.tagName,
    matchCount: candidate.matchCount,
    visible: candidate.visible,
    enabled: candidate.enabled,
    editable: candidate.editable,
    hasBoundingBox: candidate.hasBoundingBox,
    ...(candidate.countError === undefined
      ? {}
      : { countError: candidate.countError }),
  });
}

export function buildLocatorHoldoutAnalysisInput(
  observationInput: LocatorObservation,
): LocatorEvaluationAnalysisInput {
  const observation = validateLocatorObservation(observationInput);
  return Object.freeze({
    evidence: Object.freeze(structuredClone(observation.failure)),
    candidateInventory: Object.freeze({
      status: observation.candidateCollectionStatus,
      candidates: Object.freeze(
        structuredClone(observation.candidateInventory),
      ),
      droppedCandidateCount: observation.droppedCandidateCount,
      scannedElementCount:
        observation.candidateInventory.length +
        observation.droppedCandidateCount,
      intent: Object.freeze(structuredClone(observation.targetIntent)),
    }),
  });
}

function category(
  observation: LocatorObservation,
): LocatorEvaluationCase["category"] {
  const status = observation.deterministicDiagnosis.recommendationStatus;
  if (status === "candidates-available") return "locator-change";
  if (status === "no-change-recommended") return "no-change";
  if (["insufficient-evidence", "collection-unavailable"].includes(status))
    return "insufficient-evidence";
  return "non-locator";
}

function evaluationCase(
  observation: LocatorObservation,
  review: LocatorObservationReview,
  index: number,
): LocatorEvaluationCase {
  if (
    review.expectedClassification === null ||
    review.expectedRecommendationStatus === null ||
    review.minimumAcceptableConfidence === null
  )
    throw new Error("Only reviewed observations can enter holdout evaluation.");
  const changeAllowed =
    review.expectedRecommendationStatus === "candidates-available";
  const reviewNotes = review.reviewNotes?.trim();
  return Object.freeze({
    caseId: `LOC-EVAL-VAL-${String(index + 1).padStart(3, "0")}`,
    title: `Reviewed shadow observation ${String(index + 1).padStart(3, "0")}`,
    description:
      "Blind evaluation of a sanitized locator-diagnosis observation.",
    category: category(observation),
    sourceType:
      observation.sourceType === "controlled-browser"
        ? "controlled-browser"
        : observation.sourceType === "synthetic-test-fixture"
          ? "synthetic"
          : "sanitized-real-example",
    input: Object.freeze({
      failure: Object.freeze(structuredClone(observation.failure)),
      pageReadinessState: observation.pageReadinessState,
      attemptedOperation: observation.targetIntent.operation,
      ...(observation.targetIntent.locatorDescription === undefined
        ? {}
        : {
            originalLocatorDescription:
              observation.targetIntent.locatorDescription,
          }),
      targetIntent: Object.freeze(structuredClone(observation.targetIntent)),
      candidateCollectionStatus: observation.candidateCollectionStatus,
      candidates: Object.freeze(
        observation.candidateInventory.map((candidate) =>
          Object.freeze({
            candidateId: candidate.candidateId,
            descriptor: candidateDescriptor(candidate),
          }),
        ),
      ),
    }),
    expected: Object.freeze({
      classification: review.expectedClassification,
      recommendationStatus: review.expectedRecommendationStatus,
      acceptableCandidateIds: review.acceptableCandidateIds,
      preferredCandidateIds: review.preferredCandidateIds,
      forbiddenCandidateIds: review.forbiddenCandidateIds,
      locatorChangeAllowed: changeAllowed,
      minimumConfidence: review.minimumAcceptableConfidence,
    }),
    humanReview: Object.freeze({
      classificationReason: review.reviewerRationale,
      locatorChangeReason: review.reviewerRationale,
      candidateReason: review.reviewerRationale,
      uncertainty:
        reviewNotes === undefined || reviewNotes.length === 0
          ? "No additional uncertainty was recorded."
          : reviewNotes,
    }),
    tags: Object.freeze(["shadow-observation"]),
    datasetVersion: "1.0.0",
  });
}

export async function runLocatorHoldoutEvaluation(
  observationsInput: readonly LocatorObservation[],
  reviewsInput: readonly LocatorObservationReview[],
  options: { readonly mode?: "deterministic-only" | "mock-ai" } = {},
): Promise<LocatorHoldoutResult> {
  const observations = observationsInput
    .map(validateLocatorObservation)
    .sort((a, b) => a.observationId.localeCompare(b.observationId));
  if (
    new Set(observations.map(({ observationId }) => observationId)).size !==
    observations.length
  )
    throw new Error("Holdout observations must have unique IDs.");
  const observationsById = new Map(
    observations.map((entry) => [entry.observationId, entry]),
  );
  const reviews = reviewsInput
    .map((review) => {
      const observation = observationsById.get(review.observationId);
      if (observation === undefined)
        throw new Error(
          `Review ${review.observationId} has no matching observation.`,
        );
      return validateLocatorObservationReview(review, observation);
    })
    .sort((a, b) => a.observationId.localeCompare(b.observationId));
  if (
    new Set(reviews.map(({ observationId }) => observationId)).size !==
    reviews.length
  )
    throw new Error("Holdout reviews must have unique observation IDs.");
  const reviewed = reviews.filter(
    ({ reviewStatus }) => reviewStatus === "reviewed",
  );
  const cases = reviewed.map((review, index) => {
    const observation = observationsById.get(review.observationId);
    if (observation === undefined)
      throw new Error(`Observation ${review.observationId} is unavailable.`);
    return evaluationCase(observation, review, index);
  });
  const dataset: LocatorEvaluationDataset | null =
    cases.length === 0
      ? null
      : Object.freeze({
          id: "validation",
          version: "1.0.0",
          description:
            "Independent reviewed shadow observations kept separate from analyser input.",
          cases: Object.freeze(cases),
        });
  const mode = options.mode ?? DEFAULT_LOCATOR_HOLDOUT_MODE;
  const run =
    dataset === null
      ? null
      : await runLocatorEvaluationDataset(dataset, { mode });
  const mappedCases: readonly LocatorHoldoutCaseResult[] = Object.freeze(
    (run?.cases ?? []).map((entry, index) => {
      const review = reviewed[index];
      if (review === undefined)
        throw new Error("Holdout case mapping is inconsistent.");
      const observation = observationsById.get(review.observationId);
      if (observation === undefined)
        throw new Error(`Observation ${review.observationId} is unavailable.`);
      return Object.freeze({
        observationId: observation.observationId,
        sourceType: observation.sourceType,
        ...entry,
      });
    }),
  );
  const metricCases: readonly LocatorEvaluationCaseResult[] = mappedCases.map(
    (entry) => ({ ...entry, caseId: entry.observationId }),
  );
  const metrics = calculateLocatorEvaluationMetrics(metricCases);
  const count = reviewed.length;
  const meaningful =
    count >= MINIMUM_MEANINGFUL_HOLDOUT_SAMPLE_SIZE &&
    reviewed.some(
      (entry) =>
        observationsById.get(entry.observationId)?.sourceType === "real-shadow",
    );
  const sourceTypes: readonly LocatorObservation["sourceType"][] = [
    "real-shadow",
    "controlled-browser",
    "imported-sanitized",
    "synthetic-test-fixture",
  ];
  const sourceCounts = Object.freeze(
    Object.fromEntries(
      sourceTypes.map((sourceType) => [
        sourceType,
        observations.filter(
          (entry) =>
            entry.sourceType === sourceType &&
            reviewed.some(
              (review) => review.observationId === entry.observationId,
            ),
        ).length,
      ]),
    ),
  ) as Readonly<Record<LocatorObservation["sourceType"], number>>;
  const status =
    count === 0
      ? "no-reviewed-observations"
      : meaningful
        ? "evaluated"
        : "insufficient-sample";
  const notice =
    count === 0
      ? "Zero reviewed observations: holdout evaluation is not yet meaningful. Synthetic test fixtures are not production evidence."
      : meaningful
        ? "Metrics describe independent reviewed observations; they do not guarantee production accuracy."
        : `Only ${String(count)} reviewed observations are available; at least ${String(MINIMUM_MEANINGFUL_HOLDOUT_SAMPLE_SIZE)} independent real-shadow observations are recommended before interpreting accuracy.`;
  return Object.freeze({
    schemaVersion: "1.0.0",
    mode,
    status,
    meaningful,
    reviewedObservationCount: count,
    excluded: Object.freeze({
      pending: reviews.filter(({ reviewStatus }) => reviewStatus === "pending")
        .length,
      rejected: reviews.filter(
        ({ reviewStatus }) => reviewStatus === "rejected",
      ).length,
      needsMoreEvidence: reviews.filter(
        ({ reviewStatus }) => reviewStatus === "needs-more-evidence",
      ).length,
      missingReview: observations.length - reviews.length,
    }),
    sourceCounts,
    metrics,
    cases: mappedCases,
    notice,
  });
}
