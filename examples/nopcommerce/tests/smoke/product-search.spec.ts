import { expect } from "@playwright/test";

import { test } from "../../src/fixtures/test-fixtures";

const EXPECTED_PRODUCT = "Build your own computer";
const REQUIREMENT_ANNOTATION = {
  type: "requirement",
  description: "REQ-SEARCH-001",
} as const;

test.describe(
  "Product catalogue search",
  { tag: ["@smoke", "@search"] },
  () => {
    test(
      "REQ-SEARCH-001 | Exact product search displays Build your own computer",
      { annotation: REQUIREMENT_ANNOTATION },
      async ({ productSearchFlow, searchResultsPage }) => {
        await test.step("Open the nopCommerce storefront homepage", async () => {
          await productSearchFlow.openStorefrontHomepage();
        });

        await test.step("Search for the complete product name", async () => {
          await productSearchFlow.searchForProduct(EXPECTED_PRODUCT);
        });

        await test.step("Verify the search-results experience is displayed", async () => {
          await searchResultsPage.expectDisplayed();
        });

        await test.step("Verify the exact product is visible", async () => {
          await searchResultsPage.expectProductVisible(EXPECTED_PRODUCT);
        });
      },
    );

    test(
      "REQ-SEARCH-001 | Partial product search displays a relevant computer product",
      { annotation: REQUIREMENT_ANNOTATION },
      async ({ productSearchFlow, searchResultsPage }) => {
        await test.step("Open the nopCommerce storefront homepage in an isolated context", async () => {
          await productSearchFlow.openStorefrontHomepage();
        });

        await test.step("Search using the partial product keyword computer", async () => {
          await productSearchFlow.searchForProduct("computer");
        });

        await test.step("Verify at least one product result is displayed", async () => {
          await searchResultsPage.expectAtLeastOneResult();
        });

        await test.step("Verify the relevant computer product is visible", async () => {
          await searchResultsPage.expectProductVisible(EXPECTED_PRODUCT);
          const displayedProductNames =
            await searchResultsPage.getDisplayedProductNames();
          expect(displayedProductNames).toContain(EXPECTED_PRODUCT);
        });
      },
    );
  },
);
