import type { HeaderComponent } from "../components/header.component.ts";
import type {
  ProductDetailsPage,
  ProductDetailsSnapshot,
} from "../pages/product-details.page.ts";
import type {
  ShoppingCartItem,
  ShoppingCartPage,
} from "../pages/shopping-cart.page.ts";
import type { SearchResultsPage } from "../pages/search-results.page.ts";
import type { ProductSearchFlow } from "./product-search.flow.ts";

export interface AddProductToCartResult {
  readonly headerCartQuantityBefore: number;
  readonly headerCartQuantityAfter: number;
  readonly productDetails: ProductDetailsSnapshot;
  readonly cartItem: ShoppingCartItem;
}

export class AddProductToCartFlow {
  public constructor(
    private readonly productSearchFlow: ProductSearchFlow,
    private readonly searchResultsPage: SearchResultsPage,
    private readonly productDetailsPage: ProductDetailsPage,
    private readonly header: HeaderComponent,
    private readonly shoppingCartPage: ShoppingCartPage,
  ) {}

  public async openStorefrontHomepage(): Promise<void> {
    await this.productSearchFlow.openStorefrontHomepage();
  }

  public async currentCartQuantity(): Promise<number> {
    return this.header.cartQuantity();
  }

  public async openShoppingCart(): Promise<void> {
    await this.header.openShoppingCart();
    await this.shoppingCartPage.expectDisplayed();
  }

  public async addProductToCartAndOpenCart(
    productName: string,
  ): Promise<AddProductToCartResult> {
    const headerCartQuantityBefore = await this.header.cartQuantity();

    await this.productSearchFlow.searchForProduct(productName);
    await this.searchResultsPage.expectDisplayed();
    await this.searchResultsPage.openProduct(productName);
    await this.productDetailsPage.expectProductDisplayed(productName);

    const productDetails = await this.productDetailsPage.getProductDetails();
    await this.productDetailsPage.addOneUnitToCart();
    const headerCartQuantityAfter = await this.header.cartQuantity();

    await this.header.openShoppingCart();
    await this.shoppingCartPage.expectDisplayed();
    const cartItem = await this.shoppingCartPage.getCartItem(productName);

    return Object.freeze({
      headerCartQuantityBefore,
      headerCartQuantityAfter,
      productDetails,
      cartItem,
    });
  }
}
