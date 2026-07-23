import { chromium, firefox, webkit } from "playwright";
import type { BrowserType } from "playwright";

type StepResult = "PASS" | "FAIL" | "SKIP";

interface BrowserDoctorResult {
  readonly browser: string;
  readonly launch: StepResult;
  readonly context: StepResult;
  readonly page: StepResult;
  readonly navigation: StepResult;
  readonly result: "PASS" | "FAIL";
}

async function checkBrowser(
  name: string,
  browserType: BrowserType,
): Promise<BrowserDoctorResult> {
  let launch: StepResult = "SKIP";
  let contextStatus: StepResult = "SKIP";
  let pageStatus: StepResult = "SKIP";
  let navigation: StepResult = "SKIP";
  let browser;
  let context;
  let page;

  try {
    browser = await browserType.launch();
    launch = "PASS";
    context = await browser.newContext();
    contextStatus = "PASS";
    page = await context.newPage();
    pageStatus = "PASS";
    await page.goto(
      "data:text/html,<title>AegisAI%20Browser%20Doctor</title><main>browser-runtime-ready</main>",
    );
    const content = await page.getByText("browser-runtime-ready").textContent();
    navigation = content === "browser-runtime-ready" ? "PASS" : "FAIL";
  } catch {
    if (launch === "SKIP") launch = "FAIL";
    else if (contextStatus === "SKIP") contextStatus = "FAIL";
    else if (pageStatus === "SKIP") pageStatus = "FAIL";
    else navigation = "FAIL";
  } finally {
    await Promise.allSettled([
      page?.close(),
      context?.close(),
      browser?.close(),
    ]);
  }

  return {
    browser: name,
    launch,
    context: contextStatus,
    page: pageStatus,
    navigation,
    result:
      launch === "PASS" &&
      contextStatus === "PASS" &&
      pageStatus === "PASS" &&
      navigation === "PASS"
        ? "PASS"
        : "FAIL",
  };
}

const browserTypes: readonly (readonly [string, BrowserType])[] = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
];
const results: BrowserDoctorResult[] = [];
for (const [name, browserType] of browserTypes) {
  results.push(await checkBrowser(name, browserType));
}

const headings = [
  "Browser",
  "Launch",
  "Context",
  "Page",
  "Navigation",
  "Result",
] as const;
const widths = [10, 7, 8, 5, 10, 6] as const;
console.log(
  headings
    .map((heading, index) => heading.padEnd(widths[index] ?? 0))
    .join("  "),
);
for (const result of results) {
  console.log(
    [
      result.browser,
      result.launch,
      result.context,
      result.page,
      result.navigation,
      result.result,
    ]
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join("  "),
  );
}

process.exitCode = results.some(({ result }) => result === "FAIL") ? 1 : 0;
