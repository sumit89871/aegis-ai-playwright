import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const verifierScript = resolve(
  repositoryRoot,
  "scripts/ai-locator-reranking-verify.ts",
);

function execute(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", verifierScript, ...arguments_],
    {
      cwd: repositoryRoot,
      shell: false,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...environment,
      },
    },
  );
}

const PRIVATE_OUTPUT =
  /BLIND-CANDIDATE-|LOCATOR-\d{3}|sk-[A-Za-z0-9]|authorization|C:\\Users|\/home\/|reviewerRationale|raw response|prompt:/iu;

await describe("locator advisory synthetic verifier CLI", async () => {
  await it("requires explicit network confirmation without a stack trace", () => {
    const result = execute([]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--confirm-network/u);
    assert.doesNotMatch(result.stderr, /\n\s+at |C:\\Users|\/home\//u);
  });

  for (const [name, environment, expected] of [
    ["AI enablement", {}, "AEGIS_AI_ENABLED"],
    [
      "network permission",
      { AEGIS_AI_ENABLED: "true" },
      "AEGIS_AI_ALLOW_NETWORK_CALLS",
    ],
    [
      "model",
      {
        AEGIS_AI_ENABLED: "true",
        AEGIS_AI_ALLOW_NETWORK_CALLS: "true",
      },
      "AEGIS_AI_MODEL",
    ],
  ] as const)
    await it(`rejects missing ${name} safely`, () => {
      const result = execute(["--confirm-network"], environment);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(expected, "u"));
      assert.doesNotMatch(result.stderr, PRIVATE_OUTPUT);
    });

  await it("handles a missing API key before any network request", () => {
    const result = execute(["--confirm-network"], {
      AEGIS_AI_ENABLED: "true",
      AEGIS_AI_ALLOW_NETWORK_CALLS: "true",
      AEGIS_AI_MODEL: "openrouter/free",
      AEGIS_AI_INPUT_COST_PER_MILLION_USD: "0",
      AEGIS_AI_OUTPUT_COST_PER_MILLION_USD: "0",
      OPENROUTER_API_KEY: "",
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /verification: FAIL/u);
    assert.match(result.stdout, /secret-missing/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, PRIVATE_OUTPUT);
  });

  await it("is isolated from artifacts, locators, healing, and CI", async () => {
    const [script, rootPackage, workflow] = await Promise.all([
      readFile(verifierScript, "utf8"),
      readFile(resolve(repositoryRoot, "package.json"), "utf8"),
      readFile(
        resolve(repositoryRoot, ".github/workflows/framework-ci.yml"),
        "utf8",
      ),
    ]);
    assert.doesNotMatch(
      script,
      /artifacts\/locator-observations|blind\/packets|blind\/mappings|blind\/reviews|page\.(?:click|fill|press)|locator\.click|writeFile|appendFile/u,
    );
    assert.match(script, /renderLocatorAdvisoryVerificationResult/u);
    assert.doesNotMatch(
      rootPackage,
      /"ci:framework":\s*"[^"]*ai:locator:reranking:verify/u,
    );
    assert.doesNotMatch(
      workflow,
      /ai:locator:reranking:verify|OPENROUTER_API_KEY|openrouter\.ai/u,
    );
  });
});
