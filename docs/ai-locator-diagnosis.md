# Advisory UI locator diagnosis

Locator diagnosis is a shadow-mode aid for an already failed Playwright test. It classifies locator and actionability errors, gathers a small read-only inventory of relevant interactive elements, and ranks structured candidate IDs. It never edits a Page Object, retries an action or test, weakens an assertion, or changes the Playwright result.

## Deterministic first

Fixed rules run before AI. Semantic role/name and label candidates rank highest, followed by unique test IDs and other user-facing attributes. Unique, visible, enabled candidates gain points; duplicates, hidden or disabled elements, weak name approximations, and long text lose points. Generated classes, XPath, and positional `nth()`, `first()`, or `last()` repairs are not candidates. A top score means “review first,” not “known correct.”

Not every failure needs another locator. Hidden, disabled, detached, unstable, obstructed, unready, or closed-page failures produce a no-change recommendation because application state or synchronization is the stronger explanation. Accessibility and ordinary business assertions are not applicable and do not trigger page collection or AI.

## Safe candidate inventory

Collection is read-only and bounded to potentially useful buttons, links, form controls, roles, labels, placeholders, configured test IDs, image alt text, headings, stable IDs, and conservative stable CSS classes. It retains at most 50 candidates by default and records dropped counts. It does not scroll, click, focus, or mutate the page.

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
