# Test strategy

## Test pyramid

1. **Unit tests** provide the broadest, fastest feedback for pure configuration and utility logic.
2. **Focused browser tests** validate critical page/component integration and business flows.
3. **End-to-end journeys** remain a deliberately small layer for the highest-value customer behaviour.

The core workspace unit-tests generic configuration behavior. The reference consumer unit-tests its USD parser and owns the minimal search smoke journey.

## Smoke and regression scope

Smoke tests answer whether a critical storefront capability is usable after a change or deployment. They run first on Chromium and can run across all desktop engines. Future regression coverage will add deeper product configuration, pricing, and negative paths without inflating the smoke gate.

## Isolation

Playwright creates a new browser context for every test. Tests do not depend on execution order, previously created records, a permanent customer account, or data written by another test. Public-site scenarios remain read-only and non-destructive.

## Locator policy

Locators prefer role, label, placeholder, test ID, and visible text in that order. A short stable CSS selector is permitted only to scope a component or repeated domain entity when semantic markup cannot identify that group. XPath, generated IDs, DOM-position selectors, and arbitrary waiting are prohibited.

Locators are validated against the current live DOM, scoped to their owning page or component, and expected to be unique wherever a single element is acted upon.

## Evidence policy

The terminal list reporter gives immediate execution feedback. Every run also writes a machine-readable JSON report and an HTML report. Screenshots and videos are retained only on failure; traces are captured on the first retry in CI. This balances diagnostic value with artifact cost.

## Public-environment limitations

The shared public demo may reset, change data, or present Cloudflare human verification. The pinned local consumer infrastructure is the deterministic target. CAPTCHA and Cloudflare protections are not bypassed, and failures are diagnosed rather than hidden or weakened.

## Requirement traceability

Requirement documents live with their consumer project, such as `examples/nopcommerce/requirements/`. Test titles include the requirement ID, and Playwright metadata records `REQ-SEARCH-001` as a requirement annotation. Tags such as `@smoke` and `@search` support suite selection without losing the human-readable business link.
