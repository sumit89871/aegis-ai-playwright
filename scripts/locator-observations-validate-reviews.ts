import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  locatorReviewValidationExitCode,
  renderLocatorReviewValidationHuman,
  renderLocatorReviewValidationJson,
  validateLocatorObservationReviewDirectories,
} from "./locator-observation-review-validation.ts";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");
const valueFor = (prefix: string): string | undefined =>
  arguments_
    .find((entry) => entry.startsWith(`${prefix}=`))
    ?.slice(prefix.length + 1);
if (
  arguments_.some(
    (entry) =>
      entry !== "--json" &&
      !entry.startsWith("--observations=") &&
      !entry.startsWith("--reviews="),
  )
)
  throw new Error(
    "Supported options are --json, --observations=<relative-path>, and --reviews=<relative-path>.",
  );

function resolveRepositoryPath(value: string, label: string): string {
  if (isAbsolute(value))
    throw new Error(`${label} must be a repository-relative path.`);
  const path = resolve(repositoryRoot, value);
  const fromRoot = relative(repositoryRoot, path);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot))
    throw new Error(`${label} must remain inside the repository.`);
  return path;
}

const result = await validateLocatorObservationReviewDirectories({
  repositoryRoot,
  observationsDirectory: resolveRepositoryPath(
    valueFor("--observations") ?? "artifacts/locator-observations/pending",
    "Observation directory",
  ),
  reviewsDirectory: resolveRepositoryPath(
    valueFor("--reviews") ?? "artifacts/locator-observations/review",
    "Review directory",
  ),
});
process.stdout.write(
  json
    ? renderLocatorReviewValidationJson(result)
    : renderLocatorReviewValidationHuman(result),
);
process.exitCode = locatorReviewValidationExitCode(result);
