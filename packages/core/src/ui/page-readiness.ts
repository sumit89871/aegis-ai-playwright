import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  redactSensitiveText,
  sanitizeUrl,
  truncateText,
} from "../diagnostics/redaction.ts";

export const PAGE_READINESS_LANDMARK_ROLES = [
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
] as const;

export type PageReadinessLandmarkRole =
  (typeof PAGE_READINESS_LANDMARK_ROLES)[number];

export interface PageReadinessUrlCriterion {
  readonly pathname?: string;
  readonly pattern?: string;
}

export interface PageReadinessLandmarkCriterion {
  readonly role: PageReadinessLandmarkRole;
  readonly name?: string;
}

export interface PageReadinessHeadingCriterion {
  readonly name: string;
  readonly exact?: boolean;
}

export interface PageReadinessDefinition {
  readonly id: string;
  readonly timeoutMs: number;
  readonly url?: PageReadinessUrlCriterion;
  readonly titleContains?: string;
  readonly visibleLandmark?: PageReadinessLandmarkCriterion;
  readonly visibleHeading?: PageReadinessHeadingCriterion;
  readonly visibleTestId?: string;
  readonly loadingIndicatorTestId?: string;
}

export interface PageReadinessCheckResult {
  readonly criterion: string;
  readonly status: "pass";
}

export interface PageReadinessResult {
  readonly status: "pass";
  readonly definitionId: string;
  readonly durationMs: number;
  readonly finalUrl: string;
  readonly title: string;
  readonly checks: readonly PageReadinessCheckResult[];
}

export interface PageReadinessFailureDetails {
  readonly status: "fail";
  readonly definitionId: string;
  readonly durationMs: number;
  readonly error: string;
}

export class PageReadinessError extends Error {
  public readonly details: PageReadinessFailureDetails;

  public constructor(
    message: string,
    details: PageReadinessFailureDetails,
    originalError: unknown,
  ) {
    super(message, { cause: originalError });
    this.name = "PageReadinessError";
    this.details = details;
  }
}

