import { resolve } from "node:path";

import { nopCommerceRequirementRegistry } from "../requirements/requirement-registry.ts";
import { writeTraceabilityReports } from "../src/traceability/traceability.ts";
import { nopCommerceTestCatalog } from "../tests/metadata/index.ts";

const workspaceRoot = resolve(import.meta.dirname, "..");
const report = await writeTraceabilityReports({
  requirements: nopCommerceRequirementRegistry,
  tests: nopCommerceTestCatalog,
  workspaceRoot,
  outputDirectory: resolve(workspaceRoot, "test-results", "traceability"),
});

process.stdout.write(
  `Traceability valid: ${String(report.summary.coveredRequirements)}/${String(report.summary.totalRegisteredRequirements)} requirements covered by ${String(report.summary.totalRegisteredTests)} tests.\n`,
);
