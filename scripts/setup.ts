import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { satisfiesVersionRange } from "../packages/core/src/framework/index.ts";

interface RootPackage {
  readonly engines?: { readonly node?: string };
}

const repositoryRoot = new URL("../", import.meta.url);
const rootPackage = JSON.parse(
  readFileSync(new URL("package.json", repositoryRoot), "utf8"),
) as RootPackage;
const nodeEngine = rootPackage.engines?.node;
const skipBrowsers = process.argv.includes("--skip-browsers");
const require = createRequire(import.meta.url);

function fail(message: string): never {
  throw new Error(message);
}

function runLocalNodeScript(
  scriptPath: string,
  arguments_: readonly string[],
  failureMessage: string,
): void {
  const execution = spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (execution.error !== undefined || execution.status !== 0) {
    fail(failureMessage);
  }
}

try {
  console.log("AegisAI framework setup");

  if (nodeEngine === undefined) {
    fail("The root package does not declare a Node.js engine requirement.");
  }
  if (!satisfiesVersionRange(process.version, nodeEngine)) {
    fail(
      `Unsupported Node.js ${process.version}. Install a Node.js version satisfying ${nodeEngine}.`,
    );
  }
  console.log(`PASS Node.js ${process.version} satisfies ${nodeEngine}`);

  if (!existsSync(new URL("node_modules", repositoryRoot))) {
    fail(
      "Workspace dependencies are missing. Run npm install before npm run setup.",
    );
  }

  let playwrightPackagePath: string;
  try {
    playwrightPackagePath = require.resolve("@playwright/test/package.json");
    import.meta.resolve("@aegis/core");
  } catch {
    fail(
      "Required workspace packages are missing. Run npm install from the repository root.",
    );
  }
  console.log("PASS Workspace dependencies are installed");

  const playwrightCli = join(dirname(playwrightPackagePath), "cli.js");
  if (!existsSync(playwrightCli)) {
    fail("The repository-local Playwright CLI is missing. Run npm install.");
  }
  console.log("PASS Repository-local Playwright CLI is available");

  if (skipBrowsers) {
    console.log("SKIP Browser installation was disabled with --skip-browsers");
  } else {
    console.log("Installing or verifying Chromium, Firefox, and WebKit...");
    runLocalNodeScript(
      playwrightCli,
      ["install", "chromium", "firefox", "webkit"],
      "Playwright browser installation failed. Check network access and run npm run setup again.",
    );
    console.log("PASS Playwright browser installation completed");
  }

  const typescriptPackagePath = require.resolve("typescript/package.json");
  const typescriptCli = join(dirname(typescriptPackagePath), "bin", "tsc");
  runLocalNodeScript(
    typescriptCli,
    ["-p", "packages/core/tsconfig.json"],
    "@aegis/core TypeScript verification failed. Run npm run typecheck for details.",
  );

  const core = (await import("@aegis/core")) as Record<string, unknown>;
  if (typeof core.createEnvironmentConfig !== "function") {
    fail("@aegis/core imported but its essential exports are unavailable.");
  }
  console.log("PASS @aegis/core typecheck and import verification completed");
  console.log("");
  console.log("Next: npm run doctor");
  console.log("Then: npm run doctor:browsers");
  console.log("Finally: npm run validate");
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Framework setup failed.";
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}
