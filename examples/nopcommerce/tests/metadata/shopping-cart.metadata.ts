import { defineTestMetadata } from "@aegis/core";

export const addProductToCartMetadata = defineTestMetadata({
  testId: "TC-CART-001",
  title: "Shopper adds an available product to the shopping cart",
  feature: "shopping-cart",
  suite: "smoke",
  risk: "high",
  layer: "ui",
  requirementIds: ["REQ-CART-001"],
  tags: ["@cart"],
});
