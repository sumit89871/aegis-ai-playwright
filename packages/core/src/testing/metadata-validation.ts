export class MetadataValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MetadataValidationError";
  }
}

export const REQUIREMENT_ID_PATTERN =
  /^REQ-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,}$/u;
export const TEST_ID_PATTERN = /^TC-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,}$/u;

const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(?:authorization|cookie|password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/iu;
const ENVIRONMENT_DUMP_PATTERN = /\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/u;
const URL_CREDENTIAL_PATTERN = /[a-z][a-z\d+.-]*:\/\/[^/@\s]+@/iu;

export function assertPlainRecord(
  value: unknown,
  fieldName: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new MetadataValidationError(`${fieldName} must be a plain object.`);
  }
}

export function requireNonEmptyString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MetadataValidationError(
      `${fieldName} must be a non-empty string.`,
    );
  }

  if (value !== value.trim()) {
    throw new MetadataValidationError(
      `${fieldName} must not contain leading or trailing whitespace.`,
    );
  }

  assertSafeMetadataValue(value, fieldName);
  return value;
}

export function assertSafeMetadataValue(
  value: string,
  fieldName: string,
): void {
  if (value.includes("process.env")) {
    throw new MetadataValidationError(
      `${fieldName} must not contain an environment-variable dump.`,
    );
  }

  if (ENVIRONMENT_DUMP_PATTERN.test(value)) {
    throw new MetadataValidationError(
      `${fieldName} must not contain an environment-variable assignment.`,
    );
  }

  if (
    SENSITIVE_ASSIGNMENT_PATTERN.test(value) ||
    URL_CREDENTIAL_PATTERN.test(value)
  ) {
    throw new MetadataValidationError(
      `${fieldName} must not contain credential-like data.`,
    );
  }
}

export function requireStringArray(
  value: unknown,
  fieldName: string,
  allowEmpty: boolean,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new MetadataValidationError(`${fieldName} must be an array.`);
  }

  if (!allowEmpty && value.length === 0) {
    throw new MetadataValidationError(
      `${fieldName} must contain at least one value.`,
    );
  }

  return value.map((entry, index) =>
    requireNonEmptyString(entry, `${fieldName}[${String(index)}]`),
  );
}

export function assertUnique(
  values: readonly string[],
  fieldName: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new MetadataValidationError(
        `${fieldName} must contain unique values; a duplicate was found.`,
      );
    }
    seen.add(value);
  }
}

export function requireSupportedValue<TValue extends string>(
  value: unknown,
  fieldName: string,
  supportedValues: readonly TValue[],
): TValue {
  if (typeof value !== "string" || !supportedValues.includes(value as TValue)) {
    throw new MetadataValidationError(
      `${fieldName} must be one of: ${supportedValues.join(", ")}.`,
    );
  }

  return value as TValue;
}
