# @aegis/core

`@aegis/core` contains application-independent foundations shared by real AegisAI consumer projects. It is private and source-linked inside this monorepo; it is not currently published to npm.

## What belongs here

- Generic configuration contracts
- Validated HTTP/HTTPS URL parsing
- Functions that accept consumer-provided defaults and environment sources
- Bounded, redacted Playwright browser diagnostics used by consumer fixtures
- Validated test metadata plus deterministic Playwright tag and annotation conversion
- Pure framework-doctor evaluation, deterministic summaries, and rendering
- Generic, serializable application profiles with runtime validation
- Bounded HTTP and optional single-browser application preflight checks
- Reusable deterministic utilities with at least one real consumer
- Named package exports that do not depend on a specific application

## What does not belong here

- Application URLs or environment names
- Page selectors, page objects, components, flows, fixtures, or business rules
- Product names, catalogue assumptions, or requirement documents
- Application Docker infrastructure
- Speculative abstractions created only for possible future use
- AI or LLM execution inside deterministic test paths

## Framework doctor APIs

Core exposes pure doctor evaluation functions that accept injected version, filesystem, package, and browser-installation facts. Thin repository scripts collect those facts and decide the process exit code. This separation keeps doctor logic deterministic and unit-testable without changing the developer's machine.

`npm run doctor` answers “Is AegisAI installed correctly?” It is read-only. `npm run doctor:browsers` is deliberately deeper: it launches Chromium, Firefox, and WebKit against a `data:` URL to prove runtime capability.

## Application profiles and preflight

`ApplicationProfile` describes only generic target information: a normalized ID and environment, display name, safe base URL and health path, allowed HTTP statuses, bounded timeout, and optional browser/title check. Runtime validation rejects embedded credentials, sensitive query parameters, unsafe paths, invalid status codes, unsupported browsers, and non-serializable data without mutating the input.

`runApplicationPreflight()` validates the profile, performs a body-free HTTP reachability check, and optionally opens the application with one selected Playwright browser. It returns sanitized serializable results; rendering and process exit behavior remain separate. Consumer infrastructure, credentials, selectors, database details, and business data never belong in this model.

Dependency direction is always from a consumer to `@aegis/core`. Core must never import consumer code.

## Test metadata contract

The core metadata contract gives every automated test a stable test ID, human-readable title, feature, suite, risk, layer, requirement IDs, and tags. Validation happens at runtime as well as compile time. IDs use generic formats such as `TC-FEATURE-001` and `REQ-FEATURE-001`; features and custom tags use normalized lowercase values. The canonical end-to-end suite value is `end-to-end`.

The converter creates Playwright-native tags and annotations, while the consumer remains responsible for choosing application-specific values and maintaining its requirement catalog. Core never parses business identifiers from test-title strings.

A future monetary utility may belong here only when it supports explicit locale and currency configuration and has a real consumer. A consumer-specific currency parser should remain with that consumer until then.
