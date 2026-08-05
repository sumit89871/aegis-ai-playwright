# Advisory UI locator diagnosis

Locator diagnosis is a shadow-mode aid for an already failed Playwright test. It classifies locator and actionability errors, gathers a small read-only inventory of relevant interactive elements, and ranks structured candidate IDs. It never edits a Page Object, retries an action or test, weakens an assertion, or changes the Playwright result.

## Deterministic first

Fixed rules run before AI. Semantic role/name and label candidates rank highest, followed by unique test IDs and other user-facing attributes. Unique, visible, enabled candidates gain points; duplicates, hidden or disabled elements, weak name approximations, and long text lose points. Generated classes, XPath, and positional `nth()`, `first()`, or `last()` repairs are not candidates. A top score means “review first,” not “known correct.”

Not every failure needs another locator. Hidden, disabled, detached, unstable, obstructed, unready, or closed-page failures produce a no-change recommendation because application state or synchronization is the stronger explanation. Accessibility and ordinary business assertions are not applicable and do not trigger page collection or AI.

## Safe candidate inventory

Collection is read-only and bounded to potentially useful buttons, links, form controls, roles, labels, placeholders, configured test IDs, image alt text, headings, stable IDs, and conservative stable CSS classes. The shared supported maximum is 50 retained candidates, and additional candidates are counted as dropped. Collection, observation, review, and evaluation validation all use this same bound. It does not scroll, click, focus, or mutate the page.

The collector never reads form values, password values, cookies, headers, storage, request or response bodies, scripts, styles, `innerHTML`, `outerHTML`, the full DOM, or the full accessibility tree. Candidate-level accessible names use a bounded approximation from `aria-label`, associated labels, alt/title text, safe visible text, role, and placeholder. This approximation is deliberately not presented as the browser’s complete accessible-name computation.

## AI restriction and privacy

AI ranking is off by default. When explicitly enabled, the model can rank or explain only candidate IDs already created by deterministic code. Validation rejects invented IDs, XPath, positional repairs, `force: true`, patches, commands, executable code, raw HTML, secret-like output, and absolute local paths. Browser/application evidence is enclosed in the existing untrusted-data boundary. Deterministic match counts, readiness, visibility, and enabled state remain authoritative; disagreements lower confidence and are recorded.

No full prompt, raw response, screenshot, video, trace, DOM, HTML, or form value is submitted. Default nopCommerce execution uses deterministic analysis, requires no key, and makes no network call.

## Reports and commands

Applicable failures attach `locator-diagnosis.json` and `locator-diagnosis.md` alongside the original diagnostics and general failure analysis. The original failure remains primary. Passing and non-locator tests receive no locator report.

Run the offline synthetic demonstration from the repository root:

```powershell
npm run ai:locator:demo
npm run ai:locator:demo -- --json
```

The demo uses the mock provider and synthetic candidates only. Review nopCommerce reports with `npm run nopcommerce:report` after a local run.

## Current limitations

Candidate collection sees only the current page state at teardown and may be unavailable after a crash or explicit page close. The accessible-name calculation is an approximation. Shadow-mode suggestions still require a person to confirm business intent and update the owning Page Object manually.

## Repeatable evaluation

The [locator-diagnosis evaluation harness](locator-diagnosis-evaluation.md) measures classification, no-change decisions, candidate ranks, confidence, and unsafe output against separate reviewed calibration and validation packs. Expected answers are never passed to the analyser. The default evaluation is deterministic and offline:

```powershell
npm run ai:locator:evaluate
npm run ai:locator:evaluate -- --dataset=validation
```

Passing this controlled benchmark supports continued shadow-mode review; it does not establish production accuracy or authorize automatic healing.

## Shadow observations

Applicable `locator-diagnosis.json` attachments can be imported into a bounded, host-free observation. Screenshots, traces, HTML, form values, URLs, and secrets are not copied. Because the observation still contains the diagnosis and score-ranked IDs, its legacy review is pilot/calibration evidence. Independent holdout review uses a separate redacted packet with neutral aliases; expected answers never enter diagnosis input. See [Locator shadow observations](locator-shadow-observations.md).

## Deterministic versus advisory reranking

Fixed TypeScript scoring remains the default baseline. It is predictable and auditable, but lexical scoring can miss semantic equivalence such as “Saved items” and “Wishlist”. The optional advisory comparison asks an LLM only whether a bounded supplied inventory contains a useful replacement and how those supplied aliases should be ordered. Classification remains deterministic, and AI cannot generate selectors or Playwright code.

The provider input is built from the blind reviewer packet without loading its review or private mapping. Original `LOCATOR-*` IDs, deterministic ordering/scores/stability/rationale, and human expected classification, recommendation, acceptable/preferred/forbidden sets, confidence floor, and rationale are excluded. A concise versioned prompt requires semantic and operation compatibility, uniqueness, visibility, enablement, editability for fill operations, and abstention when evidence is weak. Output schema `1.0.0` accepts only supported recommendation statuses, supplied neutral IDs, supported confidence, and a bounded sanitized summary; invented/duplicate IDs, unknown fields, prohibited repairs, patches, commands, and unsafe text are rejected.

Run the offline comparison with `npm run ai:locator:holdout:compare -- --mode=mock-ai`. Live OpenRouter execution requires `--mode=ai-advisory --confirm-network` and the existing secure configuration. Failed or invalid cases reduce advisory coverage instead of receiving a disguised deterministic fallback. Side-by-side aggregates do not reveal cases, IDs, prompts, raw responses, or human answers. They remain advisory evidence only and never apply a locator.

The `locator-advisory-reranking` prompt is version `1.1.0`; its output schema remains version `1.0.0`. It explicitly names all five fields, allowed recommendation and confidence values, candidate-array status rules, and the 500-character summary bound. OpenRouter also receives a strict per-request JSON Schema whose candidate enum contains only that request's neutral aliases. Provider enforcement is not trusted alone: the TypeScript validator still rejects unknown or duplicate aliases, extra fields, invalid status relationships, and unsafe summary content.

The advisory generation allowance is bounded at 2,000 tokens so reasoning-capable models have room for hidden reasoning and the final structured object. It is not a visible-response allowance: the five-field schema and 500-character summary limit are unchanged. The provider timeout is bounded at 30 seconds, matching the global default, while `Math.min` permits a caller to choose less. The verifier still retries zero times and comparison still permits at most one retry. Timeouts and truncation fail closed without parsing partial output. Live comparisons should use a currently reliable model, but Aegis has no model-specific limit, does not claim the bounds guarantee success, and does not turn a successful response into locator execution or healing.

Use this live order only after offline validation:

```text
npm run ai:locator:reranking:verify -- --confirm-network
npm run ai:locator:holdout:compare -- --mode=ai-advisory --confirm-network
npm run ai:locator:holdout:compare -- --mode=ai-advisory --confirm-network --summary-json
```

The first command makes exactly one request with compiled synthetic evidence and no observation, packet, mapping, or human review. It prints no aliases, prompt, summary, or raw response. A pass confirms contract compatibility only. The five-case comparison remains an insufficient sample, and neither command authorizes locator application or healing.
