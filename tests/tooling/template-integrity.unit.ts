import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const templateRoot = new URL("../../templates/application/", import.meta.url);
const requiredFiles = [
  "README.md",
  "package.json.template",
  "playwright.config.ts.template",
  "tsconfig.json.template",
  "scripts/run-preflight.ts.template",
  "src/config/application-profile.ts.template",
  "src/components/navigation.component.ts.template",
  "src/pages/application.page.ts.template",
  "src/flows/open-application.flow.ts.template",
  "src/fixtures/test-fixtures.ts.template",
  "requirements/REQ-EXAMPLE-001.md.template",
  "tests/metadata/example.metadata.ts.template",
  "tests/smoke/example.spec.ts.template",
] as const;
const requiredPlaceholders = [
  "__APP_ID__",
  "__APP_NAME__",
  "__BASE_URL__",
  "__EXPECTED_TITLE__",
] as const;

await describe("application template integrity", async () => {
  await it("contains the required generic files and placeholders", async () => {
    const contents = await Promise.all(
      requiredFiles.map(async (relativePath) => {
        const content = await readFile(
          new URL(relativePath, templateRoot),
          "utf8",
        );
        return { relativePath, content };
      }),
    );
    const combined = contents.map(({ content }) => content).join("\n");

    for (const placeholder of requiredPlaceholders) {
      assert.match(combined, new RegExp(placeholder, "u"));
    }
    assert.doesNotMatch(combined, /nopcommerce/iu);
    assert.doesNotMatch(combined, /[A-Z]:\\Users\\/u);
    assert.doesNotMatch(
      combined,
      /(?:authorization|cookie|password|secret|token|api[_-]?key)\s*[:=]\s*\S+/iu,
    );
    assert.equal(contents.length, requiredFiles.length);
  });
});
