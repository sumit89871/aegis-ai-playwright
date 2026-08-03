import {
  LOCATOR_RECOMMENDATION_STATUSES,
  type LocatorDiagnosisConfidence,
  type LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import {
  LOCATOR_FAILURE_CLASSIFICATIONS,
  type LocatorFailureClassification,
} from "../locator-diagnosis/locator-failure-classifier.ts";
import { MAX_LOCATOR_CANDIDATES } from "../locator-diagnosis/locator-candidate.ts";
import type { LocatorObservation } from "./locator-observation.ts";
import {
  LOCATOR_OBSERVATION_REVIEW_STATUSES,
  type LocatorObservationReview,
  type LocatorObservationReviewStatus,
} from "./locator-observation-review.ts";

export const LOCATOR_OBSERVATION_REVIEW_VERSION = "1.0.0" as const;
export const LOCATOR_REVIEW_CONFIDENCES = ["high", "medium", "low"] as const;

export const LOCATOR_REVIEW_VALIDATION_CODES = [
  "REVIEW_JSON_INVALID",
  "REVIEW_FILE_READ_FAILED",
  "REVIEW_OBSERVATION_NOT_FOUND",
  "REVIEW_OBSERVATION_INVALID",
  "REVIEW_FILENAME_ID_MISMATCH",
  "REVIEW_REQUIRED_FIELD_MISSING",
  "REVIEW_UNKNOWN_FIELD",
  "REVIEW_FIELD_TYPE_INVALID",
  "REVIEW_OBSERVATION_ID_INVALID",
  "REVIEW_OBSERVATION_ID_MISMATCH",
  "REVIEW_STATUS_UNSUPPORTED",
  "REVIEW_VERSION_UNSUPPORTED",
  "REVIEW_CANDIDATE_ID_INVALID",
  "REVIEW_CANDIDATE_ARRAY_TOO_LARGE",
  "REVIEW_CANDIDATE_DUPLICATE",
  "REVIEW_CANDIDATE_UNKNOWN",
  "REVIEW_CANDIDATE_SET_MISMATCH",
  "REVIEWED_CLASSIFICATION_REQUIRED",
  "REVIEW_CLASSIFICATION_UNSUPPORTED",
  "REVIEWED_RECOMMENDATION_STATUS_REQUIRED",
  "REVIEW_RECOMMENDATION_STATUS_UNSUPPORTED",
  "REVIEWED_CONFIDENCE_REQUIRED",
  "REVIEW_CONFIDENCE_UNSUPPORTED",
  "REVIEW_PREFERRED_NOT_ACCEPTABLE",
  "REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP",
  "REVIEW_PREFERRED_FORBIDDEN_OVERLAP",
  "REVIEWED_ACCEPTABLE_CANDIDATE_REQUIRED",
  "REVIEW_RATIONALE_EMPTY",
  "REVIEW_RATIONALE_TOO_SHORT",
  "REVIEW_RATIONALE_TOO_LONG",
  "REVIEW_TEXT_UNSAFE",
] as const;

export type LocatorReviewValidationCode =
  (typeof LOCATOR_REVIEW_VALIDATION_CODES)[number];
export type LocatorReviewValidationIssueCategory =
  "json-syntax" | "schema" | "field" | "relationship" | "observation-link";
export type LocatorReviewSafeActualValue =
  null | boolean | number | string | readonly string[];

export interface LocatorReviewValidationIssue {
  readonly code: LocatorReviewValidationCode;
  readonly category: LocatorReviewValidationIssueCategory;
  readonly fieldPath: string;
  readonly message: string;
  readonly suggestion: string;
  readonly line?: number;
  readonly column?: number;
  readonly actualValue?: LocatorReviewSafeActualValue;
  readonly allowedValues?: readonly string[];
}

export interface LocatorReviewValidationResult {
  readonly valid: boolean;
  readonly observationId?: string;
  readonly review?: LocatorObservationReview;
  readonly issues: readonly LocatorReviewValidationIssue[];
}

const OBSERVATION_ID = /^LOC-OBS-[A-F0-9]{16}$/u;
const CANDIDATE_ID = /^LOCATOR-\d{3}$/u;
const SAFE_ENUM_TEXT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_VERSION_TEXT = /^\d+\.\d+\.\d+$/u;
const UNSAFE_REVIEW_TEXT =
  /<\/?\w+\b|authorization\s*[:=]|bearer\s+|api[_-]?key\s*[:=]|password\s*[:=]|cookie\s*[:=]|(?:\b[A-Za-z]:[\\/]|\/(?:home|Users)\/)/iu;
const REQUIRED_FIELDS = [
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
] as const;
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, "reviewNotes"]);

