import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { nopCommerceTestCatalog } from "../tests/metadata/index.ts";

const require = createRequire(import.meta.url);
const workspaceRoot = new URL("../", import.meta.url);
const playwrightPackage = require.resolve("@playwright/test/package.json");
const playwrightCli = join(dirname(playwrightPackage), "cli.js");

function listTests(grep?: string): string {
  const arguments_ = [
    playwrightCli,
    "test",
    "tests/smoke",
    "--project=chromium",
    "--list",
    ...(grep === undefined ? [] : ["--grep", grep]),
  ];
  const execution = spawnSync(process.execPath, arguments_, {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (execution.error !== undefined || execution.status !== 0) {
    throw new Error("Playwright test discovery failed.");
  }
  return execution.stdout;
}

const completeListing = listTests();
const expectedTestCount = nopCommerceTestCatalog.length;
if (!completeListing.includes(`Total: ${String(expectedTestCount)} tests`)) {
  throw new Error(
    `Expected Playwright to discover ${String(expectedTestCount)} registered tests.`,
  );
}

console.log(completeListing.trim());
for (const metadata of [...nopCommerceTestCatalog].sort((left, right) =>
  left.testId.localeCompare(right.testId),
)) {
  const listing = listTests(`@test-id:${metadata.testId}`);
  if (!/Total: 1 test(?:\s|$)/u.test(listing)) {
    throw new Error(
      `Expected exactly one Playwright test for ${metadata.testId}.`,
    );
  }
  console.log(`PASS ${metadata.testId} discovered through structured tags`);
}
