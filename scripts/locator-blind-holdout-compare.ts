import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CliOptionError,
  createAiClient,
  createCliProgressReporter,
  createLocatorAdvisoryComparisonAggregateSummary,
  defaultAiConfiguration,
  detectTerminalCapabilities,
  isCliPresentationArgument,
  LOCATOR_ADVISORY_RERANKING_CAPABILITY,
  OpenRouterAiProvider,
  renderCliError,
  renderLocatorAdvisoryComparisonMarkdown,
  renderLocatorAdvisoryComparisonTerminal,
  runLocatorAdvisoryComparisonPhase,
  completeLocatorAdvisoryComparison,
  validateCliPresentationArguments,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReviewPacket,
  validateLocatorObservation,
  validateLocatorObservationReview,
} from "@aegis/core";
import type {
  AiClient,
  LocatorAdvisoryComparisonAnswerRecord,
  LocatorAdvisoryComparisonInputRecord,
  LocatorAdvisoryComparisonMode,
  LocatorBlindCandidateMapping,
  LocatorBlindReview,
  LocatorBlindReviewPacket,
  LocatorObservation,
  LocatorObservationReview,
} from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const capabilities = detectTerminalCapabilities({
  arguments: arguments_,
  environment: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  platform: process.platform,
});
const progress = createCliProgressReporter({
  capabilities,
  stream: process.stderr,
});
const startedAt = performance.now();

function mode(): LocatorAdvisoryComparisonMode {
  const entry = arguments_.find((value) => value.startsWith("--mode="));
  const value = entry?.slice(7) ?? "deterministic-only";
  if (!["deterministic-only", "mock-ai", "ai-advisory"].includes(value))
    throw new CliOptionError(
      "LOCATOR_COMPARISON_MODE_UNSUPPORTED",
      "--mode",
      `The locator comparison mode ${JSON.stringify(value)} is unsupported.`,
      "Choose a deterministic, offline mock, or explicitly authorized live advisory mode.",
      ["deterministic-only", "mock-ai", "ai-advisory"],
    );
  return value as LocatorAdvisoryComparisonMode;
}

function validateArguments(): LocatorAdvisoryComparisonMode {
  validateCliPresentationArguments(arguments_);
  if (arguments_.includes("--json"))
    throw new CliOptionError(
      "LOCATOR_COMPARISON_PRIVATE_JSON_UNAVAILABLE",
      "--json",
      "The comparison command does not expose private per-case JSON.",
      "Use --summary-json for the privacy-safe aggregate result.",
      ["--summary-json"],
    );
  if (
    arguments_.some(
      (entry) =>
        entry !== "--summary-json" &&
        entry !== "--confirm-network" &&
        !entry.startsWith("--mode=") &&
        !entry.startsWith("--root=") &&
        !isCliPresentationArgument(entry),
    )
  )
    throw new CliOptionError(
      "LOCATOR_COMPARISON_OPTION_UNSUPPORTED",
      "command arguments",
      "An unsupported locator comparison option was supplied.",
      "Use a documented comparison or presentation option.",
    );
  const selected = mode();
  if (selected !== "ai-advisory" && arguments_.includes("--confirm-network"))
    throw new CliOptionError(
      "LOCATOR_COMPARISON_NETWORK_CONFIRMATION_UNUSED",
      "--confirm-network",
      "Network confirmation is valid only for ai-advisory mode.",
      "Remove --confirm-network or select --mode=ai-advisory.",
    );
  return selected;
}

function artifactRoot(): string {
  const rootValue = arguments_
    .find((entry) => entry.startsWith("--root="))
    ?.slice(7);
  if (rootValue !== undefined && isAbsolute(rootValue))
    throw new Error("Comparison artifact root must be repository-relative.");
  const root = resolve(
    repositoryRoot,
    rootValue ?? "artifacts/locator-observations",
  );
  if (relative(repositoryRoot, root).startsWith(".."))
    throw new Error("Comparison artifact root must remain in the repository.");
  return root;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0)
    throw new CliOptionError(
      "LOCATOR_COMPARISON_LIVE_CONFIGURATION_REQUIRED",
      name,
      `Live advisory comparison requires the ${name} configuration value.`,
      `Set ${name} locally, without printing or committing its value, and retry.`,
    );
  return value;
}