function issue(
  code: LocatorReviewValidationCode,
  category: LocatorReviewValidationIssueCategory,
  fieldPath: string,
  message: string,
  suggestion: string,
  options: {
    readonly actualValue?: LocatorReviewSafeActualValue;
    readonly allowedValues?: readonly string[];
    readonly line?: number;
    readonly column?: number;
  } = {},
): LocatorReviewValidationIssue {
  return Object.freeze({
    code,
    category,
    fieldPath,
    message,
    suggestion,
    ...(options.actualValue === undefined
      ? {}
      : { actualValue: options.actualValue }),
    ...(options.allowedValues === undefined
      ? {}
      : { allowedValues: Object.freeze([...options.allowedValues]) }),
    ...(options.line === undefined ? {} : { line: options.line }),
    ...(options.column === undefined ? {} : { column: options.column }),
  });
}

export function createLocatorReviewValidationIssue(
  code: LocatorReviewValidationCode,
  category: LocatorReviewValidationIssueCategory,
  fieldPath: string,
  message: string,
  suggestion: string,
  options: {
    readonly actualValue?: LocatorReviewSafeActualValue;
    readonly allowedValues?: readonly string[];
    readonly line?: number;
    readonly column?: number;
  } = {},
): LocatorReviewValidationIssue {
  return issue(code, category, fieldPath, message, suggestion, options);
}

export function orderLocatorReviewValidationIssues(
  issues: readonly LocatorReviewValidationIssue[],
): readonly LocatorReviewValidationIssue[] {
  return sortedIssues(issues);
}

function safeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function safeEnumActual(value: unknown): LocatorReviewSafeActualValue {
  if (
    typeof value === "string" &&
    value.length <= 80 &&
    SAFE_ENUM_TEXT.test(value)
  )
    return value;
  return `<${safeType(value)}>`;
}

function safeVersionActual(value: unknown): LocatorReviewSafeActualValue {
  if (
    typeof value === "string" &&
    value.length <= 30 &&
    SAFE_VERSION_TEXT.test(value)
  )
    return value;
  return `<${safeType(value)}>`;
}

function safeCandidateActual(value: unknown): LocatorReviewSafeActualValue {
  if (
    typeof value === "string" &&
    value.length <= 40 &&
    /^[A-Z0-9-]+$/u.test(value)
  )
    return value;
  return `<${safeType(value)}>`;
}

function sortedIssues(
  issues: readonly LocatorReviewValidationIssue[],
): readonly LocatorReviewValidationIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.code.localeCompare(right.code),
    ),
  );
}

interface CandidateArrayResult {
  readonly structurallyValid: boolean;
  readonly ids: readonly string[];
  readonly originalIds: readonly string[];
}

