# REQ-CART-001: Shopper can add an available product to the cart

## Business purpose

A shopper shall be able to add an available catalogue product to the shopping cart and see correct product, quantity, and pricing information before deciding whether to proceed further.

## Preconditions

- The storefront is available.
- The sample catalogue contains an in-stock product that can be purchased anonymously.
- The shopper starts in a fresh browser context with an empty cart.

## Primary flow

1. The shopper searches for an available product.
2. The shopper opens the matching product-details page.
3. The shopper adds exactly one unit to the shopping cart.
4. The shopper opens the full shopping-cart page.
5. The shopper reviews the product, quantity, unit price, and subtotal.

## Acceptance criteria

### AC-CART-001

The shopper can locate an available product through catalogue search.

### AC-CART-002

The shopper can open the selected product's details page.

### AC-CART-003

The shopper can add one unit of the selected product to the cart.

### AC-CART-004

The header cart indicator reflects one added unit.

### AC-CART-005

The full cart contains the expected product.

### AC-CART-006

The matching cart row has quantity one.

### AC-CART-007

The displayed unit price is a valid positive monetary value.

### AC-CART-008

The displayed subtotal equals the unit price multiplied by quantity using an exact minor-unit comparison.

### AC-CART-009

The journey ends on the shopping-cart page without entering checkout or placing an order.

## Risk

High. A failure prevents a shopper from beginning a purchase or makes the cart's financial information unreliable.

## Out of scope

- Authentication and customer accounts
- Cart quantity changes or item removal
- Checkout, addresses, shipping selection, payment, and order placement
- Promotions, tax calculation, gift cards, and multiple-product carts
