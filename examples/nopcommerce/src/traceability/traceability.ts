import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  TEST_LAYERS,
  TEST_RISKS,
  TEST_SUITES,
  toPlaywrightTags,
  validateRequirementMetadata,
  validateTestMetadata,
} from "@aegis/core";
import type {
  RequirementMetadata,
  TestLayer,
  TestMetadata,
  TestRisk,
  TestSuite,
} from "@aegis/core";

export interface TraceabilitySummary {
  readonly totalRegisteredRequirements: number;
  readonly activeRequirements: number;
  readonly coveredRequirements: number;
  readonly uncoveredRequirements: number;
  readonly totalRegisteredTests: number;
  readonly testsBySuite: Readonly<Record<TestSuite, number>>;
  readonly testsByRisk: Readonly<Record<TestRisk, number>>;
  readonly testsByLayer: Readonly<Record<TestLayer, number>>;
  readonly testsByFeature: Readonly<Record<string, number>>;
}

export interface RequirementTraceabilityDetail {
  readonly requirementId: string;
  readonly title: string;
  readonly feature: string;
  readonly status: string;
  readonly documentPath: string;
  readonly coverageState: "covered" | "uncovered";
  readonly linkedTestIds: readonly string[];
  readonly linkedTestTitles: readonly string[];
  readonly risks: readonly TestRisk[];
  readonly suites: readonly TestSuite[];
}

export interface TestTraceabilityDetail {
  readonly testId: string;
  readonly title: string;
  readonly requirementIds: readonly string[];
  readonly feature: string;
  readonly suite: TestSuite;
  readonly risk: TestRisk;
  readonly layer: TestLayer;
  readonly canonicalTags: readonly string[];
}

export interface TraceabilityReport {
  readonly summary: TraceabilitySummary;
  readonly requirements: readonly RequirementTraceabilityDetail[];
  readonly tests: readonly TestTraceabilityDetail[];
}

export interface BuildTraceabilityOptions {
  readonly requirements: readonly unknown[];
  readonly tests: readonly unknown[];
  readonly workspaceRoot: string;
}

export interface WriteTraceabilityOptions extends BuildTraceabilityOptions {
  readonly outputDirectory: string;
}

export class TraceabilityValidationError extends Error {
  public readonly errors: readonly string[];

