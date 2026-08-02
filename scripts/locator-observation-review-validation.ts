import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  createLocatorReviewValidationIssue,
  inspectLocatorObservationReview,
  orderLocatorReviewValidationIssues,
  validateLocatorObservation,
} from "@aegis/core";
import type {
  LocatorObservation,
  LocatorObservationReviewStatus,
  LocatorReviewSafeActualValue,
  LocatorReviewValidationIssue,
} from "@aegis/core";

export interface LocatorReviewValidationFileResult {
  readonly path: string;
  readonly observationId?: string;
  readonly valid: boolean;
  readonly reviewStatus?: LocatorObservationReviewStatus;
  readonly issues: readonly LocatorReviewValidationIssue[];
}

export interface LocatorReviewValidationSummary {
  readonly reviewed: number;
  readonly pending: number;
  readonly rejected: number;
  readonly needsMoreEvidence: number;
  readonly invalid: number;
  readonly issues: number;
}

export interface LocatorReviewDirectoryValidationResult {
  readonly status: "pass" | "fail";
  readonly summary: LocatorReviewValidationSummary;
  readonly files: readonly LocatorReviewValidationFileResult[];
}

export interface LocatorReviewDirectoryValidationOptions {
  readonly repositoryRoot: string;
  readonly observationsDirectory: string;
  readonly reviewsDirectory: string;
}

const OBSERVATION_FILE = /^(LOC-OBS-[A-F0-9]{16})\.json$/u;
const REVIEW_FILE = /^(LOC-OBS-[A-F0-9]{16})\.review\.json$/u;

function relativePath(repositoryRoot: string, path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function parseLocation(
  message: string,
  source: string,
): { readonly line?: number; readonly column?: number } {
  const direct = /line\s+(\d+)\s+column\s+(\d+)/iu.exec(message);
  if (direct !== null) {
    return { line: Number(direct[1]), column: Number(direct[2]) };
  }
  const position = /position\s+(\d+)/iu.exec(message);
  if (position === null) return {};
  const offset = Number(position[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) return {};
  const before = source.slice(0, offset);
  const lines = before.split(/\r?\n/u);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function jsonIssue(
  error: unknown,
  source: string,
): LocatorReviewValidationIssue {
  const location =
    error instanceof Error ? parseLocation(error.message, source) : {};
  return createLocatorReviewValidationIssue(
    "REVIEW_JSON_INVALID",
    "json-syntax",
    "$",
    "The review file is not valid JSON.",
    "Check for a missing comma, unmatched quote, unmatched bracket, or trailing comma.",
    location,
  );
}

async function loadObservations(directory: string): Promise<{
  readonly valid: ReadonlyMap<string, LocatorObservation>;
  readonly invalid: ReadonlySet<string>;
}> {
  const valid = new Map<string, LocatorObservation>();
  const invalid = new Set<string>();
  const names = (await readdir(directory).catch(() => [] as string[])).sort();
  for (const name of names) {
    const match = OBSERVATION_FILE.exec(name);
    if (match?.[1] === undefined) continue;
    try {
      const source = await readFile(resolve(directory, name), "utf8");
      const parsed: unknown = JSON.parse(source);
      const observation = validateLocatorObservation(parsed);
      valid.set(observation.observationId, observation);
    } catch {
      invalid.add(match[1]);
    }
  }
  return { valid, invalid };
}

function safeObservationId(value: unknown): string | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).observationId === "string" &&
    /^LOC-OBS-[A-F0-9]{16}$/u.test(
      String((value as Record<string, unknown>).observationId),
    )
    ? String((value as Record<string, unknown>).observationId)
    : undefined;
}

function linkedObservationIssue(
  id: string,
  invalid: boolean,
): LocatorReviewValidationIssue {
  return invalid
    ? createLocatorReviewValidationIssue(
        "REVIEW_OBSERVATION_INVALID",
        "observation-link",
        "$.observationId",
        `The linked pending observation ${id} is invalid and cannot be used for comparison.`,
        "Recollect the sanitized observation before validating its review.",
        { actualValue: id },
      )
    : createLocatorReviewValidationIssue(
        "REVIEW_OBSERVATION_NOT_FOUND",
        "observation-link",
        "$.observationId",
        `No pending observation exists for ${id}.`,
        "Restore or recollect the matching pending observation, then regenerate the review template.",
        { actualValue: id },
      );
}

export async function validateLocatorObservationReviewDirectories(
  options: LocatorReviewDirectoryValidationOptions,
): Promise<LocatorReviewDirectoryValidationResult> {
  const observations = await loadObservations(options.observationsDirectory);
  const reviewNames = (
    await readdir(options.reviewsDirectory).catch(() => [] as string[])
  )
    .filter((name) => name.endsWith(".review.json"))
    .sort();
  const files: LocatorReviewValidationFileResult[] = [];
  const counts = {
    reviewed: 0,
    pending: 0,
    rejected: 0,
    needsMoreEvidence: 0,
  };

  for (const name of reviewNames) {
    const path = resolve(options.reviewsDirectory, name);
    const normalizedPath = relativePath(options.repositoryRoot, path);
    const filenameId = REVIEW_FILE.exec(name)?.[1];
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      files.push(
        Object.freeze({
          path: normalizedPath,
          valid: false,
          issues: Object.freeze([
            createLocatorReviewValidationIssue(
              "REVIEW_FILE_READ_FAILED",
              "schema",
              "$",
              "The review file could not be read.",
              "Check that the file exists and is readable, then rerun validation.",
            ),
          ]),
        }),
      );
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      files.push(
        Object.freeze({
          path: normalizedPath,
          ...(filenameId === undefined ? {} : { observationId: filenameId }),
          valid: false,
          issues: Object.freeze([jsonIssue(error, source)]),
        }),
      );
      continue;
    }

    const parsedId = safeObservationId(parsed);
    const issues: LocatorReviewValidationIssue[] = [];
    if (
      filenameId !== undefined &&
      parsedId !== undefined &&
      filenameId !== parsedId
    ) {
      issues.push(
        createLocatorReviewValidationIssue(
          "REVIEW_FILENAME_ID_MISMATCH",
          "observation-link",
          "$.observationId",
          `The review filename identifies ${filenameId}, but observationId identifies ${parsedId}.`,
          "Rename or regenerate the review so its filename and observationId identify the same pending observation.",
          { actualValue: parsedId },
        ),
      );
    }
    const linkId = filenameId ?? parsedId;
    const observation =
      linkId === undefined ? undefined : observations.valid.get(linkId);
    if (linkId !== undefined && observation === undefined) {
      issues.push(
        linkedObservationIssue(linkId, observations.invalid.has(linkId)),
      );
    }
    const inspected = inspectLocatorObservationReview(parsed, observation);
    issues.push(...inspected.issues);
    const ordered = orderLocatorReviewValidationIssues(issues);
    if (ordered.length > 0 || inspected.review === undefined) {
      const displayId = parsedId ?? filenameId;
      files.push(
        Object.freeze({
          path: normalizedPath,
          ...(displayId === undefined ? {} : { observationId: displayId }),
          valid: false,
          issues: ordered,
        }),
      );
      continue;
    }
    const status = inspected.review.reviewStatus;
    if (status === "needs-more-evidence") counts.needsMoreEvidence += 1;
    else counts[status] += 1;
    files.push(
      Object.freeze({
        path: normalizedPath,
        observationId: inspected.review.observationId,
        valid: true,
        reviewStatus: status,
        issues: Object.freeze([]),
      }),
    );
  }

  const invalid = files.filter(({ valid }) => !valid).length;
  const issueCount = files.reduce(
    (total, file) => total + file.issues.length,
    0,
  );
  return Object.freeze({
    status: invalid === 0 ? "pass" : "fail",
    summary: Object.freeze({
      ...counts,
      invalid,
      issues: issueCount,
    }),
    files: Object.freeze(files),
  });
}

