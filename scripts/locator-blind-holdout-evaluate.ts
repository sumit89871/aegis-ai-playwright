import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocatorBlindHoldoutAggregateSummary,
  inspectLocatorBlindReview,
  renderLocatorBlindHoldoutAggregateMarkdown,
  renderLocatorBlindHoldoutHumanSummary,
  runLocatorBlindHoldoutEvaluation,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReviewPacket,
  validateLocatorObservation,
  validateLocatorObservationReview,
} from "@aegis/core";
import type {
  LocatorBlindCandidateMapping,
  LocatorBlindHoldoutRecord,
  LocatorBlindReview,
  LocatorBlindReviewPacket,
  LocatorObservation,
  LocatorObservationReview,
} from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
if (
  arguments_.some(
    (entry) =>
      entry !== "--json" &&
      entry !== "--summary-json" &&
      entry !== "--mode=mock-ai" &&
      entry !== "--mode=deterministic-only" &&
      !entry.startsWith("--root="),
  )
)
  throw new Error("Unsupported blind holdout option.");
if (arguments_.includes("--json") && arguments_.includes("--summary-json"))
  throw new Error("Choose either --json or --summary-json, not both.");
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
  throw new Error("Blind observation root must remain inside the repository.");
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

const result = await runLocatorBlindHoldoutEvaluation(records, {
  mode,
  calibrationPilotReviewed,
  invalidBlindReviews,
});
const aggregateSummary = createLocatorBlindHoldoutAggregateSummary(result);
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
if (arguments_.includes("--json")) console.log(JSON.stringify(result, null, 2));
else if (arguments_.includes("--summary-json"))
  console.log(JSON.stringify(aggregateSummary, null, 2));
else console.log(renderLocatorBlindHoldoutHumanSummary(aggregateSummary));
