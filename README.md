# AegisAI Playwright Quality Platform

AegisAI is a reusable, deterministic Playwright and TypeScript framework platform. This repository is an npm-workspaces monorepo that separates application-independent capabilities from consumer-specific automation.

The current onboarding foundation provides generic setup, framework health checks, application profiles, application preflight, and a copyable consumer template. The packages remain private and are not yet published or independently installable from an npm registry.

## Workspace architecture

```text
packages/core                   @aegis/core
    application-independent configuration and utility foundations

examples/nopcommerce           @aegis/example-nopcommerce
    reference consumer with pages, components, flows, tests, requirements,
    Playwright configuration, environment defaults, and Docker infrastructure
```

Dependency direction is one-way:

```text
examples/nopcommerce -> @aegis/core
```

Core never imports from an example. Application selectors, URLs, product names, business workflows, and application infrastructure remain in the consumer project.

Client projects may eventually live in separate repositories and consume published framework packages from a private npm registry. Publication, package builds, and external distribution are future milestones.

## Prerequisites

- Node.js `>=22.22.0 <27`
- npm
- Git
- Docker and Docker Compose for the reference example
- Network access for dependencies, browsers, and pinned container images

The repository pins Node.js `22.22.2` in `.nvmrc` for repeatable local and CI execution while retaining support for maintained Node 22, 24, and 26 releases through the broader package engine range.

## Clone-to-ready framework workflow

These commands prepare and validate AegisAI itself without requiring nopCommerce, Docker, PostgreSQL, an application `.env`, or any running target application:

```text
git clone <repository>
cd aegis-ai-playwright
npm install
npm run setup
npm run doctor
npm run doctor:browsers
npm run validate
```

- `npm install` installs and links repository workspace dependencies.
- `npm run setup` validates Node.js, verifies workspace packages, uses the repository-local Playwright CLI to install or verify Chromium, Firefox, and WebKit, then typechecks and imports `@aegis/core`. It never runs `npm install` recursively or starts application infrastructure. Use `npm run setup -- --skip-browsers` only when browser installation is deliberately handled elsewhere.
- `npm run doctor` performs read-only framework checks: Node/npm, lockfile and workspace readiness, core resolution/imports, Playwright version alignment, browser executables, and the core-to-consumer dependency boundary.
- `npm run doctor -- --json` emits the same deterministic checks as machine-readable JSON with stable IDs.
- `npm run doctor:browsers` launches each browser against a local `data:` URL to prove launch, context, page, and navigation capability without contacting an application or the internet.
- `npm run validate` runs formatting checks, linting, strict TypeScript checks, and unit tests.

When piping doctor JSON to another tool, use `npm run --silent doctor -- --json` to suppress npm's command banner.

The browser doctor still checks all three browsers by default. Select one browser, as the CI matrix does, with:

```text
npm run doctor:browsers -- --browser=chromium
npm run doctor:browsers -- --browser=firefox
npm run doctor:browsers -- --browser=webkit
npm run doctor:browsers -- --browser=chromium --json
```

The managed Codex Windows sandbox may prevent Firefox's Gecko tab subprocess from starting even when Firefox is installed correctly. `doctor:browsers` reports that runtime failure honestly. The unchanged command passes in a normal non-administrator PowerShell session; no framework bypass is applied.

## Three readiness levels

| Question                                            | Command type                  | Example                                                                                     |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| Is AegisAI installed correctly?                     | Framework doctor              | Checks Node.js, Playwright packages, core exports, and browser installations.               |
| Can AegisAI reach and open my application?          | Application preflight         | The nopCommerce profile checks that `http://localhost:8080` responds and opens in Chromium. |
| Are this application's supporting services healthy? | Consumer infrastructure check | nopCommerce checks its Docker containers and PostgreSQL database.                           |

Only the first two concepts use reusable core APIs. Infrastructure belongs to each consumer; another application may not use Docker or PostgreSQL at all.

## Onboard another application

The inert files under `templates/application` are a copyable consumer starting point. Replace `__APP_ID__`, `__APP_NAME__`, `__BASE_URL__`, and `__EXPECTED_TITLE__`, remove each `.template` suffix, and keep application selectors, requirements, pages, flows, fixtures, and infrastructure inside the new consumer. The template is validated for structure and safety but is not a runnable workspace while placeholders remain.

