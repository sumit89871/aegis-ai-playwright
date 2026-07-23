import {
  containsSensitiveUrlData,
  redactSensitiveText,
} from "../diagnostics/redaction.ts";

export const APPLICATION_BROWSERS = ["chromium", "firefox", "webkit"] as const;

export type ApplicationBrowserName = (typeof APPLICATION_BROWSERS)[number];

export interface ApplicationBrowserCheck {
  readonly enabled: boolean;
  readonly browser?: ApplicationBrowserName;
  readonly expectedTitleContains?: string;
}

export interface ApplicationProfile {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly baseUrl: string;
  readonly healthCheckPath: string;
  readonly expectedStatusCodes: readonly number[];
  readonly requestTimeoutMs: number;
  readonly browserCheck: ApplicationBrowserCheck;
}

export class ApplicationProfileValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ApplicationProfileValidationError";
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PROFILE_FIELDS = new Set([
  "id",
  "name",
  "environment",
  "baseUrl",
  "healthCheckPath",
  "expectedStatusCodes",
  "requestTimeoutMs",
  "browserCheck",
]);
const BROWSER_FIELDS = new Set(["enabled", "browser", "expectedTitleContains"]);

function fail(field: string, reason: string): never {
  throw new ApplicationProfileValidationError(
    `Application profile field "${field}" ${reason}`,
  );
}

function assertPlainObject(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(field, "must be a plain object.");
  }
}

function assertSerializable(
  value: unknown,
  field: string,
  ancestors = new Set<object>(),
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(field, "must contain only finite numeric values.");
    }
    return;
  }
  if (typeof value !== "object") {
    fail(field, "must contain only JSON-serializable data.");
  }
  if (ancestors.has(value)) {
    fail(field, "must not contain a circular reference.");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertSerializable(entry, `${field}[${String(index)}]`, ancestors);
    });
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail(field, "must contain only plain serializable objects.");
    }
    for (const [key, entry] of Object.entries(value)) {
      assertSerializable(entry, `${field}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function requireString(
  value: unknown,
  field: string,
  maximumLength: number,
  checkCredentials = true,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(field, "must be a non-empty string.");
  }
  if (value !== value.trim()) {
    fail(field, "must not contain leading or trailing whitespace.");
  }
  if (value.length > maximumLength) {
    fail(field, `must not exceed ${String(maximumLength)} characters.`);
  }
  if (checkCredentials && redactSensitiveText(value, maximumLength) !== value) {
    fail(field, "must not contain credential-like data.");
  }
  return value;
}

function requireSlug(value: unknown, field: string): string {
  const slug = requireString(value, field, 80);
  if (!SLUG_PATTERN.test(slug)) {
    fail(field, "must be a normalized lowercase slug.");
  }
  return slug;
}

function validateBaseUrl(value: unknown): string {
  const baseUrl = requireString(value, "baseUrl", 2_048, false);
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail("baseUrl", "must be an absolute HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("baseUrl", "must use HTTP or HTTPS.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    fail("baseUrl", "must not contain an embedded username or password.");
  }
  if (containsSensitiveUrlData(baseUrl)) {
    fail("baseUrl", "must not contain sensitive query parameters.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function validateHealthCheckPath(value: unknown): string {
  const path = requireString(value, "healthCheckPath", 1_024);
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /\s/u.test(path)
  ) {
    fail("healthCheckPath", "must be a safe absolute-path reference.");
  }
  if (path.includes("#")) {
    fail("healthCheckPath", "must not contain a URL fragment.");
  }
  for (const segment of path.split("/")) {
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      fail("healthCheckPath", "contains invalid URL encoding.");
    }
    if (decodedSegment === ".." || decodedSegment === ".") {
      fail("healthCheckPath", "must not contain path traversal segments.");
    }
  }
  if (containsSensitiveUrlData(`https://profile.invalid${path}`)) {
    fail("healthCheckPath", "must not contain sensitive query parameters.");
  }
  return path;
}

function validateStatusCodes(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("expectedStatusCodes", "must contain at least one HTTP status code.");
  }
  const codes = value.map((entry, index) => {
    if (
      !Number.isInteger(entry) ||
      Number(entry) < 100 ||
      Number(entry) > 599
    ) {
      fail(
        `expectedStatusCodes[${String(index)}]`,
        "must be an integer from 100 through 599.",
      );
    }
    return Number(entry);
  });
  if (new Set(codes).size !== codes.length) {
    fail("expectedStatusCodes", "must contain unique values.");
  }
  return Object.freeze([...codes].sort((left, right) => left - right));
}

function validateTimeout(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < 100 ||
    Number(value) > 120_000
  ) {
    fail(
      "requestTimeoutMs",
      "must be an integer between 100 and 120000 milliseconds.",
    );
  }
  return Number(value);
}

function validateBrowserCheck(value: unknown): ApplicationBrowserCheck {
  assertPlainObject(value, "browserCheck");
  for (const key of Object.keys(value)) {
    if (!BROWSER_FIELDS.has(key)) {
      fail(`browserCheck.${key}`, "is not a supported field.");
    }
  }
  if (typeof value.enabled !== "boolean") {
    fail("browserCheck.enabled", "must be a boolean.");
  }
  const browser = value.browser;
  if (
    browser !== undefined &&
    (typeof browser !== "string" ||
      !APPLICATION_BROWSERS.includes(browser as ApplicationBrowserName))
  ) {
    fail(
      "browserCheck.browser",
      `must be one of: ${APPLICATION_BROWSERS.join(", ")}.`,
    );
  }
  const expectedTitleContains =
    value.expectedTitleContains === undefined
      ? undefined
      : requireString(
          value.expectedTitleContains,
          "browserCheck.expectedTitleContains",
          200,
        );

  return Object.freeze({
    enabled: value.enabled,
    ...(browser === undefined
      ? {}
      : { browser: browser as ApplicationBrowserName }),
    ...(expectedTitleContains === undefined ? {} : { expectedTitleContains }),
  });
}

export function validateApplicationProfile(value: unknown): ApplicationProfile {
  assertSerializable(value, "profile");
  assertPlainObject(value, "profile");
  for (const key of Object.keys(value)) {
    if (!PROFILE_FIELDS.has(key)) {
      fail(key, "is not a supported field.");
    }
  }

  return Object.freeze({
    id: requireSlug(value.id, "id"),
    name: requireString(value.name, "name", 120),
    environment: requireSlug(value.environment, "environment"),
    baseUrl: validateBaseUrl(value.baseUrl),
    healthCheckPath: validateHealthCheckPath(value.healthCheckPath),
    expectedStatusCodes: validateStatusCodes(value.expectedStatusCodes),
    requestTimeoutMs: validateTimeout(value.requestTimeoutMs),
    browserCheck: validateBrowserCheck(value.browserCheck),
  });
}

export function defineApplicationProfile(
  profile: ApplicationProfile,
): ApplicationProfile {
  return validateApplicationProfile(profile);
}
