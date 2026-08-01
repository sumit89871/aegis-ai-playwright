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
  let locatorDiagnosisImportable = false;
  let locatorDiagnosisDeterministicDefault = false;
  let locatorDiagnosisAiDisabledDefault = false;
  let locatorDiagnosisLimitsValid = false;
  let locatorDiagnosisMockAvailable = false;
  let locatorEvaluationImportable = false;
  let locatorEvaluationDatasetsValid = false;
  let locatorEvaluationCaseIdsUnique = false;
  let locatorEvaluationThresholdsValid = false;
  let locatorEvaluationDeterministicDefault = false;
  let locatorEvaluationNetworkDisabledDefault = false;
  let locatorObservationImportable = false;
  let locatorObservationSchemaValid = false;
  let locatorObservationReviewSchemaValid = false;
  let locatorHoldoutDeterministicDefault = false;
  let locatorHoldoutNetworkDisabledDefault = false;
  let locatorHoldoutApiKeyNotRequired = false;
  let locatorHoldoutDoesNotApplyLocators = false;
  let automaticHealingAbsent = false;
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
    const defaultLocatorDiagnosisConfiguration =
      core.defaultLocatorDiagnosisConfiguration as
        (() => Readonly<Record<string, unknown>>) | undefined;
    const validateLocatorEvaluationDataset =
      core.validateLocatorEvaluationDataset as
        | ((value: unknown) => {
            readonly cases: readonly { readonly caseId: string }[];
          })
        | undefined;
    const validateLocatorEvaluationThresholds =
      core.validateLocatorEvaluationThresholds as
        ((value: unknown) => unknown) | undefined;
    const evaluationDatasets = core.LOCATOR_EVALUATION_DATASETS as
      readonly unknown[] | undefined;
    const evaluationThresholds = core.LOCATOR_EVALUATION_BASELINE;
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
    locatorDiagnosisImportable = [
      "classifyLocatorFailure",
      "collectLocatorCandidates",
      "diagnoseLocatorFailure",
      "diagnoseLocatorDeterministically",
      "renderLocatorDiagnosisMarkdown",
    ].every((name) => coreExports.includes(name));
    locatorEvaluationImportable = [
      "runLocatorEvaluationDataset",
      "calculateLocatorEvaluationMetrics",
      "validateLocatorEvaluationDataset",
      "validateLocatorEvaluationThresholds",
      "renderLocatorEvaluationMarkdown",
    ].every((name) => coreExports.includes(name));
    locatorObservationImportable = [
      "importLocatorDiagnosisObservation",
      "validateLocatorObservation",
      "createLocatorObservationReviewTemplate",
      "validateLocatorObservationReview",
      "runLocatorHoldoutEvaluation",
      "renderLocatorHoldoutMarkdown",
    ].every((name) => coreExports.includes(name));
    locatorObservationSchemaValid =
      core.LOCATOR_OBSERVATION_SCHEMA_VERSION === "1.0.0" &&
      Array.isArray(core.LOCATOR_OBSERVATION_SOURCE_TYPES) &&
      core.LOCATOR_OBSERVATION_SOURCE_TYPES.length === 4;
    locatorObservationReviewSchemaValid =
      Array.isArray(core.LOCATOR_OBSERVATION_REVIEW_STATUSES) &&
      core.LOCATOR_OBSERVATION_REVIEW_STATUSES.length === 4;
    locatorHoldoutDeterministicDefault =
      core.DEFAULT_LOCATOR_HOLDOUT_MODE === "deterministic-only";
    locatorHoldoutNetworkDisabledDefault = locatorHoldoutDeterministicDefault;
    locatorHoldoutApiKeyNotRequired = locatorHoldoutDeterministicDefault;
    locatorHoldoutDoesNotApplyLocators = ![
      "applyHoldoutLocator",
      "replayLocatorObservation",
      "healFromObservation",
    ].some((name) => coreExports.includes(name));
    if (
      validateLocatorEvaluationDataset !== undefined &&
      validateLocatorEvaluationThresholds !== undefined &&
      evaluationDatasets !== undefined
    ) {
      try {
        const validated = evaluationDatasets.map((dataset) =>
          validateLocatorEvaluationDataset(dataset),
        );
        locatorEvaluationDatasetsValid = validated.length === 2;
        const ids = validated.flatMap(({ cases }) =>
          cases.map(({ caseId }) => caseId),
        );
        locatorEvaluationCaseIdsUnique = new Set(ids).size === ids.length;
        validateLocatorEvaluationThresholds(evaluationThresholds);
        locatorEvaluationThresholdsValid = true;
      } catch {
        locatorEvaluationDatasetsValid = false;
      }
    }
    locatorEvaluationDeterministicDefault =
      core.DEFAULT_LOCATOR_EVALUATION_MODE === "deterministic-only";
    locatorEvaluationNetworkDisabledDefault =
      locatorEvaluationDeterministicDefault;
    if (defaultLocatorDiagnosisConfiguration !== undefined) {
      const defaults = defaultLocatorDiagnosisConfiguration();
      locatorDiagnosisDeterministicDefault =
        defaults.enabled === true && defaults.deterministicEnabled === true;
      locatorDiagnosisAiDisabledDefault =
        defaults.mode === "deterministic-only" &&
        defaults.aiAdvisoryEnabled === false;
      locatorDiagnosisLimitsValid =
        typeof defaults.maximumDurationMs === "number" &&
        defaults.maximumDurationMs <= 10_000 &&
        typeof defaults.maximumCandidates === "number" &&
        defaults.maximumCandidates <= 100;
    }
    automaticHealingAbsent = ![
      "healLocator",
      "replaceLocator",
      "applyLocatorRepair",
      "retryWithCandidate",
    ].some((name) => coreExports.includes(name));
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
    locatorDiagnosisMockAvailable =
      locatorDiagnosisImportable && aiMockProviderAvailable;
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
    locatorDiagnosisImportable,
    locatorDiagnosisDeterministicDefault,
    locatorDiagnosisAiDisabledDefault,
    locatorDiagnosisLimitsValid,
    locatorDiagnosisMockAvailable,
    locatorEvaluationImportable,
    locatorEvaluationDatasetsValid,
    locatorEvaluationCaseIdsUnique,
    locatorEvaluationThresholdsValid,
    locatorEvaluationDeterministicDefault,
    locatorEvaluationNetworkDisabledDefault,
    locatorEvaluationArtifactsIgnored: readFileSync(
      new URL(".gitignore", repositoryRoot),
      "utf8",
    ).includes("/artifacts/locator-evaluation/"),
    locatorObservationImportable,
    locatorObservationSchemaValid,
    locatorObservationReviewSchemaValid,
    locatorObservationArtifactsIgnored: readFileSync(
      new URL(".gitignore", repositoryRoot),
      "utf8",
    ).includes("/artifacts/locator-observations/"),
    locatorHoldoutDeterministicDefault,
    locatorHoldoutNetworkDisabledDefault,
    locatorHoldoutApiKeyNotRequired,
    locatorHoldoutDoesNotApplyLocators,
    automaticHealingAbsent,
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
