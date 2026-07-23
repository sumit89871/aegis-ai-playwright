# nopCommerce reference consumer

`@aegis/example-nopcommerce` demonstrates how an application project consumes `@aegis/core` while keeping application-specific automation isolated from the reusable framework.

## Application under test

The deterministic target is a local nopCommerce 4.90.6 container at `http://localhost:8080`, backed by PostgreSQL 17. The workspace owns this URL default, its dotenv loading, Playwright configuration, page/component objects, business flows, tests, requirements, reports, and infrastructure.

The ignored `.env` uses:

```text
BASE_URL=http://localhost:8080
TEST_ENV=local
```

## Local Docker setup

From the repository root:

```text
npm run nopcommerce:infra:pull
npm run nopcommerce:infra:up
npm run nopcommerce:infra:status
npm run nopcommerce:infra:wait
npm run nopcommerce:preflight
```

The first startup stops at the installation page. Do not run browser search tests until a human completes installation with sample data. See the [manual infrastructure and installation guide](infrastructure/README.md).

Routine shutdown preserves data:

```text
npm run nopcommerce:infra:down
```

The `nopcommerce:infra:reset` command deletes all local database and application volumes. It must not be used without explicit authorization for complete data deletion.

## Application preflight versus infrastructure

The nopCommerce workspace defines a generic `ApplicationProfile` using its existing environment configuration. Run this from the repository root:

```text
npm run nopcommerce:preflight
```

It validates the profile, requests `/`, expects HTTP 200, opens the base URL in Chromium, and checks that the title contains `Your store`. It does not inspect Docker or PostgreSQL and does not read database credentials.

- **Framework doctor** — `npm run doctor` asks whether Node.js, Playwright, browsers, and `@aegis/core` are ready.
- **Application preflight** — `npm run nopcommerce:preflight` asks whether AegisAI can reach and open this storefront.
- **Application infrastructure** — `npm run nopcommerce:infra:status` and `npm run nopcommerce:infra:verify-db` ask whether this example's containers and database are healthy.

Another consumer can reuse the profile and preflight contract without Docker or PostgreSQL.

## Requirements and tests

The current browser coverage traces to:

- [REQ-SEARCH-001](requirements/REQ-SEARCH-001.md): exact and partial catalogue searches should display **Build your own computer**.
- [REQ-CART-001](requirements/REQ-CART-001.md): an available product can be added as one unit and reviewed with consistent cart pricing.

The catalog gives each automated check deterministic metadata:

- A **requirement** describes the expected business behavior.
- A **test ID** uniquely identifies one automated test.
- A **suite** indicates when the test normally runs, such as `smoke`.
- **Risk** indicates the business impact if the behavior fails.
- A **layer** identifies the technical level under test; the current checks use `ui`.
- **Tags** expose those values to Playwright for selective execution.

The exact-search test is `TC-SEARCH-001` (high risk), and the partial-search test is `TC-SEARCH-002` (medium risk). Both cover `REQ-SEARCH-001`.

## Shopping-cart journey

`TC-CART-001` searches for the sample-data product **HTC smartphone**, opens its details, adds exactly one unit, and verifies the full cart's product, quantity, unit price, and subtotal. This product was selected because it is in stock, anonymously purchasable, has a stable displayed price, and requires no configurable options or customer-entered text.

The test uses three application layers:

- `HeaderComponent` reads the user-facing cart count and opens the cart.
- `ProductDetailsPage`, `SearchResultsPage`, and `ShoppingCartPage` model their respective screens and return typed values.
- `AddProductToCartFlow` coordinates search, product review, add-to-cart, and cart navigation as one business activity.

A Flow keeps the test readable: the test describes the shopper's intent and financial assertions instead of repeating every click and locator. Playwright gives every test a fresh browser context, so cart cookies are isolated. The cart test also checks both the initial header count and the full empty-cart page before adding the product; it never deletes shared application data.

Run only the cart test ID from PowerShell at the repository root:

