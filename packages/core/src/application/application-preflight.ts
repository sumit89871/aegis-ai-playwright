import type {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
} from "@playwright/test";

import {
  redactSensitiveText,
  sanitizeUrl,
  truncateText,
} from "../diagnostics/redaction.ts";
import {
  type ApplicationBrowserName,
  type ApplicationProfile,
  ApplicationProfileValidationError,
  validateApplicationProfile,
} from "./application-profile.ts";

export const PREFLIGHT_STATUSES = ["pass", "warn", "fail", "skipped"] as const;
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];

export interface PreflightCheckResult {
  readonly status: PreflightStatus;
  readonly message: string;
  readonly durationMs: number;
}

export interface HttpPreflightResult extends PreflightCheckResult {
  readonly targetUrl?: string;
  readonly finalUrl?: string;
  readonly statusCode?: number;
}

export interface BrowserPreflightResult extends PreflightCheckResult {
  readonly browser: ApplicationBrowserName;
  readonly targetUrl?: string;
  readonly finalUrl?: string;
  readonly title?: string;
}

export interface ApplicationPreflightTarget {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  readonly baseUrl: string;
}

export interface ApplicationPreflightResult {
  readonly status: "pass" | "warn" | "fail";
  readonly target?: ApplicationPreflightTarget;
  readonly profileValidation: PreflightCheckResult;
  readonly httpCheck: HttpPreflightResult;
  readonly browserCheck: BrowserPreflightResult;
}

export interface ApplicationPreflightOptions {
  readonly browserName?: ApplicationBrowserName;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

function elapsed(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown preflight error.";
  return redactSensitiveText(message, 500);
}

function skipped(message: string): PreflightCheckResult {
  return Object.freeze({ status: "skipped", message, durationMs: 0 });
}

async function runHttpCheck(
  profile: ApplicationProfile,
  fetchImplementation: typeof fetch,
  now: () => number,
): Promise<HttpPreflightResult> {
  const startedAt = now();
  const targetUrl = new URL(
    profile.healthCheckPath,
    `${profile.baseUrl}/`,
  ).toString();
  const sanitizedTargetUrl = sanitizeUrl(targetUrl);

  try {
    const response = await fetchImplementation(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(profile.requestTimeoutMs),
    });
    await response.body?.cancel();
    const statusAllowed = profile.expectedStatusCodes.includes(response.status);
    return Object.freeze({
      status: statusAllowed ? "pass" : "fail",
      message: statusAllowed
        ? `HTTP ${String(response.status)} is allowed`
        : `HTTP ${String(response.status)} is not in the allowed status list`,
      durationMs: elapsed(startedAt, now),
      targetUrl: sanitizedTargetUrl,
      finalUrl: sanitizeUrl(response.url || targetUrl),
      statusCode: response.status,
    });
  } catch (error) {
    return Object.freeze({
      status: "fail",
      message: `HTTP request failed: ${safeError(error)}`,
      durationMs: elapsed(startedAt, now),
      targetUrl: sanitizedTargetUrl,
    });
  }
}

async function loadBrowserType(
  browserName: ApplicationBrowserName,
): Promise<BrowserType> {
  const playwright = await import("@playwright/test");
  return playwright[browserName];
}

async function closeBrowserResources(
  page: Page | undefined,
  context: BrowserContext | undefined,
  browser: Browser | undefined,
): Promise<void> {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
}

