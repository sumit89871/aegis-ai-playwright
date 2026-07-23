import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, repositoryRoot), "utf8");
}

await describe("AI foundation security invariants", async () => {
  await it("keeps the committed AI environment example secret-free", () => {
    const example = read(".env.ai.example");
    assert.match(example, /^AEGIS_AI_ENABLED=false$/mu);
    assert.match(example, /^OPENROUTER_API_KEY=$/mu);
    assert.doesNotMatch(example, /OPENROUTER_API_KEY=\S+/u);
  });

  await it("uses the offline mock for the repository AI smoke", () => {
    const smoke = read("scripts/ai-smoke.ts");
    assert.match(smoke, /new MockAiProvider/u);
    assert.match(smoke, /allowNetworkCalls: false/u);
    assert.match(smoke, /networkCalls: 0/u);
    assert.doesNotMatch(smoke, /OpenRouterAiProvider|OPENROUTER_API_KEY/u);
  });

  await it("runs only offline AI validation in framework CI", () => {
    const rootPackage = read("package.json");
    const workflow = read(".github/workflows/framework-ci.yml");
    assert.match(rootPackage, /"ci:framework": "[^"]*npm run ai:smoke/u);
    assert.match(rootPackage, /"ci:framework": "[^"]*npm run ai:analyse:demo/u);
    assert.doesNotMatch(
      workflow,
      /OPENROUTER_API_KEY|openrouter\.ai|AEGIS_AI_ENABLED|secrets\./u,
    );
  });

  await it("keeps advisory analysis offline in automated execution", () => {
    const demo = read("scripts/ai-analyse-demo.ts");
    const fixture = read("examples/nopcommerce/src/fixtures/test-fixtures.ts");
    assert.match(demo, /new MockAiProvider/u);
    assert.match(demo, /allowNetworkCalls: false/u);
    assert.match(demo, /networkCalls: 0/u);
    assert.doesNotMatch(demo, /OpenRouterAiProvider|OPENROUTER_API_KEY/u);
    assert.match(fixture, /defaultFailureAnalysisConfiguration\(\)/u);
    assert.doesNotMatch(fixture, /createAiClient|OpenRouterAiProvider/u);
  });

  await it("guards optional OpenRouter verification behind explicit consent", () => {
    const verification = read("scripts/ai-openrouter-verify.ts");
    const rootPackage = read("package.json");
    assert.match(verification, /--confirm-network/u);
    assert.match(verification, /AEGIS_AI_ALLOW_NETWORK_CALLS/u);
    assert.match(verification, /maxEstimatedCostUsd: 0\.01/u);
    assert.doesNotMatch(
      rootPackage,
      /"ci:framework": "[^"]*openrouter:verify/u,
    );
  });

  await it("exposes no automatic remediation or command execution", () => {
    const files = [
      "packages/core/src/ai-analysis/failure-analysis-client.ts",
      "packages/core/src/ai-analysis/deterministic-failure-analysis.ts",
      "packages/core/src/ai-analysis/failure-analysis-validator.ts",
    ];
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /child_process|execSync|spawnSync/u);
      assert.doesNotMatch(source, /writeFile|apply_patch|git\s+commit/u);
      assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/u);
    }
  });

  await it("contains no dynamic model-code execution primitive", () => {
    const files = [
      "packages/core/src/ai/ai-client.ts",
      "packages/core/src/ai/prompt-template.ts",
      "packages/core/src/ai/structured-output.ts",
    ];
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/u);
      assert.doesNotMatch(source, /import\s*\([^"']/u);
    }
  });

  await it("does not enumerate process environment variables", () => {
    const source = read("packages/core/src/ai/ai-client.ts");
    const resolver = read("packages/core/src/ai/secret-resolution.ts");
    assert.doesNotMatch(
      `${source}\n${resolver}`,
      /Object\.(?:keys|values|entries)\(process\.env\)|for\s*\([^)]*process\.env/u,
    );
  });
});
