# AegisAI Playwright Quality Platform

AegisAI is a reusable, deterministic Playwright and TypeScript framework platform. This repository is an npm-workspaces monorepo that separates application-independent capabilities from consumer-specific automation.

Milestone 1B establishes internal plug-and-play architecture. The packages are private and are not yet published or independently installable from an npm registry.

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

## Install all workspaces

From the repository root:

```text
npm install
npm run setup
```

`npm install` links the local `@aegis/core` workspace into the example through npm workspace resolution.

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

## nopCommerce reference example

The example owns its application URL, dotenv file, Playwright configuration, search requirement, UI abstractions, tests, reports, and local Docker environment.

Start and inspect its infrastructure from the repository root:

```text
npm run nopcommerce:infra:pull
npm run nopcommerce:infra:up
npm run nopcommerce:infra:status
npm run nopcommerce:infra:wait
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
```

Detailed setup and installer values are documented in the [example guide](examples/nopcommerce/README.md) and [infrastructure guide](examples/nopcommerce/infrastructure/README.md).

## Public demo limitation

The shared public demo returned Cloudflare HTTP 403 human-verification pages to automated browser sessions. AegisAI does not bypass CAPTCHA or Cloudflare protections. The pinned local environment is the deterministic development target.

## Current scope

The repository currently contains deterministic browser foundations and one reference consumer. AI, LLM integration, recording, healing, dashboards, product configuration, and external package publication remain out of scope.
