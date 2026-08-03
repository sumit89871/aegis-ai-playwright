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
- Serializable page-readiness definitions and web-first readiness execution
- Sanitized, bounded accessibility scanning with configurable impact policy
- Provider-neutral AI contracts, offline mock execution, secure OpenRouter transport, prompt boundaries, structured output, usage limits, and safe lifecycle events
- Bounded UI failure evidence, deterministic advisory classification, evidence-cited AI enrichment, and safe JSON/Markdown rendering
- Reusable deterministic utilities with at least one real consumer
- Named package exports that do not depend on a specific application

## What does not belong here

- Application URLs or environment names
- Page selectors, page objects, components, flows, fixtures, or business rules
- Product names, catalogue assumptions, or requirement documents
- Application Docker infrastructure
- Speculative abstractions created only for possible future use
- Application-specific AI prompts, uploaded UI evidence, autonomous tools, generated tests, locator healing, or source modification

## Framework doctor APIs

Core exposes pure doctor evaluation functions that accept injected version, filesystem, package, and browser-installation facts. Thin repository scripts collect those facts and decide the process exit code. This separation keeps doctor logic deterministic and unit-testable without changing the developer's machine.

`npm run doctor` answers “Is AegisAI installed correctly?” It is read-only. `npm run doctor:browsers` is deliberately deeper: it launches Chromium, Firefox, and WebKit against a `data:` URL to prove runtime capability.

## Application profiles and preflight

`ApplicationProfile` describes only generic target information: a normalized ID and environment, display name, safe base URL and health path, allowed HTTP statuses, bounded timeout, and optional browser/title check. Runtime validation rejects embedded credentials, sensitive query parameters, unsafe paths, invalid status codes, unsupported browsers, and non-serializable data without mutating the input.

`runApplicationPreflight()` validates the profile, performs a body-free HTTP reachability check, and optionally opens the application with one selected Playwright browser. It returns sanitized serializable results; rendering and process exit behavior remain separate. Consumer infrastructure, credentials, selectors, database details, and business data never belong in this model.

Dependency direction is always from a consumer to `@aegis/core`. Core must never import consumer code.

## Provider-neutral AI foundation

The `ai` public module is an opt-in communication boundary, not part of deterministic browser execution. `AiProvider` keeps vendor responses behind plain AegisAI request/result models. `createAiClient` validates configuration, enforces capability/network/mock-only policy and request limits, renders versioned prompts, resolves only one named secret at execution time, retries bounded transient failures, validates structured output, and emits prompt-free lifecycle records.

`MockAiProvider` is deterministic and offline for tests and CI. `OpenRouterAiProvider` is the first real adapter and uses built-in `fetch`; core has no provider SDK dependency. AI defaults to disabled, network access defaults to denied, and normal framework commands need no key. External content must be wrapped as untrusted evidence. This boundary reduces prompt-injection risk but cannot make model output trustworthy.

Core does not contain application selectors, business decisions, provider pricing, tools, code execution, test generation, self-healing, or source mutation. The generic failure-analysis prompt accepts only consumer-supplied sanitized evidence and never owns application values. Full behavior and security rules are documented in [AI foundation](../../docs/ai-foundation.md) and [Advisory UI failure analysis](../../docs/ai-failure-analysis.md).

## Advisory failure analysis

`normalizeFailureEvidence` turns safe test metadata, errors, browser diagnostics, readiness details, accessibility summaries, and attachment names into bounded records with stable evidence IDs. `analyseFailureDeterministically` recognizes explicit failure signals without AI. `analyseUiFailure` may ask a configured `AiClient` for additional advice, but it always retains deterministic facts and rejects unsafe, uncited, or malformed output. `renderFailureAnalysisMarkdown` renders the validated report without raw HTML or executable blocks.

Defaults are deterministic-only. No API key is resolved and no network call is attempted. Consumers decide whether and how to attach reports; the API cannot update test status, apply a locator, execute a command, or write source code.

## Generic UI quality APIs

`definePageReadiness` validates a consumer-owned readiness contract, and `waitForPageReady` evaluates it with Playwright web-first expectations. Definitions can describe URL, title, landmark, heading, test-ID, and loading-indicator evidence without storing Page objects in results.

`runAccessibilityScan` uses the maintained `@axe-core/playwright` adapter. Core retains bounded rule metadata, sanitized selectors, and failure summaries, never full HTML or form values. `assertAccessibilityPolicy` applies the configurable default: critical and serious fail, moderate warns, and minor is informational. A rule exclusion is invalid without an explicit reason and scope.

Application selectors, titles, readiness landmarks, WCAG scope, and justified exclusions stay in the consumer. Static repository locator scanning is tooling because it depends on the TypeScript compiler API; its rules are documented in the [UI quality policy](../../docs/ui-quality.md).

## Test metadata contract

The core metadata contract gives every automated test a stable test ID, human-readable title, feature, suite, risk, layer, requirement IDs, and tags. Validation happens at runtime as well as compile time. IDs use generic formats such as `TC-FEATURE-001` and `REQ-FEATURE-001`; features and custom tags use normalized lowercase values. The canonical end-to-end suite value is `end-to-end`.

The converter creates Playwright-native tags and annotations, while the consumer remains responsible for choosing application-specific values and maintaining its requirement catalog. Core never parses business identifiers from test-title strings.

A future monetary utility may belong here only when it supports explicit locale and currency configuration and has a real consumer. A consumer-specific currency parser should remain with that consumer until then.

## Advisory locator diagnosis

The `locator-diagnosis` exports provide controlled Playwright error classification, conservative target-intent inference, bounded read-only candidate collection, uniqueness measurement, deterministic scoring, strict report validation, optional mock/provider ranking of known IDs, and safe JSON/Markdown rendering. Defaults are deterministic-only with AI disabled. These APIs do not retry actions, write source, or implement self-healing.

The `locator-evaluation` exports validate 40 reviewed generic calibration/validation cases, remove expected answers before analysis, compute classification/recommendation/ranking/confidence/safety metrics, enforce strict thresholds, and render deterministic reports. They default to offline deterministic execution. Browser-backed evaluation remains a script-level runtime check so core unit tests require no browser.

The `locator-observations` exports import the existing sanitized locator report into an anonymous content-addressed record. Legacy review records remain pilot/calibration evidence because they expose Aegis's verdict and ranked candidate IDs. The blind-review APIs instead create a strict reviewer packet, a separate private alias mapping, and a blank review. Neutral aliases are deterministically reordered, then translated back to original IDs only after packet, mapping, observation, and review integrity checks pass.

Core performs no consumer-specific filesystem discovery and knows no application host. Thin repository scripts collect relative-path artifacts, prepare and validate blind reviews, and write ignored reports. Both review paths remain backward compatible. The default is deterministic-only, requires no key or network, cannot repair a review, and cannot execute or apply a locator.
