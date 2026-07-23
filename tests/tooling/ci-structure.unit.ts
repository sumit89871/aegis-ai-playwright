import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { check } from "prettier";

const repositoryRoot = new URL("../../", import.meta.url);
const frameworkWorkflow = readFileSync(
  new URL(".github/workflows/framework-ci.yml", repositoryRoot),
  "utf8",
);
const referenceWorkflow = readFileSync(
  new URL(".github/workflows/reference-consumer-ci.yml", repositoryRoot),
  "utf8",
);
const workflows = [frameworkWorkflow, referenceWorkflow] as const;

await describe("GitHub Actions workflow structure", async () => {
  await it("contains syntactically valid YAML workflows", async () => {
    for (const workflow of workflows) {
      assert.equal(await check(workflow, { parser: "yaml" }), true);
    }
  });

  await it("uses read-only permissions and safe event triggers", () => {
    for (const workflow of workflows) {
      assert.match(workflow, /permissions:\s*\n\s+contents: read/u);
      assert.doesNotMatch(workflow, /pull_request_target|secrets\./u);
      assert.doesNotMatch(workflow, /contents:\s*write/u);
    }
  });

  await it("uses locked installation and the pinned Node version", () => {
    for (const workflow of workflows) {
      assert.match(workflow, /run: npm ci/u);
      assert.match(workflow, /node-version-file: \.nvmrc/u);
      assert.doesNotMatch(workflow, /run: npm install(?:\s|$)/u);
    }
  });

  await it("keeps framework quality independent from applications", () => {
    const frameworkQuality = frameworkWorkflow.slice(
      frameworkWorkflow.indexOf("framework-quality:"),
      frameworkWorkflow.indexOf("browser-runtime:"),
    );
    assert.doesNotMatch(
      frameworkQuality,
      /nopcommerce|localhost|docker|postgres/iu,
    );
    assert.match(frameworkQuality, /npm run ci:framework/u);
    const rootPackage = readFileSync(
      new URL("package.json", repositoryRoot),
      "utf8",
    );
    assert.match(rootPackage, /"ci:framework": "[^"]*npm run ui:policy/u);
    assert.match(rootPackage, /"ci:framework": "[^"]*npm run ai:smoke/u);
    assert.doesNotMatch(frameworkQuality, /test:accessibility/u);
    assert.doesNotMatch(
      frameworkQuality,
      /OPENROUTER_API_KEY|openrouter\.ai|secrets\./u,
    );
  });

  await it("defines exactly the required browser matrix and artifacts", () => {
    assert.match(
      frameworkWorkflow,
      /browser:\s*\[chromium, firefox, webkit\]/u,
    );
    assert.match(
      frameworkWorkflow,
      /doctor:browsers -- --browser=\$\{\{ matrix\.browser \}\} --json/u,
    );
    assert.match(frameworkWorkflow, /if: always\(\)/u);
    assert.match(frameworkWorkflow, /actions\/upload-artifact@v7/u);
  });

  await it("keeps reference validation static", () => {
    assert.match(referenceWorkflow, /npm run ci:reference/u);
    assert.doesNotMatch(
      referenceWorkflow,
      /nopcommerce:test:smoke|nopcommerce:preflight|infra:|docker|postgres/iu,
    );

    const rootPackage = readFileSync(
      new URL("package.json", repositoryRoot),
      "utf8",
    );
    assert.match(
      rootPackage,
      /npm run typecheck --workspace=@aegis\/example-nopcommerce/u,
    );
  });

  await it("uses only stable major references for official actions", () => {
    for (const workflow of workflows) {
      assert.doesNotMatch(workflow, /uses:\s*[^\s]+@(main|master)\b/u);
      for (const action of workflow.matchAll(/uses:\s*([^\s]+)@([^\s]+)/gu)) {
        assert.match(action[1] ?? "", /^actions\//u);
        assert.match(action[2] ?? "", /^v\d+$/u);
      }
    }
  });
});
