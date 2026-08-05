import {
  createAiClient,
  defaultAiConfiguration,
  LOCATOR_ADVISORY_RERANKING_CAPABILITY,
  OpenRouterAiProvider,
  renderLocatorAdvisoryVerificationResult,
  verifyLocatorAdvisoryStructuredOutput,
} from "@aegis/core";

const arguments_ = process.argv.slice(2);

function failConfiguration(message: string): never {
  process.stderr.write(
    `Locator advisory structured-output verification: FAIL\nSafe error code: verification-configuration-invalid\n${message}\n`,
  );
  process.exit(1);
}

if (arguments_.length !== 1 || arguments_[0] !== "--confirm-network")
  failConfiguration(
    "Run with --confirm-network only when one bounded synthetic request is intended.",
  );
if (process.env.AEGIS_AI_ENABLED !== "true")
  failConfiguration("AEGIS_AI_ENABLED must be true for this explicit command.");
if (process.env.AEGIS_AI_ALLOW_NETWORK_CALLS !== "true")
  failConfiguration(
    "AEGIS_AI_ALLOW_NETWORK_CALLS must be true for this explicit command.",
  );
const model = process.env.AEGIS_AI_MODEL;
if (model === undefined || model.trim().length === 0)
  failConfiguration("AEGIS_AI_MODEL must be configured locally.");
const inputPrice = Number(process.env.AEGIS_AI_INPUT_COST_PER_MILLION_USD);
const outputPrice = Number(process.env.AEGIS_AI_OUTPUT_COST_PER_MILLION_USD);
if (
  !Number.isFinite(inputPrice) ||
  inputPrice < 0 ||
  !Number.isFinite(outputPrice) ||
  outputPrice < 0
)
  failConfiguration(
    "Both local per-million-token pricing values must be finite and non-negative.",
  );

const client = createAiClient(
  defaultAiConfiguration({
    enabled: true,
    provider: "openrouter",
    model,
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    allowNetworkCalls: true,
    mockOnly: false,
    enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
    requestTimeoutMs: 15_000,
    maxRetries: 0,
    maxInputCharacters: 30_000,
    maxOutputTokens: 512,
    maxEstimatedCostUsd: 0.01,
    defaultTemperature: 0,
    applicationName: "aegis-locator-advisory-verification",
  }),
  {
    providers: [new OpenRouterAiProvider()],
    environment: process.env,
    pricing: {
      inputCostPerMillionTokens: inputPrice,
      outputCostPerMillionTokens: outputPrice,
    },
  },
);

const result = await verifyLocatorAdvisoryStructuredOutput(client);
process.stdout.write(renderLocatorAdvisoryVerificationResult(result));
if (result.status === "fail") process.exitCode = 1;
