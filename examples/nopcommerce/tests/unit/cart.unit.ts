import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCartItemQuantity,
  parseHeaderCartQuantity,
} from "../../src/utils/cart.ts";

await describe("cart quantity parsing", async () => {
  await it("parses an empty header cart", () => {
    assert.equal(parseHeaderCartQuantity("Shopping cart (0)"), 0);
  });

  await it("normalizes whitespace in the header cart text", () => {
    assert.equal(parseHeaderCartQuantity("\n Shopping cart\n (12) \n"), 12);
  });

  await it("parses a positive cart-row quantity", () => {
    assert.equal(parseCartItemQuantity(" 1 "), 1);
  });

  await it("rejects invalid header quantity text", () => {
    assert.throws(
      () => parseHeaderCartQuantity("Shopping cart"),
      /Invalid header cart quantity text/u,
    );
  });

  await it("rejects invalid cart-row quantity text", () => {
    assert.throws(
      () => parseCartItemQuantity("1.5"),
      /Invalid cart item quantity/u,
    );
  });
});
