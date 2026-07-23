export const DOCTOR_STATUSES = ["pass", "warn", "fail"] as const;

export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export interface FrameworkDoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly message: string;
}

export interface FrameworkDoctorSummary {
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
}

export interface FrameworkDoctorResult {
  readonly status: DoctorStatus;
  readonly summary: FrameworkDoctorSummary;
  readonly checks: readonly FrameworkDoctorCheck[];
}

export interface BrowserExecutableAvailability {
  readonly chromium: boolean;
  readonly firefox: boolean;
  readonly webkit: boolean;
}

export interface FrameworkDoctorInput {
  readonly nodeVersion: string;
  readonly nodeEngineRange: string;
  readonly npmVersion: string | null;
  readonly packageLockExists: boolean;
  readonly workspaceDirectoriesPresent: boolean;
  readonly workspaceDependenciesInstalled: boolean;
  readonly coreResolvable: boolean;
  readonly coreImportable: boolean;
  readonly typescriptConfigExists: boolean;
  readonly playwrightTestVersion: string | null;
  readonly playwrightVersion: string | null;
  readonly playwrightCoreVersion: string | null;
  readonly browserExecutables: BrowserExecutableAvailability;
  readonly essentialCoreExportsPresent: boolean;
  readonly coreHasConsumerDependency: boolean;
}

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION_CLAUSE_PATTERN = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u;

function parseSemanticVersion(value: string): SemanticVersion | null {
  const normalized = value.trim().replace(/^v/u, "").split("-", 1)[0];
  if (normalized === undefined) {
    return null;
  }

  const match = VERSION_CLAUSE_PATTERN.exec(normalized);
  if (match === null) {
    return null;
  }

  return {
    major: Number(match[2]),
    minor: Number(match[3] ?? 0),
    patch: Number(match[4] ?? 0),
  };
}

function compareVersions(
  left: SemanticVersion,
  right: SemanticVersion,
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }
  return 0;
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  const parsedVersion = parseSemanticVersion(version);
  if (parsedVersion === null) {
    return false;
  }

  const clauses = range.trim().split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) {
    return false;
  }

  return clauses.every((clause) => {
    const match = VERSION_CLAUSE_PATTERN.exec(clause);
    if (match === null) {
      return false;
    }

    const target = parseSemanticVersion(
      `${String(match[2])}.${match[3] ?? "0"}.${match[4] ?? "0"}`,
    );
    if (target === null) {
      return false;
    }

    const comparison = compareVersions(parsedVersion, target);
    switch (match[1] ?? "=") {
      case ">=":
        return comparison >= 0;
      case "<=":
        return comparison <= 0;
      case ">":
        return comparison > 0;
      case "<":
        return comparison < 0;
      case "=":
        return comparison === 0;
      default:
        return false;
    }
  });
}

function check(
  id: string,
  passed: boolean,
  passMessage: string,
  failMessage: string,
): FrameworkDoctorCheck {
  return Object.freeze({
    id,
    status: passed ? "pass" : "fail",
    message: passed ? passMessage : failMessage,
  });
}

function packageVersionsAligned(input: FrameworkDoctorInput): boolean {
  const versions = [
    input.playwrightTestVersion,
    input.playwrightVersion,
    input.playwrightCoreVersion,
  ];
  return (
    versions.every((version) => version !== null) &&
    new Set(versions).size === 1
  );
}

export function summarizeDoctorChecks(
  checks: readonly FrameworkDoctorCheck[],
): FrameworkDoctorSummary {
  return Object.freeze({
    passed: checks.filter(({ status }) => status === "pass").length,
    warned: checks.filter(({ status }) => status === "warn").length,
    failed: checks.filter(({ status }) => status === "fail").length,
  });
}

