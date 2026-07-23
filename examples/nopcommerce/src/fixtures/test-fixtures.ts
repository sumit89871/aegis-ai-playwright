import { writeFile } from "node:fs/promises";

import {
  analyseUiFailure,
  createBrowserDiagnosticsCollector,
  defaultFailureAnalysisConfiguration,
  redactSensitiveText,
  renderFailureAnalysisMarkdown,
  runAccessibilityScan,
  sanitizeUrl,
} from "@aegis/core";
import type {
  AccessibilityScanOptions,
  AccessibilityScanResult,
  AiClient,
  FailureAnalysisConfiguration,
  FailureEvidenceInput,
  PageReadinessFailureDetails,
} from "@aegis/core";
import { test as base } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

import { HeaderComponent } from "../components/header.component";
import { environment } from "../config/environment";
import { AddProductToCartFlow } from "../flows/add-product-to-cart.flow.ts";
import { ProductSearchFlow } from "../flows/product-search.flow";
import { ProductDetailsPage } from "../pages/product-details.page.ts";
import { HomePage } from "../pages/home.page.ts";
import { SearchResultsPage } from "../pages/search-results.page";
import { ShoppingCartPage } from "../pages/shopping-cart.page.ts";

interface AegisFixtures {
  readonly accessibility: AccessibilityFixture;
  readonly failureAnalysisConfiguration: FailureAnalysisConfiguration;
  readonly failureAnalysisAiClient: AiClient | undefined;
  readonly header: HeaderComponent;
  readonly browserDiagnostics: undefined;
  readonly addProductToCartFlow: AddProductToCartFlow;
  readonly productSearchFlow: ProductSearchFlow;
  readonly productDetailsPage: ProductDetailsPage;
  readonly homePage: HomePage;
  readonly searchResultsPage: SearchResultsPage;
  readonly shoppingCartPage: ShoppingCartPage;
}

export interface AccessibilityFixture {
  readonly scan: (
    options?: AccessibilityScanOptions,
  ) => Promise<AccessibilityScanResult>;
}

const accessibilityEvidenceByTest = new WeakMap<
  TestInfo,
  AccessibilityScanResult
>();
const FAILURE_ANALYSIS_CONFIGURATION = defaultFailureAnalysisConfiguration();

function addDiagnosticsWarning(testInfo: TestInfo, error: unknown): void {
  const message =
    error instanceof Error
      ? redactSensitiveText(error.message, 500)
      : "Unknown optional diagnostics error.";

  try {
    testInfo.annotations.push({
      type: "diagnostics-warning",
      description: message,
    });
  } catch {
    // Optional diagnostics must never alter the test result.
  }
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const outputPath = testInfo.outputPath(name);
  await writeFile(outputPath, JSON.stringify(value, null, 2), "utf8");
  await testInfo.attach(name, {
    path: outputPath,
    contentType: "application/json",
  });
}

async function attachMarkdown(
  testInfo: TestInfo,
  name: string,
  value: string,
): Promise<void> {
  const outputPath = testInfo.outputPath(name);
  await writeFile(outputPath, value, "utf8");
  await testInfo.attach(name, {
    path: outputPath,
    contentType: "text/markdown",
  });
}

function annotationValue(testInfo: TestInfo, type: string): string | undefined {
  return testInfo.annotations.find((annotation) => annotation.type === type)
    ?.description;
}

function annotationValues(testInfo: TestInfo, type: string): readonly string[] {
  return testInfo.annotations
    .filter((annotation) => annotation.type === type)
    .flatMap((annotation) =>
      annotation.description === undefined ? [] : [annotation.description],
    );
}

function readinessFailureFrom(
  testInfo: TestInfo,
): PageReadinessFailureDetails | undefined {
  const message = testInfo.error?.message;
  if (message === undefined) {
    return undefined;
  }
  const match = /Page readiness failed for ([a-z0-9]+(?:-[a-z0-9]+)*):/u.exec(
    message,
  );
  if (match?.[1] === undefined) {
    return undefined;
  }
  return Object.freeze({
    status: "fail",
    definitionId: match[1],
    durationMs: testInfo.duration,
    error: redactSensitiveText(message, 500),
  });
}

type DiagnosticsSnapshot = ReturnType<
  ReturnType<typeof createBrowserDiagnosticsCollector>["snapshot"]
>;

function failureEvidenceInput(
  testInfo: TestInfo,
  browserDiagnostics: DiagnosticsSnapshot,
): FailureEvidenceInput {
  const browserName = testInfo.project.use.browserName;
  const errorMessage = testInfo.error?.message;
  const readiness = readinessFailureFrom(testInfo);
  const accessibility = accessibilityEvidenceByTest.get(testInfo);
  const testId = annotationValue(testInfo, "test-id");
  const feature = annotationValue(testInfo, "feature");
  const suite = annotationValue(testInfo, "suite");
  const risk = annotationValue(testInfo, "risk");
  const layer = annotationValue(testInfo, "layer");
  return Object.freeze({
    test: Object.freeze({
      title: testInfo.title,
      ...(testId === undefined ? {} : { testId }),
      ...(feature === undefined ? {} : { feature }),
      ...(suite === undefined ? {} : { suite }),
      ...(risk === undefined ? {} : { risk }),
      ...(layer === undefined ? {} : { layer }),
      requirementIds: annotationValues(testInfo, "requirement"),
      tags: testInfo.tags,
      projectName: testInfo.project.name,
      ...(browserName === undefined ? {} : { browserName }),
      expectedStatus: testInfo.expectedStatus,
      actualStatus: testInfo.status ?? "unknown",
      retry: testInfo.retry,
      durationMs: testInfo.duration,
    }),
    ...(errorMessage === undefined
      ? {}
      : {
          error: Object.freeze({
            name: "PlaywrightError",
            message: errorMessage,
            ...(testInfo.error?.stack === undefined
              ? {}
              : { stack: testInfo.error.stack }),
          }),
        }),
    ...(readiness === undefined ? {} : { readiness }),
    browserDiagnostics,
    ...(accessibility === undefined ? {} : { accessibility }),
    availableAttachments: testInfo.attachments.map(
      (attachment) => attachment.name,
    ),
  });
}

