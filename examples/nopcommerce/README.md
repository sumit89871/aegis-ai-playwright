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
```

The first startup stops at the installation page. Do not run browser search tests until a human completes installation with sample data. See the [manual infrastructure and installation guide](infrastructure/README.md).

Routine shutdown preserves data:

```text
npm run nopcommerce:infra:down
```

The `nopcommerce:infra:reset` command deletes all local database and application volumes. It must not be used without explicit authorization for complete data deletion.

## Requirements and tests

The current browser coverage traces to [REQ-SEARCH-001](requirements/REQ-SEARCH-001.md): exact and partial catalogue searches should display **Build your own computer**.

After installation with sample data and a successful readiness check:

```text
npm run nopcommerce:test:smoke
npm run nopcommerce:test:cross-browser
```

The smoke command runs the two Chromium search tests and writes the HTML report to `examples/nopcommerce/playwright-report`. A normal test run refreshes that directory, so it represents the most recent execution written there.

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