export function evaluateFrameworkDoctor(
  input: FrameworkDoctorInput,
): FrameworkDoctorResult {
  const playwrightVersion = input.playwrightTestVersion ?? "not installed";
  const checks: readonly FrameworkDoctorCheck[] = Object.freeze([
    check(
      "node-version",
      satisfiesVersionRange(input.nodeVersion, input.nodeEngineRange),
      `${input.nodeVersion} satisfies ${input.nodeEngineRange}`,
      `${input.nodeVersion} does not satisfy ${input.nodeEngineRange}`,
    ),
    check(
      "npm-available",
      input.npmVersion !== null,
      `npm ${input.npmVersion ?? ""} is available`,
      "npm is not available",
    ),
    check(
      "package-lock",
      input.packageLockExists,
      "package-lock.json exists",
      "package-lock.json is missing",
    ),
    check(
      "workspace-directories",
      input.workspaceDirectoriesPresent,
      "Required framework directories exist",
      "One or more required framework directories are missing",
    ),
    check(
      "workspace-dependencies",
      input.workspaceDependenciesInstalled,
      "Workspace dependencies are installed",
      "Workspace dependencies are missing; run npm install",
    ),
    check(
      "core-resolution",
      input.coreResolvable,
      "@aegis/core resolves through npm workspaces",
      "@aegis/core cannot be resolved",
    ),
    check(
      "core-import",
      input.coreImportable,
      "@aegis/core imports successfully",
      "@aegis/core could not be imported",
    ),
    check(
      "typescript-configuration",
      input.typescriptConfigExists,
      "Shared TypeScript configuration exists",
      "tsconfig.base.json is missing",
    ),
    check(
      "playwright-test-installed",
      input.playwrightTestVersion !== null,
      `Playwright Test ${playwrightVersion} is installed`,
      "@playwright/test is not installed",
    ),
    check(
      "playwright-version-alignment",
      packageVersionsAligned(input),
      `Playwright packages are aligned at ${playwrightVersion}`,
      "@playwright/test, playwright, and playwright-core versions are not aligned",
    ),
    check(
      "chromium-executable",
      input.browserExecutables.chromium,
      "Chromium executable is installed",
      "Chromium executable is missing; run npm run setup",
    ),
    check(
      "firefox-executable",
      input.browserExecutables.firefox,
      "Firefox executable is installed",
      "Firefox executable is missing; run npm run setup",
    ),
    check(
      "webkit-executable",
      input.browserExecutables.webkit,
      "WebKit executable is installed",
      "WebKit executable is missing; run npm run setup",
    ),
    check(
      "essential-core-exports",
      input.essentialCoreExportsPresent,
      "Essential @aegis/core exports are available",
      "One or more essential @aegis/core exports are missing",
    ),
    check(
      "core-consumer-boundary",
      !input.coreHasConsumerDependency,
      "Core has no reverse dependency on consumer examples",
      "Core contains a forbidden dependency on a consumer example",
    ),
  ]);
  const summary = summarizeDoctorChecks(checks);
  const status: DoctorStatus =
    summary.failed > 0 ? "fail" : summary.warned > 0 ? "warn" : "pass";

  return Object.freeze({ status, summary, checks });
}

export function doctorExitCode(result: FrameworkDoctorResult): number {
  return result.summary.failed > 0 ? 1 : 0;
}

const DOCTOR_CHECK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "node-version": "Node version",
  "npm-available": "npm availability",
  "package-lock": "Package lock",
  "workspace-directories": "Framework directories",
  "workspace-dependencies": "Workspace dependencies",
  "core-resolution": "Core resolution",
  "core-import": "Core import",
  "typescript-configuration": "TypeScript configuration",
  "playwright-test-installed": "Playwright Test",
  "playwright-version-alignment": "Playwright package alignment",
  "chromium-executable": "Chromium executable",
  "firefox-executable": "Firefox executable",
  "webkit-executable": "WebKit executable",
  "essential-core-exports": "Essential core exports",
  "core-consumer-boundary": "Core to consumer dependency boundary",
});

export function renderFrameworkDoctor(result: FrameworkDoctorResult): string {
  const headings = ["Check", "Status", "Details"] as const;
  const rows: readonly (readonly [string, string, string])[] =
    result.checks.map((entry) => [
      DOCTOR_CHECK_LABELS[entry.id] ?? entry.id,
      entry.status.toUpperCase(),
      entry.message,
    ]);
  const checkWidth = Math.max(
    headings[0].length,
    ...rows.map(([id]) => id.length),
  );
  const statusWidth = Math.max(
    headings[1].length,
    ...rows.map(([, status]) => status.length),
  );
  const lines = [
    `${headings[0].padEnd(checkWidth)}  ${headings[1].padEnd(statusWidth)}  ${headings[2]}`,
    ...rows.map(
      ([id, status, message]) =>
        `${id.padEnd(checkWidth)}  ${status.padEnd(statusWidth)}  ${message}`,
    ),
    "",
    `Overall: ${result.status.toUpperCase()} (${String(result.summary.passed)} passed, ${String(result.summary.warned)} warned, ${String(result.summary.failed)} failed)`,
  ];
  return lines.join("\n");
}