function inspectCandidateArray(
  value: unknown,
  field: string,
  issues: LocatorReviewValidationIssue[],
): CandidateArrayResult {
  const fieldPath = `$.${field}`;
  if (!Array.isArray(value)) {
    issues.push(
      issue(
        "REVIEW_FIELD_TYPE_INVALID",
        "field",
        fieldPath,
        `${field} must be an array of locator candidate IDs.`,
        `Set ${field} to a JSON array, using [] when no candidates apply.`,
        { actualValue: `<${safeType(value)}>` },
      ),
    );
    return {
      structurallyValid: false,
      ids: Object.freeze([]),
      originalIds: Object.freeze([]),
    };
  }
  if (value.length > MAX_LOCATOR_CANDIDATES) {
    issues.push(
      issue(
        "REVIEW_CANDIDATE_ARRAY_TOO_LARGE",
        "field",
        fieldPath,
        `${field} contains ${String(value.length)} candidate IDs; the maximum is ${String(MAX_LOCATOR_CANDIDATES)}.`,
        `Reduce ${field} to at most ${String(MAX_LOCATOR_CANDIDATES)} reviewed candidate IDs. The validator will not truncate or repair it automatically.`,
        { actualValue: value.length },
      ),
    );
    return {
      structurallyValid: false,
      ids: Object.freeze([]),
      originalIds: Object.freeze([]),
    };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${fieldPath}[${String(index)}]`;
    if (typeof entry !== "string" || !CANDIDATE_ID.test(entry)) {
      issues.push(
        issue(
          "REVIEW_CANDIDATE_ID_INVALID",
          "field",
          entryPath,
          "The value is not a valid locator candidate ID.",
          "Use a candidate ID from candidateIds in the form LOCATOR-001.",
          { actualValue: safeCandidateActual(entry) },
        ),
      );
      return;
    }
    ids.push(entry);
    if (seen.has(entry)) {
      issues.push(
        issue(
          "REVIEW_CANDIDATE_DUPLICATE",
          "field",
          entryPath,
          `${entry} appears more than once in ${field}.`,
          `Remove the duplicate ${entry} entry from ${field}.`,
          { actualValue: entry },
        ),
      );
    }
    seen.add(entry);
  });
  return {
    structurallyValid: value.every(
      (entry) => typeof entry === "string" && CANDIDATE_ID.test(entry),
    ),
    ids: Object.freeze([...new Set(ids)].sort()),
    originalIds: Object.freeze([...ids]),
  };
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function inspectNullableEnum(
  input: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
  unsupportedCode: LocatorReviewValidationCode,
  label: string,
  issues: LocatorReviewValidationIssue[],
): string | null | undefined {
  if (!hasOwn(input, field)) return undefined;
  const value = input[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    issues.push(
      issue(
        "REVIEW_FIELD_TYPE_INVALID",
        "field",
        `$.${field}`,
        `${field} must be null or a supported ${label}.`,
        `Set ${field} to null or one of the listed values.`,
        { actualValue: `<${safeType(value)}>`, allowedValues: allowed },
      ),
    );
    return undefined;
  }
  if (!allowed.includes(value)) {
    const actual = safeEnumActual(value);
    issues.push(
      issue(
        unsupportedCode,
        "field",
        `$.${field}`,
        `${String(actual)} is not a supported ${label}.`,
        `Set ${field} to one of the listed values.`,
        { actualValue: actual, allowedValues: allowed },
      ),
    );
    return undefined;
  }
  return value;
}

function candidateIndex(value: CandidateArrayResult, id: string): number {
  return value.originalIds.indexOf(id);
}

export function inspectLocatorObservationReview(
  value: unknown,
  observation?: LocatorObservation,
): LocatorReviewValidationResult {
  const issues: LocatorReviewValidationIssue[] = [];
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "schema",
          "$",
          "The review must be a plain JSON object.",
          "Regenerate the review template and copy only human review values into it.",
          { actualValue: `<${safeType(value)}>` },
        ),
      ]),
    });
  }

  const input = structuredClone(value as Record<string, unknown>);
  for (const field of Object.keys(input).sort()) {
    if (ALLOWED_FIELDS.has(field)) continue;
    const safeField = /^[A-Za-z][A-Za-z0-9_-]{0,80}$/u.test(field)
      ? field
      : "<unsafe-property>";
    issues.push(
      issue(
        "REVIEW_UNKNOWN_FIELD",
        "schema",
        `$.${safeField}`,
        `This property is not part of review schema ${LOCATOR_OBSERVATION_REVIEW_VERSION}.`,
        "Remove the property or regenerate the review template.",
      ),
    );
  }
  for (const field of REQUIRED_FIELDS) {
    if (hasOwn(input, field)) continue;
    issues.push(
      issue(
        "REVIEW_REQUIRED_FIELD_MISSING",
        "schema",
        `$.${field}`,
        `${field} is required by the locator review schema.`,
        "Regenerate the review template or restore the missing property.",
      ),
    );
  }

  let observationId: string | undefined;
  if (hasOwn(input, "observationId")) {
    if (typeof input.observationId !== "string") {
      issues.push(
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "field",
          "$.observationId",
          "observationId must be text.",
          "Copy the observation ID from the pending observation filename.",
          { actualValue: `<${safeType(input.observationId)}>` },
        ),
      );
    } else if (!OBSERVATION_ID.test(input.observationId)) {
      issues.push(
        issue(
          "REVIEW_OBSERVATION_ID_INVALID",
          "field",
          "$.observationId",
          "observationId does not use the required LOC-OBS identifier format.",
          "Copy the exact LOC-OBS-... ID from the pending observation.",
          { actualValue: "<invalid observation ID>" },
        ),
      );
    } else {
      observationId = input.observationId;
      if (
        observation !== undefined &&
        observationId !== observation.observationId
      ) {
        issues.push(
          issue(
            "REVIEW_OBSERVATION_ID_MISMATCH",
            "observation-link",
            "$.observationId",
            "observationId does not identify the linked pending observation.",
            `Set observationId to ${observation.observationId} or use the matching observation file.`,
            { actualValue: observationId },
          ),
        );
      }
    }
  }

  let reviewStatus: LocatorObservationReviewStatus | undefined;
  if (hasOwn(input, "reviewStatus")) {
    if (typeof input.reviewStatus !== "string") {
      issues.push(
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "field",
          "$.reviewStatus",
          "reviewStatus must be text.",
          "Set reviewStatus to one of the listed values.",
          {
            actualValue: `<${safeType(input.reviewStatus)}>`,
            allowedValues: LOCATOR_OBSERVATION_REVIEW_STATUSES,
          },
        ),
      );
    } else if (
      !LOCATOR_OBSERVATION_REVIEW_STATUSES.includes(
        input.reviewStatus as LocatorObservationReviewStatus,
      )
    ) {
      const actual = safeEnumActual(input.reviewStatus);
      issues.push(
        issue(
          "REVIEW_STATUS_UNSUPPORTED",
          "field",
          "$.reviewStatus",
          `${String(actual)} is not a supported review status.`,
          "Set reviewStatus to one of the listed values. Reviewed records require classification, recommendation, confidence, candidate verdicts, and rationale.",
          {
            actualValue: actual,
            allowedValues: LOCATOR_OBSERVATION_REVIEW_STATUSES,
          },
        ),
      );
    } else {
      reviewStatus = input.reviewStatus as LocatorObservationReviewStatus;
    }
  }

  if (hasOwn(input, "reviewVersion")) {
    if (typeof input.reviewVersion !== "string") {
      issues.push(
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "field",
          "$.reviewVersion",
          "reviewVersion must be semantic version text.",
          "Regenerate the review template with the current framework version.",
          { actualValue: `<${safeType(input.reviewVersion)}>` },
        ),
      );
    } else if (input.reviewVersion !== LOCATOR_OBSERVATION_REVIEW_VERSION) {
      const actual = safeVersionActual(input.reviewVersion);
      issues.push(
        issue(
          "REVIEW_VERSION_UNSUPPORTED",
          "field",
          "$.reviewVersion",
          `${String(actual)} is not a supported locator review version.`,
          "Regenerate the review template before reviewing this observation.",
          {
            actualValue: actual,
            allowedValues: [LOCATOR_OBSERVATION_REVIEW_VERSION],
          },
        ),
      );
    }
  }

  const missingArray = Object.freeze({
    structurallyValid: false,
    ids: Object.freeze([]),
    originalIds: Object.freeze([]),
  });
  const candidateIds = hasOwn(input, "candidateIds")
    ? inspectCandidateArray(input.candidateIds, "candidateIds", issues)
    : missingArray;
  const acceptable = hasOwn(input, "acceptableCandidateIds")
    ? inspectCandidateArray(
        input.acceptableCandidateIds,
        "acceptableCandidateIds",
        issues,
      )
    : missingArray;
  const preferred = hasOwn(input, "preferredCandidateIds")
    ? inspectCandidateArray(
        input.preferredCandidateIds,
        "preferredCandidateIds",
        issues,
      )
    : missingArray;
  const forbidden = hasOwn(input, "forbiddenCandidateIds")
    ? inspectCandidateArray(
        input.forbiddenCandidateIds,
        "forbiddenCandidateIds",
        issues,
      )
    : missingArray;

  const expectedClassification = inspectNullableEnum(
    input,
    "expectedClassification",
    LOCATOR_FAILURE_CLASSIFICATIONS,
    "REVIEW_CLASSIFICATION_UNSUPPORTED",
    "locator failure classification",
    issues,
  );
  const expectedRecommendationStatus = inspectNullableEnum(
    input,
    "expectedRecommendationStatus",
    LOCATOR_RECOMMENDATION_STATUSES,
    "REVIEW_RECOMMENDATION_STATUS_UNSUPPORTED",
    "locator recommendation status",
    issues,
  );
  const minimumAcceptableConfidence = inspectNullableEnum(
    input,
    "minimumAcceptableConfidence",
    LOCATOR_REVIEW_CONFIDENCES,
    "REVIEW_CONFIDENCE_UNSUPPORTED",
    "confidence value",
    issues,
  );

  const available =
    observation?.candidateInventory
      .map(({ candidateId }) => candidateId)
      .sort() ?? [];
  if (candidateIds.structurallyValid && observation !== undefined) {
    const unknown = candidateIds.ids.filter((id) => !available.includes(id));
    unknown.forEach((id) => {
      const index = candidateIndex(candidateIds, id);
      issues.push(
        issue(
          "REVIEW_CANDIDATE_UNKNOWN",
          "observation-link",
          `$.candidateIds[${String(index)}]`,
          `${id} does not exist in the linked observation candidate inventory.`,
          "Regenerate the review template from the linked observation.",
          { actualValue: id },
        ),
      );
    });
    const missing = available.filter((id) => !candidateIds.ids.includes(id));
    if (missing.length > 0) {
      issues.push(
        issue(
          "REVIEW_CANDIDATE_SET_MISMATCH",
          "observation-link",
          "$.candidateIds",
          `candidateIds is missing observation candidates: ${missing.join(", ")}.`,
          "Regenerate the review template so candidateIds exactly matches the observation inventory.",
          { actualValue: candidateIds.ids },
        ),
      );
    }
  }

  if (candidateIds.structurallyValid) {
    for (const [field, values] of [
      ["acceptableCandidateIds", acceptable],
      ["preferredCandidateIds", preferred],
      ["forbiddenCandidateIds", forbidden],
    ] as const) {
      if (!values.structurallyValid) continue;
      values.ids.forEach((id) => {
        if (candidateIds.ids.includes(id)) return;
        const index = candidateIndex(values, id);
        issues.push(
          issue(
            "REVIEW_CANDIDATE_UNKNOWN",
            "relationship",
            `$.${field}[${String(index)}]`,
            `${id} is not listed in candidateIds.`,
            `Remove ${id} or regenerate the review template from the matching observation.`,
            { actualValue: id },
          ),
        );
      });
    }
  }

  if (preferred.structurallyValid && acceptable.structurallyValid) {
    preferred.ids.forEach((id) => {
      if (acceptable.ids.includes(id)) return;
      issues.push(
        issue(
          "REVIEW_PREFERRED_NOT_ACCEPTABLE",
          "relationship",
          `$.preferredCandidateIds[${String(candidateIndex(preferred, id))}]`,
          `${id} is preferred but is not listed as acceptable.`,
          `Add ${id} to acceptableCandidateIds or remove it from preferredCandidateIds.`,
          { actualValue: id },
        ),
      );
    });
  }
  if (acceptable.structurallyValid && forbidden.structurallyValid) {
    acceptable.ids
      .filter((id) => forbidden.ids.includes(id))
      .forEach((id) => {
        issues.push(
          issue(
            "REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP",
            "relationship",
            `$.forbiddenCandidateIds[${String(candidateIndex(forbidden, id))}]`,
            `${id} appears in both acceptableCandidateIds and forbiddenCandidateIds.`,
            `Remove ${id} from one of those arrays after human review.`,
            { actualValue: id },
          ),
        );
      });
  }
  if (preferred.structurallyValid && forbidden.structurallyValid) {
    preferred.ids
      .filter((id) => forbidden.ids.includes(id))
      .forEach((id) => {
        issues.push(
          issue(
            "REVIEW_PREFERRED_FORBIDDEN_OVERLAP",
            "relationship",
            `$.forbiddenCandidateIds[${String(candidateIndex(forbidden, id))}]`,
            `${id} appears in both preferredCandidateIds and forbiddenCandidateIds.`,
            `Remove ${id} from preferredCandidateIds or forbiddenCandidateIds after human review.`,
            { actualValue: id },
          ),
        );
      });
  }

  if (reviewStatus === "reviewed") {
    if (expectedClassification === null) {
      issues.push(
        issue(
          "REVIEWED_CLASSIFICATION_REQUIRED",
          "field",
          "$.expectedClassification",
          'reviewStatus is "reviewed", but expectedClassification is null.',
          "Set expectedClassification to the human-reviewed failure classification.",
          { actualValue: null, allowedValues: LOCATOR_FAILURE_CLASSIFICATIONS },
        ),
      );
    }
    if (expectedRecommendationStatus === null) {
      issues.push(
        issue(
          "REVIEWED_RECOMMENDATION_STATUS_REQUIRED",
          "field",
          "$.expectedRecommendationStatus",
          'reviewStatus is "reviewed", but expectedRecommendationStatus is null.',
          "Set expectedRecommendationStatus to the human-reviewed recommendation status.",
          { actualValue: null, allowedValues: LOCATOR_RECOMMENDATION_STATUSES },
        ),
      );
    }
    if (minimumAcceptableConfidence === null) {
      issues.push(
        issue(
          "REVIEWED_CONFIDENCE_REQUIRED",
          "field",
          "$.minimumAcceptableConfidence",
          'reviewStatus is "reviewed", but minimumAcceptableConfidence is null.',
          "Set minimumAcceptableConfidence to the lowest confidence acceptable for this reviewed verdict.",
          { actualValue: null, allowedValues: LOCATOR_REVIEW_CONFIDENCES },
        ),
      );
    }
    if (
      expectedRecommendationStatus === "candidates-available" &&
      acceptable.structurallyValid &&
      acceptable.ids.length === 0
    ) {
      issues.push(
        issue(
          "REVIEWED_ACCEPTABLE_CANDIDATE_REQUIRED",
          "relationship",
          "$.acceptableCandidateIds",
          "A reviewed candidates-available verdict requires at least one acceptable candidate.",
          "Add at least one human-approved candidate ID to acceptableCandidateIds.",
          { actualValue: Object.freeze([]) },
        ),
      );
    }
  }

  if (hasOwn(input, "reviewerRationale")) {
    if (typeof input.reviewerRationale !== "string") {
      issues.push(
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "field",
          "$.reviewerRationale",
          "reviewerRationale must be text.",
          "Write a bounded human explanation without private information.",
          { actualValue: `<${safeType(input.reviewerRationale)}>` },
        ),
      );
    } else {
      const trimmed = input.reviewerRationale.trim();
      if (reviewStatus === "reviewed" && trimmed.length === 0) {
        issues.push(
          issue(
            "REVIEW_RATIONALE_EMPTY",
            "field",
            "$.reviewerRationale",
            "A reviewed record requires a non-empty human rationale.",
            "Explain why the classification, recommendation, and candidate verdict are correct.",
            {
              actualValue:
                input.reviewerRationale.length === 0
                  ? "<empty>"
                  : "<whitespace-only>",
            },
          ),
        );
      } else if (reviewStatus === "reviewed" && trimmed.length < 10) {
        issues.push(
          issue(
            "REVIEW_RATIONALE_TOO_SHORT",
            "field",
            "$.reviewerRationale",
            "The reviewed rationale must contain at least 10 non-whitespace characters.",
            "Add a concise human explanation of the expected verdict.",
            { actualValue: `<text length ${String(trimmed.length)}>` },
          ),
        );
      }
      if (input.reviewerRationale.length > 1_000) {
        issues.push(
          issue(
            "REVIEW_RATIONALE_TOO_LONG",
            "field",
            "$.reviewerRationale",
            "reviewerRationale exceeds the 1,000-character limit.",
            "Shorten the rationale without adding private evidence.",
            {
              actualValue: `<text length ${String(input.reviewerRationale.length)}>`,
            },
          ),
        );
      }
      if (UNSAFE_REVIEW_TEXT.test(input.reviewerRationale)) {
        issues.push(
          issue(
            "REVIEW_TEXT_UNSAFE",
            "field",
            "$.reviewerRationale",
            "reviewerRationale contains private or unsafe content.",
            "Remove HTML, credentials, secrets, or absolute local paths from the rationale.",
            { actualValue: "<unsafe text omitted>" },
          ),
        );
      }
    }
  }
  if (hasOwn(input, "reviewNotes")) {
    if (typeof input.reviewNotes !== "string") {
      issues.push(
        issue(
          "REVIEW_FIELD_TYPE_INVALID",
          "field",
          "$.reviewNotes",
          "reviewNotes must be text when supplied.",
          "Remove reviewNotes or replace it with bounded, non-private text.",
          { actualValue: `<${safeType(input.reviewNotes)}>` },
        ),
      );
    } else if (
      input.reviewNotes.length > 1_000 ||
      UNSAFE_REVIEW_TEXT.test(input.reviewNotes)
    ) {
      issues.push(
        issue(
          "REVIEW_TEXT_UNSAFE",
          "field",
          "$.reviewNotes",
          "reviewNotes is oversized or contains private or unsafe content.",
          "Shorten the notes and remove HTML, credentials, secrets, and absolute paths.",
          { actualValue: "<unsafe text omitted>" },
        ),
      );
    }
  }

  const ordered = sortedIssues(issues);
  if (ordered.length > 0) {
    return Object.freeze({
      valid: false,
      ...(observationId === undefined ? {} : { observationId }),
      issues: ordered,
    });
  }

  const normalized = Object.freeze({
    observationId: input.observationId as string,
    reviewStatus: input.reviewStatus as LocatorObservationReviewStatus,
    candidateIds: candidateIds.ids,
    expectedClassification:
      expectedClassification as LocatorFailureClassification | null,
    expectedRecommendationStatus:
      expectedRecommendationStatus as LocatorRecommendationStatus | null,
    acceptableCandidateIds: acceptable.ids,
    preferredCandidateIds: preferred.ids,
    forbiddenCandidateIds: forbidden.ids,
    minimumAcceptableConfidence:
      minimumAcceptableConfidence as LocatorDiagnosisConfidence | null,
    reviewerRationale: input.reviewerRationale as string,
    reviewVersion: input.reviewVersion as string,
    ...(input.reviewNotes === undefined
      ? {}
      : { reviewNotes: input.reviewNotes as string }),
  });
  return Object.freeze({
    valid: true,
    observationId: normalized.observationId,
    review: normalized,
    issues: Object.freeze([]),
  });
}

export function validateLocatorObservationReview(
  review: LocatorObservationReview,
  observation: LocatorObservation,
): LocatorObservationReview {
  const result = inspectLocatorObservationReview(review, observation);
  if (!result.valid || result.review === undefined) {
    const first = result.issues[0];
    throw new Error(
      first === undefined
        ? "Invalid locator observation review."
        : `Invalid locator observation review: ${first.code} at ${first.fieldPath}: ${first.message}`,
    );
  }
  return result.review;
}
