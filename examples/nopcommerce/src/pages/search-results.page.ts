import { definePageReadiness, waitForPageReady } from "@aegis/core";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const SEARCH_RESULTS_READINESS = definePageReadiness({
  id: "nopcommerce-search-results",
  timeoutMs: 10_000,
  url: { pattern: "\\/search(?:[?#]|$)" },
  visibleHeading: { name: "Search", exact: true },
});

export class SearchResultsPage {
  private readonly productCards: Locator;
  private readonly productNameLinks: Locator;

  public constructor(private readonly page: Page) {
    this.productCards = page.locator(".product-item");
    this.productNameLinks = this.productCards
      .getByRole("heading", { level: 2 })
      .getByRole("link");
  }

  public async expectDisplayed(): Promise<void> {
    await waitForPageReady(this.page, SEARCH_RESULTS_READINESS);
  }

  public async expectProductVisible(productName: string): Promise<void> {
    const productLink = this.productCards.getByRole("link", {
      name: productName,
      exact: true,
    });
    await expect(productLink).toBeVisible();
  }

  public async openProduct(productName: string): Promise<void> {
    await this.productCards
      .getByRole("link", { name: productName, exact: true })
      .click();
  }

  public async getDisplayedProductNames(): Promise<readonly string[]> {
    return this.productNameLinks.allTextContents();
  }

  public async expectAtLeastOneResult(): Promise<void> {
    await expect(this.productCards).not.toHaveCount(0);
  }
}
