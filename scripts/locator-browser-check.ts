import { chromium, firefox, webkit } from "playwright";
import type { BrowserType } from "playwright";
import { collectLocatorCandidates } from "@aegis/core";

const supported = ["chromium", "firefox", "webkit"] as const;
type BrowserName = (typeof supported)[number];
const requested =
  process.argv
    .find((argument) => argument.startsWith("--browser="))
    ?.slice("--browser=".length) ?? "chromium";
if (!supported.includes(requested as BrowserName))
  throw new Error(`Unsupported locator browser '${requested}'.`);
const browserTypes: Readonly<Record<BrowserName, BrowserType>> = {
  chromium,
  firefox,
  webkit,
};
const browser = await browserTypes[requested as BrowserName].launch();
try {
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <button aria-label="Save changes" data-testid="save-button">Save</button>
      <button disabled>Disabled action</button>
      <a href="#one">Duplicate label</a><a href="#two">Duplicate label</a>
      <label>Email <input placeholder="name@example.test" value="private-value-must-not-appear"></label>
    </main>
  `);
  const before = await page.locator("main").textContent();
  const inventory = await collectLocatorCandidates(
    page,
    {
      operation: "click",
      strategy: "role",
      role: "button",
      name: "Save changes",
    },
    { includeDisabledCandidates: true },
  );
  const after = await page.locator("main").textContent();
  const role = inventory.candidates.find(
    (candidate) =>
      candidate.strategy === "role" && candidate.name === "Save changes",
  );
  const duplicate = inventory.candidates.find(
    (candidate) =>
      candidate.strategy === "text" && candidate.value === "Duplicate label",
  );
  const disabled = inventory.candidates.find(
    (candidate) => candidate.name === "Disabled action",
  );
  const serialized = JSON.stringify(inventory);
  if (
    inventory.status !== "collected" ||
    role?.matchCount !== 1 ||
    (duplicate?.matchCount ?? 0) < 2 ||
    disabled?.enabled !== false ||
    before !== after ||
    serialized.includes("private-value-must-not-appear") ||
    serialized.includes("<main")
  )
    throw new Error("Locator candidate browser integration assertions failed.");
  console.log(
    JSON.stringify(
      {
        status: "pass",
        browser: requested,
        candidates: inventory.candidates.length,
        roleUnique: true,
        duplicateTextCount: duplicate?.matchCount,
        disabledDetected: true,
        pageUnchanged: true,
        inputValuesRetained: false,
        fullHtmlRetained: false,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
