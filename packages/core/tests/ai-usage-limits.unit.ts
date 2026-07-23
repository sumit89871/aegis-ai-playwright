import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  defaultAiConfiguration,
  enforceAiUsageLimits,
  estimateInputTokensConservatively,
  estimateMaximumAiCost,
} from "../src/index.ts";

const pricing = Object.freeze({
  inputCostPerMillionTokens: 1,
  outputCostPerMillionTokens: 2,
});

await describe("AI usage limits", async () => {
  await it("uses a documented conservative character approximation", () => {
    assert.equal(estimateInputTokensConservatively(10), 4);
    assert.equal(estimateMaximumAiCost(10, 100, pricing).approximate, true);
  });

  await it("blocks input and output limits before execution", () => {
    const configuration = defaultAiConfiguration({
      maxInputCharacters: 10,
      maxOutputTokens: 5,
    });
    for (const input of [
      { inputCharacters: 11, requestedOutputTokens: 5 },
      { inputCharacters: 10, requestedOutputTokens: 6 },
    ]) {
      assert.throws(
        () => enforceAiUsageLimits(configuration, input),
        (error: unknown) =>
          error instanceof AiError && error.code === "request-blocked",
      );
    }
  });

  await it("blocks requests above configured estimated cost", () => {
    const configuration = defaultAiConfiguration({
      maxEstimatedCostUsd: 0.000001,
    });
    assert.throws(() =>
      enforceAiUsageLimits(configuration, {
        inputCharacters: 300,
        requestedOutputTokens: 100,
        pricing,
      }),
    );
  });

  await it("requires pricing when a cost limit is configured", () => {
    assert.throws(() =>
      enforceAiUsageLimits(defaultAiConfiguration({ maxEstimatedCostUsd: 1 }), {
        inputCharacters: 10,
        requestedOutputTokens: 10,
      }),
    );
  });

  await it("rejects invalid estimates", () => {
    assert.throws(() => estimateInputTokensConservatively(-1));
    assert.throws(() =>
      estimateMaximumAiCost(10, 10, {
        inputCostPerMillionTokens: -1,
        outputCostPerMillionTokens: 1,
      }),
    );
  });
});
