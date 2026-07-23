import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defineTestMetadata,
  toPlaywrightAnnotations,
  toPlaywrightTags,
  validateTestMetadata,
} from "../src/index.ts";

const VALID_METADATA = {
  testId: "TC-CATALOG-001",
  title: "A customer can search the catalogue",
  feature: "catalog-search",
  suite: "smoke",
  risk: "high",
  layer: "ui",
  requirementIds: ["REQ-CATALOG-002", "REQ-CATALOG-001"],
  tags: ["@search", "@catalog"],
} as const;

await describe("test metadata validation", async () => {
  await it("accepts valid metadata and normalizes deterministic array order", () => {
    const metadata = defineTestMetadata(VALID_METADATA);

    assert.deepEqual(metadata.requirementIds, [
      "REQ-CATALOG-001",
      "REQ-CATALOG-002",
    ]);
    assert.deepEqual(metadata.tags, ["@catalog", "@search"]);
  });

  await it("rejects an invalid test ID", () => {
    assert.throws(
      () => validateTestMetadata({ ...VALID_METADATA, testId: "SEARCH-1" }),
      /testId has an invalid identifier format/u,
    );
  });

  await it("rejects an invalid requirement ID", () => {
    assert.throws(
      () =>
        validateTestMetadata({
          ...VALID_METADATA,
          requirementIds: ["SEARCH-001"],
        }),
      /requirementIds contains an invalid identifier format/u,
    );
  });

  await it("rejects duplicate requirement IDs", () => {
    assert.throws(
      () =>
        validateTestMetadata({
          ...VALID_METADATA,
          requirementIds: ["REQ-CATALOG-001", "REQ-CATALOG-001"],
        }),
      /requirementIds must contain unique values/u,
    );
  });

  await it("rejects duplicate tags", () => {
    assert.throws(
      () =>
        validateTestMetadata({
          ...VALID_METADATA,
          tags: ["@search", "@search"],
        }),
      /tags must contain unique values/u,
    );
  });

  for (const [field, value] of [
    ["risk", "urgent"],
    ["suite", "nightly"],
    ["layer", "browser"],
  ] as const) {
    await it(`rejects an unsupported ${field}`, () => {
      assert.throws(
        () => validateTestMetadata({ ...VALID_METADATA, [field]: value }),
        new RegExp(`^MetadataValidationError: ${field} must be one of:`, "u"),
      );
    });
  }

  await it("rejects credential-like metadata values without echoing them", () => {
    const credential = "token=do-not-report-this";
    assert.throws(
      () =>
        validateTestMetadata({
          ...VALID_METADATA,
          title: credential,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /credential-like data/u);
        assert.doesNotMatch(error.message, /do-not-report-this/u);
        return true;
      },
    );
  });

  await it("does not mutate its input", () => {
    const input = {
      ...VALID_METADATA,
      requirementIds: [...VALID_METADATA.requirementIds],
      tags: [...VALID_METADATA.tags],
    };
    const before = structuredClone(input);

    validateTestMetadata(input);

    assert.deepEqual(input, before);
  });
});

await describe("Playwright metadata conversion", async () => {
  await it("generates canonical tags", () => {
    assert.deepEqual(toPlaywrightTags(defineTestMetadata(VALID_METADATA)), [
      "@smoke",
      "@catalog",
      "@search",
      "@feature:catalog-search",
      "@risk:high",
      "@layer:ui",
      "@requirement:REQ-CATALOG-001",
      "@requirement:REQ-CATALOG-002",
      "@test-id:TC-CATALOG-001",
    ]);
  });

  await it("generates report-visible annotations", () => {
    assert.deepEqual(
      toPlaywrightAnnotations(defineTestMetadata(VALID_METADATA)),
      [
        { type: "test-id", description: "TC-CATALOG-001" },
        { type: "requirement", description: "REQ-CATALOG-001" },
        { type: "requirement", description: "REQ-CATALOG-002" },
        { type: "feature", description: "catalog-search" },
        { type: "risk", description: "high" },
        { type: "layer", description: "ui" },
        { type: "suite", description: "smoke" },
      ],
    );
  });

  await it("produces deterministic output for equivalent input ordering", () => {
    const first = defineTestMetadata(VALID_METADATA);
    const second = defineTestMetadata({
      ...VALID_METADATA,
      requirementIds: [...VALID_METADATA.requirementIds].reverse(),
      tags: [...VALID_METADATA.tags].reverse(),
    });

    assert.deepEqual(toPlaywrightTags(first), toPlaywrightTags(second));
    assert.deepEqual(
      toPlaywrightAnnotations(first),
      toPlaywrightAnnotations(second),
    );
  });
});
