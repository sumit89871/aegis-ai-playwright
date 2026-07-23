import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { satisfiesVersionRange } from "../../packages/core/src/index.ts";

interface RootPackage {
  readonly engines?: { readonly node?: string };
}

const repositoryRoot = new URL("../../", import.meta.url);
const nodePin = readFileSync(new URL(".nvmrc", repositoryRoot), "utf8").trim();
const rootPackage = JSON.parse(
  readFileSync(new URL("package.json", repositoryRoot), "utf8"),
) as RootPackage;

await describe("repository Node version pin", async () => {
  await it("uses a complete semantic version", () => {
    assert.match(nodePin, /^\d+\.\d+\.\d+$/u);
    assert.equal(nodePin, "22.22.2");
  });

  await it("satisfies the declared Node engine range", () => {
    assert.ok(rootPackage.engines?.node);
    assert.equal(
      satisfiesVersionRange(nodePin, rootPackage.engines.node),
      true,
    );
  });
});
