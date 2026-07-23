# AI foundation

## Purpose and boundary

The AI foundation is a controlled, provider-neutral communication layer for future quality-engineering capabilities. It validates configuration and prompts, enforces network and usage policy, resolves one named secret only at execution time, invokes a registered provider, validates structured output, and returns plain serializable results.

The communication layer now supports an advisory failure-analysis consumer, but it still does **not** heal locators, replace selectors, generate tests, plan tests, analyse screenshots, upload DOM content, execute tools, or modify source code. Deterministic Playwright execution never calls a real AI provider unless a consumer explicitly opts in.

```mermaid
flowchart LR
    FEATURE[Future opt-in capability] --> CLIENT[AI client policy boundary]
    CLIENT --> TEMPLATE[Versioned prompt template]
    CLIENT --> LIMITS[Input, token, retry, timeout, and cost limits]
    CLIENT --> MOCK[Deterministic mock provider]
    CLIENT --> OPENROUTER[OpenRouter adapter]
    OPENROUTER -. explicit network opt-in .-> API[OpenRouter HTTPS API]
    CLIENT --> OUTPUT[Validated serializable output]
    CLIENT --> EVENTS[Safe lifecycle events]
```

The mock provider is used by unit tests, local demonstrations, and CI. OpenRouter is the first real adapter, not a dependency of the provider-neutral contract.

## Offline by default

- AI is disabled by default.
- Network calls are disabled by default.
- Mock-only mode is enabled by default.
- Disabled execution does not resolve an API key or contact a provider.
- Normal setup, doctor, UI policy, Playwright, accessibility, traceability, and validation commands require no AI key or model.
- CI runs only deterministic unit tests, the offline mock smoke command, and the offline mock failure-analysis demo.
- Failure analysis defaults to deterministic-only rules; its demo uses `MockAiProvider` and makes zero network calls.

Run the offline demonstration with:

```text
npm run ai:smoke
npm run ai:smoke -- --json
```

The output shows validated structured data and safe lifecycle records. It always reports zero network calls and needs no API key.

## Configuration and secrets

`AiConfiguration` stores an environment-variable **name**, never the API-key value. A real provider receives the secret only when a permitted request executes. The resolver reads only the configured variable and never enumerates the environment.

For optional local OpenRouter experimentation, use `.env.ai.example` as the naming guide, place real values only in an ignored local environment file or your shell, choose a currently available model, and map those values into an explicit `AiConfiguration`. Core deliberately does not auto-load this file. Normal framework operation does not require this step. Model availability and pricing can change; verify both with the provider before enabling a paid request.

Real-provider execution requires all of these independent choices:

1. `enabled: true`
2. A registered real provider
3. `allowNetworkCalls: true`
4. `mockOnly: false`
5. The capability enabled, when a capability is requested
6. A named environment variable containing the key

Endpoints require HTTPS. Plain HTTP is accepted only for explicitly enabled localhost test or mock endpoints. Credentials and sensitive query parameters are rejected.

## Prompt and output security

Prompts are versioned templates with declared variables and rendered-length limits. Values derived from browsers, applications, logs, or other external sources must use the untrusted-content wrapper. The wrapper redacts common secrets and places evidence inside deterministic labelled boundaries so it remains data rather than trusted instructions.

This reduces prompt-injection risk; it does not guarantee prevention. Model output is always untrusted. Structured responses must parse as a JSON object and may be checked by a caller-supplied validator. The framework never uses `eval`, executes generated code, dynamically imports model-selected paths, or gives a model tool access.

Lifecycle events contain provider/model identifiers, prompt template ID and version, input size, bounded limits, retry number, duration, usage, approximate cost, and safe error codes. They exclude prompts, raw evidence, response bodies, authorization headers, cookies, keys, and environment dumps.

## Usage and cost policy

Configuration bounds request duration, retries, input characters, requested output tokens, and optional estimated cost. Requests above a limit are blocked before provider execution. Pricing is supplied externally as input/output cost per million tokens; no provider price is hard-coded as permanent truth.

When an exact tokenizer is unavailable, the estimate conservatively uses one token per three characters and marks the result approximate. Estimated cost is a policy guard, not a billing statement.

## OpenRouter adapter

The adapter uses the built-in HTTP client surface through `fetch`, bearer authentication, JSON requests, and `AbortController`. It retries only through the generic client and only for transient conditions such as HTTP 429 or 5xx responses. Authentication and malformed requests are not retried. `Retry-After` is bounded, response size is bounded, and HTTP error bodies are not retained or emitted.

No real OpenRouter request is made by repository tests or CI. A future explicitly authorized local integration test must verify a currently available model, actual provider response semantics, and current pricing without committing a key or output log.

## Advisory failure-analysis consumer

The generic analyzer normalizes bounded diagnostic, readiness, accessibility, and metadata records into deterministic evidence IDs. Its rule-based conclusion is always retained. Optional model output must cite those IDs and pass controlled schema and safety validation; conflicts lower confidence and leave deterministic facts primary. Reports contain safe provenance, never full prompts or model responses.

Run the offline demonstration with `npm run ai:analyse:demo` or its JSON form with `npm run ai:analyse:demo -- --json`. See [Advisory UI failure analysis](ai-failure-analysis.md) for the evidence contract and Playwright attachment lifecycle.
