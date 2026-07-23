import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  failureEvidenceIds,
  normalizeFailureEvidence,
  sanitizeFailureEvidenceText,
} from "../src/index.ts";
import type {
  AccessibilityScanResult,
  BrowserDiagnosticsSnapshot,
  FailureEvidenceInput,
} from "../src/index.ts";

const syntheticWindowsPath = ["C:", "Users", "person", "repo", "test.ts"].join(
  "\\",
);

const diagnostics: BrowserDiagnosticsSnapshot = Object.freeze({
  browserConsoleErrors: Object.freeze([
    Object.freeze({
      timestamp: "2026-01-01T00:00:00.000Z",
      pageUrl: "https://example.test/page?token=secret",
      messageType: "error" as const,
      text: "console failed",
    }),
  ]),
  pageErrors: Object.freeze([
    Object.freeze({
      timestamp: "2026-01-01T00:00:01.000Z",
      pageUrl: "https://example.test/page",
      errorName: "TypeError",
      message: "page failed",
      stack: `TypeError: page failed\n at ${syntheticWindowsPath}:1:1`,
    }),
  ]),
  failedRequests: Object.freeze([
    Object.freeze({
      timestamp: "2026-01-01T00:00:02.000Z",
      method: "GET",
      url: "https://example.test/api?api_key=secret",
      resourceType: "fetch",
      failureText: "connection refused",
    }),
    Object.freeze({
      timestamp: "2026-01-01T00:00:03.000Z",
      method: "GET",
      url: "https://example.test/api?api_key=secret",
      resourceType: "fetch",
      failureText: "connection refused",
    }),
  ]),
  httpErrorResponses: Object.freeze([
    Object.freeze({
      timestamp: "2026-01-01T00:00:04.000Z",
      method: "POST",
      url: "https://example.test/action",
      status: 500,
      statusText: "Server Error",
      resourceType: "xhr",
    }),
  ]),
  summary: Object.freeze({
    collectionStartedAt: "2026-01-01T00:00:00.000Z",
    collectionEndedAt: "2026-01-01T00:00:05.000Z",
    counts: Object.freeze({
      browserConsoleErrors: 1,
      pageErrors: 1,
      failedRequests: 2,
      httpErrorResponses: 1,
    }),
    droppedEntries: Object.freeze({
      browserConsoleErrors: 1,
      pageErrors: 0,
      failedRequests: 2,
      httpErrorResponses: 0,
    }),
    internalErrorCount: 0,
  }),
});

const accessibility: AccessibilityScanResult = Object.freeze({
  status: "fail",
  targetUrl: "https://example.test/",
  policy: Object.freeze({
    critical: "fail",
    serious: "fail",
    moderate: "warn",
    minor: "info",
  }),
  exclusionsApplied: Object.freeze([]),
  summary: Object.freeze({
    status: "fail",
    totalViolationCount: 1,
    retainedViolationCount: 1,
    droppedViolationCount: 2,
    excludedViolationCount: 0,
    failingViolationCount: 1,
    warningViolationCount: 0,
    informationalViolationCount: 0,
    violationsByImpact: Object.freeze({
      critical: 0,
      serious: 1,
      moderate: 0,
      minor: 0,
    }),
    retainedNodeCount: 1,
    droppedNodeCount: 14,
    durationMs: 12,
  }),
  violations: Object.freeze([
    Object.freeze({
      ruleId: "color-contrast",
      impact: "serious" as const,
      action: "fail" as const,
      help: "Elements must meet contrast thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/color-contrast",
      affectedNodeCount: 15,
      retainedNodeCount: 1,
      droppedNodeCount: 14,
      nodes: Object.freeze([]),
    }),
  ]),
});

