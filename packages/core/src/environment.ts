import type {
  EnvironmentConfig,
  EnvironmentDefaults,
  EnvironmentVariables,
} from "./types/environment.types.ts";

export function parseHttpUrl(value: string, configurationName: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(
      `Invalid ${configurationName} configuration: "${value}" is not a valid URL. ` +
        "Provide an absolute HTTP or HTTPS URL.",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Invalid ${configurationName} configuration: protocol "${parsedUrl.protocol}" is not supported. ` +
        "Use HTTP or HTTPS.",
    );
  }

  return parsedUrl.toString().replace(/\/$/, "");
}

export function createEnvironmentConfig(
  defaults: EnvironmentDefaults,
  variables: EnvironmentVariables,
): Readonly<EnvironmentConfig> {
  const configuredBaseUrl = variables.BASE_URL?.trim();
  const baseUrlCandidate =
    configuredBaseUrl === undefined || configuredBaseUrl.length === 0
      ? defaults.baseUrl
      : configuredBaseUrl;
  const configuredTestEnvironment = variables.TEST_ENV?.trim();
  const testEnvironment =
    configuredTestEnvironment === undefined ||
    configuredTestEnvironment.length === 0
      ? defaults.testEnvironment.trim()
      : configuredTestEnvironment;

  if (testEnvironment.length === 0) {
    throw new Error(
      "Invalid TEST_ENV configuration: provide a non-empty environment name.",
    );
  }

  return Object.freeze({
    baseUrl: parseHttpUrl(baseUrlCandidate, "BASE_URL"),
    testEnvironment,
    isCi: variables.CI === "true" || variables.CI === "1",
  });
}
