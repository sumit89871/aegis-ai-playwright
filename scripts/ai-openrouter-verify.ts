import {
  AiError,
  createAiClient,
  defaultAiConfiguration,
  OpenRouterAiProvider,
  untrustedPromptValue,
} from "@aegis/core";

const CONFIRMATION_FLAG = "--confirm-network";
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 1 || arguments_[0] !== CONFIRMATION_FLAG) {
  throw new Error(
    `OpenRouter verification is networked and must be explicitly confirmed with ${CONFIRMATION_FLAG}.`,
  );
}
if (process.env.AEGIS_AI_ENABLED !== "true") {
  throw new Error("OpenRouter verification requires AEGIS_AI_ENABLED=true.");
}
if (process.env.AEGIS_AI_ALLOW_NETWORK_CALLS !== "true") {
  throw new Error(
    "OpenRouter verification requires AEGIS_AI_ALLOW_NETWORK_CALLS=true.",
  );
}
const model = process.env.AEGIS_AI_MODEL;
if (model === undefined || model.trim().length === 0) {
  throw new Error("OpenRouter verification requires AEGIS_AI_MODEL.");
}
const inputPrice = Number(process.env.AEGIS_AI_INPUT_COST_PER_MILLION_USD);
const outputPrice = Number(process.env.AEGIS_AI_OUTPUT_COST_PER_MILLION_USD);
if (
  !Number.isFinite(inputPrice) ||
  inputPrice < 0 ||
  !Number.isFinite(outputPrice) ||
  outputPrice < 0
) {
  throw new Error(
    "OpenRouter verification requires valid non-negative local pricing inputs.",
  );
}

const client = createAiClient(
  defaultAiConfiguration({
    enabled: true,
    provider: "openrouter",
    model,
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    allowNetworkCalls: true,
    mockOnly: false,
    enabledCapabilities: ["provider-verification"],
    requestTimeoutMs: 15_000,
    maxRetries: 0,
    maxInputCharacters: 2_000,
    maxOutputTokens: 128,
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
const verificationStartedAt = Date.now();
try {
  const result = await client.generate({
    template: Object.freeze({
      id: "provider-verification",
      version: "1.0.0",
      purpose:
        "Verify an explicitly authorized provider connection with synthetic data.",
      systemTemplate: "Return only a JSON object whose status is ok.",
      userTemplate: "Synthetic request: {{evidence}}",
      requiredVariables: Object.freeze(["evidence"]),
      maximumRenderedLength: 1_000,
    }),
    variables: Object.freeze({
      evidence: untrustedPromptValue(
        "Provider connection verification.",
        "synthetic-evidence",
      ),
    }),
    responseFormat: Object.freeze({
      type: "json_object" as const,
      validatorId: "provider-verification-v1",
      validator: (value) => value.status === "ok",
    }),
    capability: "provider-verification",
    maxOutputTokens: 128,
  });
  if (result.status !== "completed" || result.structuredOutput === undefined) {
    throw new Error(
      "OpenRouter verification did not return validated structured output.",
    );
  }
  console.log("OpenRouter verification: PASS");
  console.log(`Provider: ${result.providerId}`);
  console.log(`Requested model: ${model}`);
  console.log(`Returned model: ${result.model}`);
  console.log(
    `Input tokens: ${String(result.usage?.inputTokens ?? "unavailable")}`,
  );
  console.log(
    `Output tokens: ${String(result.usage?.outputTokens ?? "unavailable")}`,
  );
  console.log(
    `Reasoning tokens: ${String(result.usage?.reasoningTokens ?? "unavailable")}`,
  );
  console.log(
    `Approximate cost USD: ${String(result.approximateCostUsd ?? "unavailable")}`,
  );
  console.log(`Duration ms: ${String(result.durationMs)}`);
  console.log(`Retry count: ${String(result.retryCount)}`);
  console.log(`Finish reason: ${result.finishReason}`);
  console.log(
    `Provider request ID: ${result.providerRequestId ?? "unavailable"}`,
  );
  console.log("Structured-output validation: PASS");
} catch (error) {
  console.error("OpenRouter verification: FAIL");
  console.error("Provider: openrouter");
  console.error(`Requested model: ${model}`);
  console.error(
    `Duration ms: ${String(Math.max(Date.now() - verificationStartedAt, 0))}`,
  );
  console.error("Retry count: 0");
  console.error("Structured-output validation: NOT COMPLETED");
  if (error instanceof AiError) {
    const metadata = error.responseMetadata;
    console.error(`Safe error code: ${error.code}`);
    console.error(
      `Result category: ${metadata?.httpCategory ?? "unavailable"}`,
    );
    console.error(
      `Returned model: ${metadata?.returnedModel ?? "unavailable"}`,
    );
    console.error(`Finish reason: ${metadata?.finishReason ?? "unavailable"}`);
    console.error(
      `Native finish reason: ${metadata?.nativeFinishReason ?? "unavailable"}`,
    );
    console.error(
      `Output tokens: ${String(metadata?.completionTokens ?? "unavailable")}`,
    );
    console.error(
      `Reasoning tokens: ${String(metadata?.reasoningTokens ?? "unavailable")}`,
    );
    console.error(
      `Provider request ID: ${metadata?.providerRequestId ?? "unavailable"}`,
    );
  } else {
    console.error("Safe error code: provider-failure");
  }
  process.exitCode = 1;
}