```powershell
npm exec --workspace=@aegis/example-nopcommerce -- playwright test tests/smoke --project=chromium --grep '@test-id:TC-CART-001'
```

Run the shopping-cart feature:

```powershell
npm exec --workspace=@aegis/example-nopcommerce -- playwright test tests/smoke --project=chromium --grep '@feature:shopping-cart'
```

Validate the registry and generate a deterministic coverage map from the repository root:

```text
npm run nopcommerce:traceability
```

The command fails on invalid or duplicate metadata, unknown requirements, missing requirement documents, and active requirements without tests. It writes local output to:

```text
examples/nopcommerce/test-results/traceability/traceability.json
examples/nopcommerce/test-results/traceability/traceability.md
```

These generated files are ignored by Git. The report is derived from the requirement registry and test metadata catalog, not from Playwright runtime reports.

After installation with sample data and a successful readiness check:

```text
npm run nopcommerce:test:smoke
npm run nopcommerce:test:cross-browser
```

Structured tags also support focused runs from PowerShell at the repository root:

```powershell
# All smoke tests
npm run nopcommerce:test:smoke

# High-risk tests
npm exec --workspace=@aegis/example-nopcommerce -- playwright test tests/smoke --project=chromium --grep '@risk:high'

# Every test linked to one requirement
npm exec --workspace=@aegis/example-nopcommerce -- playwright test tests/smoke --project=chromium --grep '@requirement:REQ-SEARCH-001'

# One test ID
npm exec --workspace=@aegis/example-nopcommerce -- playwright test tests/smoke --project=chromium --grep '@test-id:TC-SEARCH-001'
```

The metadata also appears as Playwright tags and annotations in the HTML report, so a reviewer can see the test ID, requirement, feature, suite, risk, and layer without interpreting the title.

The smoke command runs the two Chromium search tests and the cart journey, then writes the HTML report to `examples/nopcommerce/playwright-report`. A normal test run refreshes that directory, so it represents the most recent execution written there.

Open that report from the repository root with the convenience command:

```text
npm run nopcommerce:report
```

From inside `examples/nopcommerce`, the equivalent workspace command is:

```text
npm run report
```

Avoid running `npx playwright show-report` from an arbitrary directory. Playwright may find a different `playwright-report` folder there and display an older or unrelated run.

## Failure evidence and diagnostics

When a test fails, Playwright keeps evidence under `examples/nopcommerce/test-results`:

- The HTML report summarizes test results and links to retained evidence.
- A screenshot shows the page at the point of failure.
- A video shows browser activity leading to the failure.
- A trace supports step-by-step inspection of actions, network activity, and page state.
- Console diagnostics contain browser JavaScript errors.
- Page-error diagnostics contain uncaught browser exceptions.
- Failed-request diagnostics identify requests that never completed.
- HTTP-error diagnostics identify 4xx and 5xx responses without recording response bodies.

Screenshots, videos, traces, and diagnostic JSON attachments are retained only for failed tests. On failure, all four diagnostic categories are attached as JSON arrays, including empty arrays, plus a diagnostic summary and safe test context. Generated evidence is ignored by Git.

Open the latest HTML report from the repository root:

```text
npm run nopcommerce:report
```

Open a retained trace directly with:

```text
npx playwright show-trace <path-to-trace.zip>
```

Workspace unit tests include the intentionally USD-specific currency parser:

```text
npm run test:unit --workspace=@aegis/example-nopcommerce
```

The parser remains in this consumer because it is not a locale- or currency-configurable framework abstraction. A broader core monetary utility may be considered in a later milestone when a real cross-application need exists.

## Public demo limitation

The shared public demo returned Cloudflare HTTP 403 human-verification pages to Playwright browser sessions. CAPTCHA and Cloudflare protections are never bypassed. Local pinned infrastructure provides the stable, controlled reference environment.

## Why this is an example

This project proves the consumer boundary: it imports generic configuration support through `@aegis/core`, while core has no knowledge of this application. Future client projects can follow the same structure and may eventually live in separate repositories after framework packages are prepared for private-registry publication.
