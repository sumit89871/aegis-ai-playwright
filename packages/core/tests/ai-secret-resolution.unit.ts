import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  defaultAiConfiguration,
  resolveAiApiKey,
} from "../src/index.ts";

await describe("AI secret resolution", async () => {
  await it("reads only the requested environment variable", () => {
    const reads: string[] = [];
    const source = new Proxy<Record<string, string>>(
      { REQUESTED_KEY: "synthetic-secret" },
      {
        get(target, property: string): string | undefined {
          reads.push(property);
          return target[property];
        },
        ownKeys(): never {
          throw new Error("Environment enumeration is forbidden.");
        },
      },
    );
    assert.equal(resolveAiApiKey("REQUESTED_KEY", source), "synthetic-secret");
    assert.deepEqual(reads, ["REQUESTED_KEY"]);
  });

  await it("reports a missing variable without revealing secret information", () => {
    assert.throws(
      () => resolveAiApiKey("OPENROUTER_API_KEY", Object.freeze({})),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "secret-missing" &&
        error.message ===
          "AI provider is enabled, but the configured API-key environment variable is missing.",
    );
  });

  await it("never serializes a secret into configuration", () => {
    const secret = "synthetic-super-secret";
    const configuration = defaultAiConfiguration({
      apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    });
    assert.doesNotMatch(JSON.stringify(configuration), new RegExp(secret, "u"));
    assert.equal(
      resolveAiApiKey("OPENROUTER_API_KEY", { OPENROUTER_API_KEY: secret }),
      secret,
    );
  });
});
