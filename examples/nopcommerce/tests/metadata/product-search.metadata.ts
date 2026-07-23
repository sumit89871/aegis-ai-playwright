import { defineTestMetadata } from "@aegis/core";

export const exactProductSearchMetadata = defineTestMetadata({
  testId: "TC-SEARCH-001",
  title: "Exact product search displays Build your own computer",
  feature: "product-search",
  suite: "smoke",
  risk: "high",
  layer: "ui",
  requirementIds: ["REQ-SEARCH-001"],
  tags: ["@search"],
});

export const partialProductSearchMetadata = defineTestMetadata({
  testId: "TC-SEARCH-002",
  title: "Partial product search displays a relevant computer product",
  feature: "product-search",
  suite: "smoke",
  risk: "medium",
  layer: "ui",
  requirementIds: ["REQ-SEARCH-001"],
  tags: ["@search"],
});
