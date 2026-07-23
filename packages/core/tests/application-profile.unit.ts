import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ApplicationProfileValidationError,
  validateApplicationProfile,
} from "../src/index.ts";
import type { ApplicationProfile } from "../src/index.ts";

function validProfile(
  overrides: Partial<ApplicationProfile> = {},
): ApplicationProfile {
  return {
    id: "sample-app",
    name: "Sample Application",
    environment: "qa",
    baseUrl: "https://qa.example.test",
    healthCheckPath: "/health",
    expectedStatusCodes: [200],
    requestTimeoutMs: 10_000,
    browserCheck: {
      enabled: true,
      browser: "chromium",
      expectedTitleContains: "Sample Application",
    },
    ...overrides,
  };
}

function assertInvalid(profile: unknown, pattern: RegExp): void {
  assert.throws(
    () => validateApplicationProfile(profile),
    (error: unknown) =>
      error instanceof ApplicationProfileValidationError &&
      pattern.test(error.message),
  );
}

await describe("application profile validation", async () => {
  await it("accepts and normalizes a valid profile", () => {
    const result = validateApplicationProfile(
      validProfile({ expectedStatusCodes: [204, 200] }),
    );
    assert.deepEqual(result.expectedStatusCodes, [200, 204]);
  });

  await it("rejects an invalid application ID", () => {
    assertInvalid(validProfile({ id: "Sample App" }), /field "id"/u);
  });

  await it("rejects an invalid environment slug", () => {
    assertInvalid(
      validProfile({ environment: "QA Environment" }),
      /environment/u,
    );
  });

  await it("rejects an invalid base URL", () => {
    assertInvalid(validProfile({ baseUrl: "not-a-url" }), /baseUrl/u);
  });

  await it("rejects an embedded username or password", () => {
    assertInvalid(
      validProfile({ baseUrl: "https://user:password@example.test" }),
      /username or password/u,
    );
  });

  await it("rejects a sensitive URL query parameter", () => {
    assertInvalid(
      validProfile({ baseUrl: "https://example.test?access_token=hidden" }),
      /sensitive query/u,
    );
  });

  await it("rejects an unsafe health-check path", () => {
    assertInvalid(
      validProfile({ healthCheckPath: "/../admin" }),
      /healthCheckPath/u,
    );
  });

  await it("rejects duplicate status codes", () => {
    assertInvalid(validProfile({ expectedStatusCodes: [200, 200] }), /unique/u);
  });

  await it("rejects an invalid HTTP status code", () => {
    assertInvalid(
      validProfile({ expectedStatusCodes: [99] }),
      /100 through 599/u,
    );
  });

  await it("rejects an invalid timeout", () => {
    assertInvalid(validProfile({ requestTimeoutMs: 20 }), /100 and 120000/u);
  });

  await it("rejects invalid browser configuration", () => {
    assertInvalid(
      validProfile({
        browserCheck: {
          enabled: true,
          browser: "edge" as "chromium",
        },
      }),
      /browserCheck.browser/u,
    );
  });

  await it("does not mutate its input", () => {
    const input = validProfile({ expectedStatusCodes: [204, 200] });
    const before = structuredClone(input);
    validateApplicationProfile(input);
    assert.deepEqual(input, before);
  });
});
