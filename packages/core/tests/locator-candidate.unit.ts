import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatLocatorCandidate,
  rankLocatorCandidates,
  scoreLocatorCandidate,
} from "../src/index.ts";
import type { CandidateScoreInput, LocatorCandidate } from "../src/index.ts";

function candidate(
  overrides: Partial<CandidateScoreInput> = {},
): CandidateScoreInput {
  return {
    strategy: "role",
    role: "button",
    name: "Save",
    exact: true,
    scopeHint: null,
    tagName: "button",
    matchCount: 1,
    visible: true,
    enabled: true,
    editable: false,
    hasBoundingBox: true,
    ...overrides,
  };
}

const intent = Object.freeze({
  operation: "click" as const,
  strategy: "role" as const,
  role: "button",
  name: "Save",
});

await describe("locator candidate scoring", async () => {
  await it("ranks a unique semantic role above duplicate text", () => {
    const textCandidate: CandidateScoreInput = {
      strategy: "text",
      value: "Save",
      exact: true,
      scopeHint: null,
      tagName: "span",
      matchCount: 2,
      visible: true,
      enabled: true,
      editable: false,
      hasBoundingBox: true,
    };
    const result = rankLocatorCandidates([candidate(), textCandidate], intent);
    const [first, second] = result.candidates;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.strategy, "role");
    assert.ok(first.deterministicScore > second.deterministicScore);
  });

  await it("penalizes hidden and disabled action targets", () => {
    const good = scoreLocatorCandidate(candidate(), intent);
    const weak = scoreLocatorCandidate(
      candidate({ visible: false, enabled: false }),
      intent,
    );
    assert.ok(good.deterministicScore > weak.deterministicScore);
  });

  await it("enforces limits and preserves dropped count", () => {
    const testIdCandidate: CandidateScoreInput = {
      strategy: "test-id",
      value: "save",
      exact: true,
      scopeHint: null,
      tagName: "button",
      matchCount: 1,
      visible: true,
      enabled: true,
      editable: false,
      hasBoundingBox: true,
    };
    const result = rankLocatorCandidates(
      [candidate(), testIdCandidate],
      intent,
      1,
    );
    assert.equal(result.candidates.length, 1);
    assert.equal(result.dropped, 1);
  });

  await it("uses deterministic tie-breaking", () => {
    const first = rankLocatorCandidates(
      [candidate({ name: "Beta" }), candidate({ name: "Alpha" })],
      intent,
    );
    const second = rankLocatorCandidates(
      [candidate({ name: "Alpha" }), candidate({ name: "Beta" })],
      intent,
    );
    assert.deepEqual(first, second);
  });

  await it("formats only validated structured strategies", () => {
    const ranked = rankLocatorCandidates(
      [candidate({ name: 'Save "now"' })],
      intent,
    ).candidates[0];
    assert.ok(ranked !== undefined);
    assert.equal(
      formatLocatorCandidate(ranked),
      'page.getByRole("button", { name: "Save \\"now\\"", exact: true })',
    );
  });

  await it("refuses unsupported strategies", () => {
    const unsupported = {
      ...rankLocatorCandidates([candidate()], intent).candidates[0],
      strategy: "unsupported",
    } as LocatorCandidate;
    assert.throws(() => formatLocatorCandidate(unsupported), /Unsupported/u);
  });

  for (const [strategy, value] of [
    ["label", "Email"],
    ["placeholder", "Email address"],
    ["test-id", "save-button"],
    ["text", "Save"],
    ["alt-text", "Profile"],
    ["title", "Settings"],
    ["stable-id", "save-button"],
    ["scoped-css", "button.save-action"],
  ] as const) {
    await it(`formats the controlled ${strategy} strategy`, () => {
      const ranked = rankLocatorCandidates(
        [
          {
            strategy,
            value,
            exact: true,
            scopeHint: null,
            tagName: "button",
            matchCount: 1,
            visible: true,
            enabled: true,
            editable: false,
            hasBoundingBox: true,
          },
        ],
        intent,
      ).candidates[0];
      assert.ok(ranked !== undefined);
      assert.doesNotThrow(() => formatLocatorCandidate(ranked));
    });
  }

  await it("rejects XPath and positional descriptor values", () => {
    const base = rankLocatorCandidates([candidate()], intent).candidates[0];
    assert.ok(base !== undefined);
    for (const value of ["xpath=//button", "button.nth(1)"]) {
      assert.throws(
        () =>
          formatLocatorCandidate({
            ...base,
            strategy: "scoped-css",
            value,
          }),
        /unsafe/u,
      );
    }
  });
});
