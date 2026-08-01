import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocatorObservationReviewTemplate,
  validateLocatorObservation,
} from "@aegis/core";
import type { LocatorObservation } from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const requestedId = arguments_
  .find((entry) => entry.startsWith("--id="))
  ?.slice(5);
if (arguments_.some((entry) => !entry.startsWith("--id=")))
  throw new Error("Only --id=<observation-id> is supported.");
const pending = resolve(
  repositoryRoot,
  "artifacts/locator-observations/pending",
);
const reviewDirectory = resolve(
  repositoryRoot,
  "artifacts/locator-observations/review",
);
await mkdir(reviewDirectory, { recursive: true });
const files = (await readdir(pending).catch(() => [] as string[]))
  .filter((name) => /^LOC-OBS-[A-F0-9]{16}\.json$/u.test(name))
  .sort();
let created = 0;
let preserved = 0;
for (const name of files) {
  const observation = validateLocatorObservation(
    JSON.parse(
      await readFile(resolve(pending, name), "utf8"),
    ) as LocatorObservation,
  );
  if (requestedId !== undefined && observation.observationId !== requestedId)
    continue;
  const target = resolve(
    reviewDirectory,
    `${observation.observationId}.review.json`,
  );
  try {
    await writeFile(
      target,
      `${JSON.stringify(createLocatorObservationReviewTemplate(observation), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    created += 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    preserved += 1;
  }
}
if (requestedId !== undefined && created + preserved === 0)
  throw new Error(`Observation ${requestedId} was not found.`);
console.log(
  `Review templates: created ${String(created)} | preserved ${String(preserved)}. Completed reviews are never overwritten.`,
);
