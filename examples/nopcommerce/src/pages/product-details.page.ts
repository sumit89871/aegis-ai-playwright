import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  parseCurrencyToMinorUnits,
  parseUsdCurrency,
} from "../utils/currency.ts";

export interface ProductDetailsSnapshot {
  readonly productName: string;
  readonly unitPrice: number;
  readonly unitPriceInCents: number;
  readonly unitPriceText: string;
}

export class ProductDetailsPage {
  private readonly productName: Locator;
  private readonly productPrice: Locator;
  private readonly quantityInput: Locator;
  private readonly addToCartButton: Locator;
  private readonly addToCartConfirmation: Locator;

  public constructor(page: Page) {
    const productDetails = page.locator(".product-essential");
    this.productName = productDetails.locator(".product-name");
    this.productPrice = productDetails.locator(".product-price");
    this.quantityInput = productDetails.getByLabel("Enter a quantity");
    this.addToCartButton = productDetails.getByRole("button", {
      name: "Add to cart",
      exact: true,
    });
    this.addToCartConfirmation = page.getByText(
      "The product has been added to your shopping cart",
      { exact: true },
    );
  }

  public async expectProductDisplayed(productName: string): Promise<void> {
    await expect(this.productName).toHaveText(productName);
  }

  public async getProductDetails(): Promise<ProductDetailsSnapshot> {
    const productName = (await this.productName.innerText()).trim();
    const unitPriceText = (await this.productPrice.innerText()).trim();

    return Object.freeze({
      productName,
      unitPrice: parseUsdCurrency(unitPriceText),
      unitPriceInCents: parseCurrencyToMinorUnits(unitPriceText),
      unitPriceText,
    });
  }

  public async addOneUnitToCart(): Promise<void> {
    await this.quantityInput.fill("1");
    await this.addToCartButton.click();
    await expect(this.addToCartConfirmation).toBeVisible();
  }
}
