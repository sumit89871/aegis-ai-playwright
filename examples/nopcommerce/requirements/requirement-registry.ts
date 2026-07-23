import { defineRequirementMetadata } from "@aegis/core";
import type { RequirementMetadata } from "@aegis/core";

export const productSearchRequirement = defineRequirementMetadata({
  requirementId: "REQ-SEARCH-001",
  title: "Product catalogue search",
  documentPath: "requirements/REQ-SEARCH-001.md",
  feature: "product-search",
  status: "active",
});

export const nopCommerceRequirementRegistry: readonly RequirementMetadata[] =
  Object.freeze([productSearchRequirement]);
