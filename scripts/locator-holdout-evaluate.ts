import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderLocatorHoldoutMarkdown,
  runLocatorHoldoutEvaluation,
  validateLocatorObservation,
  validateLocatorObservationReview,
} from "@aegis/core";
import type { LocatorObservation, LocatorObservationReview } from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
if (
  arguments_.some(
    (entry) =>
      entry !== "--json" &&
      entry !== "--mode=mock-ai" &&
      entry !== "--mode=deterministic-only" &&
      !entry.startsWith("--dataset="),
  )
)
  throw new Error("Unsupported holdout-evaluation option.");
const datasetValue = arguments_
  .find((entry) => entry.startsWith("--dataset="))
  ?.slice(10);
const mode = arguments_.includes("--mode=mock-ai")
  ? "mock-ai"
  : "deterministic-only";
let observations: LocatorObservation[] = [];
let reviews: LocatorObservationReview[] = [];
if (datasetValue !== undefined) {
  if (isAbsolute(datasetValue))
    throw new Error("Holdout dataset must use a repository-relative path.");
  const datasetPath = resolve(repositoryRoot, datasetValue);
  if (relative(repositoryRoot, datasetPath).startsWith(".."))
    throw new Error("Holdout dataset must remain inside the repository.");
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as {
    observations?: LocatorObservation[];
    reviews?: LocatorObservationReview[];
  };
  observations = dataset.observations ?? [];
  reviews = dataset.reviews ?? [];
} else {
  const pending = resolve(
    repositoryRoot,
    "artifacts/locator-observations/pending",
  );
  const reviewDirectory = resolve(
    repositoryRoot,
    "artifacts/locator-observations/review",
  );
  for (const name of (await readdir(pending).catch(() => [] as string[]))
    .filter((entry) => entry.endsWith(".json"))
    .sort())
    observations.push(
      validateLocatorObservation(
        JSON.parse(
          await readFile(resolve(pending, name), "utf8"),
        ) as LocatorObservation,
      ),
    );
  for (const name of (
    await readdir(reviewDirectory).catch(() => [] as string[])
  )
    .filter((entry) => entry.endsWith(".review.json"))
    .sort())
    reviews.push(
      JSON.parse(
        await readFile(resolve(reviewDirectory, name), "utf8"),
      ) as LocatorObservationReview,
    );
}
const byId = new Map(
  observations.map((entry) => [
    entry.observationId,
    validateLocatorObservation(entry),
  ]),
);
reviews = reviews.map((review) => {
  const observation = byId.get(review.observationId);
  if (observation === undefined)
    throw new Error(
      `Review ${review.observationId} has no matching observation.`,
    );
  return validateLocatorObservationReview(review, observation);
});
const result = await runLocatorHoldoutEvaluation([...byId.values()], reviews, {
  mode,
});
const reportDirectory = resolve(
  repositoryRoot,
  "artifacts/locator-observations/reports",
);
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  resolve(reportDirectory, `holdout-${mode}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
await writeFile(
  resolve(reportDirectory, `holdout-${mode}.md`),
  `${renderLocatorHoldoutMarkdown(result)}\n`,
  "utf8",
);
if (arguments_.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  const percent = (value: number | null): string =>
    value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
  console.log(
    `Locator holdout: ${result.status.toUpperCase()} (${String(result.reviewedObservationCount)} reviewed)`,
  );
  console.log(result.notice);
  console.log(
    `Classification ${percent(result.metrics.classification.accuracy.value)} | recommendation ${percent(result.metrics.recommendation.accuracy.value)} | unsafe ${percent(result.metrics.safety.unsafeRecommendationRate.value)}`,
  );
  console.log(
    "Network calls: 0 | API key required: no | locator application: absent",
  );
}
