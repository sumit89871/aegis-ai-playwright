import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AiError,
  MAX_AI_JSON_SCHEMA_BYTES,
  parseAiOutput,
  validateAiJsonSchema,
  validateAiResponseFormat,
} from "../src/index.ts";

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
    assert.throws(
      () =>
        parseAiOutput('{"status":"bad"}', {
          type: "json_object",
          validatorId: "status-v1",
          validator: (value) => ({
            valid: value.status === "ok",
            errors: ["status-unsupported"],
          }),
        }),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "structured-output-invalid" &&
        error.validationErrors?.[0] === "status-unsupported",
    );
  });

  await it("retains raw text only when explicitly requested", () => {
    const text = '{"status":"ok"}';
    assert.equal(
      parseAiOutput(text, { type: "json_object", retainRawText: true }).text,
      text,
    );
  });

  await it("accepts bounded plain JSON Schema response formats", () => {
    const schema = { type: "object", additionalProperties: false };
    const result = validateAiResponseFormat({
      type: "json_schema",
      name: "synthetic_contract_v1",
      strict: true,
      schema,
    });
    assert.equal(result.type, "json_schema");
    assert.deepEqual(result.schema, schema);
    assert.equal(Object.isFrozen(result.schema), true);
    assert.deepEqual(validateAiResponseFormat({ type: "text" }), {
      type: "text",
    });
    assert.deepEqual(validateAiResponseFormat({ type: "json_object" }), {
      type: "json_object",
    });
  });

  await it("rejects unsafe JSON Schema names and values", () => {
    for (const name of ["", "has spaces", "../schema", "x".repeat(65)])
      assert.throws(
        () =>
          validateAiResponseFormat({
            type: "json_schema",
            name,
            strict: true,
            schema: { type: "object" },
          }),
        (error: unknown) =>
          error instanceof AiError && error.code === "request-invalid",
      );
    for (const schema of [
      Object.create({ type: "object" }) as Record<string, unknown>,
      { value: BigInt(1) },
      { value: Symbol("unsafe") },
      { value: (): undefined => undefined },
      { value: Number.NaN },
    ])
      assert.throws(() => validateAiJsonSchema(schema), AiError);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    assert.throws(() => validateAiJsonSchema(cyclic), AiError);
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "type", {
      enumerable: true,
      get: (): string => "object",
    });
    assert.throws(() => validateAiJsonSchema(accessor), AiError);
  });

  await it("rejects oversized JSON Schema documents", () => {
    assert.throws(
      () =>
        validateAiJsonSchema({
          description: "x".repeat(MAX_AI_JSON_SCHEMA_BYTES),
        }),
      (error: unknown) =>
        error instanceof AiError && error.code === "request-invalid",
    );
  });

  await it("bounds and redacts validator diagnostics without raw output", () => {
    const secret = "sk-live-example-secret-1234567890";
    assert.throws(
      () =>
        parseAiOutput('{"status":"bad","private":"raw-value"}', {
          type: "json_schema",
          name: "safe_diagnostics_v1",
          strict: true,
          schema: { type: "object" },
          validator: () => ({
            valid: false,
            errors: [
              secret,
              "C:\\Users\\private\\fixture.json",
              "BLIND-CANDIDATE-999",
              ...Array.from(
                { length: 12 },
                (_, index) => `issue-${String(index)} ${"x".repeat(300)}`,
              ),
            ],
          }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof AiError);
        assert.equal(error.code, "structured-output-invalid");
        const errors = error.validationErrors;
        assert.ok(errors);
        assert.equal(errors.length, 10);
        assert.ok(errors.every((entry) => entry.length <= 200));
        const serialized = JSON.stringify(error);
        assert.doesNotMatch(
          serialized,
          /raw-value|sk-live|C:\\Users|BLIND-CANDIDATE/u,
        );
        return true;
      },
    );
  });
});
