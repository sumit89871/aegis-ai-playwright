import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { runApplicationPreflight } from "../src/index.ts";
import type { ApplicationProfile } from "../src/index.ts";

let server: ReturnType<typeof createServer>;
let baseUrl: string;

function profile(
  healthCheckPath: string,
  expectedStatusCodes: readonly number[] = [200],
): ApplicationProfile {
  return {
    id: "preflight-test",
    name: "Preflight Test Application",
    environment: "test",
    baseUrl,
    healthCheckPath,
    expectedStatusCodes,
    requestTimeoutMs: 150,
    browserCheck: { enabled: false },
  };
}

before(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case "/ok":
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("TOP_SECRET_RESPONSE_BODY");
        break;
      case "/accepted":
        response.writeHead(202);
        response.end();
        break;
      case "/redirect":
        response.writeHead(302, { location: "/ok" });
        response.end();
        break;
      case "/unexpected":
        response.writeHead(503);
        response.end();
        break;
      case "/timeout":
        break;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
});

await describe("application preflight", async () => {
  await it("passes an HTTP 200 health check", async () => {
    const result = await runApplicationPreflight(profile("/ok"));
    assert.equal(result.status, "pass");
    assert.equal(result.httpCheck.statusCode, 200);
    assert.equal(result.browserCheck.status, "skipped");
  });

  await it("accepts an explicitly allowed non-200 status", async () => {
    const result = await runApplicationPreflight(
      profile("/accepted", [200, 202]),
    );
    assert.equal(result.httpCheck.status, "pass");
    assert.equal(result.httpCheck.statusCode, 202);
  });

  await it("fails an unexpected HTTP status", async () => {
    const result = await runApplicationPreflight(profile("/unexpected"));
    assert.equal(result.status, "fail");
    assert.equal(result.httpCheck.statusCode, 503);
  });

  await it("follows redirects and records the sanitized final URL", async () => {
    const result = await runApplicationPreflight(profile("/redirect"));
    assert.equal(result.httpCheck.status, "pass");
    assert.equal(result.httpCheck.finalUrl, `${baseUrl}/ok`);
  });

  await it("fails within the configured timeout", async () => {
    const result = await runApplicationPreflight(profile("/timeout"));
    assert.equal(result.status, "fail");
    assert.match(result.httpCheck.message, /failed/iu);
  });

  await it("reports a connection failure without throwing", async () => {
    const unavailableServer = createServer();
    await new Promise<void>((resolve) =>
      unavailableServer.listen(0, "127.0.0.1", resolve),
    );
    const address = unavailableServer.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      unavailableServer.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
    const unreachableProfile = {
      ...profile("/health"),
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
    };
    const result = await runApplicationPreflight(unreachableProfile);
    assert.equal(result.httpCheck.status, "fail");
  });

  await it("sanitizes errors and never retains response bodies", async () => {
    const secret = "private-value";
    const errorResult = await runApplicationPreflight(profile("/ok"), {
      fetchImplementation: () =>
        Promise.reject(
          new Error(`authorization: Bearer ${secret} token=${secret}`),
        ),
      now: () => 100,
    });
    const errorJson = JSON.stringify(errorResult);
    assert.doesNotMatch(errorJson, new RegExp(secret, "u"));

    const successResult = await runApplicationPreflight(profile("/ok"));
    assert.doesNotMatch(
      JSON.stringify(successResult),
      /TOP_SECRET_RESPONSE_BODY/u,
    );
  });

  await it("returns a deterministic serializable structure with an injected clock", async () => {
    const result = await runApplicationPreflight(profile("/ok"), {
      now: () => 500,
    });
    assert.equal(result.profileValidation.durationMs, 0);
    assert.equal(result.httpCheck.durationMs, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});
