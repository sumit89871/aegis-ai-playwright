import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactHeaders, sanitizeUrl } from "../src/diagnostics/redaction.ts";

await describe("diagnostic URL redaction", async () => {
  await it("preserves non-sensitive query values", () => {
    const sanitized = sanitizeUrl(
      "https://example.test/search?query=computer&page=2",
    );

    assert.match(sanitized, /query=computer/);
    assert.match(sanitized, /page=2/);
  });

  await it("masks token, password, and api_key values", () => {
    const sanitized = sanitizeUrl(
      "https://example.test/path?token=token-value&password=password-value&api_key=key-value&view=full",
    );

    assert.doesNotMatch(sanitized, /token-value|password-value|key-value/);
    assert.match(sanitized, /token=%5BREDACTED%5D/);
    assert.match(sanitized, /password=%5BREDACTED%5D/);
    assert.match(sanitized, /api_key=%5BREDACTED%5D/);
    assert.match(sanitized, /view=full/);
  });

  await it("removes URL usernames and passwords", () => {
    const sanitized = sanitizeUrl(
      "https://local-user:local-password@example.test/catalog",
    );

    assert.equal(sanitized, "https://example.test/catalog");
  });

  await it("redacts malformed input without throwing", () => {
    assert.doesNotThrow(() =>
      sanitizeUrl("not a valid url?token=secret-value&view=summary"),
    );

    const sanitized = sanitizeUrl(
      "not a valid url?token=secret-value&view=summary",
    );
    assert.doesNotMatch(sanitized, /secret-value/);
    assert.match(sanitized, /view=summary/);
  });

  await it("bounds sanitized URL length", () => {
    const sanitized = sanitizeUrl(
      `https://example.test/path?query=${"x".repeat(200)}`,
      64,
    );

    assert.ok(sanitized.length <= 64);
  });
});

await describe("diagnostic header redaction", async () => {
  await it("masks authorization case-insensitively", () => {
    const redacted = redactHeaders({ AUTHORIZATION: "Bearer secret-token" });

    assert.equal(redacted.AUTHORIZATION, "[REDACTED]");
  });

  await it("masks cookie and set-cookie values", () => {
    const redacted = redactHeaders({
      Cookie: "session=secret",
      "Set-Cookie": ["session=secret", "preference=secret"],
    });

    assert.equal(redacted.Cookie, "[REDACTED]");
    assert.deepEqual(redacted["Set-Cookie"], ["[REDACTED]", "[REDACTED]"]);
  });

  await it("preserves non-sensitive headers", () => {
    const redacted = redactHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
    });

    assert.deepEqual(redacted, {
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  await it("does not mutate its input", () => {
    const original = {
      Authorization: "Bearer original-secret",
      Accept: "application/json",
    } as const;
    const before = { ...original };

    redactHeaders(original);

    assert.deepEqual(original, before);
  });
});
