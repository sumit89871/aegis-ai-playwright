import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  defineRequirementMetadata,
  defineTestMetadata,
  validateRequirementMetadata,
  validateTestMetadata,
} from "@aegis/core";

import { nopCommerceRequirementRegistry } from "../../requirements/requirement-registry.ts";
import {
  buildTraceabilityReport,
  serializeTraceabilityJson,
} from "../../src/traceability/traceability.ts";
import { nopCommerceTestCatalog } from "../metadata/index.ts";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../..");

await describe("nopCommerce traceability", async () => {
  await it("validates the current requirement registry", () => {
    assert.doesNotThrow(() => {
      for (const requirement of nopCommerceRequirementRegistry) {
        validateRequirementMetadata(requirement);
      }
    });
  });

  await it("validates the current test catalog", () => {
    assert.doesNotThrow(() => {
      for (const metadata of nopCommerceTestCatalog) {
        validateTestMetadata(metadata);
      }
    });
  });

  await it("detects duplicate test IDs", async () => {
    await assert.rejects(
      buildTraceabilityReport({
        requirements: nopCommerceRequirementRegistry,
        tests: [nopCommerceTestCatalog[0], nopCommerceTestCatalog[0]],
        workspaceRoot: WORKSPACE_ROOT,
      }),
      /Duplicate test ID: TC-SEARCH-001/u,
    );
  });

  await it("detects tests that reference unknown requirements", async () => {
    const unknownRequirementTest = defineTestMetadata({
      testId: "TC-SEARCH-999",
      title: "Traceability validation probe",
      feature: "product-search",
      suite: "regression",
      risk: "low",
      layer: "ui",
      requirementIds: ["REQ-UNKNOWN-999"],
      tags: ["@search"],
    });

    await assert.rejects(
      buildTraceabilityReport({
        requirements: nopCommerceRequirementRegistry,
        tests: [...nopCommerceTestCatalog, unknownRequirementTest],
        workspaceRoot: WORKSPACE_ROOT,
      }),
      /references unknown requirement REQ-UNKNOWN-999/u,
    );
  });

  await it("detects a missing requirement document", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "aegis-traceability-unit-"),
    );
    try {
      const requirement = defineRequirementMetadata({
        requirementId: "REQ-TEMP-001",
        title: "Temporary requirement",
        documentPath: "requirements/REQ-TEMP-001.md",
        feature: "temporary-feature",
        status: "active",
      });
      const metadata = defineTestMetadata({
        testId: "TC-TEMP-001",
        title: "Temporary test",
        feature: "temporary-feature",
        suite: "integration",
        risk: "low",
        layer: "contract",
        requirementIds: ["REQ-TEMP-001"],
        tags: ["@temporary"],
      });

      await assert.rejects(
        buildTraceabilityReport({
          requirements: [requirement],
          tests: [metadata],
          workspaceRoot: temporaryRoot,
        }),
        /references missing Markdown document requirements\/REQ-TEMP-001\.md/u,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await it("reports the current coverage summary", async () => {
    const report = await buildTraceabilityReport({
      requirements: nopCommerceRequirementRegistry,
      tests: nopCommerceTestCatalog,
      workspaceRoot: WORKSPACE_ROOT,
    });

    assert.deepEqual(report.summary, {
      totalRegisteredRequirements: 1,
      activeRequirements: 1,
      coveredRequirements: 1,
      uncoveredRequirements: 0,
      totalRegisteredTests: 2,
      testsBySuite: {
        smoke: 2,
        regression: 0,
        integration: 0,
        "end-to-end": 0,
      },
      testsByRisk: { critical: 0, high: 1, medium: 1, low: 0 },
      testsByLayer: { ui: 2, api: 0, database: 0, contract: 0 },
      testsByFeature: { "product-search": 2 },
    });
    assert.deepEqual(report.requirements[0]?.linkedTestIds, [
      "TC-SEARCH-001",
      "TC-SEARCH-002",
    ]);
  });

  await it("serializes equivalent catalogs deterministically", async () => {
    const first = await buildTraceabilityReport({
      requirements: nopCommerceRequirementRegistry,
      tests: nopCommerceTestCatalog,
      workspaceRoot: WORKSPACE_ROOT,
    });
    const second = await buildTraceabilityReport({
      requirements: [...nopCommerceRequirementRegistry].reverse(),
      tests: [...nopCommerceTestCatalog].reverse(),
      workspaceRoot: WORKSPACE_ROOT,
    });

    assert.equal(
      serializeTraceabilityJson(first),
      serializeTraceabilityJson(second),
    );
  });
});