## Test metadata and traceability

`@aegis/core` provides application-independent validation and Playwright conversion for structured test metadata. Consumer projects own their requirement registries and test catalogs. A requirement describes expected business behavior; a test ID uniquely identifies an automated check; suite, risk, and layer describe when it runs, the impact of failure, and the technical level under test.

Generate and validate the nopCommerce coverage map from the repository root:

```text
npm run nopcommerce:traceability
```

The local JSON and Markdown reports are written beneath `examples/nopcommerce/test-results/traceability` and are ignored by Git.

## Root quality gates

```text
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run validate
```

Root validation covers formatting, linting, all workspace TypeScript projects, and workspace unit tests. It intentionally excludes application browser tests.

## Continuous integration

The local framework-quality command mirrors the required framework CI job after dependencies have been installed:

```text
npm install
npm run setup
npm run ci:framework
```

CI uses `npm ci` rather than `npm install`, then runs setup with `--skip-browsers` because browser installation belongs to the separate runtime matrix. In that browser-independent job, missing browser executables are reported by doctor as warnings; package alignment and every other required framework check remain strict.

The [framework workflow](.github/workflows/framework-ci.yml) contains four independently visible executions:

- Framework quality validates installation consistency, core boundaries, formatting, lint, strict TypeScript, unit tests, and template integrity.
- Chromium, Firefox, and WebKit matrix entries each install only their selected browser and navigate to a deterministic `data:` URL.
- Each browser entry uploads its bounded JSON doctor result from `artifacts/browser-doctor` for seven days, even when the check fails.

The optional nopCommerce consumer has a separate, static [reference workflow](.github/workflows/reference-consumer-ci.yml). Run the same validation locally with:

```text
npm run ci:reference
```

This typechecks the consumer integration, validates requirement traceability, asks Playwright to list the three registered smoke tests, and then filters the static listing by each catalogued structured test-ID tag. Discovery proves `TC-SEARCH-001`, `TC-SEARCH-002`, and `TC-CART-001` each map to exactly one test without launching a browser or contacting localhost.

Core CI does not require nopCommerce, Docker, PostgreSQL, application `.env` files, or any live URL. Reference-consumer CI also does not run nopCommerce. A live end-to-end workflow would require the consuming application to provision and install its own environment deterministically; that is deliberately a future consumer-owned milestone. This separation lets applications use AegisAI regardless of how—or whether—they use containers and databases.

## nopCommerce reference example

The example owns its application URL, dotenv file, Playwright configuration, search requirement, UI abstractions, tests, reports, and local Docker environment.

Start and inspect its infrastructure from the repository root:

```text
npm run nopcommerce:infra:pull
npm run nopcommerce:infra:up
npm run nopcommerce:infra:status
npm run nopcommerce:infra:wait
npm run nopcommerce:preflight
```

Routine operations:

```text
npm run nopcommerce:infra:logs
npm run nopcommerce:infra:restart
npm run nopcommerce:infra:down
```

`nopcommerce:infra:down` preserves all named volumes. `nopcommerce:infra:reset` is deliberately destructive and must only be used when complete local data deletion is explicitly required.

The first startup displays the installation page. Complete installation manually with sample data before running the existing browser suite:

```text
npm run nopcommerce:test:smoke
npm run nopcommerce:test:cross-browser
npm run nopcommerce:traceability
```

These `nopcommerce:*` commands are optional consumer commands, not AegisAI core prerequisites. `nopcommerce:preflight` uses the generic application contract and checks only profile validity, HTTP reachability, and one Chromium navigation. Docker and PostgreSQL remain covered separately by `nopcommerce:infra:status` and `nopcommerce:infra:verify-db`.

Detailed setup and installer values are documented in the [example guide](examples/nopcommerce/README.md) and [infrastructure guide](examples/nopcommerce/infrastructure/README.md).

## Public demo limitation

The shared public demo returned Cloudflare HTTP 403 human-verification pages to automated browser sessions. AegisAI does not bypass CAPTCHA or Cloudflare protections. The pinned local environment is the deterministic development target.

## Current scope

The repository currently contains deterministic browser foundations and one reference consumer. AI, LLM integration, recording, healing, dashboards, product configuration, and external package publication remain out of scope.