  public constructor(errors: readonly string[]) {
    const sortedErrors = [...errors].sort();
    super(`Traceability validation failed:\n- ${sortedErrors.join("\n- ")}`);
    this.name = "TraceabilityValidationError";
    this.errors = Object.freeze(sortedErrors);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function validateRequirements(
  values: readonly unknown[],
  errors: string[],
): readonly RequirementMetadata[] {
  const validated: RequirementMetadata[] = [];
  for (const [index, value] of values.entries()) {
    try {
      validated.push(validateRequirementMetadata(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`requirements[${String(index)}]: ${message}`);
    }
  }
  return validated;
}

function validateTests(
  values: readonly unknown[],
  errors: string[],
): readonly TestMetadata[] {
  const validated: TestMetadata[] = [];
  for (const [index, value] of values.entries()) {
    try {
      validated.push(validateTestMetadata(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`tests[${String(index)}]: ${message}`);
    }
  }
  return validated;
}

function detectDuplicates(
  values: readonly string[],
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`Duplicate ${label}: ${value}.`);
    }
    seen.add(value);
  }
}

function countControlledValues<TValue extends string>(
  values: readonly TValue[],
  supported: readonly TValue[],
): Readonly<Record<TValue, number>> {
  const counts = Object.fromEntries(
    supported.map((value) => [value, 0]),
  ) as Record<TValue, number>;
  for (const value of values) {
    counts[value] += 1;
  }
  return Object.freeze(counts);
}

function countFeatures(
  tests: readonly TestMetadata[],
): Readonly<Record<string, number>> {
  const features = [...new Set(tests.map((test) => test.feature))].sort();
  return Object.freeze(
    Object.fromEntries(
      features.map((feature) => [
        feature,
        tests.filter((test) => test.feature === feature).length,
      ]),
    ),
  );
}

export async function buildTraceabilityReport(
  options: BuildTraceabilityOptions,
): Promise<TraceabilityReport> {
  const errors: string[] = [];
  const requirements = validateRequirements(options.requirements, errors);
  const tests = validateTests(options.tests, errors);

  detectDuplicates(
    requirements.map((requirement) => requirement.requirementId),
    "requirement ID",
    errors,
  );
  detectDuplicates(
    tests.map((test) => test.testId),
    "test ID",
    errors,
  );

  const knownRequirementIds = new Set(
    requirements.map((requirement) => requirement.requirementId),
  );
  for (const test of tests) {
    for (const requirementId of test.requirementIds) {
      if (!knownRequirementIds.has(requirementId)) {
        errors.push(
          `Test ${test.testId} references unknown requirement ${requirementId}.`,
        );
      }
    }
  }

  for (const requirement of requirements) {
    if (
      !(await isFile(resolve(options.workspaceRoot, requirement.documentPath)))
    ) {
      errors.push(
        `Requirement ${requirement.requirementId} references missing Markdown document ${requirement.documentPath}.`,
      );
    }
  }

  for (const requirement of requirements) {
    const linked = tests.some((test) =>
      test.requirementIds.includes(requirement.requirementId),
    );
    if (requirement.status === "active" && !linked) {
      errors.push(
        `Active requirement ${requirement.requirementId} has no linked tests.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new TraceabilityValidationError(errors);
  }

  const sortedTests = [...tests].sort((left, right) =>
    left.testId.localeCompare(right.testId),
  );
  const sortedRequirements = [...requirements].sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  );
  const requirementDetails = sortedRequirements.map((requirement) => {
    const linkedTests = sortedTests.filter((test) =>
      test.requirementIds.includes(requirement.requirementId),
    );
    return Object.freeze({
      requirementId: requirement.requirementId,
      title: requirement.title,
      feature: requirement.feature,
      status: requirement.status,
      documentPath: requirement.documentPath,
      coverageState: linkedTests.length > 0 ? "covered" : "uncovered",
      linkedTestIds: Object.freeze(linkedTests.map((test) => test.testId)),
      linkedTestTitles: Object.freeze(linkedTests.map((test) => test.title)),
      risks: Object.freeze(
        [...new Set(linkedTests.map((test) => test.risk))].sort(),
      ),
      suites: Object.freeze(
        [...new Set(linkedTests.map((test) => test.suite))].sort(),
      ),
    } satisfies RequirementTraceabilityDetail);
  });
  const testDetails = sortedTests.map((test) =>
    Object.freeze({
      testId: test.testId,
      title: test.title,
      requirementIds: Object.freeze([...test.requirementIds]),
      feature: test.feature,
      suite: test.suite,
      risk: test.risk,
      layer: test.layer,
      canonicalTags: toPlaywrightTags(test),
    } satisfies TestTraceabilityDetail),
  );
  const coveredRequirements = requirementDetails.filter(
    (requirement) => requirement.coverageState === "covered",
  ).length;

  return Object.freeze({
    summary: Object.freeze({
      totalRegisteredRequirements: sortedRequirements.length,
      activeRequirements: sortedRequirements.filter(
        (requirement) => requirement.status === "active",
      ).length,
      coveredRequirements,
      uncoveredRequirements: sortedRequirements.length - coveredRequirements,
      totalRegisteredTests: sortedTests.length,
      testsBySuite: countControlledValues(
        sortedTests.map((test) => test.suite),
        TEST_SUITES,
      ),
      testsByRisk: countControlledValues(
        sortedTests.map((test) => test.risk),
        TEST_RISKS,
      ),
      testsByLayer: countControlledValues(
        sortedTests.map((test) => test.layer),
        TEST_LAYERS,
      ),
      testsByFeature: countFeatures(sortedTests),
    }),
    requirements: Object.freeze(requirementDetails),
    tests: Object.freeze(testDetails),
  });
}

export function serializeTraceabilityJson(report: TraceabilityReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function markdownList(values: readonly string[]): string {
  return values.length === 0 ? "—" : values.join(", ");
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function serializeTraceabilityMarkdown(
  report: TraceabilityReport,
): string {
  const lines = [
    "# nopCommerce requirement traceability",
    "",
    "## Summary",
    "",
    `- Total registered requirements: ${String(report.summary.totalRegisteredRequirements)}`,
    `- Active requirements: ${String(report.summary.activeRequirements)}`,
    `- Covered requirements: ${String(report.summary.coveredRequirements)}`,
    `- Uncovered requirements: ${String(report.summary.uncoveredRequirements)}`,
    `- Total registered tests: ${String(report.summary.totalRegisteredTests)}`,
    `- Tests by suite: ${markdownList(Object.entries(report.summary.testsBySuite).map(([name, count]) => `${name}=${String(count)}`))}`,
    `- Tests by risk: ${markdownList(Object.entries(report.summary.testsByRisk).map(([name, count]) => `${name}=${String(count)}`))}`,
    `- Tests by layer: ${markdownList(Object.entries(report.summary.testsByLayer).map(([name, count]) => `${name}=${String(count)}`))}`,
    `- Tests by feature: ${markdownList(Object.entries(report.summary.testsByFeature).map(([name, count]) => `${name}=${String(count)}`))}`,
    "",
    "## Requirements",
    "",
    "| Requirement | Title | Feature | Status | Document | Coverage | Test IDs | Test titles | Risks | Suites |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.requirements.map(
      (requirement) =>
        `| ${requirement.requirementId} | ${escapeMarkdown(requirement.title)} | ${requirement.feature} | ${requirement.status} | ${requirement.documentPath} | ${requirement.coverageState} | ${markdownList(requirement.linkedTestIds)} | ${escapeMarkdown(markdownList(requirement.linkedTestTitles))} | ${markdownList(requirement.risks)} | ${markdownList(requirement.suites)} |`,
    ),
    "",
    "## Tests",
    "",
    "| Test ID | Title | Requirements | Feature | Suite | Risk | Layer | Canonical tags |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.tests.map(
      (test) =>
        `| ${test.testId} | ${escapeMarkdown(test.title)} | ${markdownList(test.requirementIds)} | ${test.feature} | ${test.suite} | ${test.risk} | ${test.layer} | ${escapeMarkdown(test.canonicalTags.join(" "))} |`,
    ),
    "",
  ];

  return lines.join("\n");
}

export async function writeTraceabilityReports(
  options: WriteTraceabilityOptions,
): Promise<TraceabilityReport> {
  const report = await buildTraceabilityReport(options);
  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(options.outputDirectory, "traceability.json"),
      serializeTraceabilityJson(report),
      "utf8",
    ),
    writeFile(
      resolve(options.outputDirectory, "traceability.md"),
      serializeTraceabilityMarkdown(report),
      "utf8",
    ),
  ]);
  return report;
}
