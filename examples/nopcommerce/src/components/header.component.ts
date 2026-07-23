import type { Locator, Page } from "@playwright/test";

import { parseHeaderCartQuantity } from "../utils/cart.ts";

export class HeaderComponent {
  private readonly searchInput: Locator;
  private readonly searchButton: Locator;
  private readonly shoppingCartLink: Locator;

  public constructor(page: Page) {
    const header = page.locator(".header");
    this.searchInput = header.getByPlaceholder("Search store");
    this.searchButton = header.getByRole("button", { name: "Search" });
    this.shoppingCartLink = header.getByRole("link", {
      name: /Shopping cart/u,
    });
  }

  public async searchFor(keyword: string): Promise<void> {
    await this.searchInput.fill(keyword);
    await this.searchButton.click();
  }

  public async cartQuantity(): Promise<number> {
    return parseHeaderCartQuantity(await this.shoppingCartLink.innerText());
  }

  public async openShoppingCart(): Promise<void> {
    await this.shoppingCartLink.click();
  }
}
