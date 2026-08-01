import { mkdir, writeFile } from "node:fs/promises";

import {
  LOCATOR_CALIBRATION_DATASET,
  PRE_CALIBRATION_LOCATOR_EVALUATION,
  LOCATOR_VALIDATION_DATASET,
  renderLocatorEvaluationMarkdown,
  runLocatorEvaluationDataset,
} from "@aegis/core";
import type {
  LocatorEvaluationDataset,
  LocatorEvaluationMode,
  LocatorEvaluationRunResult,
} from "@aegis/core";

const arguments_ = process.argv.slice(2);
const supported = new Set([
  "--json",
  "--dataset=calibration",
  "--dataset=validation",
  "--mode=mock-ai",
  "--mode=deterministic-only",
]);
const unsupported = arguments_.find((argument) => !supported.has(argument));
if (unsupported !== undefined)
  throw new Error(`Unsupported locator-evaluation option '${unsupported}'.`);

const datasetArgument = arguments_.find((argument) =>
  argument.startsWith("--dataset="),
);
const modeArgument = arguments_.find((argument) =>
  argument.startsWith("--mode="),
);
const mode = (modeArgument?.split("=")[1] ??
  "deterministic-only") as LocatorEvaluationMode;
const datasets: readonly LocatorEvaluationDataset[] =
  datasetArgument === "--dataset=calibration"
    ? [LOCATOR_CALIBRATION_DATASET]
    : datasetArgument === "--dataset=validation"
      ? [LOCATOR_VALIDATION_DATASET]
      : [LOCATOR_CALIBRATION_DATASET, LOCATOR_VALIDATION_DATASET];

const artifactDirectory = new URL(
  "../artifacts/locator-evaluation/",
  import.meta.url,
);
await mkdir(artifactDirectory, { recursive: true });
const results: LocatorEvaluationRunResult[] = [];
for (const dataset of datasets) {
  const result = await runLocatorEvaluationDataset(dataset, { mode });
  const preCalibration = PRE_CALIBRATION_LOCATOR_EVALUATION[dataset.id];
  results.push(result);
  const modeSuffix = mode === "mock-ai" ? "-mock-ai" : "";
  const base = `${dataset.id}${modeSuffix}-report`;
  await writeFile(
    new URL(`${base}.json`, artifactDirectory),
    `${JSON.stringify({ ...result, preCalibration }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    new URL(`${base}.md`, artifactDirectory),
    `${renderLocatorEvaluationMarkdown(result, preCalibration)}\n`,
    "utf8",
  );
}

const output = Object.freeze({
  schemaVersion: "1.0.0",
  mode,
  status: results.every(({ status }) => status === "pass") ? "pass" : "fail",
  datasets: Object.freeze(results),
});
if (arguments_.includes("--json")) console.log(JSON.stringify(output, null, 2));
else {
  console.log("AegisAI locator-diagnosis evaluation");
  for (const result of results) {
    const percent = (value: number | null): string =>
      value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
    console.log(
      `${result.dataset.id} ${result.dataset.version}: ${result.status.toUpperCase()} (${String(result.dataset.caseCount)} cases)`,
    );
    console.log(
      `  classification ${percent(result.metrics.classification.accuracy.value)} | recommendation ${percent(result.metrics.recommendation.accuracy.value)} | top-1 ${percent(result.metrics.ranking.top1AcceptableRate.value)} | top-3 ${percent(result.metrics.ranking.top3AcceptableRate.value)} | unsafe ${percent(result.metrics.safety.unsafeRecommendationRate.value)}`,
    );
    if (result.failedCaseIds.length > 0)
      console.log(`  failed cases: ${result.failedCaseIds.join(", ")}`);
    if (result.thresholdEvaluation.failedThresholdIds.length > 0)
      console.log(
        `  failed thresholds: ${result.thresholdEvaluation.failedThresholdIds.join(", ")}`,
      );
    if (mode === "mock-ai")
      console.log(
        `  mock comparison: changed ${String(result.aiComparison.rankingChanged)}, improved ${String(result.aiComparison.rankingImproved)}, worsened ${String(result.aiComparison.rankingWorsened)}, conflicts ${String(result.aiComparison.classificationConflicts)}, rejected ${String(result.aiComparison.rejectedOutputs)}, fallbacks ${String(result.aiComparison.fallbackCount)}`,
      );
  }
  console.log(`Network calls: 0`);
  console.log(`API key required: no`);
}
process.exitCode = output.status === "pass" ? 0 : 1;