function renderActual(value: LocatorReviewSafeActualValue): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? value.length === 0
        ? "[]"
        : value.join(", ")
      : typeof value === "string"
        ? value
        : String(value);
}

export function renderLocatorReviewValidationHuman(
  result: LocatorReviewDirectoryValidationResult,
): string {
  const lines: string[] = [];
  if (result.status === "fail") {
    lines.push("Observation review validation failed", "");
    for (const file of result.files.filter(({ valid }) => !valid)) {
      lines.push("File:", file.path, "");
      if (file.observationId !== undefined)
        lines.push("Observation:", file.observationId, "");
      file.issues.forEach((entry, index) => {
        lines.push(
          `Issue ${String(index + 1)}`,
          `Code: ${entry.code}`,
          `Category: ${entry.category}`,
          `Field: ${entry.fieldPath}`,
          `Problem: ${entry.message}`,
        );
        if (entry.line !== undefined && entry.column !== undefined)
          lines.push(
            `Location: line ${String(entry.line)}, column ${String(entry.column)}`,
          );
        if (entry.actualValue !== undefined)
          lines.push(`Actual: ${renderActual(entry.actualValue)}`);
        if (entry.allowedValues !== undefined)
          lines.push(`Allowed: ${entry.allowedValues.join(", ")}`);
        lines.push(`Fix: ${entry.suggestion}`, "");
      });
    }
  }
  const summary = result.summary;
  lines.push(
    `Observation reviews: ${result.status.toUpperCase()} | reviewed ${String(summary.reviewed)} | pending ${String(summary.pending)} | rejected ${String(summary.rejected)} | needs more evidence ${String(summary.needsMoreEvidence)} | invalid ${String(summary.invalid)} | issues ${String(summary.issues)}`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderLocatorReviewValidationJson(
  result: LocatorReviewDirectoryValidationResult,
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function locatorReviewValidationExitCode(
  result: LocatorReviewDirectoryValidationResult,
): 0 | 1 {
  return result.status === "pass" ? 0 : 1;
}
