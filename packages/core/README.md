# @aegis/core

`@aegis/core` contains application-independent foundations shared by real AegisAI consumer projects. It is private and source-linked inside this monorepo; it is not currently published to npm.

## What belongs here

- Generic configuration contracts
- Validated HTTP/HTTPS URL parsing
- Functions that accept consumer-provided defaults and environment sources
- Bounded, redacted Playwright browser diagnostics used by consumer fixtures
- Validated test metadata plus deterministic Playwright tag and annotation conversion
- Reusable deterministic utilities with at least one real consumer
- Named package exports that do not depend on a specific application

## What does not belong here

- Application URLs or environment names
- Page selectors, page objects, components, flows, fixtures, or business rules
- Product names, catalogue assumptions, or requirement documents
- Application Docker infrastructure
- Speculative abstractions created only for possible future use
- AI or LLM execution inside deterministic test paths

Dependency direction is always from a consumer to `@aegis/core`. Core must never import consumer code.

## Test metadata contract

The core metadata contract gives every automated test a stable test ID, human-readable title, feature, suite, risk, layer, requirement IDs, and tags. Validation happens at runtime as well as compile time. IDs use generic formats such as `TC-FEATURE-001` and `REQ-FEATURE-001`; features and custom tags use normalized lowercase values. The canonical end-to-end suite value is `end-to-end`.

The converter creates Playwright-native tags and annotations, while the consumer remains responsible for choosing application-specific values and maintaining its requirement catalog. Core never parses business identifiers from test-title strings.

A future monetary utility may belong here only when it supports explicit locale and currency configuration and has a real consumer. A consumer-specific currency parser should remain with that consumer until then.
