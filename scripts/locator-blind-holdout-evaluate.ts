import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCliProgressReporter,
  createLocatorBlindHoldoutAggregateSummary,
  detectTerminalCapabilities,
  isCliPresentationArgument,
  inspectLocatorBlindReview,
  renderCliError,
  renderLocatorBlindHoldoutAggregateMarkdown,
  renderLocatorBlindHoldoutTerminal,
  runLocatorBlindHoldoutEvaluation,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReviewPacket,
  validateLocatorObservation,
  validateLocatorObservationReview,
  validateCliPresentationArguments,
} from "@aegis/core";
import type {
  CliOptionError,
  LocatorBlindCandidateMapping,
  LocatorBlindHoldoutRecord,
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
  stdoutIsTty: process.stdout.isTTY,
  stderrIsTty: process.stderr.isTTY,
  columns: process.stdout.columns,
  platform: process.platform,
});
const progress = createCliProgressReporter({
  capabilities,
  stream: process.stderr,
});
const startedAt = performance.now();

function validateArguments(): void {
  validateCliPresentationArguments(arguments_);
  if (
    arguments_.some(
      (entry) =>
        entry !== "--json" &&
        entry !== "--summary-json" &&
        !isCliPresentationArgument(entry) &&
        entry !== "--mode=mock-ai" &&
        entry !== "--mode=deterministic-only" &&
        !entry.startsWith("--root="),
    )
  )
    throw new Error("Unsupported blind holdout option.");
}

async function run(): Promise<void> {
  validateArguments();
  const mode = arguments_.includes("--mode=mock-ai")
    ? "mock-ai"
    : "deterministic-only";
  const rootValue = arguments_
    .find((entry) => entry.startsWith("--root="))
    ?.slice(7);
  if (rootValue !== undefined && isAbsolute(rootValue))
    throw new Error("Blind observation root must be repository-relative.");
  const root = resolve(
    repositoryRoot,
    rootValue ?? "artifacts/locator-observations",
  );
  if (relative(repositoryRoot, root).startsWith(".."))
    throw new Error(
      "Blind observation root must remain inside the repository.",
    );

  progress.start("Loading sanitized observation records");
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
      // Invalid source artifacts are never eligible for blind evaluation.
    }
  }

  progress.update("Counting reviewed pilot and calibration records");
  let calibrationPilotReviewed = 0;
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
        calibrationPilotReviewed += 1;
    } catch {
      // Invalid pilot reviews do not qualify for either count.
    }
  }

  progress.update("Validating packet and mapping integrity");
  const records: LocatorBlindHoldoutRecord[] = [];
  let invalidBlindReviews = 0;
  const blindReviewDirectory = resolve(root, "blind/reviews");
  for (const name of (
    await readdir(blindReviewDirectory).catch(() => [] as string[])
  )
    .filter((entry) => entry.endsWith(".blind-review.json"))
    .sort()) {
    const packetId = name.replace(/\.blind-review\.json$/u, "");
    try {
      const packetInput = JSON.parse(
        await readFile(
          resolve(root, "blind/packets", `${packetId}.blind-packet.json`),
          "utf8",
        ),
      ) as LocatorBlindReviewPacket;
      const observation = observations.get(packetInput.observationId);
      if (observation === undefined)
        throw new Error("Missing source observation.");
      const packet = validateLocatorBlindReviewPacket(packetInput, observation);
      const mapping = validateLocatorBlindCandidateMapping(
        JSON.parse(
          await readFile(
            resolve(root, "blind/mappings", `${packetId}.blind-mapping.json`),
            "utf8",
          ),
        ) as LocatorBlindCandidateMapping,
        packet,
        observation,
      );
      const reviewInput = JSON.parse(
        await readFile(resolve(blindReviewDirectory, name), "utf8"),
      ) as LocatorBlindReview;
      const inspection = inspectLocatorBlindReview(reviewInput, packet);
      if (!inspection.valid || inspection.review === undefined) {
        invalidBlindReviews += 1;
        continue;
      }
      records.push({
        observation,
        packet,
        mapping,
        review: inspection.review,
      });
    } catch {
      invalidBlindReviews += 1;
    }
  }

  progress.update("Translating aliases and running holdout evaluation");
  const result = await runLocatorBlindHoldoutEvaluation(records, {
    mode,
    calibrationPilotReviewed,
    invalidBlindReviews,
  });
  progress.update("Calculating privacy-safe aggregate metrics");
  const aggregateSummary = createLocatorBlindHoldoutAggregateSummary(result);
  progress.update("Writing privacy-safe Markdown and private JSON reports");
  const reportDirectory = resolve(root, "blind/reports");
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, `blind-holdout-${mode}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(reportDirectory, `blind-holdout-${mode}.md`),
    `${renderLocatorBlindHoldoutAggregateMarkdown(aggregateSummary)}\n`,
    "utf8",
  );
  progress.succeed();

  if (capabilities.outputMode === "private-json")
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (capabilities.outputMode === "summary-json")
    process.stdout.write(`${JSON.stringify(aggregateSummary, null, 2)}\n`);
  else
    process.stdout.write(
      `${renderLocatorBlindHoldoutTerminal(
        aggregateSummary,
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
  const optionError = caught as Partial<CliOptionError>;
  const error = {
    status: "error",
    error: {
      code:
        optionError.name === "CliOptionError"
          ? (optionError.code ?? "CLI_OPTION_INVALID")
          : "CLI_EXECUTION_FAILED",
      option:
        optionError.name === "CliOptionError" ? optionError.option : undefined,
      message:
        optionError.name === "CliOptionError"
          ? (optionError.message ?? "The terminal option is invalid.")
          : "The blind holdout command could not complete safely.",
      suggestion:
        optionError.name === "CliOptionError"
          ? (optionError.suggestion ?? "Choose a supported option.")
          : "Check the command options and validate the ignored blind-review artifacts before retrying.",
      allowedValues:
        optionError.name === "CliOptionError"
          ? optionError.allowedValues
          : undefined,
    },
  } as const;
  if (
    capabilities.outputMode === "private-json" ||
    capabilities.outputMode === "summary-json"
  )
    process.stdout.write(`${JSON.stringify(error, null, 2)}\n`);
  else
    process.stderr.write(
      `${renderCliError(
        {
          title: "Blind holdout evaluation failed",
          code: error.error.code,
          ...(error.error.option === undefined
            ? {}
            : { fieldPath: error.error.option }),
          message: error.error.message,
          suggestion: `${error.error.suggestion}${
            error.error.allowedValues === undefined ||
            error.error.allowedValues.length === 0
              ? ""
              : ` Supported: ${error.error.allowedValues.join(", ")}.`
          }`,
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
