import { defineApplicationProfile } from "@aegis/core";

import { environment } from "./environment.ts";

export const applicationProfile = defineApplicationProfile({
  id: "nopcommerce",
  name: "nopCommerce reference application",
  environment: environment.testEnvironment,
  baseUrl: environment.baseUrl,
  healthCheckPath: "/",
  expectedStatusCodes: [200],
  requestTimeoutMs: 10_000,
  browserCheck: {
    enabled: true,
    browser: "chromium",
    expectedTitleContains: "Your store",
  },
});
