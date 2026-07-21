import type { Locator, Page } from "@playwright/test";

export class HeaderComponent {
  private readonly searchInput: Locator;
  private readonly searchButton: Locator;

  public constructor(page: Page) {
    const header = page.locator(".header");
    this.searchInput = header.getByPlaceholder("Search store");
    this.searchButton = header.getByRole("button", { name: "Search" });
  }

  public async searchFor(keyword: string): Promise<void> {
    await this.searchInput.fill(keyword);
    await this.searchButton.click();
  }
}