function liveClient(): AiClient {
  if (!arguments_.includes("--confirm-network"))
    throw new CliOptionError(
      "LOCATOR_COMPARISON_NETWORK_CONFIRMATION_REQUIRED",
      "--confirm-network",
      "Live advisory comparison requires explicit --confirm-network consent.",
      "Add --confirm-network only when a bounded local provider request is intended.",
      ["--confirm-network"],
    );
  if (process.env.AEGIS_AI_ENABLED !== "true")
    throw new CliOptionError(
      "LOCATOR_COMPARISON_LIVE_CONFIGURATION_REQUIRED",
      "AEGIS_AI_ENABLED",
      "Live advisory comparison requires AEGIS_AI_ENABLED=true.",
      "Enable AI explicitly only for this local advisory command.",
      ["true"],
    );
  if (process.env.AEGIS_AI_ALLOW_NETWORK_CALLS !== "true")
    throw new CliOptionError(
      "LOCATOR_COMPARISON_LIVE_CONFIGURATION_REQUIRED",
      "AEGIS_AI_ALLOW_NETWORK_CALLS",
      "Live advisory comparison requires AEGIS_AI_ALLOW_NETWORK_CALLS=true.",
      "Permit network access explicitly only for this local advisory command.",
      ["true"],
    );
  const model = requiredEnvironment("AEGIS_AI_MODEL");
  const inputPrice = Number(
    requiredEnvironment("AEGIS_AI_INPUT_COST_PER_MILLION_USD"),
  );
  const outputPrice = Number(
    requiredEnvironment("AEGIS_AI_OUTPUT_COST_PER_MILLION_USD"),
  );
  if (
    !Number.isFinite(inputPrice) ||
    inputPrice < 0 ||
    !Number.isFinite(outputPrice) ||
    outputPrice < 0
  )
    throw new CliOptionError(
      "LOCATOR_COMPARISON_LIVE_PRICING_INVALID",
      "AI pricing configuration",
      "Live advisory comparison requires valid non-negative local pricing inputs.",
      "Set both per-million-token prices to finite non-negative numbers.",
    );
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "openrouter",
      model,
      apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
      allowNetworkCalls: true,
      mockOnly: false,
      enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
      requestTimeoutMs: 15_000,
      maxRetries: 1,
      maxInputCharacters: 30_000,
      maxOutputTokens: 512,
      maxEstimatedCostUsd: 0.01,
      defaultTemperature: 0,
      applicationName: "aegis-locator-advisory-comparison",
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
}

async function loadObservations(
  root: string,
): Promise<Map<string, LocatorObservation>> {
  const observations = new Map<string, LocatorObservation>();
  for (const name of (
    await readdir(resolve(root, "pending")).catch(() => [] as string[])
  )
    .filter((entry) => entry.endsWith(".json"))
    .sort()) {
    try {
      const observation = validateLocatorObservation(
        JSON.parse(
          await readFile(resolve(root, "pending", name), "utf8"),
        ) as LocatorObservation,
      );
      observations.set(observation.observationId, observation);
    } catch {
      // Invalid observations never enter the provider-facing phase.
    }
  }
  return observations;
}

async function loadInputRecords(
  root: string,
  observations: ReadonlyMap<string, LocatorObservation>,
): Promise<readonly LocatorAdvisoryComparisonInputRecord[]> {
  const records: LocatorAdvisoryComparisonInputRecord[] = [];
  for (const name of (
    await readdir(resolve(root, "blind/packets")).catch(() => [] as string[])
  )
    .filter((entry) => entry.endsWith(".blind-packet.json"))
    .sort()) {
    try {
      const packetInput = JSON.parse(
        await readFile(resolve(root, "blind/packets", name), "utf8"),
      ) as LocatorBlindReviewPacket;
      const observation = observations.get(packetInput.observationId);
      if (observation === undefined) continue;
      const packet = validateLocatorBlindReviewPacket(packetInput, observation);
      records.push(Object.freeze({ observation, packet }));
    } catch {
      // Invalid packets never enter the provider-facing phase.
    }
  }
  return Object.freeze(records);
}

async function loadAnswerRecords(
  root: string,
  inputs: readonly LocatorAdvisoryComparisonInputRecord[],
): Promise<{
  readonly answers: readonly LocatorAdvisoryComparisonAnswerRecord[];
  readonly invalid: number;
}> {
  const answers: LocatorAdvisoryComparisonAnswerRecord[] = [];
  let invalid = 0;
  for (const { observation, packet } of inputs) {
    try {
      const mapping = validateLocatorBlindCandidateMapping(
        JSON.parse(
          await readFile(
            resolve(
              root,
              "blind/mappings",
              `${packet.blindPacketId}.blind-mapping.json`,
            ),
            "utf8",
          ),
        ) as LocatorBlindCandidateMapping,
        packet,
        observation,
      );
      const review = JSON.parse(
        await readFile(
          resolve(
            root,
            "blind/reviews",
            `${packet.blindPacketId}.blind-review.json`,
          ),
          "utf8",
        ),
      ) as LocatorBlindReview;
      answers.push(Object.freeze({ observation, packet, mapping, review }));
    } catch {
      invalid += 1;
    }
  }
  return Object.freeze({ answers: Object.freeze(answers), invalid });
}

