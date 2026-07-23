import { chromium, firefox, webkit } from "playwright";
import type { BrowserType } from "playwright";
import {
  browserDoctorExitCode,
  createBrowserDoctorResult,
  parseBrowserDoctorArguments,
  redactSensitiveText,
  renderBrowserDoctor,
  sanitizeBrowserDoctorError,
  selectedBrowserNames,
} from "@aegis/core";
import type {
  BrowserDoctorBrowser,
  BrowserDoctorCheckResult,
  BrowserDoctorStepStatus,
} from "@aegis/core";

async function checkBrowser(
  name: BrowserDoctorBrowser,
  browserType: BrowserType,
): Promise<BrowserDoctorCheckResult> {
  let launch: BrowserDoctorStepStatus = "skipped";
  let contextStatus: BrowserDoctorStepStatus = "skipped";
  let pageStatus: BrowserDoctorStepStatus = "skipped";
  let navigation: BrowserDoctorStepStatus = "skipped";
  let safeError: string | undefined;
  let browser;
  let context;
  let page;

  try {
    browser = await browserType.launch();
    launch = "pass";
    context = await browser.newContext();
    contextStatus = "pass";
    page = await context.newPage();
    pageStatus = "pass";
    await page.goto(
      "data:text/html,<title>AegisAI%20Browser%20Doctor</title><main>browser-runtime-ready</main>",
    );
    const content = await page.getByText("browser-runtime-ready").textContent();
    navigation = content === "browser-runtime-ready" ? "pass" : "fail";
  } catch (error) {
    safeError = sanitizeBrowserDoctorError(
      error instanceof Error ? error.message : String(error),
    );
    if (launch === "skipped") launch = "fail";
    else if (contextStatus === "skipped") contextStatus = "fail";
    else if (pageStatus === "skipped") pageStatus = "fail";
    else navigation = "fail";
  } finally {
    await Promise.allSettled([
      page?.close(),
      context?.close(),
      browser?.close(),
    ]);
  }

  const status =
    launch === "pass" &&
    contextStatus === "pass" &&
    pageStatus === "pass" &&
    navigation === "pass"
      ? "pass"
      : "fail";
  return {
    browser: name,
    launch,
    context: contextStatus,
    page: pageStatus,
    navigation,
    status,
    ...(safeError === undefined ? {} : { error: safeError }),
  };
}

const browserTypes: Readonly<Record<BrowserDoctorBrowser, BrowserType>> = {
  chromium,
  firefox,
  webkit,
};

let options;
try {
  options = parseBrowserDoctorArguments(process.argv.slice(2));
} catch (error) {
  console.error(
    redactSensitiveText(
      error instanceof Error ? error.message : String(error),
      1_000,
    ),
  );
  process.exitCode = 2;
  process.exit();
}

const checks: BrowserDoctorCheckResult[] = [];
for (const browserName of selectedBrowserNames(options.browser)) {
  checks.push(await checkBrowser(browserName, browserTypes[browserName]));
}

const result = createBrowserDoctorResult(options.browser, checks);
console.log(
  options.json ? JSON.stringify(result, null, 2) : renderBrowserDoctor(result),
);
process.exitCode = browserDoctorExitCode(result);
