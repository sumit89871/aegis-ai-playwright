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

  await it("keeps locator diagnosis advisory, bounded, and offline", () => {
    const demo = read("scripts/ai-locator-demo.ts");
    const fixture = read("examples/nopcommerce/src/fixtures/test-fixtures.ts");
    const collector = read(
      "packages/core/src/locator-diagnosis/locator-candidate-collector.ts",
    );
    const client = read(
      "packages/core/src/locator-diagnosis/locator-diagnosis-client.ts",
    );
    assert.match(demo, /new MockAiProvider/u);
    assert.match(demo, /allowNetworkCalls: false/u);
    assert.match(demo, /networkCalls: 0/u);
    assert.doesNotMatch(demo, /OpenRouterAiProvider|OPENROUTER_API_KEY/u);
    assert.match(fixture, /defaultLocatorDiagnosisConfiguration\(\)/u);
    assert.doesNotMatch(fixture, /createAiClient|OpenRouterAiProvider/u);
    assert.doesNotMatch(
      `${collector}\n${client}`,
      /innerHTML|outerHTML|localStorage|sessionStorage|document\.cookie|child_process|writeFile|click\(|fill\(|press\(/u,
    );
  });

  await it("keeps locator evaluation deterministic and offline in CI", () => {
    const evaluator = read("scripts/ai-locator-evaluate.ts");
    const openRouterEvaluator = read(
      "scripts/ai-locator-evaluate-openrouter.ts",
    );
    const rootPackage = read("package.json");
    const workflow = read(".github/workflows/framework-ci.yml");
    const ignore = read(".gitignore");
    assert.match(evaluator, /runLocatorEvaluationDataset/u);
    assert.doesNotMatch(
      evaluator,
      /OpenRouterAiProvider|OPENROUTER_API_KEY|allowNetworkCalls:\s*true/u,
    );
    assert.match(openRouterEvaluator, /--confirm-network/u);
    assert.match(openRouterEvaluator, /maxRetries:\s*0/u);
    assert.match(openRouterEvaluator, /maxEstimatedCostUsd:\s*0\.01/u);
    assert.doesNotMatch(
      rootPackage,
      /"ci:framework": "[^"]*evaluate:openrouter/u,
    );
    assert.doesNotMatch(
      workflow,
      /OPENROUTER_API_KEY|openrouter\.ai|secrets\./u,
    );
    assert.match(ignore, /\/artifacts\/locator-evaluation\//u);
  });

  await it("keeps shadow observations private and holdout analysis offline", () => {
    const importer = read(
      "packages/core/src/locator-observations/locator-observation-importer.ts",
    );
    const runner = read(
      "packages/core/src/locator-observations/locator-holdout-runner.ts",
    );
    const holdout = read("scripts/locator-holdout-evaluate.ts");
    const rootPackage = read("package.json");
    const ignore = read(".gitignore");
    assert.match(ignore, /\/artifacts\/locator-observations\//u);
    assert.match(
      rootPackage,
      /"ci:framework": "[^"]*ai:locator:holdout:evaluate/u,
    );
    assert.doesNotMatch(
      `${importer}\n${runner}\n${holdout}`,
      /OpenRouterAiProvider|OPENROUTER_API_KEY|allowNetworkCalls:\s*true|document\.cookie|localStorage|sessionStorage|innerHTML|outerHTML/u,
    );
    assert.doesNotMatch(
      runner,
      /click\(|fill\(|press\(|applyLocator|retryWithCandidate|writeFile/u,
    );
  });

  await it("keeps advisory reranking opt-in, bounded, and absent from CI", () => {
    const reranker = read(
      "packages/core/src/locator-diagnosis/locator-advisory-reranking.ts",
    );
    const prompt = read(
      "packages/core/src/locator-diagnosis/locator-advisory-reranking-prompt.ts",
    );
    const comparison = read(
      "packages/core/src/locator-observations/locator-advisory-comparison.ts",
    );
    const command = read("scripts/locator-blind-holdout-compare.ts");
    const rootPackage = read("package.json");
    const workflows = `${read(".github/workflows/framework-ci.yml")}\n${read(".github/workflows/reference-consumer-ci.yml")}`;
    assert.match(command, /--confirm-network/u);
    assert.match(
      command,
      /maxOutputTokens:\s*LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS/u,
    );
    assert.match(
      command,
      /requestTimeoutMs:\s*LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS/u,
    );
    assert.match(
      reranker,
      /LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS\s*=\s*2_000/u,
    );
    assert.match(
      reranker,
      /LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS\s*=\s*30_000/u,
    );
    assert.match(command, /maxEstimatedCostUsd:\s*0\.01/u);
    assert.match(prompt, /Rank only candidate IDs supplied/u);
    assert.doesNotMatch(
      reranker,
      /expectedClassification|expectedRecommendationStatus|acceptableCandidateIds|preferredCandidateIds|forbiddenCandidateIds|reviewerRationale|deterministicScore|originalCandidateId/u,
    );
    assert.doesNotMatch(
      `${reranker}\n${comparison}`,
      /click\(|fill\(|press\(|applyLocator|retryWithCandidate|child_process|execSync|spawnSync/u,
    );
    assert.doesNotMatch(
      rootPackage,
      /"ci:framework":\s*"[^"]*ai:locator:holdout:compare/u,
    );
    assert.doesNotMatch(workflows, /ai:locator:holdout:compare/u);
  });

  await it("attaches locator reports only after an unexpected failure", () => {
    const fixture = read("examples/nopcommerce/src/fixtures/test-fixtures.ts");
    const failureGuard = fixture.indexOf(
      "testInfo.status !== testInfo.expectedStatus",
    );
    const generalAnalysis = fixture.indexOf("await createFailureAnalysis(");
    const locatorAnalysis = fixture.indexOf("await createLocatorDiagnosis(");
    assert.ok(failureGuard >= 0);
    assert.ok(generalAnalysis > failureGuard);
    assert.ok(locatorAnalysis > generalAnalysis);
    assert.match(fixture, /locator-diagnosis\.json/u);
    assert.match(fixture, /locator-diagnosis\.md/u);
  });

  await it("guards optional OpenRouter verification behind explicit consent", () => {
    const verification = read("scripts/ai-openrouter-verify.ts");
    const rootPackage = read("package.json");
    assert.match(verification, /--confirm-network/u);
    assert.match(verification, /AEGIS_AI_ALLOW_NETWORK_CALLS/u);
    assert.match(verification, /maxEstimatedCostUsd: 0\.01/u);
    assert.match(verification, /requestTimeoutMs: 15_000/u);
    assert.match(verification, /maxRetries: 0/u);
    assert.match(verification, /maxOutputTokens: 128/u);
    assert.doesNotMatch(
      verification,
      /console\.(?:log|error)\([^\n]*(?:result\.text|structuredOutput|apiKey)/u,
    );
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
      "packages/core/src/locator-diagnosis/locator-diagnosis-client.ts",
      "packages/core/src/locator-diagnosis/deterministic-locator-diagnosis.ts",
      "packages/core/src/locator-evaluation/evaluation-runner.ts",
      "packages/core/src/locator-evaluation/evaluation-metrics.ts",
      "packages/core/src/locator-evaluation/evaluation-validator.ts",
      "packages/core/src/locator-observations/locator-holdout-runner.ts",
      "packages/core/src/locator-observations/locator-observation-validator.ts",
    ];
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /child_process|execSync|spawnSync/u);
      assert.doesNotMatch(source, /writeFile|apply_patch|git\s+commit/u);
      assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/u);
    }
    const locatorValidator = read(
      "packages/core/src/locator-diagnosis/locator-diagnosis-validator.ts",
    );
    assert.match(locatorValidator, /child_process/u);
    assert.match(locatorValidator, /begin patch/u);
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
