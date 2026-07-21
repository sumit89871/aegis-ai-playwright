export interface EnvironmentConfig {
  readonly baseUrl: string;
  readonly testEnvironment: string;
  readonly isCi: boolean;
}

export interface EnvironmentDefaults {
  readonly baseUrl: string;
  readonly testEnvironment: string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;
