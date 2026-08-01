import {
  createAiClient,
  defaultAiConfiguration,
  LOCATOR_VALIDATION_DATASET,
  OpenRouterAiProvider,
  runLocatorEvaluationDataset,
} from "@aegis/core";

if (process.argv.length !== 3 || process.argv[2] !== "--confirm-network") {
  throw new Error(
    "OpenRouter locator evaluation requires explicit --confirm-network consent.",
  );
}
if (process.env.AEGIS_AI_ENABLED !== "true")
  throw new Error(
    "OpenRouter locator evaluation requires AEGIS_AI_ENABLED=true.",
  );
if (process.env.AEGIS_AI_ALLOW_NETWORK_CALLS !== "true")
  throw new Error(
    "OpenRouter locator evaluation requires AEGIS_AI_ALLOW_NETWORK_CALLS=true.",
  );
const model = process.env.AEGIS_AI_MODEL;
if (model === undefined || model.trim().length === 0)
  throw new Error("OpenRouter locator evaluation requires AEGIS_AI_MODEL.");
const inputPrice = Number(process.env.AEGIS_AI_INPUT_COST_PER_MILLION_USD);
const outputPrice = Number(process.env.AEGIS_AI_OUTPUT_COST_PER_MILLION_USD);
if (
  !Number.isFinite(inputPrice) ||
  inputPrice < 0 ||
  !Number.isFinite(outputPrice) ||
  outputPrice < 0
)
  throw new Error(
    "OpenRouter locator evaluation requires non-negative local pricing inputs.",
  );

const client = createAiClient(
  defaultAiConfiguration({
    enabled: true,
    provider: "openrouter",
    model,
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    allowNetworkCalls: true,
    mockOnly: false,
    enabledCapabilities: ["ui-locator-diagnosis"],
    requestTimeoutMs: 15_000,
    maxRetries: 0,
    maxInputCharacters: 40_000,
    maxOutputTokens: 512,
    maxEstimatedCostUsd: 0.01,
    defaultTemperature: 0,
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
const limitedDataset = Object.freeze({
  ...LOCATOR_VALIDATION_DATASET,
  description:
    "Explicitly authorized limited sanitized validation subset for OpenRouter.",
  cases: Object.freeze(
    LOCATOR_VALIDATION_DATASET.cases.filter(({ caseId }) =>
      ["LOC-EVAL-VAL-001", "LOC-EVAL-VAL-005", "LOC-EVAL-VAL-007"].includes(
        caseId,
      ),
    ),
  ),
});
const result = await runLocatorEvaluationDataset(limitedDataset, {
  mode: "ai-advisory",
  aiClientFactory: () => client,
});
console.log(`OpenRouter locator evaluation: ${result.status.toUpperCase()}`);
console.log(`Provider: openrouter`);
console.log(`Requested model: ${model}`);
console.log(`Cases: ${String(result.dataset.caseCount)}`);
console.log(
  `Classification accuracy: ${String(result.metrics.classification.accuracy.value ?? "unavailable")}`,
);
console.log(
  `Recommendation accuracy: ${String(result.metrics.recommendation.accuracy.value ?? "unavailable")}`,
);
console.log(`Rejected outputs: ${String(result.aiComparison.rejectedOutputs)}`);
console.log(`Fallback count: ${String(result.aiComparison.fallbackCount)}`);
console.log("Raw prompts and responses: not retained");
process.exitCode = result.status === "pass" ? 0 : 1;
