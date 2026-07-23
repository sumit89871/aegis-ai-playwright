import { defineTestMetadata } from "@aegis/core";

export const homePageAccessibilityMetadata = defineTestMetadata({
  testId: "TC-A11Y-001",
  title:
    "Storefront home page has no critical or serious automated accessibility violations",
  feature: "accessibility",
  suite: "smoke",
  risk: "high",
  layer: "ui",
  requirementIds: ["REQ-A11Y-001"],
  tags: ["@accessibility"],
});
