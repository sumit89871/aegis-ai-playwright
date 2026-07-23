import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  scanUiPolicy,
  uiPolicyExitCode,
} from "./ui-policy/ui-policy-scanner.ts";
import type {
  UiPolicyFinding,
  UiPolicySourceFile,
} from "./ui-policy/ui-policy-scanner.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const scanRoots = [
  "examples/nopcommerce/src/components",
  "examples/nopcommerce/src/pages",
  "examples/nopcommerce/src/flows",
  "examples/nopcommerce/src/fixtures",
  "examples/nopcommerce/tests/smoke",
] as const;
const excludedDirectoryNames = new Set([
  "blob-report",
  "node_modules",
  "playwright-report",
  "test-results",
  "traces",
]);

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name.startsWith(".env")) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectoryNames.has(entry.name)) {
        paths.push(...(await collectTypeScriptFiles(path)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      paths.push(path);
    }
  }
  return paths;
}

function humanFinding(finding: UiPolicyFinding): string {
  return `${finding.severity.toUpperCase().padEnd(6)} ${finding.ruleId.padEnd(34)} ${finding.file}:${String(finding.line)}:${String(finding.column)}\n       ${finding.preview}`;
}

async function main(): Promise<void> {
  const json = process.argv.slice(2).includes("--json");
  const absolutePaths = (
    await Promise.all(
      scanRoots.map((root) =>
        collectTypeScriptFiles(resolve(repositoryRoot, root)),
      ),
    )
  )
    .flat()
    .sort();
  const files: UiPolicySourceFile[] = await Promise.all(
    absolutePaths.map(async (path) => ({
      path: relative(repositoryRoot, path),
      sourceText: await readFile(path, "utf8"),
    })),
  );
  const report = scanUiPolicy(files);

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("AegisAI UI policy scan\n\n");
    if (report.findings.length === 0) {
      process.stdout.write("No findings.\n");
    } else {
      process.stdout.write(`${report.findings.map(humanFinding).join("\n")}\n`);
    }
    process.stdout.write(
      `\nStatus: ${report.status.toUpperCase()} | Files: ${String(report.summary.filesScanned)} | High: ${String(report.summary.high)} | Medium: ${String(report.summary.medium)} | Info: ${String(report.summary.info)} | Suppressions: ${String(report.summary.suppressionsUsed)}/${String(report.summary.suppressions)} used\n`,
    );
  }

  process.exitCode = uiPolicyExitCode(report);
}

await main();
