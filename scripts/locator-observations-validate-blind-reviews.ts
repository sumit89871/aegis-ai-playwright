import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectLocatorBlindReview,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReviewPacket,
  validateLocatorObservation,
} from "@aegis/core";
import type {
  LocatorBlindReviewPacket,
  LocatorBlindReviewValidationIssue,
  LocatorObservation,
} from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const jsonOnly = arguments_.includes("--json");
const rootValue = arguments_
  .find((entry) => entry.startsWith("--root="))
  ?.slice(7);
if (
  arguments_.some((entry) => entry !== "--json" && !entry.startsWith("--root="))
)
  throw new Error("Only --json and --root=<relative-path> are supported.");
if (rootValue !== undefined && isAbsolute(rootValue))
  throw new Error("Blind observation root must be repository-relative.");
const root = resolve(
  repositoryRoot,
  rootValue ?? "artifacts/locator-observations",
);
if (relative(repositoryRoot, root).startsWith(".."))
  throw new Error("Blind observation root must remain inside the repository.");
const safePath = (path: string): string =>
  relative(repositoryRoot, path).replaceAll("\\", "/");
interface FileResult {
  readonly path: string;
  readonly blindPacketId?: string;
  readonly valid: boolean;
  readonly reviewStatus?: string;
  readonly issues: readonly LocatorBlindReviewValidationIssue[];
}
const issue = (
  code: string,
  fieldPath: string,
  message: string,
  suggestion: string,
): LocatorBlindReviewValidationIssue => ({
  code,
  category: "observation-link",
  fieldPath,
  message,
  suggestion,
});
const parse = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `JSON is invalid: ${(error as Error).message.slice(0, 200)}`,
      {
        cause: error,
      },
    );
  }
};

const observations = new Map<string, LocatorObservation>();
for (const name of (
  await readdir(resolve(root, "pending")).catch(() => [] as string[])
).sort()) {
  if (!name.endsWith(".json")) continue;
  try {
    const value = validateLocatorObservation(
      await parse(resolve(root, "pending", name)),
    );
    observations.set(value.observationId, value);
  } catch {
    // The existing observation validator owns diagnostics for invalid source observations.
  }
}

const reviewDirectory = resolve(root, "blind/reviews");
const files: FileResult[] = [];
for (const name of (await readdir(reviewDirectory).catch(() => [] as string[]))
  .filter((entry) => entry.endsWith(".blind-review.json"))
  .sort()) {
  const reviewPath = resolve(reviewDirectory, name);
  const packetId = name.replace(/\.blind-review\.json$/u, "");
  const packetPath = resolve(
    root,
    "blind/packets",
    `${packetId}.blind-packet.json`,
  );
  const mappingPath = resolve(
    root,
    "blind/mappings",
    `${packetId}.blind-mapping.json`,
  );
  try {
    const packetValue = await parse(packetPath);
    const candidatePacket = packetValue as LocatorBlindReviewPacket;
    const observation = observations.get(candidatePacket.observationId);
    if (observation === undefined)
      throw new Error("The linked source observation was not found.");
    const packet = validateLocatorBlindReviewPacket(
      candidatePacket,
      observation,
    );
    if (packet.blindPacketId !== packetId)
      throw new Error(
        "The blind packet ID does not match the review filename.",
      );
    validateLocatorBlindCandidateMapping(
      await parse(mappingPath),
      packet,
      observation,
    );
    const reviewValue = await parse(reviewPath);
    const inspected = inspectLocatorBlindReview(reviewValue, packet);
    const reviewStatus =
      typeof reviewValue === "object" &&
      reviewValue !== null &&
      typeof (reviewValue as Record<string, unknown>).reviewStatus === "string"
        ? ((reviewValue as Record<string, unknown>).reviewStatus as string)
        : undefined;
    files.push({
      path: safePath(reviewPath),
      blindPacketId: packetId,
      valid: inspected.valid,
      ...(reviewStatus === undefined ? {} : { reviewStatus }),
      issues: inspected.issues,
    });
  } catch (error) {
    files.push({
      path: safePath(reviewPath),
      blindPacketId: packetId,
      valid: false,
      issues: [
        issue(
          (error as Error).message.startsWith("JSON is invalid")
            ? "BLIND_JSON_INVALID"
            : "BLIND_LINK_INVALID",
          "$",
          (error as Error).message.slice(0, 300),
          "Restore or regenerate the linked packet, private mapping, and review template; files are never repaired automatically.",
        ),
      ],
    });
  }
}
const summary = {
  reviewed: files.filter(
    (entry) => entry.valid && entry.reviewStatus === "reviewed",
  ).length,
  pending: files.filter(
    (entry) => entry.valid && entry.reviewStatus === "pending",
  ).length,
  rejected: files.filter(
    (entry) => entry.valid && entry.reviewStatus === "rejected",
  ).length,
  needsMoreEvidence: files.filter(
    (entry) => entry.valid && entry.reviewStatus === "needs-more-evidence",
  ).length,
  invalid: files.filter((entry) => !entry.valid).length,
  issues: files.reduce((total, entry) => total + entry.issues.length, 0),
};
const result = {
  status: summary.invalid === 0 ? "pass" : "fail",
  summary,
  files,
};
if (jsonOnly) console.log(JSON.stringify(result, null, 2));
else {
  for (const file of files.filter((entry) => !entry.valid)) {
    console.log(`\nFile: ${file.path}`);
    console.log(`Packet: ${file.blindPacketId ?? "unavailable"}`);
    file.issues.forEach((entry, index) => {
      console.log(`Issue ${String(index + 1)}`);
      console.log(`Code: ${entry.code}`);
      console.log(`Field: ${entry.fieldPath}`);
      console.log(`Problem: ${entry.message}`);
      console.log(`Fix: ${entry.suggestion}`);
    });
  }
  console.log(
    `Blind reviews: ${result.status.toUpperCase()} | reviewed ${String(summary.reviewed)} | pending ${String(summary.pending)} | rejected ${String(summary.rejected)} | needs more evidence ${String(summary.needsMoreEvidence)} | invalid ${String(summary.invalid)} | issues ${String(summary.issues)}`,
  );
}
if (summary.invalid > 0) process.exitCode = 1;