interface PageReadinessRuntimeOptions {
  readonly now?: () => number;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAXIMUM_TEXT_LENGTH = 200;
const MINIMUM_TIMEOUT_MS = 100;
const MAXIMUM_TIMEOUT_MS = 120_000;

function assertPlainObject(
  value: unknown,
  fieldName: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${fieldName} must be a plain serializable object.`);
  }
}

function assertOnlyFields(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  allowedFields: readonly string[],
): void {
  const unknownField = Object.keys(value).find(
    (field) => !allowedFields.includes(field),
  );
  if (unknownField !== undefined) {
    throw new Error(`${fieldName} contains unsupported field ${unknownField}.`);
  }
}

function requiredBoundedString(value: unknown, fieldName: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }
  if (value.length > MAXIMUM_TEXT_LENGTH) {
    throw new Error(
      `${fieldName} must not exceed ${String(MAXIMUM_TEXT_LENGTH)} characters.`,
    );
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  fieldName: string,
): string | undefined {
  return value === undefined
    ? undefined
    : requiredBoundedString(value, fieldName);
}

function validateUrlCriterion(value: unknown): PageReadinessUrlCriterion {
  assertPlainObject(value, "url");
  assertOnlyFields(value, "url", ["pathname", "pattern"]);
  const pathname = optionalBoundedString(value.pathname, "url.pathname");
  const pattern = optionalBoundedString(value.pattern, "url.pattern");
  if (pathname === undefined && pattern === undefined) {
    throw new Error("url must define pathname or pattern.");
  }
  if (pathname !== undefined && !pathname.startsWith("/")) {
    throw new Error("url.pathname must begin with '/'.");
  }
  if (pattern !== undefined) {
    try {
      new RegExp(pattern, "u");
    } catch {
      throw new Error("url.pattern must be a valid regular-expression string.");
    }
  }
  return Object.freeze({
    ...(pathname === undefined ? {} : { pathname }),
    ...(pattern === undefined ? {} : { pattern }),
  });
}

function validateLandmark(value: unknown): PageReadinessLandmarkCriterion {
  assertPlainObject(value, "visibleLandmark");
  assertOnlyFields(value, "visibleLandmark", ["role", "name"]);
  if (
    typeof value.role !== "string" ||
    !PAGE_READINESS_LANDMARK_ROLES.includes(
      value.role as PageReadinessLandmarkRole,
    )
  ) {
    throw new Error(
      `visibleLandmark.role must be one of: ${PAGE_READINESS_LANDMARK_ROLES.join(", ")}.`,
    );
  }
  const name = optionalBoundedString(value.name, "visibleLandmark.name");
  return Object.freeze({
    role: value.role as PageReadinessLandmarkRole,
    ...(name === undefined ? {} : { name }),
  });
}

function validateHeading(value: unknown): PageReadinessHeadingCriterion {
  assertPlainObject(value, "visibleHeading");
  assertOnlyFields(value, "visibleHeading", ["name", "exact"]);
  const name = requiredBoundedString(value.name, "visibleHeading.name");
  if (value.exact !== undefined && typeof value.exact !== "boolean") {
    throw new Error("visibleHeading.exact must be a boolean when supplied.");
  }
  return Object.freeze({
    name,
    ...(value.exact === undefined ? {} : { exact: value.exact }),
  });
}

export function validatePageReadinessDefinition(
  value: unknown,
): PageReadinessDefinition {
  assertPlainObject(value, "page readiness definition");
  assertOnlyFields(value, "page readiness definition", [
    "id",
    "timeoutMs",
    "url",
    "titleContains",
    "visibleLandmark",
    "visibleHeading",
    "visibleTestId",
    "loadingIndicatorTestId",
  ]);
  const id = requiredBoundedString(value.id, "id");
  if (!ID_PATTERN.test(id)) {
    throw new Error("id must use lowercase kebab-case.");
  }
  if (
    typeof value.timeoutMs !== "number" ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs < MINIMUM_TIMEOUT_MS ||
    value.timeoutMs > MAXIMUM_TIMEOUT_MS
  ) {
    throw new Error(
      `timeoutMs must be an integer between ${String(MINIMUM_TIMEOUT_MS)} and ${String(MAXIMUM_TIMEOUT_MS)}.`,
    );
  }

  const url =
    value.url === undefined ? undefined : validateUrlCriterion(value.url);
  const titleContains = optionalBoundedString(
    value.titleContains,
    "titleContains",
  );
  const visibleLandmark =
    value.visibleLandmark === undefined
      ? undefined
      : validateLandmark(value.visibleLandmark);
  const visibleHeading =
    value.visibleHeading === undefined
      ? undefined
      : validateHeading(value.visibleHeading);
  const visibleTestId = optionalBoundedString(
    value.visibleTestId,
    "visibleTestId",
  );
  const loadingIndicatorTestId = optionalBoundedString(
    value.loadingIndicatorTestId,
    "loadingIndicatorTestId",
  );

  if (
    url === undefined &&
    titleContains === undefined &&
    visibleLandmark === undefined &&
    visibleHeading === undefined &&
    visibleTestId === undefined &&
    loadingIndicatorTestId === undefined
  ) {
    throw new Error(
      "A page readiness definition must include at least one criterion.",
    );
  }

  return Object.freeze({
    id,
    timeoutMs: value.timeoutMs,
    ...(url === undefined ? {} : { url }),
    ...(titleContains === undefined ? {} : { titleContains }),
    ...(visibleLandmark === undefined ? {} : { visibleLandmark }),
    ...(visibleHeading === undefined ? {} : { visibleHeading }),
    ...(visibleTestId === undefined ? {} : { visibleTestId }),
    ...(loadingIndicatorTestId === undefined ? {} : { loadingIndicatorTestId }),
  });
}

export function definePageReadiness(
  definition: PageReadinessDefinition,
): PageReadinessDefinition {
  return validatePageReadinessDefinition(definition);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function waitForPageReady(
  page: Page,
  definition: PageReadinessDefinition,
  options: PageReadinessRuntimeOptions = {},
): Promise<PageReadinessResult> {
  const validated = validatePageReadinessDefinition(definition);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const checks: PageReadinessCheckResult[] = [];

  try {
    if (validated.url !== undefined) {
      const pattern =
        validated.url.pattern === undefined
          ? undefined
          : new RegExp(validated.url.pattern, "u");
      await expect(page).toHaveURL(
        (url) =>
          (validated.url?.pathname === undefined ||
            url.pathname === validated.url.pathname) &&
          (pattern === undefined || pattern.test(url.toString())),
        { timeout: validated.timeoutMs },
      );
      checks.push(Object.freeze({ criterion: "url", status: "pass" }));
    }

    if (validated.titleContains !== undefined) {
      await expect(page).toHaveTitle(
        new RegExp(escapeRegularExpression(validated.titleContains), "u"),
        { timeout: validated.timeoutMs },
      );
      checks.push(Object.freeze({ criterion: "title", status: "pass" }));
    }

    if (validated.visibleLandmark !== undefined) {
      const { role, name } = validated.visibleLandmark;
      await expect(
        page.getByRole(role, name === undefined ? {} : { name }),
      ).toBeVisible({ timeout: validated.timeoutMs });
      checks.push(Object.freeze({ criterion: "landmark", status: "pass" }));
    }

    if (validated.visibleHeading !== undefined) {
      await expect(
        page.getByRole("heading", {
          name: validated.visibleHeading.name,
          exact: validated.visibleHeading.exact ?? true,
        }),
      ).toBeVisible({ timeout: validated.timeoutMs });
      checks.push(Object.freeze({ criterion: "heading", status: "pass" }));
    }

    if (validated.visibleTestId !== undefined) {
      await expect(page.getByTestId(validated.visibleTestId)).toBeVisible({
        timeout: validated.timeoutMs,
      });
      checks.push(Object.freeze({ criterion: "test-id", status: "pass" }));
    }

    if (validated.loadingIndicatorTestId !== undefined) {
      await expect(
        page.getByTestId(validated.loadingIndicatorTestId),
      ).toBeHidden({ timeout: validated.timeoutMs });
      checks.push(
        Object.freeze({ criterion: "loading-indicator", status: "pass" }),
      );
    }

    return Object.freeze({
      status: "pass",
      definitionId: validated.id,
      durationMs: Math.max(0, now() - startedAt),
      finalUrl: sanitizeUrl(page.url()),
      title: truncateText(await page.title(), MAXIMUM_TEXT_LENGTH),
      checks: Object.freeze(checks),
    });
  } catch (error) {
    const safeError = redactSensitiveText(
      error instanceof Error ? error.message : "Unknown readiness error.",
      500,
    );
    const details = Object.freeze({
      status: "fail" as const,
      definitionId: validated.id,
      durationMs: Math.max(0, now() - startedAt),
      error: safeError,
    });
    throw new PageReadinessError(
      `Page readiness failed for ${validated.id}: ${safeError}`,
      details,
      error,
    );
  }
}
