# Repository instructions

These rules apply to all future Codex changes in this repository.

- Tests express business intent and preserve requirement traceability.
- Reuse existing pages, components, and flows before creating new ones.
- Inspect the existing architecture before adding files.
- Do not use arbitrary waits or `page.waitForTimeout()`.
- Do not use XPath unless explicitly approved.
- Do not hard-code environment URLs, credentials, or secrets.
- Keep AI code outside deterministic Playwright test execution.
- Generated code must pass lint, typecheck, and all relevant tests.
- Do not automatically change assertions merely to make a failing test pass.
- Do not silently weaken assertions.
- Keep public-site tests isolated, independent, and non-destructive.
- Use the local nopCommerce environment for deterministic development tests.
- Never attempt to bypass Cloudflare, CAPTCHA, or other human-verification protections.
- Never run `npm run nopcommerce:infra:reset` unless the task explicitly requires complete local data deletion.
- Do not commit local database passwords, administrator passwords, or other secrets.
- Pin every infrastructure container image to an explicit version.
- Confirm that services are ready before running browser tests.
- Keep application selectors, URLs, product names, and business rules out of `packages/core`.
- Keep application-specific fixtures, pages, components, flows, requirements, and tests inside consumer workspaces.
- Reusable abstractions must have at least one real consumer.
- Do not create generic classes solely to anticipate possible future use.
- Expose new reusable framework features through explicit package interfaces and named exports.
- Never make `packages/core` depend on an example or consumer project.
- Examples may depend on `@aegis/core`; dependency direction must never be reversed.
- Never delete Docker data without an explicit task requiring complete local data deletion.

## Required validation

Run these commands after relevant changes:

```text
npm run format
npm run lint
npm run typecheck
npm run test:unit
npm run validate
```

After nopCommerce is installed with sample data and `npm run nopcommerce:infra:wait` passes, run `npm run nopcommerce:test:smoke`. Run `npm run nopcommerce:test:cross-browser` when browser-facing behaviour, locators, fixtures, flows, pages, or Playwright configuration changes.
