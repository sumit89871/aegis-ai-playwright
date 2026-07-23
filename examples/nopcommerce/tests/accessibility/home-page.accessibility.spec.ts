import {
  assertAccessibilityPolicy,
  toPlaywrightAnnotations,
  toPlaywrightTags,
} from "@aegis/core";

import { test } from "../../src/fixtures/test-fixtures.ts";
import { homePageAccessibilityMetadata } from "../metadata/index.ts";

test.describe("Storefront accessibility", () => {
  test(
    homePageAccessibilityMetadata.title,
    {
      tag: toPlaywrightTags(homePageAccessibilityMetadata),
      annotation: toPlaywrightAnnotations(homePageAccessibilityMetadata),
    },
    async ({ accessibility, homePage, productSearchFlow }) => {
      await test.step("Open the storefront home page in a business-ready state", async () => {
        await productSearchFlow.openStorefrontHomepage();
        await homePage.expectReady();
      });

      const result =
        await test.step("Scan the home page against selected WCAG rules", async () =>
          accessibility.scan({
            includedTags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          }));

      await test.step("Verify no critical or serious automated violations remain", () => {
        assertAccessibilityPolicy(result);
      });
    },
  );
});
