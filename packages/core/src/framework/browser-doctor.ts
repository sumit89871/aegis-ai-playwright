import { redactSensitiveText } from "../diagnostics/redaction.ts";

export const BROWSER_DOCTOR_BROWSERS = [
  "chromium",
  "firefox",
  "webkit",
] as const;

export type BrowserDoctorBrowser = (typeof BROWSER_DOCTOR_BROWSERS)[number];
export type BrowserDoctorSelection = BrowserDoctorBrowser | "all";
export type BrowserDoctorStepStatus = "pass" | "fail" | "skipped";

export interface BrowserDoctorOptions {
  readonly browser: BrowserDoctorSelection;
  readonly json: boolean;
}

export interface BrowserDoctorCheckResult {
  readonly browser: BrowserDoctorBrowser;
  readonly launch: BrowserDoctorStepStatus;
  readonly context: BrowserDoctorStepStatus;
  readonly page: BrowserDoctorStepStatus;
  readonly navigation: BrowserDoctorStepStatus;
  readonly status: "pass" | "fail";
  readonly error?: string;
}

export interface BrowserDoctorSummary {
  readonly passed: number;
  readonly failed: number;
}

export interface BrowserDoctorResult {
  readonly selectedBrowser: BrowserDoctorSelection;
  readonly status: "pass" | "fail";
  readonly summary: BrowserDoctorSummary;
  readonly browsers: readonly BrowserDoctorCheckResult[];
}

export function sanitizeBrowserDoctorError(value: string): string {
  return redactSensitiveText(value, 1_000)
    .replace(/\b[A-Za-z]:\\[^\r\n]*/gu, "[LOCAL_PATH]")
    .replace(/\/(?:home|root|Users)\/[^\s\r\n]*/gu, "[LOCAL_PATH]")
    .replace(/\/[^\s\r\n]*ms-playwright[^\s\r\n]*/gu, "[BROWSER_CACHE_PATH]");
}

function isBrowserSelection(value: string): value is BrowserDoctorSelection {
  return (
    value === "all" ||
    BROWSER_DOCTOR_BROWSERS.includes(value as BrowserDoctorBrowser)
  );
}

export function parseBrowserDoctorArguments(
  arguments_: readonly string[],
): BrowserDoctorOptions {
  let browser: BrowserDoctorSelection = "all";
  let browserSpecified = false;
  let json = false;

  for (const argument of arguments_) {
    if (argument === "--json") {
      if (json) {
        throw new Error("The --json option may be supplied only once.");
      }
      json = true;
      continue;
    }

    if (argument.startsWith("--browser=")) {
      if (browserSpecified) {
        throw new Error("The --browser option may be supplied only once.");
      }
      const value = argument.slice("--browser=".length).toLowerCase();
      if (!isBrowserSelection(value)) {
        throw new Error(
          `Unsupported browser '${value || "(empty)"}'. Expected chromium, firefox, webkit, or all.`,
        );
      }
      browser = value;
      browserSpecified = true;
      continue;
    }

    throw new Error(`Unsupported browser-doctor option '${argument}'.`);
  }

  return Object.freeze({ browser, json });
}

export function selectedBrowserNames(
  selection: BrowserDoctorSelection,
): readonly BrowserDoctorBrowser[] {
  return selection === "all"
    ? BROWSER_DOCTOR_BROWSERS
    : Object.freeze([selection]);
}

export function createBrowserDoctorResult(
  selectedBrowser: BrowserDoctorSelection,
  browserResults: readonly BrowserDoctorCheckResult[],
): BrowserDoctorResult {
  const selected = new Set(selectedBrowserNames(selectedBrowser));
  const byBrowser = new Map(
    browserResults.map((result) => [result.browser, result]),
  );
  const browsers = Object.freeze(
    BROWSER_DOCTOR_BROWSERS.filter((browser) => selected.has(browser)).map(
      (browser) => {
        const result = byBrowser.get(browser);
        if (result === undefined) {
          throw new Error(`Missing browser-doctor result for ${browser}.`);
        }
        return Object.freeze({ ...result });
      },
    ),
  );
  const summary = Object.freeze({
    passed: browsers.filter(({ status }) => status === "pass").length,
    failed: browsers.filter(({ status }) => status === "fail").length,
  });

  return Object.freeze({
    selectedBrowser,
    status: summary.failed === 0 ? "pass" : "fail",
    summary,
    browsers,
  });
}

export function browserDoctorExitCode(result: BrowserDoctorResult): number {
  return result.status === "pass" ? 0 : 1;
}

const BROWSER_LABELS: Readonly<Record<BrowserDoctorBrowser, string>> = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};

export function renderBrowserDoctor(result: BrowserDoctorResult): string {
  const headings = [
    "Browser",
    "Launch",
    "Context",
    "Page",
    "Navigation",
    "Result",
  ] as const;
  const rows = result.browsers.map((browser) => [
    BROWSER_LABELS[browser.browser],
    browser.launch.toUpperCase(),
    browser.context.toUpperCase(),
    browser.page.toUpperCase(),
    browser.navigation.toUpperCase(),
    browser.status.toUpperCase(),
  ]);
  const widths = headings.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );

  return [
    headings
      .map((heading, index) => heading.padEnd(widths[index] ?? 0))
      .join("  "),
    ...rows.map((row) =>
      row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  "),
    ),
    "",
    `Overall: ${result.status.toUpperCase()} (${String(result.summary.passed)} passed, ${String(result.summary.failed)} failed)`,
  ].join("\n");
}