async function runBrowserCheck(
  profile: ApplicationProfile,
  browserName: ApplicationBrowserName,
  now: () => number,
): Promise<BrowserPreflightResult> {
  const startedAt = now();
  const targetUrl = sanitizeUrl(profile.baseUrl);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    const browserType = await loadBrowserType(browserName);
    browser = await browserType.launch();
    context = await browser.newContext();
    page = await context.newPage();
    const response = await page.goto(profile.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: profile.requestTimeoutMs,
    });
    if (response === null) {
      throw new Error("Browser navigation did not return an HTTP response.");
    }
    const title = truncateText(await page.title(), 200);
    const expectedTitle = profile.browserCheck.expectedTitleContains;
    if (expectedTitle !== undefined && !title.includes(expectedTitle)) {
      return Object.freeze({
        status: "fail",
        message: "Browser title did not contain the expected text",
        durationMs: elapsed(startedAt, now),
        browser: browserName,
        targetUrl,
        finalUrl: sanitizeUrl(page.url()),
        title: redactSensitiveText(title, 200),
      });
    }

    return Object.freeze({
      status: "pass",
      message:
        expectedTitle === undefined
          ? "Browser navigation succeeded"
          : "Browser navigation and title check succeeded",
      durationMs: elapsed(startedAt, now),
      browser: browserName,
      targetUrl,
      finalUrl: sanitizeUrl(page.url()),
      title: redactSensitiveText(title, 200),
    });
  } catch (error) {
    return Object.freeze({
      status: "fail",
      message: `Browser check failed: ${safeError(error)}`,
      durationMs: elapsed(startedAt, now),
      browser: browserName,
      targetUrl,
    });
  } finally {
    await closeBrowserResources(page, context, browser);
  }
}

export async function runApplicationPreflight(
  profileValue: unknown,
  options: ApplicationPreflightOptions = {},
): Promise<ApplicationPreflightResult> {
  const now = options.now ?? performance.now.bind(performance);
  const validationStartedAt = now();
  let profile: ApplicationProfile;

  try {
    profile = validateApplicationProfile(profileValue);
  } catch (error) {
    const validationMessage =
      error instanceof ApplicationProfileValidationError
        ? error.message
        : `Application profile validation failed: ${safeError(error)}`;
    const browserName = options.browserName ?? "chromium";
    return Object.freeze({
      status: "fail",
      profileValidation: Object.freeze({
        status: "fail",
        message: validationMessage,
        durationMs: elapsed(validationStartedAt, now),
      }),
      httpCheck: Object.freeze({
        ...skipped("HTTP check skipped because the profile is invalid"),
      }),
      browserCheck: Object.freeze({
        ...skipped("Browser check skipped because the profile is invalid"),
        browser: browserName,
      }),
    });
  }

  const profileValidation = Object.freeze({
    status: "pass" as const,
    message: "Application profile is valid",
    durationMs: elapsed(validationStartedAt, now),
  });
  const httpCheck = await runHttpCheck(
    profile,
    options.fetchImplementation ?? fetch,
    now,
  );
  const browserName =
    options.browserName ?? profile.browserCheck.browser ?? "chromium";
  const browserCheck: BrowserPreflightResult = profile.browserCheck.enabled
    ? await runBrowserCheck(profile, browserName, now)
    : Object.freeze({
        ...skipped("Browser check is disabled by the application profile"),
        browser: browserName,
      });
  const hasFailure =
    httpCheck.status === "fail" || browserCheck.status === "fail";
  const hasWarning =
    httpCheck.status === "warn" || browserCheck.status === "warn";

  return Object.freeze({
    status: hasFailure ? "fail" : hasWarning ? "warn" : "pass",
    target: Object.freeze({
      id: profile.id,
      name: profile.name,
      environment: profile.environment,
      baseUrl: sanitizeUrl(profile.baseUrl),
    }),
    profileValidation,
    httpCheck,
    browserCheck,
  });
}

export function applicationPreflightExitCode(
  result: ApplicationPreflightResult,
): number {
  return result.status === "fail" ? 1 : 0;
}

export function renderApplicationPreflight(
  result: ApplicationPreflightResult,
): string {
  const rows = [
    ["Profile validation", result.profileValidation],
    ["HTTP health check", result.httpCheck],
    ["Browser check", result.browserCheck],
  ] as const;
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(
    ([label, checkResult]) =>
      `${label.padEnd(labelWidth)}  ${checkResult.status.toUpperCase().padEnd(7)}  ${checkResult.message}`,
  );
  lines.push("", `Overall: ${result.status.toUpperCase()}`);
  return lines.join("\n");
}
