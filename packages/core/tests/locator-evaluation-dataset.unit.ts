import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLocatorEvaluationAnalysisInput,
  LOCATOR_CALIBRATION_DATASET,
  LOCATOR_VALIDATION_DATASET,
  MAX_LOCATOR_CANDIDATES,
  validateLocatorEvaluationCase,
  validateLocatorEvaluationDataset,
} from "../src/index.ts";
import type { LocatorEvaluationCase } from "../src/index.ts";

function mutableCase(): Record<string, unknown> {
  return structuredClone(
    LOCATOR_CALIBRATION_DATASET.cases[0],
  ) as unknown as Record<string, unknown>;
}

function maximumCandidateCase(): LocatorEvaluationCase {
  const first = LOCATOR_CALIBRATION_DATASET.cases[0];
  assert.ok(first !== undefined);
  const descriptor = first.input.candidates[0]?.descriptor;
  assert.ok(descriptor !== undefined);
  return {
    ...structuredClone(first),
    input: {
      ...structuredClone(first.input),
      candidates: Array.from(
        { length: MAX_LOCATOR_CANDIDATES },
        (_, index) => ({
          candidateId: `LOCATOR-${String(index + 1).padStart(3, "0")}`,
          descriptor: structuredClone(descriptor),
        }),
      ),
    },
    expected: {
      ...structuredClone(first.expected),
      recommendationStatus: "no-change-recommended",
      acceptableCandidateIds: [],
      preferredCandidateIds: [],
      forbiddenCandidateIds: [],
      locatorChangeAllowed: false,
    },
  };
}

await describe("locator evaluation dataset validation", async () => {
  await it("validates both reviewed packs and their balanced size", () => {
    assert.equal(
      validateLocatorEvaluationDataset(LOCATOR_CALIBRATION_DATASET).cases
        .length,
      20,
    );
    assert.equal(
      validateLocatorEvaluationDataset(LOCATOR_VALIDATION_DATASET).cases.length,
      20,
    );
  });

  await it("rejects duplicate case IDs", () => {
    const dataset = structuredClone(LOCATOR_CALIBRATION_DATASET);
    const first = dataset.cases[0];
    assert.ok(first !== undefined);
    const cases = [...dataset.cases];
    cases[1] = structuredClone(first);
    assert.throws(
      () => validateLocatorEvaluationDataset({ ...dataset, cases }),
      /case IDs must be unique/u,
    );
  });

  for (const [name, mutate, pattern] of [
    [
      "missing expected classification",
      (value: Record<string, unknown>): void => {
        delete (value.expected as Record<string, unknown>).classification;
      },
      /classification/u,
    ],
    [
      "unknown expected classification",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).classification = "magic";
      },
      /classification/u,
    ],
    [
      "invalid recommendation status",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).recommendationStatus =
          "heal";
      },
      /recommendation/u,
    ],
    [
      "acceptable candidate absent from inventory",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).acceptableCandidateIds = [
          "LOCATOR-999",
        ];
      },
      /must exist/u,
    ],
    [
      "preferred candidate not acceptable",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).preferredCandidateIds = [
          "LOCATOR-003",
        ];
      },
      /preferred/u,
    ],
    [
      "forbidden candidate absent from inventory",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).forbiddenCandidateIds = [
          "LOCATOR-999",
        ];
      },
      /must exist/u,
    ],
    [
      "candidate acceptable and forbidden",
      (value: Record<string, unknown>): void => {
        (value.expected as Record<string, unknown>).forbiddenCandidateIds = [
          "LOCATOR-001",
        ];
      },
      /acceptable and forbidden/u,
    ],
    [
      "missing rationale",
      (value: Record<string, unknown>): void => {
        (value.humanReview as Record<string, unknown>).classificationReason =
          "";
      },
      /classificationReason/u,
    ],
    [
      "invalid dataset version",
      (value: Record<string, unknown>): void => {
        value.datasetVersion = "latest";
      },
      /datasetVersion/u,
    ],
  ] as const) {
    await it(`rejects ${name}`, () => {
      const value = mutableCase();
      mutate(value);
      assert.throws(
        () =>
          validateLocatorEvaluationCase(
            value as unknown as LocatorEvaluationCase,
          ),
        pattern,
      );
    });
  }

  await it("does not mutate a reviewed case", () => {
    const first = LOCATOR_CALIBRATION_DATASET.cases[0];
    assert.ok(first !== undefined);
    const value = structuredClone(first);
    const before = JSON.stringify(value);
    validateLocatorEvaluationCase(value);
    assert.equal(JSON.stringify(value), before);
  });

  await it("accepts verdict arrays through the shared candidate maximum", () => {
    const value = maximumCandidateCase();
    const ids = value.input.candidates.map(({ candidateId }) => candidateId);
    for (const count of [0, 1, 49, MAX_LOCATOR_CANDIDATES]) {
      assert.doesNotThrow(() =>
        validateLocatorEvaluationCase({
          ...value,
          expected: {
            ...value.expected,
            forbiddenCandidateIds: ids.slice(0, count),
          },
        }),
      );
    }
  });

  await it("rejects candidate inventories and verdict arrays above the shared maximum", () => {
    const value = maximumCandidateCase();
    const firstCandidate = value.input.candidates[0];
    assert.ok(firstCandidate !== undefined);
    const extra = {
      ...firstCandidate,
      candidateId: "LOCATOR-051",
    };
    assert.throws(
      () =>
        validateLocatorEvaluationCase({
          ...value,
          input: {
            ...value.input,
            candidates: [...value.input.candidates, extra],
          },
        }),
      /at most 50/u,
    );
    assert.throws(
      () =>
        validateLocatorEvaluationCase({
          ...value,
          expected: {
            ...value.expected,
            forbiddenCandidateIds: [
              ...value.input.candidates.map(({ candidateId }) => candidateId),
              "LOCATOR-051",
            ],
          },
        }),
      /bounded array/u,
    );
  });

  await it("removes expected answers and rationale before diagnosis", () => {
    const first = LOCATOR_CALIBRATION_DATASET.cases[0];
    assert.ok(first !== undefined);
    const runtime = buildLocatorEvaluationAnalysisInput(first);
    const serialized = JSON.stringify(runtime);
    assert.doesNotMatch(
      serialized,
      /humanReview|acceptableCandidateIds|preferredCandidateIds|forbiddenCandidateIds|threshold/u,
    );
    assert.match(serialized, /LOCATOR-001/u);
    assert.doesNotThrow(() => JSON.stringify(runtime));
  });

  await it("rejects a dataset with mismatched case versions", () => {
    const dataset = structuredClone(LOCATOR_CALIBRATION_DATASET);
    const cases = [...dataset.cases];
    const first = cases[0];
    assert.ok(first);
    cases[0] = { ...first, datasetVersion: "2.0.0" };
    assert.throws(
      () => validateLocatorEvaluationDataset({ ...dataset, cases }),
      /must match/u,
    );
  });
});
