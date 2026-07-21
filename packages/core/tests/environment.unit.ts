import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEnvironmentConfig, parseHttpUrl } from "../src/index.ts";

await describe("generic environment configuration", async () => {
  await it("normalizes a valid HTTP URL", () => {
    assert.equal(
      parseHttpUrl("https://service.example.test/", "SERVICE_URL"),
      "https://service.example.test",
    );
  });

  await it("rejects a non-HTTP protocol descriptively", () => {
    assert.throws(
      () => parseHttpUrl("ftp://service.example.test", "SERVICE_URL"),
      /Invalid SERVICE_URL configuration: protocol "ftp:" is not supported/,
    );
  });

  await it("uses consumer defaults when variables are absent", () => {
    const config = createEnvironmentConfig(
      {
        baseUrl: "http://application.example.test",
        testEnvironment: "development",
      },
      {},
    );

    assert.deepEqual(config, {
      baseUrl: "http://application.example.test",
      testEnvironment: "development",
      isCi: false,
    });
  });

  await it("applies supplied variables and CI state", () => {
    const config = createEnvironmentConfig(
      {
        baseUrl: "http://application.example.test",
        testEnvironment: "development",
      },
      {
        BASE_URL: "https://override.example.test/",
        TEST_ENV: "integration",
        CI: "true",
      },
    );

    assert.deepEqual(config, {
      baseUrl: "https://override.example.test",
      testEnvironment: "integration",
      isCi: true,
    });
  });
});
