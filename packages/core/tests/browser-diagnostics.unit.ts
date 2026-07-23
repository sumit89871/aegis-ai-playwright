import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BoundedBuffer } from "../src/diagnostics/bounded-buffer.ts";
import {
  BrowserDiagnosticsCollector,
  createDiagnosticSummary,
} from "../src/diagnostics/browser-diagnostics.ts";
import { truncateText } from "../src/diagnostics/redaction.ts";

await describe("bounded diagnostic collection", async () => {
  await it("enforces the entry limit and counts dropped entries", () => {
    const buffer = new BoundedBuffer<{ readonly message: string }>(2);

    buffer.add({ message: "first" });
    buffer.add({ message: "second" });
    buffer.add({ message: "dropped" });

    assert.equal(buffer.count, 2);
    assert.equal(buffer.droppedEntries, 1);
    assert.deepEqual(buffer.toArray(), [
      { message: "first" },
      { message: "second" },
    ]);
  });

  await it("truncates oversized diagnostic messages", () => {
    const truncated = truncateText("x".repeat(200), 48);

    assert.equal(truncated.length, 48);
    assert.match(truncated, /\[truncated\]$/);
  });

  await it("stores JSON-serializable records", () => {
    const buffer = new BoundedBuffer<{
      readonly timestamp: string;
      readonly values: readonly number[];
    }>(1);
    buffer.add({ timestamp: "2026-01-01T00:00:00.000Z", values: [1, 2] });

    assert.doesNotThrow(() => JSON.stringify(buffer.toArray()));
    assert.equal(
      JSON.stringify(buffer.toArray()),
      '[{"timestamp":"2026-01-01T00:00:00.000Z","values":[1,2]}]',
    );
  });
});

await describe("diagnostic summary", async () => {
  await it("reports deterministic timestamps, counts, and dropped counts", () => {
    const summary = createDiagnosticSummary({
      collectionStartedAt: "2026-01-01T00:00:00.000Z",
      collectionEndedAt: "2026-01-01T00:00:05.000Z",
      counts: {
        browserConsoleErrors: 2,
        pageErrors: 1,
        failedRequests: 3,
        httpErrorResponses: 4,
      },
      droppedEntries: {
        browserConsoleErrors: 5,
        pageErrors: 6,
        failedRequests: 7,
        httpErrorResponses: 8,
      },
      internalErrorCount: 0,
    });

    assert.deepEqual(summary, {
      collectionStartedAt: "2026-01-01T00:00:00.000Z",
      collectionEndedAt: "2026-01-01T00:00:05.000Z",
      counts: {
        browserConsoleErrors: 2,
        pageErrors: 1,
        failedRequests: 3,
        httpErrorResponses: 4,
      },
      droppedEntries: {
        browserConsoleErrors: 5,
        pageErrors: 6,
        failedRequests: 7,
        httpErrorResponses: 8,
      },
      internalErrorCount: 0,
    });
  });

  await it("disposes idempotently without a live browser", () => {
    const times = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:01.000Z"),
    ] as const;
    let timeIndex = 0;
    const collector = new BrowserDiagnosticsCollector({
      now: (): Date =>
        times[Math.min(timeIndex++, times.length - 1)] ?? times[1],
    });

    collector.dispose();
    collector.dispose();

    assert.equal(
      collector.snapshot().summary.collectionEndedAt,
      "2026-01-01T00:00:01.000Z",
    );
  });
});
