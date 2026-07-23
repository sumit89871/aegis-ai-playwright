# AegisAI application consumer template

Copy this directory into a new consumer workspace, replace every placeholder, and remove the `.template` suffix from template files.

Required placeholders:

- `__APP_ID__`: lowercase application slug
- `__APP_NAME__`: human-readable application name
- `__BASE_URL__`: absolute HTTP or HTTPS target URL
- `__EXPECTED_TITLE__`: stable title text visible after navigation

The template demonstrates an application profile, preflight command, Playwright configuration, component/page/flow separation, fixture injection, requirement traceability, structured metadata, and one smoke-test skeleton. Add application selectors and business behavior only inside the consumer workspace.

The generic `@aegis/core` package does not install or manage the target application. If the consumer needs containers, databases, or other infrastructure, keep those commands in that consumer project.

The template does not enable AI. A future consumer may opt into the generic `@aegis/core` AI interfaces, but application prompts and redacted evidence must remain consumer-owned. Normal page objects, flows, and tests must continue to work without a provider, model, network connection, or API key.

```text
application/
├── scripts/run-preflight.ts
├── src/
│   ├── config/application-profile.ts
│   ├── components/navigation.component.ts
│   ├── pages/application.page.ts
│   ├── flows/open-application.flow.ts
│   └── fixtures/test-fixtures.ts
├── requirements/REQ-EXAMPLE-001.md
├── tests/
│   ├── metadata/example.metadata.ts
│   └── smoke/example.spec.ts
├── package.json
├── playwright.config.ts
└── tsconfig.json
```
