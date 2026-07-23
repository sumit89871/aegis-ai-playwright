import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  doctorExitCode,
  evaluateFrameworkDoctor,
  renderFrameworkDoctor,
} from "../packages/core/src/framework/index.ts";
import type { FrameworkDoctorInput } from "../packages/core/src/framework/index.ts";

interface PackageJson {
  readonly version?: string;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const repositoryRoot = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);

function readPackage(relativePath: string): PackageJson {
  return JSON.parse(
    readFileSync(new URL(relativePath, repositoryRoot), "utf8"),
  ) as PackageJson;
}

function installedPackageVersion(packageName: string): string | null {
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(
      readFileSync(packagePath, "utf8"),
    ) as PackageJson;
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function npmVersion(): string | null {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function collectDoctorInput(
  browserExecutablesRequired: boolean,
): Promise<FrameworkDoctorInput> {
  const rootPackage = readPackage("package.json");
  const corePackage = readPackage("packages/core/package.json");
  const coreDependencies = {
    ...corePackage.dependencies,
    ...corePackage.devDependencies,
    ...corePackage.peerDependencies,
    ...corePackage.optionalDependencies,
  };
  let coreResolvable: boolean;
  let coreImportable: boolean;
  let coreExports: readonly string[] = [];
  let aiConfigurationImportable = false;
  let aiDisabledByDefault = false;
  let aiProviderIdsValid = false;
  let aiMockProviderAvailable = false;
  let aiOpenRouterEndpointValid = false;
  let failureAnalysisImportable = false;
  let failureAnalysisSafeDefault = false;
  try {
    import.meta.resolve("@aegis/core");
    coreResolvable = true;
  } catch {
    coreResolvable = false;
  }
  try {
    const core = (await import("@aegis/core")) as Record<string, unknown>;
    coreImportable = true;
    coreExports = Object.keys(core);
    const defaultAiConfiguration = core.defaultAiConfiguration as
      | ((
          overrides?: Readonly<Record<string, unknown>>,
        ) => Readonly<Record<string, unknown>>)
      | undefined;
    const validateAiProviderId = core.validateAiProviderId as
      ((id: string) => boolean) | undefined;
    const MockAiProvider = core.MockAiProvider as
      | (new () => { readonly id: string; readonly networkAccess: string })
      | undefined;
    const OpenRouterAiProvider = core.OpenRouterAiProvider as
      (new () => { readonly id: string }) | undefined;
    const defaultFailureAnalysisConfiguration =
      core.defaultFailureAnalysisConfiguration as
        (() => Readonly<Record<string, unknown>>) | undefined;
    aiConfigurationImportable = [
      "createAiClient",
      "defaultAiConfiguration",
      "validateAiConfiguration",
      "MockAiProvider",
      "OpenRouterAiProvider",
    ].every((name) => coreExports.includes(name));
    failureAnalysisImportable = [
      "analyseUiFailure",
      "analyseFailureDeterministically",
      "defaultFailureAnalysisConfiguration",
      "renderFailureAnalysisMarkdown",
    ].every((name) => coreExports.includes(name));
    if (defaultFailureAnalysisConfiguration !== undefined) {
      const defaults = defaultFailureAnalysisConfiguration();
      failureAnalysisSafeDefault =
        defaults.enabled === true &&
        defaults.mode === "deterministic-only" &&
        defaults.deterministicFallbackEnabled === true;
    }
    if (
      defaultAiConfiguration !== undefined &&
      validateAiProviderId !== undefined &&
      MockAiProvider !== undefined &&
      OpenRouterAiProvider !== undefined
    ) {
      const defaults = defaultAiConfiguration();
      const mock = new MockAiProvider();
      const openRouter = new OpenRouterAiProvider();
      aiDisabledByDefault =
        defaults.enabled === false &&
        defaults.allowNetworkCalls === false &&
        defaults.apiKeyEnvironmentVariable === undefined;
      aiProviderIdsValid =
        validateAiProviderId(mock.id) && validateAiProviderId(openRouter.id);
      aiMockProviderAvailable =
        mock.id === "mock" && mock.networkAccess === "none";
      const openRouterConfiguration = defaultAiConfiguration({
        provider: "openrouter",
        model: "example/model-v1",
        mockOnly: false,
      });
      aiOpenRouterEndpointValid =
        typeof openRouterConfiguration.endpoint === "string" &&
        openRouterConfiguration.endpoint.startsWith("https://");
    }
  } catch {
    coreImportable = false;
  }

  const browserExecutables = {
    chromium: false,
    firefox: false,
    webkit: false,
  };
  try {
    const playwright = await import("@playwright/test");
    browserExecutables.chromium = existsSync(
      playwright.chromium.executablePath(),
    );
    browserExecutables.firefox = existsSync(
      playwright.firefox.executablePath(),
    );
    browserExecutables.webkit = existsSync(playwright.webkit.executablePath());
  } catch {
    // The individual doctor checks report the unavailable package and executables.
  }

  const essentialExports = [
    "createEnvironmentConfig",
    "createBrowserDiagnosticsCollector",
    "validateTestMetadata",
    "validateApplicationProfile",
    "runApplicationPreflight",
    "createAiClient",
    "MockAiProvider",
  ];

  return {
    nodeVersion: process.version,
    nodeEngineRange: rootPackage.engines?.node ?? "invalid",
    npmVersion: npmVersion(),
    packageLockExists: existsSync(new URL("package-lock.json", repositoryRoot)),
    workspaceDirectoriesPresent:
      existsSync(new URL("packages/core", repositoryRoot)) &&
      existsSync(new URL("templates/application", repositoryRoot)),
    workspaceDependenciesInstalled:
      existsSync(new URL("node_modules", repositoryRoot)) &&
      existsSync(new URL("node_modules/@aegis/core", repositoryRoot)) &&
      existsSync(new URL("node_modules/@playwright/test", repositoryRoot)),
    coreResolvable,
    coreImportable,
    typescriptConfigExists: existsSync(
      new URL("tsconfig.base.json", repositoryRoot),
    ),
    playwrightTestVersion: installedPackageVersion("@playwright/test"),
    playwrightVersion: installedPackageVersion("playwright"),
    playwrightCoreVersion: installedPackageVersion("playwright-core"),
    browserExecutables,
    essentialCoreExportsPresent: essentialExports.every((name) =>
      coreExports.includes(name),
    ),
    coreHasConsumerDependency: Object.entries(coreDependencies).some(
      ([name, specification]) =>
        name.startsWith("@aegis/example-") ||
        specification.includes("examples/"),
    ),
    aiConfigurationImportable,
    aiDisabledByDefault,
    aiProviderIdsValid,
    aiMockProviderAvailable,
    aiOpenRouterEndpointValid,
    aiExampleContainsSecret: ((): boolean => {
      try {
        const example = readFileSync(
          new URL(".env.ai.example", repositoryRoot),
          "utf8",
        );
        const keyLine = example
          .split(/\r?\n/u)
          .find((line) => line.startsWith("OPENROUTER_API_KEY="));
        return keyLine === undefined || keyLine !== "OPENROUTER_API_KEY=";
      } catch {
        return true;
      }
    })(),
    failureAnalysisImportable,
    failureAnalysisSafeDefault,
    browserExecutablesRequired,
  };
}

const supportedArguments = new Set(["--json", "--allow-missing-browsers"]);
const unsupportedArgument = process.argv
  .slice(2)
  .find((argument) => !supportedArguments.has(argument));
if (unsupportedArgument !== undefined) {
  throw new Error(`Unsupported doctor option '${unsupportedArgument}'.`);
}

const result = evaluateFrameworkDoctor(
  await collectDoctorInput(!process.argv.includes("--allow-missing-browsers")),
);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(renderFrameworkDoctor(result));
}
process.exitCode = doctorExitCode(result);
