import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  definePageReadiness,
  PageReadinessError,
  validatePageReadinessDefinition,
} from "../src/index.ts";
import type { PageReadinessDefinition } from "../src/index.ts";

function validDefinition(
  overrides: Partial<PageReadinessDefinition> = {},
): PageReadinessDefinition {
  return {
    id: "sample-page",
    timeoutMs: 10_000,
    url: { pathname: "/sample" },
    visibleHeading: { name: "Sample page", exact: true },
    ...overrides,
  };
}

await describe("page readiness definitions", async () => {
  await it("accepts and freezes a valid definition", () => {
    const definition = definePageReadiness(validDefinition());
    assert.equal(definition.id, "sample-page");
    assert.equal(Object.isFrozen(definition), true);
  });

  await it("requires at least one readiness criterion", () => {
    assert.throws(
      () =>
        validatePageReadinessDefinition({
          id: "sample-page",
          timeoutMs: 10_000,
        }),
      /at least one criterion/u,
    );
  });

  await it("rejects an invalid timeout", () => {
    assert.throws(
      () => validatePageReadinessDefinition(validDefinition({ timeoutMs: 0 })),
      /timeoutMs/u,
    );
  });

  await it("rejects an invalid URL matcher", () => {
    assert.throws(
      () =>
        validatePageReadinessDefinition(
          validDefinition({ url: { pattern: "[invalid" } }),
        ),
      /valid regular-expression/u,
    );
  });

  await it("does not mutate input", () => {
    const input = validDefinition();
    const before = JSON.stringify(input);
    validatePageReadinessDefinition(input);
    assert.equal(JSON.stringify(input), before);
  });

  await it("rejects non-serializable or unsupported fields", () => {
    assert.throws(
      () =>
        validatePageReadinessDefinition({
          ...validDefinition(),
          callback: (): boolean => true,
        }),
      /unsupported field callback/u,
    );
  });

  await it("provides serializable bounded failure details while preserving the cause", () => {
    const cause = new Error("Original Playwright assertion");
    const details = {
      status: "fail" as const,
      definitionId: "sample-page",
      durationMs: 10,
      error: "Original Playwright assertion",
    };
    const error = new PageReadinessError("Page was not ready", details, cause);
    assert.equal(error.cause, cause);
    assert.doesNotThrow(() => JSON.stringify(error.details));
  });
});
