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

Workspace unit tests include the intentionally USD-specific currency parser:

```text
npm run test:unit --workspace=@aegis/example-nopcommerce
```

The parser remains in this consumer because it is not a locale- or currency-configurable framework abstraction. A broader core monetary utility may be considered in a later milestone when a real cross-application need exists.

## Public demo limitation

The shared public demo returned Cloudflare HTTP 403 human-verification pages to Playwright browser sessions. CAPTCHA and Cloudflare protections are never bypassed. Local pinned infrastructure provides the stable, controlled reference environment.

## Why this is an example

This project proves the consumer boundary: it imports generic configuration support through `@aegis/core`, while core has no knowledge of this application. Future client projects can follow the same structure and may eventually live in separate repositories after framework packages are prepared for private-registry publication.
