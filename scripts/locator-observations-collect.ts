import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importLocatorDiagnosisObservation } from "@aegis/core";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");
const valueFor = (prefix: string): string | undefined =>
  arguments_
    .find((entry) => entry.startsWith(`${prefix}=`))
    ?.slice(prefix.length + 1);
const supported = arguments_.every(
  (entry) =>
    entry === "--json" ||
    entry.startsWith("--input=") ||
    entry.startsWith("--application="),
);
if (!supported)
  throw new Error(
    "Supported options are --input=<relative-path>, --application=<safe-alias>, and --json.",
  );
const inputValue = valueFor("--input") ?? "test-results";
if (isAbsolute(inputValue))
  throw new Error("Observation input must be a repository-relative path.");
const input = resolve(repositoryRoot, inputValue);
if (
  !relative(repositoryRoot, input) ||
  relative(repositoryRoot, input).startsWith("..")
)
  throw new Error("Observation input must remain inside the repository.");
await access(input).catch(() => {
  throw new Error(`Observation input '${inputValue}' does not exist.`);
});

async function findArtifacts(directory: string): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await findArtifacts(path)));
    else if (
      /^locator-diagnosis(?:[-.][A-Za-z0-9_-]+)*\.json$/u.test(entry.name)
    )
      paths.push(path);
  }
  return paths.sort();
}

const outputDirectory = resolve(
  repositoryRoot,
  "artifacts/locator-observations/pending",
);
await mkdir(outputDirectory, { recursive: true });
const files = await findArtifacts(input);
let imported = 0;
let duplicates = 0;
let ignored = 0;
const failures: string[] = [];
for (const file of files) {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const result = importLocatorDiagnosisObservation(parsed, {
      applicationAlias: valueFor("--application") ?? "app-001",
      sourceType: "real-shadow",
    });
    if (result.status === "ignored") {
      ignored += 1;
      continue;
    }
    const observation = result.observation;
    const target = resolve(
      outputDirectory,
      `${observation.observationId}.json`,
    );
    try {
      const existing: unknown = JSON.parse(await readFile(target, "utf8"));
      if (JSON.stringify(existing) !== JSON.stringify(observation))
        throw new Error(
          "Observation-ID collision with different sanitized content.",
        );
      duplicates += 1;
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes("collision"))
      )
        throw error;
      await writeFile(target, `${JSON.stringify(observation, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      imported += 1;
    }
  } catch (error) {
    failures.push(
      error instanceof Error
        ? error.message.slice(0, 300)
        : "Artifact import failed safely.",
    );
  }
}
const summary = Object.freeze({
  status: failures.length === 0 ? "pass" : "fail",
  filesScanned: files.length,
  imported,
  duplicates,
  ignored,
  failed: failures.length,
  errors: Object.freeze(failures.sort()),
});
console.log(
  json
    ? JSON.stringify(summary, null, 2)
    : `Locator observations: ${summary.status.toUpperCase()} | scanned ${String(summary.filesScanned)} | imported ${String(imported)} | duplicates ${String(duplicates)} | ignored ${String(ignored)} | failed ${String(failures.length)}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
