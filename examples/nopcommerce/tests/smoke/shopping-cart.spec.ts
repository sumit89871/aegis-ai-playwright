import { expect } from "@playwright/test";
import { toPlaywrightAnnotations, toPlaywrightTags } from "@aegis/core";

import { test } from "../../src/fixtures/test-fixtures.ts";
import { calculateSubtotalInCents } from "../../src/utils/currency.ts";
import { addProductToCartMetadata } from "../metadata/index.ts";

const SELECTED_PRODUCT = "HTC smartphone";

test.describe("Shopping cart", () => {
  test(
    addProductToCartMetadata.title,
    {
      tag: toPlaywrightTags(addProductToCartMetadata),
      annotation: toPlaywrightAnnotations(addProductToCartMetadata),
    },
    async ({ addProductToCartFlow, shoppingCartPage }) => {
      await test.step("Confirm a fresh shopper starts with an empty cart", async () => {
        await addProductToCartFlow.openStorefrontHomepage();
        expect(await addProductToCartFlow.currentCartQuantity()).toBe(0);

        await addProductToCartFlow.openShoppingCart();
        await shoppingCartPage.expectEmpty();
      });

      const journey =
        await test.step("Search for the available product, add one unit, and open the cart", async () => {
          await addProductToCartFlow.openStorefrontHomepage();
          return addProductToCartFlow.addProductToCartAndOpenCart(
            SELECTED_PRODUCT,
          );
        });

      await test.step("Verify the selected product and header cart quantity", () => {
        expect(journey.headerCartQuantityBefore).toBe(0);
        expect(journey.productDetails.productName).toBe(SELECTED_PRODUCT);
        expect(journey.productDetails.unitPriceInCents).toBeGreaterThan(0);
        expect(journey.headerCartQuantityAfter).toBe(1);
      });

      await test.step("Verify the cart row product and quantity", () => {
        expect(journey.cartItem.productName).toBe(SELECTED_PRODUCT);
        expect(journey.cartItem.quantity).toBe(1);
        expect(journey.cartItem.unitPriceInCents).toBe(
          journey.productDetails.unitPriceInCents,
        );
      });

      await test.step("Verify unit price and subtotal are internally consistent", () => {
        const expectedSubtotalInCents = calculateSubtotalInCents(
          journey.cartItem.unitPriceInCents,
          journey.cartItem.quantity,
        );

        expect(journey.cartItem.unitPrice).toBeGreaterThan(0);
        expect(journey.cartItem.subtotalInCents).toBe(expectedSubtotalInCents);
      });

      await test.step("Confirm the journey remains on the cart page before checkout", async () => {
        await shoppingCartPage.expectDisplayed();
      });
    },
  );
});
