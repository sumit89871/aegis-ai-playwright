import type { TestMetadata } from "@aegis/core";

import { homePageAccessibilityMetadata } from "./accessibility.metadata.ts";
import {
  exactProductSearchMetadata,
  partialProductSearchMetadata,
} from "./product-search.metadata.ts";
import { addProductToCartMetadata } from "./shopping-cart.metadata.ts";

export {
  exactProductSearchMetadata,
  partialProductSearchMetadata,
} from "./product-search.metadata.ts";
export { homePageAccessibilityMetadata } from "./accessibility.metadata.ts";
export { addProductToCartMetadata } from "./shopping-cart.metadata.ts";

export const nopCommerceTestCatalog: readonly TestMetadata[] = Object.freeze([
  addProductToCartMetadata,
  homePageAccessibilityMetadata,
  exactProductSearchMetadata,
  partialProductSearchMetadata,
]);
