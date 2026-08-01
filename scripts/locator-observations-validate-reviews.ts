import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateLocatorObservation,
  validateLocatorObservationReview,
} from "@aegis/core";
import type { LocatorObservation, LocatorObservationReview } from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pending = resolve(
  repositoryRoot,
  "artifacts/locator-observations/pending",
);
const reviews = resolve(
  repositoryRoot,
  "artifacts/locator-observations/review",
);
const observationFiles = (await readdir(pending).catch(() => [] as string[]))
  .filter((name) => name.endsWith(".json"))
  .sort();
const byId = new Map<string, LocatorObservation>();
for (const name of observationFiles) {
  const observation = validateLocatorObservation(
    JSON.parse(
      await readFile(resolve(pending, name), "utf8"),
    ) as LocatorObservation,
  );
  byId.set(observation.observationId, observation);
}
const reviewFiles = (await readdir(reviews).catch(() => [] as string[]))
  .filter((name) => name.endsWith(".review.json"))
  .sort();
const counts = { reviewed: 0, pending: 0, rejected: 0, needsMoreEvidence: 0 };
const errors: string[] = [];
for (const name of reviewFiles) {
  try {
    const review = JSON.parse(
      await readFile(resolve(reviews, name), "utf8"),
    ) as LocatorObservationReview;
    const observation = byId.get(review.observationId);
    if (observation === undefined)
      throw new Error("Review has no matching observation.");
    const valid = validateLocatorObservationReview(review, observation);
    if (valid.reviewStatus === "needs-more-evidence")
      counts.needsMoreEvidence += 1;
    else counts[valid.reviewStatus] += 1;
  } catch (error) {
    errors.push(
      `${name}: ${error instanceof Error ? error.message.slice(0, 250) : "invalid review"}`,
    );
  }
}
console.log(
  `Observation reviews: ${errors.length === 0 ? "PASS" : "FAIL"} | reviewed ${String(counts.reviewed)} | pending ${String(counts.pending)} | rejected ${String(counts.rejected)} | needs more evidence ${String(counts.needsMoreEvidence)} | invalid ${String(errors.length)}`,
);
process.exitCode = errors.length === 0 ? 0 : 1;
