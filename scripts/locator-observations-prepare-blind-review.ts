import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocatorBlindReviewArtifacts,
  validateLocatorObservation,
} from "@aegis/core";
import type { LocatorObservation, LocatorObservationReview } from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const requestedId = arguments_
  .find((entry) => entry.startsWith("--id="))
  ?.slice(5);
const rootValue = arguments_
  .find((entry) => entry.startsWith("--root="))
  ?.slice(7);
if (
  arguments_.some(
    (entry) => !entry.startsWith("--id=") && !entry.startsWith("--root="),
  )
)
  throw new Error(
    "Only --id=<observation-id> and --root=<relative-path> are supported.",
  );
if (rootValue !== undefined && isAbsolute(rootValue))
  throw new Error("Blind observation root must be repository-relative.");

const root = resolve(
  repositoryRoot,
  rootValue ?? "artifacts/locator-observations",
);
if (relative(repositoryRoot, root).startsWith(".."))
  throw new Error("Blind observation root must remain inside the repository.");
const pendingDirectory = resolve(root, "pending");
const legacyReviewDirectory = resolve(root, "review");
const packetDirectory = resolve(root, "blind/packets");
const mappingDirectory = resolve(root, "blind/mappings");
const reviewDirectory = resolve(root, "blind/reviews");
await Promise.all([
  mkdir(packetDirectory, { recursive: true }),
  mkdir(mappingDirectory, { recursive: true }),
  mkdir(reviewDirectory, { recursive: true }),
]);

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );
const safePath = (path: string): string =>
  relative(repositoryRoot, path).replaceAll("\\", "/");

let created = 0;
let skipped = 0;
let invalid = 0;
let alreadyExisting = 0;
let matched = 0;
for (const name of (await readdir(pendingDirectory).catch(() => [] as string[]))
  .filter((entry) => /^LOC-OBS-[A-F0-9]{16}\.json$/u.test(entry))
  .sort()) {
  try {
    const observation = validateLocatorObservation(
      JSON.parse(
        await readFile(resolve(pendingDirectory, name), "utf8"),
      ) as LocatorObservation,
    );
    if (requestedId !== undefined && observation.observationId !== requestedId)
      continue;
    matched += 1;
    const legacyReviewPath = resolve(
      legacyReviewDirectory,
      `${observation.observationId}.review.json`,
    );
    if (await exists(legacyReviewPath)) {
      const legacy = JSON.parse(
        await readFile(legacyReviewPath, "utf8"),
      ) as LocatorObservationReview;
      if (legacy.reviewStatus === "reviewed") {
        skipped += 1;
        console.log(
          `${observation.observationId}: skipped as pilot/calibration reviewed evidence.`,
        );
        continue;
      }
    }
    const artifacts = createLocatorBlindReviewArtifacts(observation);
    const packetPath = resolve(
      packetDirectory,
      `${artifacts.packet.blindPacketId}.blind-packet.json`,
    );
    const mappingPath = resolve(
      mappingDirectory,
      `${artifacts.packet.blindPacketId}.blind-mapping.json`,
    );
    const reviewPath = resolve(
      reviewDirectory,
      `${artifacts.packet.blindPacketId}.blind-review.json`,
    );
    if (
      (await exists(packetPath)) ||
      (await exists(mappingPath)) ||
      (await exists(reviewPath))
    ) {
      alreadyExisting += 1;
      console.log(
        `${observation.observationId}: blind artifacts already exist; nothing was overwritten.`,
      );
      continue;
    }
    await writeFile(
      packetPath,
      `${JSON.stringify(artifacts.packet, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      mappingPath,
      `${JSON.stringify(artifacts.mapping, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      reviewPath,
      `${JSON.stringify(artifacts.review, null, 2)}\n`,
      { flag: "wx" },
    );
    created += 1;
    console.log(`Packet: ${safePath(packetPath)}`);
    console.log(`Review: ${safePath(reviewPath)}`);
    console.log(
      "Private alias mapping: created (path intentionally not printed).\n",
    );
  } catch (error) {
    invalid += 1;
    console.error(`${name}: ${(error as Error).message.slice(0, 300)}`);
  }
}
if (requestedId !== undefined && matched === 0)
  throw new Error(`Observation ${requestedId} was not found.`);
console.log(
  `Blind review preparation: created ${String(created)} | skipped ${String(skipped)} | invalid ${String(invalid)} | already existing ${String(alreadyExisting)}.`,
);
if (invalid > 0) process.exitCode = 1;
