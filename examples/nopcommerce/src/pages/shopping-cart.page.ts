import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { parseCartItemQuantity } from "../utils/cart.ts";
import {
  parseCurrencyToMinorUnits,
  parseUsdCurrency,
} from "../utils/currency.ts";

export interface ShoppingCartItem {
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly unitPriceInCents: number;
  readonly unitPriceText: string;
  readonly subtotal: number;
  readonly subtotalInCents: number;
  readonly subtotalText: string;
}

export class ShoppingCartPage {
  private readonly pageRoot: Locator;
  private readonly pageTitle: Locator;
  private readonly emptyCartMessage: Locator;

  public constructor(private readonly page: Page) {
    this.pageRoot = page.locator(".shopping-cart-page");
    this.pageTitle = this.pageRoot
      .locator(".page-title")
      .getByText("Shopping cart", { exact: true });
    this.emptyCartMessage = this.pageRoot.getByText(
      "Your Shopping Cart is empty!",
      { exact: true },
    );
  }

  public async expectDisplayed(): Promise<void> {
    await expect(this.page).toHaveURL(/\/cart(?:[?#].*)?$/u);
    await expect(this.pageTitle).toBeVisible();
  }

  public async expectEmpty(): Promise<void> {
    await expect(this.emptyCartMessage).toBeVisible();
  }

  public async getCartItem(productName: string): Promise<ShoppingCartItem> {
    const cartRow = this.pageRoot
      .locator("table.cart tr")
      .filter({ hasText: productName });
    await expect(cartRow).toHaveCount(1);
    const productLink = cartRow.getByRole("link", {
      name: productName,
      exact: true,
    });

    const displayedProductName = (await productLink.innerText()).trim();
    const quantityText = await cartRow
      .getByLabel("Qty.", { exact: true })
      .inputValue();
    const unitPriceText = (
      await cartRow.locator(".product-unit-price").innerText()
    ).trim();
    const subtotalText = (
      await cartRow.locator(".product-subtotal").innerText()
    ).trim();

    return Object.freeze({
      productName: displayedProductName,
      quantity: parseCartItemQuantity(quantityText),
      unitPrice: parseUsdCurrency(unitPriceText),
      unitPriceInCents: parseCurrencyToMinorUnits(unitPriceText),
      unitPriceText,
      subtotal: parseUsdCurrency(subtotalText),
      subtotalInCents: parseCurrencyToMinorUnits(subtotalText),
      subtotalText,
    });
  }
}