async function calibrationCount(
  root: string,
  observations: ReadonlyMap<string, LocatorObservation>,
): Promise<number> {
  let count = 0;
  for (const name of (
    await readdir(resolve(root, "review")).catch(() => [] as string[])
  )
    .filter((entry) => entry.endsWith(".review.json"))
    .sort()) {
    try {
      const review = JSON.parse(
        await readFile(resolve(root, "review", name), "utf8"),
      ) as LocatorObservationReview;
      const observation = observations.get(review.observationId);
      if (
        observation !== undefined &&
        validateLocatorObservationReview(review, observation).reviewStatus ===
          "reviewed"
      )
        count += 1;
    } catch {
      // Invalid calibration reviews do not enter the count.
    }
  }
  return count;
}

async function run(): Promise<void> {
  const selectedMode = validateArguments();
  const root = artifactRoot();
  const client = selectedMode === "ai-advisory" ? liveClient() : undefined;

  progress.start("Loading sanitized observation and blind packet records");
  const observations = await loadObservations(root);
  const inputs = await loadInputRecords(root, observations);

  if (selectedMode === "ai-advisory")
    progress.update("Preparing sanitized candidate evidence");
  else if (selectedMode === "mock-ai")
    progress.update("Preparing deterministic offline mock advisory evidence");
  else progress.update("Preparing deterministic comparison baseline");

  if (selectedMode === "ai-advisory")
    progress.update("Requesting advisory AI reranking");
  const phase = await runLocatorAdvisoryComparisonPhase(inputs, {
    mode: selectedMode,
    ...(client === undefined
      ? {}
      : { aiClientFactory: (): AiClient => client }),
  });

  if (selectedMode !== "deterministic-only")
    progress.update("Validating structured advisory responses");
  progress.update(
    "Loading independent human answers after advisory completion",
  );
  const { answers, invalid } = await loadAnswerRecords(root, inputs);
  const pilotCount = await calibrationCount(root, observations);

  progress.update("Comparing deterministic and advisory rankings");
  const comparison = await completeLocatorAdvisoryComparison(phase, answers, {
    calibrationPilotReviewed: pilotCount,
    invalidBlindReviews: invalid,
  });
  progress.update("Calculating privacy-safe aggregate deltas");
  const summary = createLocatorAdvisoryComparisonAggregateSummary(comparison);

  progress.update("Writing privacy-safe comparison reports");
  const reportDirectory = resolve(root, "blind/reports");
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, `blind-holdout-comparison-${selectedMode}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(reportDirectory, `blind-holdout-comparison-${selectedMode}.md`),
    `${renderLocatorAdvisoryComparisonMarkdown(summary)}\n`,
    "utf8",
  );
  progress.succeed();

  if (capabilities.outputMode === "summary-json")
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else
    process.stdout.write(
      `${renderLocatorAdvisoryComparisonTerminal(
        summary,
        capabilities,
        performance.now() - startedAt,
      )}\n`,
    );
}

const interrupt = (exitCode: number): void => {
  progress.interrupt();
  process.exit(exitCode);
};
const interruptSignal = (): void => {
  interrupt(130);
};
const terminateSignal = (): void => {
  interrupt(143);
};
const exitCleanup = (): void => {
  progress.dispose();
};
process.once("SIGINT", interruptSignal);
process.once("SIGTERM", terminateSignal);
process.once("exit", exitCleanup);
try {
  await run();
} catch (caught) {
  progress.fail();
  const option = caught as Partial<CliOptionError>;
  const optionError = option.name === "CliOptionError";
  const error = Object.freeze({
    status: "error",
    error: Object.freeze({
      code: optionError
        ? (option.code ?? "CLI_OPTION_INVALID")
        : "LOCATOR_COMPARISON_FAILED",
      ...(optionError && option.option !== undefined
        ? { option: option.option }
        : {}),
      message: optionError
        ? (option.message ?? "The comparison option is invalid.")
        : "The locator advisory comparison could not complete safely.",
      suggestion: optionError
        ? (option.suggestion ?? "Choose a supported option.")
        : "Validate the ignored blind artifacts and live-provider configuration before retrying.",
      ...(optionError && option.allowedValues !== undefined
        ? { allowedValues: option.allowedValues }
        : {}),
    }),
  });
  if (capabilities.outputMode === "summary-json")
    process.stdout.write(`${JSON.stringify(error, null, 2)}\n`);
  else
    process.stderr.write(
      `${renderCliError(
        {
          title: "Locator advisory comparison failed",
          code: error.error.code,
          ...(optionError && option.option !== undefined
            ? { fieldPath: option.option }
            : {}),
          message: error.error.message,
          suggestion: error.error.suggestion,
        },
        capabilities,
      )}\n`,
    );
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interruptSignal);
  process.removeListener("SIGTERM", terminateSignal);
  process.removeListener("exit", exitCleanup);
  progress.dispose();
}