function input(): FailureEvidenceInput {
  return {
    test: {
      testId: "TC-SYNTHETIC-001",
      title: "Synthetic test",
      feature: "synthetic-ui",
      suite: "smoke",
      risk: "high",
      layer: "ui",
      requirementIds: ["REQ-SYNTHETIC-001"],
      tags: ["@smoke"],
      projectName: "chromium",
      browserName: "chromium",
      expectedStatus: "passed",
      actualStatus: "failed",
      retry: 0,
      durationMs: 123,
    },
    error: {
      name: "Error",
      message: "Expected true but got false",
      stack: `Error: mismatch\n at ${syntheticWindowsPath}:2:3`,
    },
    readiness: {
      status: "fail",
      definitionId: "synthetic-page",
      durationMs: 100,
      error: "heading was not visible",
    },
    browserDiagnostics: diagnostics,
    accessibility,
    availableAttachments: [
      "trace",
      "diagnostic-summary.json",
      "unknown-private.txt",
    ],
  };
}

await describe("failure evidence normalization", async () => {
  await it("normalizes metadata and assigns stable category IDs", () => {
    const evidence = normalizeFailureEvidence(input());
    assert.deepEqual(failureEvidenceIds(evidence), [
      "METADATA-001",
      "ASSERTION-001",
      "READINESS-001",
      "CONSOLE-001",
      "PAGEERROR-001",
      "REQUEST-001",
      "HTTP-001",
      "A11Y-001",
    ]);
    assert.equal(evidence.test.testId, "TC-SYNTHETIC-001");
  });

  await it("redacts URL secrets and removes absolute local paths", () => {
    const serialized = JSON.stringify(normalizeFailureEvidence(input()));
    assert.doesNotMatch(serialized, /secret|C:\\\\Users|person\\\\repo/iu);
    assert.match(serialized, /%5BREDACTED%5D/u);
    assert.match(serialized, /\[LOCAL_PATH\]/u);
  });

  await it("deduplicates equivalent failed requests deterministically", () => {
    const evidence = normalizeFailureEvidence(input());
    assert.equal(evidence.counts.retained["failed-request"], 1);
    assert.equal(evidence.counts.dropped["failed-request"], 3);
  });

  await it("preserves collector and accessibility dropped counts", () => {
    const evidence = normalizeFailureEvidence(input());
    assert.equal(evidence.counts.dropped.console, 1);
    assert.equal(evidence.counts.dropped.accessibility, 2);
  });

  await it("bounds entries and text", () => {
    const value = input();
    const consoleError = diagnostics.browserConsoleErrors[0];
    assert.ok(consoleError !== undefined);
    const evidence = normalizeFailureEvidence(
      {
        ...value,
        browserDiagnostics: {
          ...diagnostics,
          browserConsoleErrors: [
            ...diagnostics.browserConsoleErrors,
            {
              ...consoleError,
              text: "x".repeat(2_000),
            },
          ],
        },
      },
      { maximumEntriesPerCategory: 1, maximumTextLength: 80 },
    );
    assert.equal(evidence.counts.retained.console, 1);
    assert.equal(evidence.counts.dropped.console, 2);
    assert.ok(evidence.records.every((record) => record.summary.length <= 80));
  });

  await it("records unavailable evidence categories", () => {
    const evidence = normalizeFailureEvidence({
      test: { title: "Minimal failure" },
    });
    assert.ok(evidence.unavailableCategories.includes("assertion"));
    assert.ok(evidence.unavailableCategories.includes("accessibility"));
    assert.ok(evidence.unavailableCategories.includes("failed-request"));
  });

  await it("retains only approved attachment availability names", () => {
    const evidence = normalizeFailureEvidence(input());
    assert.deepEqual(evidence.availableAttachments, [
      "diagnostic-summary.json",
      "trace",
    ]);
  });

  await it("does not mutate source evidence", () => {
    const source = input();
    const before = structuredClone(source);
    normalizeFailureEvidence(source);
    assert.deepEqual(source, before);
  });

  await it("produces JSON serializable deterministic output", () => {
    const first = normalizeFailureEvidence(input());
    const second = normalizeFailureEvidence(input());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  });

  await it("sanitizes standalone evidence text", () => {
    assert.equal(
      sanitizeFailureEvidenceText(
        `at ${["C:", "Users", "person", "secret", "file.ts"].join("\\")}`,
      ),
      "at [LOCAL_PATH]",
    );
  });

  await it("rejects an empty test title", () => {
    assert.throws(
      () => normalizeFailureEvidence({ test: { title: " " } }),
      /title must not be empty/u,
    );
  });
});
