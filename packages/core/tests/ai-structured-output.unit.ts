import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiError, parseAiOutput } from "../src/index.ts";

await describe("AI structured output", async () => {
  await it("returns plain text unchanged for text format", () => {
    assert.deepEqual(parseAiOutput("hello", { type: "text" }), {
      text: "hello",
    });
  });

  await it("parses a valid JSON object without retaining raw text by default", () => {
    assert.deepEqual(
      parseAiOutput('{"status":"ok"}', { type: "json_object" }),
      {
        structuredOutput: { status: "ok" },
      },
    );
  });

  await it("rejects invalid JSON and non-object top-level values", () => {
    for (const value of ["not json", "[]", "null", '"text"']) {
      assert.throws(
        () => parseAiOutput(value, { type: "json_object" }),
        (error: unknown) =>
          error instanceof AiError &&
          error.code === "structured-output-invalid",
      );
    }
  });

  await it("applies a supplied validator", () => {
    assert.throws(() =>
      parseAiOutput('{"status":"bad"}', {
        type: "json_object",
        validatorId: "status-v1",
        validator: (value) => ({
          valid: value.status === "ok",
          errors: ["status must be ok"],
        }),
      }),
    );
  });

  await it("retains raw text only when explicitly requested", () => {
    const text = '{"status":"ok"}';
    assert.equal(
      parseAiOutput(text, { type: "json_object", retainRawText: true }).text,
      text,
    );
  });
});
