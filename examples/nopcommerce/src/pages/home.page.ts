import { definePageReadiness, waitForPageReady } from "@aegis/core";
import type { Page } from "@playwright/test";

const HOME_PAGE_READINESS = definePageReadiness({
  id: "nopcommerce-home-page",
  timeoutMs: 10_000,
  titleContains: "Your store",
  visibleHeading: {
    name: "Welcome to our store",
    exact: true,
  },
});

export class HomePage {
  public constructor(private readonly page: Page) {}

  public async expectReady(): Promise<void> {
    await waitForPageReady(this.page, HOME_PAGE_READINESS);
  }
}
