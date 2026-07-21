import type { Page } from "@playwright/test";

import type { HeaderComponent } from "../components/header.component";

export class ProductSearchFlow {
  public constructor(
    private readonly page: Page,
    private readonly header: HeaderComponent,
  ) {}

  public async openStorefrontHomepage(): Promise<void> {
    const response = await this.page.goto("/");

    if (response === null) {
      throw new Error(
        "Storefront navigation completed without an HTTP response.",
      );
    }

    if (!response.ok()) {
      throw new Error(
        `Unable to open the storefront homepage: received HTTP ${String(response.status())} ${response.statusText()}.`,
      );
    }
  }

  public async searchForProduct(keyword: string): Promise<void> {
    await this.header.searchFor(keyword);
  }
}
