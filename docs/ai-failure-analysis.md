# Advisory UI failure analysis

AegisAI can turn sanitized Playwright failure evidence into a bounded diagnostic recommendation. The feature is advisory: it cannot edit a test, replace a locator, retry execution, run a command, apply a patch, or change Playwright's result. The original failure remains authoritative.

## Evidence boundary

The normalizer accepts plain data already produced by the framework: structured test metadata, the bounded Playwright error, page-readiness details when available, sanitized console and page errors, failed requests, HTTP error responses, sanitized accessibility rule summaries, UI-policy context, and a list of safe attachment names.

It never retains or submits Page, Locator, Request, Response, or BrowserContext objects; full DOM or HTML; screenshots, videos, or trace bytes; cookies or headers; request or response bodies; input values; environment dumps; credentials; or absolute user paths. URLs use the existing query-secret redaction. Equivalent network failures are deduplicated, arrays and text are bounded, and dropped-entry counts remain visible.

Each retained record receives a deterministic citation such as `ASSERTION-001`, `REQUEST-001`, `HTTP-001`, `READINESS-001`, or `A11Y-001`. An AI conclusion is invalid if it cites an ID that was not supplied.

## Deterministic foundation

Rule-based classification runs without an AI key or network service. It conservatively recognizes explicit accessibility policy failures, page-readiness failures, HTTP server errors, failed requests, uncaught page errors, Playwright locator-resolution errors, and plain assertion failures. When evidence is insufficient, it says so.

The deterministic conclusion is always retained. AI advisory output may enrich cited causes and actions. If it conflicts with the deterministic category, the deterministic facts remain primary, confidence is reduced, and the disagreement is recorded.

## Optional AI advisory

The versioned `ui-failure-analysis` prompt treats structured evidence as untrusted data. Trusted instructions require JSON-only output, supplied evidence citations, conservative confidence, and no security bypasses, weakened assertions, patches, locator replacement, code, or shell commands. Prompt boundaries reduce prompt-injection risk but do not make model output trustworthy.

Model output must pass the result schema, controlled-value checks, secret/path/HTML/command checks, text limits, and evidence-reference validation. Invalid output, timeout, missing credentials, disabled network access, provider failure, or cost blocking returns the deterministic analysis with safe provenance. Raw prompts and model responses are not stored in the report.

Default behavior is:

- deterministic analysis enabled;
- JSON and Markdown attachments enabled for unexpected test failures;
- AI advisory disabled;
- no provider call and no key resolution;
- no analysis for passing tests.

The nopCommerce fixture uses these defaults. On failure it first attaches existing browser diagnostics, then `failure-analysis.json` and `failure-analysis.md`. Accessibility scans also make their sanitized result available to the deterministic analyzer. The original assertion and failure artifacts remain unchanged.

## Commands

The offline demonstration uses only `MockAiProvider` and synthetic evidence:

```text
npm run ai:analyse:demo
npm run ai:analyse:demo -- --json
```

The optional `npm run ai:openrouter:verify -- --confirm-network` command is deliberately guarded and is never part of validation or CI. It requires explicit local network flags, a local ignored key, a model, and locally supplied pricing. Do not run it unless a real provider call has been authorized.

Normal validation remains offline:

```text
npm run validate
npm run ci:framework
```

Future work may connect sanitized real evidence to OpenRouter after an explicit privacy, model, pricing, and network review. This milestone does not implement self-healing, source modification, test generation, screenshot analysis, or automated remediation.
