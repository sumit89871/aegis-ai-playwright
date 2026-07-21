import { test as base } from "@playwright/test";

import { HeaderComponent } from "../components/header.component";
import { ProductSearchFlow } from "../flows/product-search.flow";
import { SearchResultsPage } from "../pages/search-results.page";

interface AegisFixtures {
  readonly header: HeaderComponent;
  readonly productSearchFlow: ProductSearchFlow;
  readonly searchResultsPage: SearchResultsPage;
}

export const test = base.extend<AegisFixtures>({
  header: async ({ page }, use) => {
    await use(new HeaderComponent(page));
  },
  searchResultsPage: async ({ page }, use) => {
    await use(new SearchResultsPage(page));
  },
  productSearchFlow: async ({ page, header }, use) => {
    await use(new ProductSearchFlow(page, header));
  },
});
