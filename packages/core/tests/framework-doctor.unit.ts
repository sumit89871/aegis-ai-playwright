import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  doctorExitCode,
  evaluateFrameworkDoctor,
  satisfiesVersionRange,
} from "../src/index.ts";
import type { FrameworkDoctorInput } from "../src/index.ts";

function validInput(
  overrides: Partial<FrameworkDoctorInput> = {},
): FrameworkDoctorInput {
  return {
    nodeVersion: "v22.22.2",
    nodeEngineRange: ">=22.22.0 <27",
    npmVersion: "10.9.7",
    packageLockExists: true,
    workspaceDirectoriesPresent: true,
    workspaceDependenciesInstalled: true,
    coreResolvable: true,
    coreImportable: true,
    typescriptConfigExists: true,
    playwrightTestVersion: "1.61.1",
    playwrightVersion: "1.61.1",
    playwrightCoreVersion: "1.61.1",
    browserExecutables: {
      chromium: true,
      firefox: true,
      webkit: true,
    },
    essentialCoreExportsPresent: true,
    coreHasConsumerDependency: false,
    ...overrides,
  };
}

await describe("framework doctor", async () => {
  await it("accepts a supported Node.js version", () => {
    assert.equal(satisfiesVersionRange("v24.1.0", ">=22.22.0 <27"), true);
    assert.equal(
      evaluateFrameworkDoctor(validInput()).checks[0]?.status,
      "pass",
    );
  });

  await it("rejects an unsupported Node.js version", () => {
    const result = evaluateFrameworkDoctor(
      validInput({ nodeVersion: "v20.18.0" }),
    );
    assert.equal(result.checks[0]?.status, "fail");
  });

  await it("accepts aligned Playwright package versions", () => {
    const check = evaluateFrameworkDoctor(validInput()).checks.find(
      ({ id }) => id === "playwright-version-alignment",
    );
    assert.equal(check?.status, "pass");
  });

  await it("detects mismatched Playwright package versions", () => {
    const result = evaluateFrameworkDoctor(
      validInput({ playwrightCoreVersion: "1.60.0" }),
    );
    assert.equal(
      result.checks.find(({ id }) => id === "playwright-version-alignment")
        ?.status,
      "fail",
    );
  });

  await it("detects a missing browser executable", () => {
    const result = evaluateFrameworkDoctor(
      validInput({
        browserExecutables: {
          chromium: true,
          firefox: false,
          webkit: true,
        },
      }),
    );
    assert.equal(
      result.checks.find(({ id }) => id === "firefox-executable")?.status,
      "fail",
    );
  });

  await it("warns about a missing executable in a browser-independent job", () => {
    const result = evaluateFrameworkDoctor(
      validInput({
        browserExecutables: {
          chromium: false,
          firefox: false,
          webkit: false,
        },
        browserExecutablesRequired: false,
      }),
    );
    assert.deepEqual(result.summary, { passed: 12, warned: 3, failed: 0 });
    assert.equal(doctorExitCode(result), 0);
  });

  await it("keeps check ordering deterministic", () => {
    const first = evaluateFrameworkDoctor(validInput());
    const second = evaluateFrameworkDoctor(validInput());
    assert.deepEqual(
      first.checks.map(({ id }) => id),
      second.checks.map(({ id }) => id),
    );
  });

  await it("calculates summary counts and exit status", () => {
    const passing = evaluateFrameworkDoctor(validInput());
    assert.deepEqual(passing.summary, { passed: 15, warned: 0, failed: 0 });
    assert.equal(doctorExitCode(passing), 0);

    const failing = evaluateFrameworkDoctor(
      validInput({ packageLockExists: false }),
    );
    assert.deepEqual(failing.summary, { passed: 14, warned: 0, failed: 1 });
    assert.equal(doctorExitCode(failing), 1);
  });

  await it("returns JSON-serializable plain data", () => {
    const result = evaluateFrameworkDoctor(validInput());
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});
