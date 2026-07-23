import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AccessibilityPolicyError,
  assertAccessibilityPolicy,
  processAccessibilityResults,
} from "../src/index.ts";
import type { RawAccessibilityViolation } from "../src/index.ts";

function violation(
  id: string,
  impact: "critical" | "serious" | "moderate" | "minor",
  nodes = 1,
): RawAccessibilityViolation {
  return {
    id,
    impact,
    help: `${id} help`,
    helpUrl: `https://example.test/rules/${id}`,
    nodes: Array.from({ length: nodes }, (_, index) => ({
      target: [`#target-${String(index)}`],
      html: '<input value="must-not-be-retained">',
      failureSummary: `Fix value="private-${String(index)}" token=secret-${String(index)}`,
    })),
  };
}

await describe("accessibility evidence processing", async () => {
  await it("classifies critical and serious violations as failures", () => {
    const result = processAccessibilityResults([
      violation("critical-rule", "critical"),
      violation("serious-rule", "serious"),
    ]);
    assert.equal(result.status, "fail");
    assert.equal(result.summary.failingViolationCount, 2);
    assert.throws(() => {
      assertAccessibilityPolicy(result);
    }, AccessibilityPolicyError);
  });

  await it("classifies moderate violations as warnings", () => {
    const result = processAccessibilityResults([
      violation("moderate-rule", "moderate"),
    ]);
    assert.equal(result.status, "pass");
    assert.equal(result.summary.warningViolationCount, 1);
  });

  await it("classifies minor violations as informational", () => {
    const result = processAccessibilityResults([
      violation("minor-rule", "minor"),
    ]);
    assert.equal(result.summary.informationalViolationCount, 1);
  });

  await it("requires reasoned rule exclusions", () => {
    assert.throws(
      () =>
        processAccessibilityResults([], {
          ruleExclusions: [{ ruleId: "label", reason: "", scope: "home" }],
        }),
      /reason/u,
    );
  });

  await it("records applied exclusions", () => {
    const result = processAccessibilityResults(
      [violation("label", "serious")],
      {
        ruleExclusions: [
          {
            ruleId: "label",
            reason: "Tracked application defect",
            scope: "home-page",
            issueReference: "ISSUE-123",
          },
        ],
      },
    );
    assert.equal(result.status, "pass");
    assert.equal(result.summary.excludedViolationCount, 1);
    assert.equal(result.exclusionsApplied[0]?.ruleId, "label");
  });

  await it("enforces node and violation limits", () => {
    const result = processAccessibilityResults(
      [violation("a-rule", "minor", 3), violation("b-rule", "minor", 2)],
      { limits: { maximumViolations: 1, maximumNodesPerViolation: 1 } },
    );
    assert.equal(result.summary.retainedViolationCount, 1);
    assert.equal(result.summary.droppedViolationCount, 1);
    assert.equal(result.summary.retainedNodeCount, 1);
    assert.equal(result.summary.droppedNodeCount, 2);
  });

  await it("truncates selectors and messages", () => {
    const result = processAccessibilityResults(
      [
        {
          ...violation("long-rule", "minor"),
          nodes: [
            {
              target: [`.${"x".repeat(200)}`],
              failureSummary: "m".repeat(200),
            },
          ],
        },
      ],
      { limits: { maximumSelectorLength: 40, maximumMessageLength: 50 } },
    );
    const node = result.violations[0]?.nodes[0];
    if (node === undefined) {
      throw new Error("Expected one retained accessibility node.");
    }
    assert.equal(node.target.length, 40);
    assert.equal(node.failureSummary.length, 50);
  });

  await it("does not retain HTML or sensitive input values", () => {
    const result = processAccessibilityResults([
      violation("sensitive-rule", "minor"),
    ]);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /must-not-be-retained|private-0|secret-0/u);
    assert.match(serialized, /\[REDACTED\]/u);
  });

  await it("orders violations deterministically", () => {
    const values = [
      violation("z-rule", "minor"),
      violation("a-rule", "moderate"),
    ];
    assert.equal(
      JSON.stringify(processAccessibilityResults(values)),
      JSON.stringify(processAccessibilityResults([...values].reverse())),
    );
  });

  await it("does not mutate engine input", () => {
    const input = [violation("immutable-rule", "minor")];
    const before = JSON.stringify(input);
    processAccessibilityResults(input);
    assert.equal(JSON.stringify(input), before);
  });

  await it("produces plain JSON-serializable output", () => {
    const result = processAccessibilityResults(
      [violation("json-rule", "minor")],
      { targetUrl: "https://example.test/?token=secret" },
    );
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result), /token=secret/u);
  });

  await it("supports deterministic policy overrides", () => {
    const result = processAccessibilityResults(
      [violation("moderate-rule", "moderate")],
      { policy: { moderate: "fail" }, durationMs: 25 },
    );
    assert.equal(result.status, "fail");
    assert.equal(result.summary.durationMs, 25);
  });
});
