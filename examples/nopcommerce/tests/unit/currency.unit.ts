import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseUsdCurrency } from "../../src/utils/currency.ts";

await describe("parseUsdCurrency", async () => {
  await it("parses a comma-separated dollar value", () => {
    assert.equal(parseUsdCurrency("$1,200.00"), 1200);
  });

  await it("parses a sub-dollar value", () => {
    assert.equal(parseUsdCurrency("$0.99"), 0.99);
  });

  await it("ignores surrounding whitespace", () => {
    assert.equal(parseUsdCurrency("  $1,200.00  "), 1200);
  });

  await it("throws a descriptive error for invalid currency text", () => {
    assert.throws(
      () => parseUsdCurrency("twelve dollars"),
      /Invalid US-dollar currency value: "twelve dollars"/,
    );
  });
});
