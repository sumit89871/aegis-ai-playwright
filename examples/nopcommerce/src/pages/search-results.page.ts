import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export class SearchResultsPage {
  private readonly pageHeading: Locator;
  private readonly productCards: Locator;
  private readonly productNameLinks: Locator;

  public constructor(page: Page) {
    this.pageHeading = page.getByRole("heading", {
      name: "Search",
      exact: true,
    });
    this.productCards = page.locator(".product-item");
    this.productNameLinks = this.productCards
      .getByRole("heading", { level: 2 })
      .getByRole("link");
  }

  public async expectDisplayed(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
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
