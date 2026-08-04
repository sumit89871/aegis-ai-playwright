import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLocatorBlindReviewArtifacts,
  diagnoseLocatorFailure,
  importLocatorDiagnosisObservation,
  rankLocatorCandidates,
} from "../../packages/core/src/index.ts";
import type {
  LocatorBlindReview,
  LocatorObservation,
} from "../../packages/core/src/index.ts";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const comparisonScript = resolve(
  repositoryRoot,
  "scripts/locator-blind-holdout-compare.ts",
);

function execute(arguments_: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", comparisonScript, ...arguments_],
    {
      cwd: repositoryRoot,
      shell: false,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        AEGIS_AI_ENABLED: "false",
        AEGIS_AI_ALLOW_NETWORK_CALLS: "false",
        OPENROUTER_API_KEY: "",
      },
    },
  );
}

async function fixtureObservation(): Promise<LocatorObservation> {
  const ranked = rankLocatorCandidates(
    [
      {
        strategy: "text",
        value: "Wishlist",
        exact: true,
        scopeHint: null,
        tagName: "a",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
      {
        strategy: "role",
        role: "link",
        name: "Saved items",
        exact: true,
        scopeHint: "account navigation",
        tagName: "a",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
    ],
    {
      operation: "click",
      strategy: "role",
      role: "link",
      name: "Wishlist",
    },
  );
  const report = await diagnoseLocatorFailure({
    evidence: {
      errorMessage: "The requested Wishlist link resolved to no elements.",
      pageReady: true,
      pageAvailable: true,
    },
    candidateInventory: {
      status: "collected",
      candidates: ranked.candidates,
      droppedCandidateCount: ranked.dropped,
      scannedElementCount: 2,
      intent: {
        operation: "click",
        strategy: "role",
        role: "link",
        name: "Wishlist",
      },
    },
  });
  const imported = importLocatorDiagnosisObservation(report, {
    applicationAlias: "comparison-cli-fixture",
    sourceType: "synthetic-test-fixture",
  });
  assert.equal(imported.status, "imported");
  return imported.observation;
}

async function withFixture(
  callback: (root: string, relativeRoot: string) => Promise<void> | void,
): Promise<void> {
  const root = resolve(
    repositoryRoot,
    `artifacts/advisory comparison tests/${String(process.pid)}-${Math.random().toString(16).slice(2)}`,
  );
  const relativeRoot = relative(repositoryRoot, root);
  const observation = await fixtureObservation();
  const bundle = createLocatorBlindReviewArtifacts(observation);
  const acceptable = bundle.mapping.aliases.find(
    ({ originalCandidateId }) => originalCandidateId === "LOCATOR-002",
  )?.blindCandidateId;
  assert.ok(acceptable);
  const review: LocatorBlindReview = {
    ...structuredClone(bundle.review),
    reviewStatus: "reviewed",
    expectedClassification: "selector-no-match",
    expectedRecommendationStatus: "candidates-available",
    acceptableBlindCandidateIds: [acceptable],
    preferredBlindCandidateIds: [acceptable],
    forbiddenBlindCandidateIds: [],
    minimumAcceptableConfidence: "medium",
    reviewerRationale:
      "Independent synthetic review selected the semantic match.",
  };
  await Promise.all([
    mkdir(join(root, "pending"), { recursive: true }),
    mkdir(join(root, "blind/packets"), { recursive: true }),
    mkdir(join(root, "blind/mappings"), { recursive: true }),
    mkdir(join(root, "blind/reviews"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "pending", `${observation.observationId}.json`),
      `${JSON.stringify(observation, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(
        root,
        "blind/packets",
        `${bundle.packet.blindPacketId}.blind-packet.json`,
      ),
      `${JSON.stringify(bundle.packet, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(
        root,
        "blind/mappings",
        `${bundle.packet.blindPacketId}.blind-mapping.json`,
      ),
      `${JSON.stringify(bundle.mapping, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(
        root,
        "blind/reviews",
        `${bundle.packet.blindPacketId}.blind-review.json`,
      ),
      `${JSON.stringify(review, null, 2)}\n`,
      "utf8",
    ),
  ]);
  try {
    await callback(root, relativeRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PRIVATE_OUTPUT =
  /LOC-OBS-|BLIND-PACKET-|BLIND-CANDIDATE-|LOCATOR-\d{3}|reviewerRationale|expectedClassification|actualClassification|"aliases"|"originalCandidateId"|C:\\Users|\/home\/|bearer\s+|authorization/iu;

await describe("locator advisory comparison CLI", async () => {
  await it("runs the real mock comparison offline with aggregate-only JSON", async () => {
    await withFixture(async (root, relativeRoot) => {
      const result = execute([
        "--mode=mock-ai",
        "--summary-json",
        `--root=${relativeRoot}`,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.includes("\u001B"), false);
      const summary = JSON.parse(result.stdout) as {
        requestedMode: string;
        counts: { blindReviewed: number; advisoryCompleted: number };
        isolation: { networkCalls: number; locatorApplications: number };
      };
      assert.equal(summary.requestedMode, "mock-ai");
      assert.equal(summary.counts.blindReviewed, 1);
      assert.equal(summary.counts.advisoryCompleted, 1);
      assert.equal(summary.isolation.networkCalls, 0);
      assert.equal(summary.isolation.locatorApplications, 0);
      assert.doesNotMatch(result.stdout, PRIVATE_OUTPUT);

      const markdown = await readFile(
        join(root, "blind/reports/blind-holdout-comparison-mock-ai.md"),
        "utf8",
      );
      assert.match(markdown, /Deterministic|AI advisory|Delta/u);
      assert.doesNotMatch(markdown, PRIVATE_OUTPUT);
    });
  });

  await it("renders a safe plain side-by-side report without progress contamination", async () => {
    await withFixture((_root, relativeRoot) => {
      const result = execute([
        "--mode=mock-ai",
        "--plain",
        `--root=${relativeRoot}`,
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.includes("\u001B"), false);
      assert.match(result.stdout, /DETERMINISTIC VERSUS AI ADVISORY/u);
      assert.match(result.stdout, /INSUFFICIENT-SAMPLE/u);
      assert.match(result.stdout, /Network calls:\s+0/u);
      assert.doesNotMatch(result.stdout, PRIVATE_OUTPUT);
    });
  });

  await it("requires explicit network consent without a stack trace", async () => {
    await withFixture((_root, relativeRoot) => {
      const result = execute([
        "--mode=ai-advisory",
        "--plain",
        `--root=${relativeRoot}`,
      ]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /explicit --confirm-network consent/u);
      assert.doesNotMatch(result.stderr, /\n\s+at |C:\\Users|\/home\//u);
    });
  });

  await it("keeps live advisory execution out of CI and normal validation", async () => {
    const [rootPackage, workflow] = await Promise.all([
      readFile(join(repositoryRoot, "package.json"), "utf8"),
      readFile(
        join(repositoryRoot, ".github/workflows/framework-ci.yml"),
        "utf8",
      ),
    ]);
    assert.doesNotMatch(
      rootPackage,
      /"ci:framework":\s*"[^"]*ai:locator:holdout:compare/u,
    );
    assert.doesNotMatch(
      workflow,
      /ai:locator:holdout:compare|OPENROUTER_API_KEY|openrouter\.ai/u,
    );
  });
});
