import { writeFile } from "node:fs/promises";

import {
  createBrowserDiagnosticsCollector,
  redactSensitiveText,
  sanitizeUrl,
} from "@aegis/core";
import { test as base } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

import { HeaderComponent } from "../components/header.component";
import { environment } from "../config/environment";
import { ProductSearchFlow } from "../flows/product-search.flow";
import { SearchResultsPage } from "../pages/search-results.page";

interface AegisFixtures {
  readonly header: HeaderComponent;
  readonly browserDiagnostics: undefined;
  readonly productSearchFlow: ProductSearchFlow;
  readonly searchResultsPage: SearchResultsPage;
}

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

export const test = base.extend<AegisFixtures>({
  browserDiagnostics: [
    async ({ context, page }, use, testInfo): Promise<void> => {
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
            }
          } catch (error) {
            addDiagnosticsWarning(testInfo, error);
          }
        }
      }
    },
    { auto: true },
  ],
  header: async ({ page }, use) => {
    await use(new HeaderComponent(page));
  },
  searchResultsPage: async ({ page }, use) => {
    await use(new SearchResultsPage(page));
  },
  productSearchFlow: async ({ page, header }, use) => {
    await use(new ProductSearchFlow(page, header));
  },
});
