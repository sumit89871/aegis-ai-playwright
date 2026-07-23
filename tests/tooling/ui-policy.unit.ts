import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  scanUiPolicy,
  uiPolicyExitCode,
} from "../../scripts/ui-policy/ui-policy-scanner.ts";
import type { UiPolicyReport } from "../../scripts/ui-policy/ui-policy-scanner.ts";

function scan(
  sourceText: string,
  path = "examples/sample/src/page.ts",
): UiPolicyReport {
  return scanUiPolicy([{ path, sourceText }]);
}

function rules(sourceText: string, path?: string): readonly string[] {
  return scan(sourceText, path).findings.map((finding) => finding.ruleId);
}

await describe("UI policy scanner", async () => {
  await it("detects fixed browser sleeps", () => {
    assert.ok(
      rules("await page.waitForTimeout(1000);").includes("no-wait-for-timeout"),
    );
  });

  await it("detects XPath locators", () => {
    assert.ok(
      rules('page.locator("xpath=//button");').includes("no-xpath-locator"),
    );
  });

  await it("detects forced actions", () => {
    assert.ok(
      rules("await button.click({ force: true });").includes(
        "review-force-action",
      ),
    );
  });

  await it("detects positional locator selection", () => {
    assert.ok(
      rules('page.locator("li").nth(2);').includes("review-positional-locator"),
    );
  });

  await it("detects raw selectors in Playwright specifications", () => {
    assert.ok(
      rules(
        'test("example", async ({ page }) => page.locator(".button").click());',
        "examples/sample/tests/smoke/example.spec.ts",
      ).includes("no-raw-selector-in-test"),
    );
  });

  await it("reports browser operations in unit tests", () => {
    assert.ok(
      rules(
        'await page.goto("data:text/html,ok");',
        "examples/sample/tests/unit/browser.unit.ts",
      ).includes("no-browser-ops-in-unit-tests"),
    );
  });

  await it("ignores dependencies and generated output", () => {
    const report = scanUiPolicy([
      {
        path: "node_modules/package/failing.ts",
        sourceText: "page.waitForTimeout(1);",
      },
      {
        path: "examples/sample/test-results/failing.ts",
        sourceText: "page.waitForTimeout(1);",
      },
    ]);
    assert.equal(report.summary.filesScanned, 0);
    assert.equal(report.findings.length, 0);
  });

  await it("normalizes Windows paths", () => {
    const report = scan(
      "const value = true;",
      "examples\\sample\\src\\page.ts",
    );
    assert.equal(report.summary.filesScanned, 1);
    assert.equal(report.findings[0]?.file, undefined);
    assert.doesNotMatch(JSON.stringify(report), /\\\\/u);
  });

  await it("orders findings deterministically", () => {
    const files = [
      { path: "z.ts", sourceText: "page.waitForTimeout(1);" },
      { path: "a.ts", sourceText: 'page.locator("//button");' },
    ];
    assert.equal(
      JSON.stringify(scanUiPolicy(files)),
      JSON.stringify(scanUiPolicy([...files].reverse())),
    );
  });

  await it("supports a narrow reasoned suppression", () => {
    const report = scan(
      '// aegis-ui-policy-disable-next-line review-locator -- stable scoped application shell\npage.locator(".shell");',
    );
    assert.equal(
      report.findings.some((finding) => finding.ruleId === "review-locator"),
      false,
    );
    assert.equal(report.suppressions[0]?.used, true);
  });

  await it("rejects a suppression without a reason", () => {
    assert.ok(
      rules(
        '// aegis-ui-policy-disable-next-line review-locator\npage.locator(".shell");',
      ).includes("invalid-ui-policy-suppression"),
    );
  });

  await it("rejects an unknown suppression rule", () => {
    assert.ok(
      rules(
        "// aegis-ui-policy-disable-next-line invented-rule -- not valid\nconst value = true;",
      ).includes("invalid-ui-policy-suppression"),
    );
  });

  await it("returns JSON-serializable deterministic data", () => {
    const report = scan('page.getByText("Continue");');
    assert.doesNotThrow(() => JSON.stringify(report));
    assert.equal(report.findings[0]?.ruleId, "review-get-by-text");
  });

  await it("fails only when a high-severity finding remains", () => {
    assert.equal(uiPolicyExitCode(scan('page.locator(".stable");')), 0);
    assert.equal(uiPolicyExitCode(scan("page.waitForTimeout(1);")), 1);
  });
});
