import type { BrowserDiagnosticsSnapshot } from "../diagnostics/browser-diagnostics.ts";
import {
  redactSensitiveText,
  sanitizeUrl,
  truncateText,
} from "../diagnostics/redaction.ts";
import type {
  AccessibilityScanResult,
  PageReadinessFailureDetails,
  PageReadinessResult,
} from "../ui/index.ts";

export const FAILURE_EVIDENCE_CATEGORIES = [
  "metadata",
  "assertion",
  "readiness",
  "console",
  "page-error",
  "failed-request",
  "http-response",
  "accessibility",
] as const;
export type FailureEvidenceCategory =
  (typeof FAILURE_EVIDENCE_CATEGORIES)[number];

export interface FailureTestContextInput {
  readonly testId?: string;
  readonly title: string;
  readonly feature?: string;
  readonly suite?: string;
  readonly risk?: string;
  readonly layer?: string;
  readonly requirementIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly projectName?: string;
  readonly browserName?: string;
  readonly expectedStatus?: string;
  readonly actualStatus?: string;
  readonly retry?: number;
  readonly durationMs?: number;
}

export interface FailureErrorInput {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface FailureEvidenceInput {
  readonly test: FailureTestContextInput;
  readonly error?: FailureErrorInput;
  readonly readiness?: PageReadinessResult | PageReadinessFailureDetails;
  readonly browserDiagnostics?: BrowserDiagnosticsSnapshot;
  readonly accessibility?: AccessibilityScanResult;
  readonly uiPolicyContext?: {
    readonly status: string;
    readonly highSeverityFindings: number;
    readonly mediumSeverityFindings: number;
  };
  readonly availableAttachments?: readonly string[];
}

export interface NormalizedFailureTestContext {
  readonly title: string;
  readonly testId?: string;
  readonly feature?: string;
  readonly suite?: string;
  readonly risk?: string;
  readonly layer?: string;
  readonly requirementIds: readonly string[];
  readonly tags: readonly string[];
  readonly projectName?: string;
  readonly browserName?: string;
  readonly expectedStatus?: string;
  readonly actualStatus?: string;
  readonly retry?: number;
  readonly durationMs?: number;
}

export interface FailureEvidenceRecord {
  readonly id: string;
  readonly category: FailureEvidenceCategory;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface FailureEvidenceCounts {
  readonly retained: Readonly<Record<FailureEvidenceCategory, number>>;
  readonly dropped: Readonly<Record<FailureEvidenceCategory, number>>;
}

export interface FailureEvidence {
  readonly test: NormalizedFailureTestContext;
  readonly records: readonly FailureEvidenceRecord[];
  readonly counts: FailureEvidenceCounts;
  readonly unavailableCategories: readonly FailureEvidenceCategory[];
  readonly availableAttachments: readonly string[];
}

export interface FailureEvidenceLimits {
  readonly maximumEntriesPerCategory: number;
  readonly maximumTextLength: number;
  readonly maximumStackFrames: number;
  readonly maximumUrlLength: number;
}

const DEFAULT_LIMITS: FailureEvidenceLimits = Object.freeze({
  maximumEntriesPerCategory: 25,
  maximumTextLength: 1_000,
  maximumStackFrames: 12,
  maximumUrlLength: 1_024,
});

const PREFIXES: Readonly<Record<FailureEvidenceCategory, string>> =
  Object.freeze({
    metadata: "METADATA",
    assertion: "ASSERTION",
    readiness: "READINESS",
    console: "CONSOLE",
    "page-error": "PAGEERROR",
    "failed-request": "REQUEST",
    "http-response": "HTTP",
    accessibility: "A11Y",
  });
const SAFE_ATTACHMENT_NAMES = new Set([
  "browser-console-errors.json",
  "page-errors.json",
  "failed-requests.json",
  "http-error-responses.json",
  "diagnostic-summary.json",
  "test-context.json",
  "accessibility-summary.json",
  "accessibility-violations.json",
  "screenshot",
  "video",
  "trace",
]);
const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\s\n\r"']+/gu;
const UNIX_USER_PATH = /\/(?:Users|home)\/[^\s\n\r"']+/gu;

function validateLimits(
  input: Partial<FailureEvidenceLimits>,
): FailureEvidenceLimits {
  const merged = { ...DEFAULT_LIMITS, ...input };
  for (const [field, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 1 || value > 10_000) {
      throw new Error(`${field} must be an integer between 1 and 10000.`);
    }
  }
  return Object.freeze(merged);
}

export function sanitizeFailureEvidenceText(
  value: string,
  maximumLength = DEFAULT_LIMITS.maximumTextLength,
): string {
  return truncateText(
    redactSensitiveText(value, maximumLength * 2)
      .replace(WINDOWS_PATH, "[LOCAL_PATH]")
      .replace(UNIX_USER_PATH, "[LOCAL_PATH]"),
    maximumLength,
  );
}

function safeText(value: unknown, maximum: number): string {
  const text =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : "";
  return sanitizeFailureEvidenceText(text, maximum);
}

function safeStringArray(
  values: readonly string[] | undefined,
  maximum: number,
): readonly string[] {
  return Object.freeze(
    [
      ...new Set((values ?? []).map((value) => safeText(value, maximum))),
    ].sort(),
  );
}

function safeNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.max(0, value);
}

function sortKey(record: Omit<FailureEvidenceRecord, "id">): string {
  return `${record.category}\u0000${record.summary}\u0000${JSON.stringify(record.details)}`;
}

function createRecords(
  category: FailureEvidenceCategory,
  candidates: readonly Omit<FailureEvidenceRecord, "id" | "category">[],
  limit: number,
): {
  readonly records: readonly FailureEvidenceRecord[];
  readonly dropped: number;
} {
  const unique = new Map<string, Omit<FailureEvidenceRecord, "id">>();
  for (const candidate of candidates) {
    const record = { category, ...candidate } as const;
    unique.set(sortKey(record), record);
  }
  const ordered = [...unique.values()].sort((left, right) =>
    sortKey(left).localeCompare(sortKey(right)),
  );
  const retained = ordered.slice(0, limit).map((record, index) =>
    Object.freeze({
      id: `${PREFIXES[category]}-${String(index + 1).padStart(3, "0")}`,
      ...record,
    }),
  );
  return Object.freeze({
    records: Object.freeze(retained),
    dropped: candidates.length - retained.length,
  });
}

function stackFrames(
  stack: string | undefined,
  limits: FailureEvidenceLimits,
): readonly string[] {
  return Object.freeze(
    (stack ?? "")
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .slice(0, limits.maximumStackFrames)
      .map((line) => safeText(line.trim(), limits.maximumTextLength)),
  );
}

export function normalizeFailureEvidence(
  input: FailureEvidenceInput,
  limitsInput: Partial<FailureEvidenceLimits> = {},
): FailureEvidence {
  const limits = validateLimits(limitsInput);
  if (input.test.title.trim().length === 0) {
    throw new Error("Failure evidence test title must not be empty.");
  }
  const retry = safeNumber(input.test.retry);
  const durationMs = safeNumber(input.test.durationMs);
  const test = Object.freeze({
    title: safeText(input.test.title, limits.maximumTextLength),
    ...(input.test.testId === undefined
      ? {}
      : { testId: safeText(input.test.testId, 100) }),
    ...(input.test.feature === undefined
      ? {}
      : { feature: safeText(input.test.feature, 100) }),
    ...(input.test.suite === undefined
      ? {}
      : { suite: safeText(input.test.suite, 50) }),
    ...(input.test.risk === undefined
      ? {}
      : { risk: safeText(input.test.risk, 50) }),
    ...(input.test.layer === undefined
      ? {}
      : { layer: safeText(input.test.layer, 50) }),
    requirementIds: safeStringArray(input.test.requirementIds, 100),
    tags: safeStringArray(input.test.tags, 100),
    ...(input.test.projectName === undefined
      ? {}
      : { projectName: safeText(input.test.projectName, 100) }),
    ...(input.test.browserName === undefined
      ? {}
      : { browserName: safeText(input.test.browserName, 50) }),
    ...(input.test.expectedStatus === undefined
      ? {}
      : { expectedStatus: safeText(input.test.expectedStatus, 50) }),
    ...(input.test.actualStatus === undefined
      ? {}
      : { actualStatus: safeText(input.test.actualStatus, 50) }),
    ...(retry === undefined ? {} : { retry }),
    ...(durationMs === undefined ? {} : { durationMs }),
  });

  const byCategory = new Map<
    FailureEvidenceCategory,
    readonly Omit<FailureEvidenceRecord, "id" | "category">[]
  >();
  const uiPolicyContext = input.uiPolicyContext;
  byCategory.set("metadata", [
    {
      summary: `Test ${test.testId ?? "without a registered ID"}: ${test.title}`,
      details: Object.freeze({
        ...test,
        ...(uiPolicyContext === undefined
          ? {}
          : {
              uiPolicyContext: Object.freeze({
                status: safeText(uiPolicyContext.status, 50),
                highSeverityFindings: Math.max(
                  0,
                  uiPolicyContext.highSeverityFindings,
                ),
                mediumSeverityFindings: Math.max(
                  0,
                  uiPolicyContext.mediumSeverityFindings,
                ),
              }),
            }),
      }),
    },
  ]);
  byCategory.set(
    "assertion",
    input.error === undefined
      ? []
      : [
          {
            summary: safeText(input.error.message, limits.maximumTextLength),
            details: Object.freeze({
              name: safeText(input.error.name ?? "Error", 100),
              message: safeText(input.error.message, limits.maximumTextLength),
              stackFrames: stackFrames(input.error.stack, limits),
            }),
          },
        ],
  );
  byCategory.set(
    "readiness",
    input.readiness === undefined
      ? []
      : [
          {
            summary:
              input.readiness.status === "pass"
                ? `Page readiness ${input.readiness.definitionId} passed.`
                : `Page readiness ${input.readiness.definitionId} failed: ${safeText(input.readiness.error, limits.maximumTextLength)}`,
            details: Object.freeze(
              input.readiness.status === "pass"
                ? {
                    status: "pass",
                    definitionId: safeText(input.readiness.definitionId, 100),
                    durationMs: input.readiness.durationMs,
                    finalUrl: sanitizeUrl(
                      input.readiness.finalUrl,
                      limits.maximumUrlLength,
                    ),
                    title: safeText(
                      input.readiness.title,
                      limits.maximumTextLength,
                    ),
                    checks: input.readiness.checks.map((check) => ({
                      criterion: safeText(check.criterion, 100),
                      status: check.status,
                    })),
                  }
                : {
                    status: "fail",
                    definitionId: safeText(input.readiness.definitionId, 100),
                    durationMs: input.readiness.durationMs,
                    error: safeText(
                      input.readiness.error,
                      limits.maximumTextLength,
                    ),
                  },
            ),
          },
        ],
  );

  const diagnostics = input.browserDiagnostics;
  byCategory.set(
    "console",
    (diagnostics?.browserConsoleErrors ?? []).map((entry) => ({
      summary: safeText(entry.text, limits.maximumTextLength),
      details: Object.freeze({
        pageUrl: sanitizeUrl(entry.pageUrl, limits.maximumUrlLength),
        messageType: entry.messageType,
        text: safeText(entry.text, limits.maximumTextLength),
        ...(entry.sourceLocation === undefined
          ? {}
          : {
              sourceLocation: Object.freeze({
                url: sanitizeUrl(
                  entry.sourceLocation.url,
                  limits.maximumUrlLength,
                ),
                lineNumber: entry.sourceLocation.lineNumber,
                columnNumber: entry.sourceLocation.columnNumber,
              }),
            }),
      }),
    })),
  );
  byCategory.set(
    "page-error",
    (diagnostics?.pageErrors ?? []).map((entry) => ({
      summary: safeText(entry.message, limits.maximumTextLength),
      details: Object.freeze({
        pageUrl: sanitizeUrl(entry.pageUrl, limits.maximumUrlLength),
        errorName: safeText(entry.errorName, 100),
        message: safeText(entry.message, limits.maximumTextLength),
        stackFrames: stackFrames(entry.stack, limits),
      }),
    })),
  );
  byCategory.set(
    "failed-request",
    (diagnostics?.failedRequests ?? []).map((entry) => ({
      summary: `${entry.method} ${sanitizeUrl(entry.url, limits.maximumUrlLength)} failed: ${safeText(entry.failureText, limits.maximumTextLength)}`,
      details: Object.freeze({
        method: safeText(entry.method, 20),
        url: sanitizeUrl(entry.url, limits.maximumUrlLength),
        resourceType: safeText(entry.resourceType, 50),
        failureText: safeText(entry.failureText, limits.maximumTextLength),
      }),
    })),
  );
  byCategory.set(
    "http-response",
    (diagnostics?.httpErrorResponses ?? []).map((entry) => ({
      summary: `${entry.method} ${sanitizeUrl(entry.url, limits.maximumUrlLength)} returned ${String(entry.status)} ${safeText(entry.statusText, 100)}`,
      details: Object.freeze({
        method: safeText(entry.method, 20),
        url: sanitizeUrl(entry.url, limits.maximumUrlLength),
        status: entry.status,
        statusText: safeText(entry.statusText, 100),
        resourceType: safeText(entry.resourceType, 50),
      }),
    })),
  );
  byCategory.set(
    "accessibility",
    (input.accessibility?.violations ?? []).map((violation) => ({
      summary: `${violation.impact} accessibility rule ${violation.ruleId} affected ${String(violation.affectedNodeCount)} node(s).`,
      details: Object.freeze({
        ruleId: safeText(violation.ruleId, 100),
        impact: violation.impact,
        action: violation.action,
        help: safeText(violation.help, limits.maximumTextLength),
        helpUrl: sanitizeUrl(violation.helpUrl, limits.maximumUrlLength),
        affectedNodeCount: violation.affectedNodeCount,
        retainedNodeCount: violation.retainedNodeCount,
        droppedNodeCount: violation.droppedNodeCount,
      }),
    })),
  );

  const records: FailureEvidenceRecord[] = [];
  const retained = Object.fromEntries(
    FAILURE_EVIDENCE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<FailureEvidenceCategory, number>;
  const dropped = Object.fromEntries(
    FAILURE_EVIDENCE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<FailureEvidenceCategory, number>;
  for (const category of FAILURE_EVIDENCE_CATEGORIES) {
    const result = createRecords(
      category,
      byCategory.get(category) ?? [],
      limits.maximumEntriesPerCategory,
    );
    records.push(...result.records);
    retained[category] = result.records.length;
    dropped[category] = result.dropped;
  }
  if (diagnostics !== undefined) {
    dropped.console += diagnostics.summary.droppedEntries.browserConsoleErrors;
    dropped["page-error"] += diagnostics.summary.droppedEntries.pageErrors;
    dropped["failed-request"] +=
      diagnostics.summary.droppedEntries.failedRequests;
    dropped["http-response"] +=
      diagnostics.summary.droppedEntries.httpErrorResponses;
  }
  if (input.accessibility !== undefined) {
    dropped.accessibility += input.accessibility.summary.droppedViolationCount;
  }

  const unavailable = FAILURE_EVIDENCE_CATEGORIES.filter((category) => {
    if (category === "metadata") return false;
    if (category === "assertion") return input.error === undefined;
    if (category === "readiness") return input.readiness === undefined;
    if (category === "accessibility") return input.accessibility === undefined;
    return diagnostics === undefined;
  });
  const attachments = safeStringArray(
    (input.availableAttachments ?? []).filter((name) =>
      SAFE_ATTACHMENT_NAMES.has(name),
    ),
    100,
  );
  return Object.freeze({
    test,
    records: Object.freeze(records),
    counts: Object.freeze({
      retained: Object.freeze(retained),
      dropped: Object.freeze(dropped),
    }),
    unavailableCategories: Object.freeze(unavailable),
    availableAttachments: attachments,
  });
}

export function failureEvidenceIds(
  evidence: FailureEvidence,
): readonly string[] {
  return Object.freeze(evidence.records.map((record) => record.id));
}
