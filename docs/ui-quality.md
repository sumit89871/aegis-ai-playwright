# UI quality policy

This policy governs deterministic browser automation built on AegisAI. It applies to reusable UI capabilities and consumer projects such as the nopCommerce reference example.

## Locator priority

Use the locator that best describes what a user or assistive technology understands:

1. `getByRole()` with an accessible name
2. `getByLabel()`
3. `getByPlaceholder()`
4. `getByText()` when the text is stable, meaningful, and appropriately scoped
5. `getByTestId()`
6. A short scoped CSS selector when no practical semantic locator exists
7. XPath only as an explicitly documented last resort

Accessible locators are preferred because they describe interface meaning and exercise the same names and roles exposed to users. Generated class names often change when CSS is rebuilt, even when behavior does not. Long CSS chains and XPath expressions couple tests to document structure and are expensive to maintain.

`nth()`, `first()`, and `last()` are review signals rather than automatic defects. They are risky when they silently depend on unrelated DOM order. `first()` can be justified when the requirement intentionally targets the first result and the collection is already scoped and ordered by a documented rule.

Fixed sleeps, including `waitForTimeout()`, are prohibited because elapsed time does not prove readiness. Use Playwright actionability, web-first assertions, or an explicit page-readiness definition. `force: true` bypasses Playwright safeguards and needs narrow, documented justification.

Page and component objects own selectors. Flows combine those objects into business activities. Test specifications express behavior and assertions rather than repeating clicks or embedding raw CSS.

## Static policy scanner

Run the scanner from the repository root:

```text
npm run ui:policy
npm run ui:policy -- --json
```

High-severity unsuppressed findings fail the command. Medium findings require review but do not fail the initial policy gate; informational findings make potentially maintainable patterns visible. The scanner uses the TypeScript syntax tree, reports normalized paths and source positions, excludes dependencies and generated output, and emits deterministic JSON without timestamps or environment values.

A legitimate exception can suppress one rule for only the next relevant line:

```ts
// aegis-ui-policy-disable-next-line review-locator -- stable scoped application shell
const shell = page.locator(".application-shell");
```

The rule ID must exist and the reason must be non-empty. File-wide suppression is not supported. Invalid suppressions are high-severity findings, and all valid suppressions appear in the summary.

## Page readiness

A page is ready when meaningful UI evidence is present, not merely when network traffic becomes idle. `@aegis/core` validates serializable readiness definitions and can wait for URL, title, landmark, heading, test-ID, and loading-indicator conditions using Playwright web-first assertions. Consumer Page Objects own their application-specific definitions.

The result contains bounded, serializable timing and check information. A failure retains the original Playwright assertion as its error cause while exposing sanitized readiness details. No cookies, headers, page objects, or HTML bodies are stored.

## Automated accessibility

`@aegis/core` uses `@axe-core/playwright` to evaluate explicitly selected pages. The default impact policy is:

| Impact   | Action        |
| -------- | ------------- |
| critical | Fail          |
| serious  | Fail          |
| moderate | Warn/report   |
| minor    | Inform/report |

Results retain bounded rule IDs, impacts, help, sanitized target selectors, failure summaries, and affected-node counts. Full HTML, input values, response bodies, cookies, and headers are never retained. Evidence limits prevent long pages from creating unbounded attachments.

Rule exclusions require a rule ID, reason, and scope; an issue reference may also be supplied. Anonymous exclusions are invalid. Exclusions belong to the consumer that owns the page, never to generic core policy merely to obtain a green result.

Automated scans find common machine-detectable problems but do not prove accessibility compliance. Keyboard navigation, screen-reader output, focus order, content meaning, zoom/reflow, and cognitive usability still require manual and broader testing.
