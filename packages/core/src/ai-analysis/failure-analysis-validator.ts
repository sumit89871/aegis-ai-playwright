import { redactSensitiveText, truncateText } from "../diagnostics/redaction.ts";
import {
  FAILURE_ANALYSIS_CATEGORIES,
  FAILURE_ANALYSIS_CONFIDENCES,
  FAILURE_RECOMMENDATION_OWNERS,
} from "./failure-analysis.ts";
import type {
  FailureAnalysisCategory,
  FailureAnalysisConclusion,
  FailureAnalysisConfidence,
  FailureRecommendationOwner,
} from "./failure-analysis.ts";

const MAXIMUM_TEXT = 1_000;
const MAXIMUM_ITEMS = 20;
const ABSOLUTE_PATH_PATTERN =
  /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home)\/)[^\s\n\r"']+/u;
const HTML_PATTERN = /<\/?[A-Za-z][^>]*>/u;
const URL_PATTERN = /https?:\/\//iu;
const COMMAND_PATTERN =
  /(?:^|\s)(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh\s+-c|npm\s+run|npx\s+|git\s+|rm\s+|del\s+|curl\s+|wget\s+|invoke-expression)(?:\s|$)/iu;
const PATCH_PATTERN = /(?:```|diff --git|\*\*\* Begin Patch|^@@\s)/mu;

function fail(message: string): never {
  throw new Error(`Invalid failure-analysis result: ${message}`);
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(`${field} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function onlyFields(
  object: Readonly<Record<string, unknown>>,
  field: string,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    fail(`${field}.${unknown} is unsupported.`);
  }
}

function safeText(
  value: unknown,
  field: string,
  maximum = MAXIMUM_TEXT,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    return fail(`${field} must be a bounded non-empty trimmed string.`);
  }
  if (redactSensitiveText(value, maximum) !== truncateText(value, maximum)) {
    return fail(`${field} contains credential-like content.`);
  }
  if (ABSOLUTE_PATH_PATTERN.test(value)) {
    return fail(`${field} contains an absolute local path.`);
  }
  if (HTML_PATTERN.test(value)) {
    return fail(`${field} contains HTML.`);
  }
  if (URL_PATTERN.test(value)) {
    return fail(`${field} contains an unsupported URL.`);
  }
  if (COMMAND_PATTERN.test(value) || PATCH_PATTERN.test(value)) {
    return fail(`${field} contains executable command or patch content.`);
  }
  return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ITEMS) {
    return fail(
      `${field} must be an array with at most ${String(MAXIMUM_ITEMS)} items.`,
    );
  }
  const values = value.map((entry, index) =>
    safeText(entry, `${field}[${String(index)}]`),
  );
  return Object.freeze([...new Set(values)]);
}

function controlled<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(`${field} has an unsupported value.`);
  }
  return value as T;
}

export function validateFailureAnalysisConclusion(
  value: unknown,
  validEvidenceIds: readonly string[],
): FailureAnalysisConclusion {
  const object = plainObject(value, "analysis");
  onlyFields(object, "analysis", [
    "summary",
    "primaryCategory",
    "confidence",
    "probableCauses",
    "recommendedActions",
    "locatorAssessment",
    "missingEvidence",
    "limitations",
  ]);
  const validIds = new Set(validEvidenceIds);
  if (
    !Array.isArray(object.probableCauses) ||
    object.probableCauses.length < 1 ||
    object.probableCauses.length > MAXIMUM_ITEMS
  ) {
    return fail("probableCauses must contain between 1 and 20 items.");
  }
  const probableCauses = object.probableCauses.map((entry, index) => {
    const cause = plainObject(entry, `probableCauses[${String(index)}]`);
    onlyFields(cause, `probableCauses[${String(index)}]`, [
      "cause",
      "confidence",
      "evidenceIds",
    ]);
    const evidenceIds = stringArray(
      cause.evidenceIds,
      `probableCauses[${String(index)}].evidenceIds`,
    );
    if (evidenceIds.length === 0) {
      return fail(
        `probableCauses[${String(index)}].evidenceIds must not be empty.`,
      );
    }
    const missing = evidenceIds.find((id) => !validIds.has(id));
    if (missing !== undefined) {
      return fail(
        `probableCauses[${String(index)}] references unknown evidence ID ${missing}.`,
      );
    }
    return Object.freeze({
      cause: safeText(cause.cause, `probableCauses[${String(index)}].cause`),
      confidence: controlled<FailureAnalysisConfidence>(
        cause.confidence,
        `probableCauses[${String(index)}].confidence`,
        FAILURE_ANALYSIS_CONFIDENCES,
      ),
      evidenceIds,
    });
  });
  if (
    !Array.isArray(object.recommendedActions) ||
    object.recommendedActions.length < 1 ||
    object.recommendedActions.length > MAXIMUM_ITEMS
  ) {
    return fail("recommendedActions must contain between 1 and 20 items.");
  }
  const recommendedActions = object.recommendedActions.map((entry, index) => {
    const action = plainObject(entry, `recommendedActions[${String(index)}]`);
    onlyFields(action, `recommendedActions[${String(index)}]`, [
      "priority",
      "action",
      "owner",
    ]);
    return Object.freeze({
      priority: controlled(
        action.priority,
        `recommendedActions[${String(index)}].priority`,
        ["high", "medium", "low"] as const,
      ),
      action: safeText(
        action.action,
        `recommendedActions[${String(index)}].action`,
      ),
      owner: controlled<FailureRecommendationOwner>(
        action.owner,
        `recommendedActions[${String(index)}].owner`,
        FAILURE_RECOMMENDATION_OWNERS,
      ),
    });
  });
  const locator = plainObject(object.locatorAssessment, "locatorAssessment");
  onlyFields(locator, "locatorAssessment", ["status", "reason"]);
  return Object.freeze({
    summary: safeText(object.summary, "summary"),
    primaryCategory: controlled<FailureAnalysisCategory>(
      object.primaryCategory,
      "primaryCategory",
      FAILURE_ANALYSIS_CATEGORIES,
    ),
    confidence: controlled<FailureAnalysisConfidence>(
      object.confidence,
      "confidence",
      FAILURE_ANALYSIS_CONFIDENCES,
    ),
    probableCauses: Object.freeze(probableCauses),
    recommendedActions: Object.freeze(recommendedActions),
    locatorAssessment: Object.freeze({
      status: controlled(locator.status, "locatorAssessment.status", [
        "no-change-recommended",
        "review-recommended",
      ] as const),
      reason: safeText(locator.reason, "locatorAssessment.reason"),
    }),
    missingEvidence: stringArray(object.missingEvidence, "missingEvidence"),
    limitations: stringArray(object.limitations, "limitations"),
  });
}

export function isValidFailureAnalysisConclusion(
  value: Readonly<Record<string, unknown>>,
  validEvidenceIds: readonly string[],
): boolean | { readonly valid: boolean; readonly errors: readonly string[] } {
  try {
    validateFailureAnalysisConclusion(value, validEvidenceIds);
    return true;
  } catch (error) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([
        error instanceof Error
          ? truncateText(error.message, 300)
          : "Invalid analysis.",
      ]),
    });
  }
}
