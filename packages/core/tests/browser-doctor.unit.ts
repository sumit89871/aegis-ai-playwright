import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  browserDoctorExitCode,
  createBrowserDoctorResult,
  parseBrowserDoctorArguments,
  sanitizeBrowserDoctorError,
} from "../src/index.ts";
import type {
  BrowserDoctorBrowser,
  BrowserDoctorCheckResult,
} from "../src/index.ts";

function passingResult(
  browser: BrowserDoctorBrowser,
): BrowserDoctorCheckResult {
  return {
    browser,
    launch: "pass",
    context: "pass",
    page: "pass",
    navigation: "pass",
    status: "pass",
  };
}

await describe("browser doctor", async () => {
  await it("selects all browsers by default", () => {
    assert.deepEqual(parseBrowserDoctorArguments([]), {
      browser: "all",
      json: false,
    });
  });

  for (const browser of ["chromium", "firefox", "webkit", "all"] as const) {
    await it(`accepts the ${browser} selection`, () => {
      assert.equal(
        parseBrowserDoctorArguments([`--browser=${browser}`]).browser,
        browser,
      );
    });
  }

  await it("rejects an unsupported browser", () => {
    assert.throws(
      () => parseBrowserDoctorArguments(["--browser=edge"]),
      /Unsupported browser 'edge'/u,
    );
  });

  await it("serializes a JSON result without application URLs", () => {
    const result = createBrowserDoctorResult("chromium", [
      passingResult("chromium"),
    ]);
    const serialized = JSON.stringify(result);
    assert.deepEqual(JSON.parse(serialized), result);
    assert.doesNotMatch(serialized, /localhost|https?:\/\//iu);
  });

  await it("redacts browser-cache paths from bounded errors", () => {
    const sanitized = sanitizeBrowserDoctorError(
      "Executable missing at C:\\Users\\person\\AppData\\Local\\ms-playwright\\firefox.exe",
    );
    assert.equal(sanitized, "Executable missing at [LOCAL_PATH]");
    assert.doesNotMatch(sanitized, /Users|ms-playwright/u);
  });

  await it("summarizes only the selected browser", () => {
    const result = createBrowserDoctorResult("firefox", [
      passingResult("firefox"),
    ]);
    assert.deepEqual(result.summary, { passed: 1, failed: 0 });
    assert.deepEqual(
      result.browsers.map(({ browser }) => browser),
      ["firefox"],
    );
  });

  await it("uses failing exit semantics when a browser fails", () => {
    const result = createBrowserDoctorResult("webkit", [
      {
        ...passingResult("webkit"),
        navigation: "fail",
        status: "fail",
        error: "Navigation failed safely",
      },
    ]);
    assert.equal(result.status, "fail");
    assert.equal(browserDoctorExitCode(result), 1);
  });

  await it("orders all browsers deterministically", () => {
    const result = createBrowserDoctorResult("all", [
      passingResult("webkit"),
      passingResult("chromium"),
      passingResult("firefox"),
    ]);
    assert.deepEqual(
      result.browsers.map(({ browser }) => browser),
      ["chromium", "firefox", "webkit"],
    );
  });

  await it("supports JSON output selection", () => {
    assert.deepEqual(
      parseBrowserDoctorArguments(["--browser=chromium", "--json"]),
      { browser: "chromium", json: true },
    );
  });
});
