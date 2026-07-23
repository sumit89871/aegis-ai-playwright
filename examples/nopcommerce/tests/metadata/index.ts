import type { TestMetadata } from "@aegis/core";

import {
  exactProductSearchMetadata,
  partialProductSearchMetadata,
} from "./product-search.metadata.ts";

export {
  exactProductSearchMetadata,
  partialProductSearchMetadata,
} from "./product-search.metadata.ts";

export const nopCommerceTestCatalog: readonly TestMetadata[] = Object.freeze([
  exactProductSearchMetadata,
  partialProductSearchMetadata,
]);
