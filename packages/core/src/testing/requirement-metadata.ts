import {
  assertPlainRecord,
  MetadataValidationError,
  REQUIREMENT_ID_PATTERN,
  requireNonEmptyString,
  requireSupportedValue,
} from "./metadata-validation.ts";

export const REQUIREMENT_STATUSES = ["active", "draft", "deprecated"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export interface RequirementMetadata {
  readonly requirementId: string;
  readonly title: string;
  readonly documentPath: string;
  readonly feature: string;
  readonly status: RequirementStatus;
}

const FEATURE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DOCUMENT_PATH_PATTERN = /^[a-zA-Z0-9._/-]+\.md$/u;

export function validateRequirementMetadata(
  value: unknown,
): RequirementMetadata {
  assertPlainRecord(value, "requirement metadata");

  const requirementId = requireNonEmptyString(
    value.requirementId,
    "requirementId",
  );
  if (!REQUIREMENT_ID_PATTERN.test(requirementId)) {
    throw new MetadataValidationError(
      "requirementId has an invalid identifier format; expected a value such as REQ-FEATURE-001.",
    );
  }

  const title = requireNonEmptyString(value.title, "title");
  const feature = requireNonEmptyString(value.feature, "feature");
  if (!FEATURE_PATTERN.test(feature)) {
    throw new MetadataValidationError(
      "feature must use lowercase kebab-case, such as product-search.",
    );
  }

  const documentPath = requireNonEmptyString(
    value.documentPath,
    "documentPath",
  );
  if (
    !DOCUMENT_PATH_PATTERN.test(documentPath) ||
    documentPath.startsWith("/") ||
    documentPath.includes("\\") ||
    documentPath.split("/").includes("..")
  ) {
    throw new MetadataValidationError(
      "documentPath must be a repository-relative POSIX Markdown path.",
    );
  }

  const status = requireSupportedValue(
    value.status,
    "status",
    REQUIREMENT_STATUSES,
  );

  return Object.freeze({ requirementId, title, documentPath, feature, status });
}

export function defineRequirementMetadata(
  metadata: RequirementMetadata,
): RequirementMetadata {
  return validateRequirementMetadata(metadata);
}