async function createFailureAnalysis(
  testInfo: TestInfo,
  snapshot: DiagnosticsSnapshot,
  configuration: FailureAnalysisConfiguration,
  aiClient: AiClient | undefined,
): Promise<void> {
  const report = await analyseUiFailure({
    evidence: failureEvidenceInput(testInfo, snapshot),
    configuration,
    ...(aiClient === undefined ? {} : { aiClient }),
  });
  if (configuration.attachJson) {
    await attachJson(testInfo, "failure-analysis.json", report);
  }
  if (configuration.attachMarkdown) {
    await attachMarkdown(
      testInfo,
      "failure-analysis.md",
      renderFailureAnalysisMarkdown(report),
    );
  }
}

export const test = base.extend<AegisFixtures>({
  failureAnalysisConfiguration: [
    FAILURE_ANALYSIS_CONFIGURATION,
    { option: true },
  ],
  failureAnalysisAiClient: [undefined, { option: true }],
  browserDiagnostics: [
    async (
      { context, page, failureAnalysisConfiguration, failureAnalysisAiClient },
      use,
      testInfo,
    ): Promise<void> => {
      let collector:
        ReturnType<typeof createBrowserDiagnosticsCollector> | undefined;

      try {
        collector = createBrowserDiagnosticsCollector();
        collector.start(context, page);
      } catch (error) {
        addDiagnosticsWarning(testInfo, error);
      }

      try {
        await use(undefined);
      } finally {
        if (collector !== undefined) {
          try {
            collector.dispose();
            const snapshot = collector.snapshot();

            if (snapshot.summary.internalErrorCount > 0) {
              addDiagnosticsWarning(
                testInfo,
                new Error(
                  `${String(snapshot.summary.internalErrorCount)} browser diagnostic event(s) could not be collected safely.`,
                ),
              );
            }

            if (testInfo.status !== testInfo.expectedStatus) {
              const browserName = testInfo.project.use.browserName;
              const testContext = {
                title: redactSensitiveText(testInfo.title),
                titlePath: testInfo.titlePath.map((part) =>
                  redactSensitiveText(part),
                ),
                projectName: redactSensitiveText(testInfo.project.name),
                retry: testInfo.retry,
                workerIndex: testInfo.workerIndex,
                expectedStatus: testInfo.expectedStatus,
                actualStatus: testInfo.status ?? "unknown",
                startTime: snapshot.summary.collectionStartedAt,
                durationMilliseconds: testInfo.duration,
                baseUrl: sanitizeUrl(environment.baseUrl),
                ...(browserName === undefined
                  ? {}
                  : { browserName: redactSensitiveText(browserName) }),
              };
              const attachments: readonly (readonly [string, unknown])[] = [
                ["browser-console-errors.json", snapshot.browserConsoleErrors],
                ["page-errors.json", snapshot.pageErrors],
                ["failed-requests.json", snapshot.failedRequests],
                ["http-error-responses.json", snapshot.httpErrorResponses],
                ["diagnostic-summary.json", snapshot.summary],
                ["test-context.json", testContext],
              ];

              for (const [name, value] of attachments) {
                try {
                  await attachJson(testInfo, name, value);
                } catch (error) {
                  addDiagnosticsWarning(testInfo, error);
                }
              }

              try {
                await createFailureAnalysis(
                  testInfo,
                  snapshot,
                  failureAnalysisConfiguration,
                  failureAnalysisAiClient,
                );
              } catch (error) {
                addDiagnosticsWarning(testInfo, error);
              }
            }
          } catch (error) {
            addDiagnosticsWarning(testInfo, error);
          }
        }
      }
    },
    { auto: true },
  ],
  accessibility: async ({ page }, use, testInfo) => {
    await use({
      scan: async (
        options: AccessibilityScanOptions = {},
      ): Promise<AccessibilityScanResult> => {
        const result = await runAccessibilityScan(page, options);
        accessibilityEvidenceByTest.set(testInfo, result);
        const summary = Object.freeze({
          targetUrl: result.targetUrl,
          policy: result.policy,
          exclusionsApplied: result.exclusionsApplied,
          ...result.summary,
        });

        for (const [name, value] of [
          ["accessibility-summary.json", summary],
          ["accessibility-violations.json", result.violations],
        ] as const) {
          try {
            await attachJson(testInfo, name, value);
          } catch (error) {
            addDiagnosticsWarning(testInfo, error);
          }
        }

        return result;
      },
    });
  },
  header: async ({ page }, use) => {
    await use(new HeaderComponent(page));
  },
  searchResultsPage: async ({ page }, use) => {
    await use(new SearchResultsPage(page));
  },
  productDetailsPage: async ({ page }, use) => {
    await use(new ProductDetailsPage(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  shoppingCartPage: async ({ page }, use) => {
    await use(new ShoppingCartPage(page));
  },
  productSearchFlow: async ({ page, header }, use) => {
    await use(new ProductSearchFlow(page, header));
  },
  addProductToCartFlow: async (
    {
      productSearchFlow,
      searchResultsPage,
      productDetailsPage,
      header,
      shoppingCartPage,
    },
    use,
  ) => {
    await use(
      new AddProductToCartFlow(
        productSearchFlow,
        searchResultsPage,
        productDetailsPage,
        header,
        shoppingCartPage,
      ),
    );
  },
});
