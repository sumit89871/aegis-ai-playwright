import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLocatorFailure,
  inferLocatorTargetIntent,
} from "../src/index.ts";

await describe("locator failure classification", async () => {
  for (const [message, expected] of [
    ["locator('button.old') resolved to no elements", "selector-no-match"],
    [
      "locator('button') resolved to multiple elements",
      "selector-multiple-match",
    ],
    [
      "strict mode violation: getByText('Save') resolved to 2 elements",
      "strict-mode-violation",
    ],
    ["locator('button') element is not visible", "element-not-visible"],
    ["locator('button') element is not enabled", "element-not-enabled"],
    ["locator('input') element is not editable", "element-not-editable"],
    ["locator('button') element was detached from the DOM", "element-detached"],
    ["locator('button') element is not stable", "element-not-stable"],
    ["locator('button') intercepts pointer events", "action-obstructed"],
    ["Target page, context or browser has been closed", "page-closed"],
    [
      "Page readiness failed for product-page: heading unavailable",
      "page-not-ready",
    ],
    [
      "expect(locator).toBeVisible locator assertion timeout",
      "assertion-locator-failure",
    ],
    [
      "Timeout 10000ms exceeded while waiting for getByRole('button')",
      "selector-no-match",
    ],
    ["click locator failed with timeout while waiting", "selector-no-match"],
    ["Accessibility color-contrast violation", "not-a-locator-failure"],
    ["Expected value 2 but received: 3", "not-a-locator-failure"],
    [
      "An unusual locator transport condition occurred",
      "unknown-locator-failure",
    ],
  ] as const) {
    await it(`classifies ${expected}`, () => {
      assert.equal(classifyLocatorFailure(message).classification, expected);
    });
  }

  await it("does not collect candidates for state failures", () => {
    assert.equal(
      classifyLocatorFailure("locator('button') element is disabled")
        .collectCandidates,
      false,
    );
  });

  await it("infers controlled role intent", () => {
    assert.deepEqual(
      inferLocatorTargetIntent("click getByRole('button', { name: 'Save' })"),
      {
        operation: "click",
        strategy: "role",
        role: "button",
        name: "Save",
        locatorDescription: 'getByRole("button", { name: "Save" })',
      },
    );
  });

  await it("infers test ID without inventing business intent", () => {
    const intent = inferLocatorTargetIntent(
      "waiting for getByTestId('submit-order')",
    );
    assert.equal(intent.strategy, "test-id");
    assert.equal(intent.value, "submit-order");
    assert.equal(intent.operation, "unknown");
  });
});
