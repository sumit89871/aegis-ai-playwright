import {
  assertPlainRecord,
  assertUnique,
  MetadataValidationError,
  REQUIREMENT_ID_PATTERN,
  requireNonEmptyString,
  requireStringArray,
  requireSupportedValue,
  TEST_ID_PATTERN,
} from "./metadata-validation.ts";

export const TEST_RISKS = ["critical", "high", "medium", "low"] as const;
export const TEST_SUITES = [
  "smoke",
  "regression",
  "integration",
  "end-to-end",
] as const;
export const TEST_LAYERS = ["ui", "api", "database", "contract"] as const;

export type TestRisk = (typeof TEST_RISKS)[number];
export type TestSuite = (typeof TEST_SUITES)[number];
export type TestLayer = (typeof TEST_LAYERS)[number];

export interface TestMetadata {
  readonly testId: string;
  readonly title: string;
  readonly feature: string;
  readonly suite: TestSuite;
  readonly risk: TestRisk;
  readonly layer: TestLayer;
  readonly requirementIds: readonly string[];
  readonly tags: readonly string[];
}

export interface PlaywrightMetadataAnnotation {
  readonly type: string;
  readonly description: string;
}

const FEATURE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TAG_PATTERN = /^@[a-z0-9]+(?:[-_:][a-z0-9]+)*$/u;

function validateIdentifier(
  value: unknown,
  fieldName: string,
  pattern: RegExp,
  example: string,
): string {
  const identifier = requireNonEmptyString(value, fieldName);
  if (!pattern.test(identifier)) {
    throw new MetadataValidationError(
      `${fieldName} has an invalid identifier format; expected a value such as ${example}.`,
    );
  }
  return identifier;
}

export function validateTestMetadata(value: unknown): TestMetadata {
  assertPlainRecord(value, "test metadata");

  const testId = validateIdentifier(
    value.testId,
    "testId",
    TEST_ID_PATTERN,
    "TC-FEATURE-001",
  );
  const title = requireNonEmptyString(value.title, "title");
  const feature = requireNonEmptyString(value.feature, "feature");
  if (!FEATURE_PATTERN.test(feature)) {
    throw new MetadataValidationError(
      "feature must use lowercase kebab-case, such as product-search.",
    );
  }

  const suite = requireSupportedValue(value.suite, "suite", TEST_SUITES);
  const risk = requireSupportedValue(value.risk, "risk", TEST_RISKS);
  const layer = requireSupportedValue(value.layer, "layer", TEST_LAYERS);
  const requirementIds = requireStringArray(
    value.requirementIds,
    "requirementIds",
    false,
  );
  for (const requirementId of requirementIds) {
    if (!REQUIREMENT_ID_PATTERN.test(requirementId)) {
      throw new MetadataValidationError(
        "requirementIds contains an invalid identifier format; expected a value such as REQ-FEATURE-001.",
      );
    }
  }
  assertUnique(requirementIds, "requirementIds");

  const tags = requireStringArray(value.tags, "tags", true);
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new MetadataValidationError(
        "tags must be normalized lowercase Playwright tags beginning with @.",
      );
    }
  }
  assertUnique(tags, "tags");

  return Object.freeze({
    testId,
    title,
    feature,
    suite,
    risk,
    layer,
    requirementIds: Object.freeze([...requirementIds].sort()),
    tags: Object.freeze([...tags].sort()),
  });
}

export function defineTestMetadata(metadata: TestMetadata): TestMetadata {
  return validateTestMetadata(metadata);
}

export function toPlaywrightTags(metadata: TestMetadata): string[] {
  const validated = validateTestMetadata(metadata);
  return [
    ...new Set([
      `@${validated.suite}`,
      ...validated.tags,
      `@feature:${validated.feature}`,
      `@risk:${validated.risk}`,
      `@layer:${validated.layer}`,
      ...validated.requirementIds.map(
        (requirementId) => `@requirement:${requirementId}`,
      ),
      `@test-id:${validated.testId}`,
    ]),
  ];
}

export function toPlaywrightAnnotations(
  metadata: TestMetadata,
): PlaywrightMetadataAnnotation[] {
  const validated = validateTestMetadata(metadata);
  return [
    { type: "test-id", description: validated.testId },
    ...validated.requirementIds.map((requirementId) => ({
      type: "requirement",
      description: requirementId,
    })),
    { type: "feature", description: validated.feature },
    { type: "risk", description: validated.risk },
    { type: "layer", description: validated.layer },
    { type: "suite", description: validated.suite },
  ];
}
