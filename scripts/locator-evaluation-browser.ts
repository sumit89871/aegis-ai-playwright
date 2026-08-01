import { chromium, firefox, webkit } from "@playwright/test";

import {
  collectLocatorCandidates,
  defaultLocatorDiagnosisConfiguration,
  diagnoseLocatorFailure,
  emptyCandidateInventory,
  inferLocatorTargetIntent,
} from "@aegis/core";
import type { LocatorDiagnosisReport } from "@aegis/core";

const browserName =
  process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--browser="))
    ?.split("=")[1] ?? "chromium";
const browserTypes = { chromium, firefox, webkit } as const;
if (!(browserName in browserTypes))
  throw new Error(`Unsupported browser '${browserName}'.`);
const browserType = browserTypes[browserName as keyof typeof browserTypes];
const browser = await browserType.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.setContent(`
    <main aria-label="Evaluation surface">
      <button aria-label="Save changes">Save</button>
      <button data-testid="publish-action">Publish</button>
      <a href="#one">Details</a><a href="#two">Details</a><a href="#account" aria-label="Account details">Details</a>
      <button disabled aria-label="Continue">Continue</button>
      <div role="dialog" aria-label="Overlay"><button aria-label="Blocked action">Blocked</button></div>
      <label for="email">Email address</label><input id="email" type="email">
      <button hidden aria-label="Hidden action">Hidden</button>
    </main>
  `);
  const before = Object.freeze({
    elementCount: await page.locator("main *").count(),
    rootLabel: await page.locator("main").getAttribute("aria-label"),
  });
  async function diagnose(
    message: string,
    options: { readonly hidden?: boolean; readonly empty?: boolean } = {},
  ): Promise<LocatorDiagnosisReport> {
    const intent = inferLocatorTargetIntent(message);
    const inventory = options.empty
      ? emptyCandidateInventory(intent, "not-requested")
      : await collectLocatorCandidates(page, intent, {
          maximumCandidates: 30,
          maximumCandidateTextLength: 120,
          includeHiddenCandidates: options.hidden ?? false,
          includeDisabledCandidates: true,
        });
    return diagnoseLocatorFailure({
      evidence: {
        errorMessage: message,
        pageReady: true,
        pageAvailable: true,
      },
      candidateInventory: inventory,
      configuration: defaultLocatorDiagnosisConfiguration(),
    });
  }
  const cases = [
    [
      "browser-no-match-role",
      await diagnose(
        "click getByRole('button', { name: 'Save' }) resolved to no elements",
      ),
      "selector-no-match",
      "candidates-available",
    ],
    [
      "browser-duplicate-text",
      await diagnose(
        "click getByText('Details') strict mode violation: resolved to 2 elements",
      ),
      "strict-mode-violation",
      "candidates-available",
    ],
    [
      "browser-disabled",
      await diagnose(
        "click getByRole('button', { name: 'Continue' }) element is not enabled",
      ),
      "element-not-enabled",
      "no-change-recommended",
    ],
    [
      "browser-obstructed",
      await diagnose(
        "click getByRole('button', { name: 'Blocked action' }) overlay intercepts pointer events",
      ),
      "action-obstructed",
      "no-change-recommended",
    ],
    [
      "browser-label",
      await diagnose("fill locator('.old-email') resolved to no elements"),
      "selector-no-match",
      "candidates-available",
    ],
    [
      "browser-testid",
      await diagnose("click locator('.old-publish') resolved to no elements"),
      "selector-no-match",
      "candidates-available",
    ],
    [
      "browser-hidden",
      await diagnose(
        "click getByRole('button', { name: 'Hidden action' }) element is not visible",
        { hidden: true },
      ),
      "element-not-visible",
      "no-change-recommended",
    ],
    [
      "browser-empty-inventory",
      await diagnose("click getByTestId('removed') resolved to no elements", {
        empty: true,
      }),
      "selector-no-match",
      "insufficient-evidence",
    ],
  ] as const;
  const failures = cases.filter(
    ([, report, classification, recommendation]) =>
      report.conclusion.classification !== classification ||
      report.conclusion.recommendationStatus !== recommendation,
  );
  const serialized = JSON.stringify(cases);
  const after = Object.freeze({
    elementCount: await page.locator("main *").count(),
    rootLabel: await page.locator("main").getAttribute("aria-label"),
  });
  const pageUnchanged = JSON.stringify(before) === JSON.stringify(after);
  const result = Object.freeze({
    status:
      failures.length === 0 &&
      pageUnchanged &&
      !/(?:innerHTML|outerHTML|input-value|password-value)/iu.test(serialized)
        ? "pass"
        : "fail",
    browser: browserName,
    cases: cases.length,
    passed: cases.length - failures.length,
    failedCaseIds: failures.map(([caseId]) => caseId),
    pageUnchanged,
    inputValuesRetained: false,
    fullHtmlRetained: false,
    networkCalls: 0,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "pass") process.exitCode = 1;
} finally {
  await page.close();
  await context.close();
  await browser.close();
}
