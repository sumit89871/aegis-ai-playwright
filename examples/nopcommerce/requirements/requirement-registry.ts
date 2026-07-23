import { defineRequirementMetadata } from "@aegis/core";
import type { RequirementMetadata } from "@aegis/core";

export const productSearchRequirement = defineRequirementMetadata({
  requirementId: "REQ-SEARCH-001",
  title: "Product catalogue search",
  documentPath: "requirements/REQ-SEARCH-001.md",
  feature: "product-search",
  status: "active",
});

export const shoppingCartRequirement = defineRequirementMetadata({
  requirementId: "REQ-CART-001",
  title: "Shopper can add an available product to the cart",
  documentPath: "requirements/REQ-CART-001.md",
  feature: "shopping-cart",
  status: "active",
});

export const nopCommerceRequirementRegistry: readonly RequirementMetadata[] =
  Object.freeze([shoppingCartRequirement, productSearchRequirement]);
