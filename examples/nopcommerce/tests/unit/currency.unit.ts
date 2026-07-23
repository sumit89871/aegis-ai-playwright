import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateSubtotalInCents,
  parseCurrencyToMinorUnits,
  parseUsdCurrency,
} from "../../src/utils/currency.ts";

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

await describe("displayed currency normalization", async () => {
  await it("normalizes US dollars to exact minor units", () => {
    assert.equal(parseCurrencyToMinorUnits("$1,200.50"), 120_050);
  });

  await it("does not assume a single currency symbol", () => {
    assert.equal(parseCurrencyToMinorUnits("₹1,234.50"), 123_450);
  });

  await it("rejects invalid monetary text", () => {
    assert.throws(
      () => parseCurrencyToMinorUnits("not money"),
      /Invalid displayed currency value/u,
    );
  });
});

await describe("cart subtotal calculation", async () => {
  await it("multiplies exact minor units by quantity", () => {
    assert.equal(calculateSubtotalInCents(24_500, 1), 24_500);
    assert.equal(calculateSubtotalInCents(24_500, 3), 73_500);
  });

  await it("rejects an invalid quantity", () => {
    assert.throws(
      () => calculateSubtotalInCents(24_500, 0),
      /Cart quantity must be a positive safe integer/u,
    );
  });
});
