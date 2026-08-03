import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  diagnoseLocatorFailure,
  importLocatorDiagnosisObservation,
  rankLocatorCandidates,
} from "../../packages/core/src/index.ts";
import type {
  LocatorBlindCandidateMapping,
  LocatorBlindReview,
  LocatorObservation,
} from "../../packages/core/src/index.ts";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const prepareScript = resolve(
  repositoryRoot,
  "scripts/locator-observations-prepare-blind-review.ts",
);
const validateScript = resolve(
  repositoryRoot,
  "scripts/locator-observations-validate-blind-reviews.ts",
);
const evaluateScript = resolve(
  repositoryRoot,
  "scripts/locator-blind-holdout-evaluate.ts",
);

async function fixtureObservation(): Promise<LocatorObservation> {
  const ranked = rankLocatorCandidates(
    [
      {
        strategy: "role",
        role: "button",
        name: "Save",
        exact: true,
        scopeHint: null,
        tagName: "button",
        matchCount: 1,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
      {
        strategy: "text",
        value: "Save",
        exact: true,
        scopeHint: null,
        tagName: "span",
        matchCount: 2,
        visible: true,
        enabled: true,
        editable: false,
        hasBoundingBox: true,
      },
    ],
    { operation: "click", strategy: "css", value: ".old" },
  );
  const report = await diagnoseLocatorFailure({
    evidence: {
      errorMessage: "locator('.old') resolved to no elements",
      pageReady: true,
      pageAvailable: true,
    },
    candidateInventory: {
      status: "collected",
      candidates: ranked.candidates,
      droppedCandidateCount: 0,
      scannedElementCount: 2,
      intent: { operation: "click", strategy: "css", value: ".old" },
    },
  });
  const imported = importLocatorDiagnosisObservation(report, {
    applicationAlias: "synthetic-app",
    sourceType: "synthetic-test-fixture",
  });
  assert.equal(imported.status, "imported");
  return imported.observation;
}

function run(
  script: string,
  arguments_: readonly string[],
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, ...arguments_],
    {
      cwd: repositoryRoot,
      shell: false,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
}

async function withFixture(
  callback: (context: {
    root: string;
    relativeRoot: string;
    observation: LocatorObservation;
  }) => Promise<void> | void,
): Promise<void> {
  const root = resolve(
    repositoryRoot,
    `artifacts/blind review tests/${String(process.pid)}-${Math.random().toString(16).slice(2)}`,
  );
  const relativeRoot = relative(repositoryRoot, root);
  const observation = await fixtureObservation();
  await mkdir(join(root, "pending"), { recursive: true });
  await writeFile(
    join(root, "pending", `${observation.observationId}.json`),
    `${JSON.stringify(observation, null, 2)}\n`,
    "utf8",
  );
  try {
    await callback({ root, relativeRoot, observation });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await describe("blind review command workflow", async () => {
  await it("prepares a packet, private mapping, and blank review without leaking rank", async () => {
    await withFixture(async ({ root, relativeRoot }) => {
      const result = run(prepareScript, [`--root=${relativeRoot}`]);
      assert.equal(result.status, 0, result.stderr);
      const packetName = (await readdir(join(root, "blind/packets")))[0];
      assert.ok(packetName !== undefined);
      const packet = await readFile(
        join(root, "blind/packets", packetName),
        "utf8",
      );
      assert.doesNotMatch(
        packet,
        /deterministicDiagnosis|deterministicScore|stability|rationale|LOCATOR-00/u,
      );
      const mappingName = (await readdir(join(root, "blind/mappings")))[0];
      assert.ok(mappingName !== undefined);
      const mapping = JSON.parse(
        await readFile(join(root, "blind/mappings", mappingName), "utf8"),
      ) as LocatorBlindCandidateMapping;
      assert.equal(
        mapping.aliases[0]?.originalCandidateId === "LOCATOR-001",
        false,
      );
      assert.doesNotMatch(
        result.stdout,
        /blind\/mappings|originalCandidateId/u,
      );
    });
  });

  await it("validates a completed blind review and evaluates separate counts", async () => {
    await withFixture(async ({ root, relativeRoot }) => {
      assert.equal(run(prepareScript, [`--root=${relativeRoot}`]).status, 0);
      const mappingName = (await readdir(join(root, "blind/mappings")))[0];
      const reviewName = (await readdir(join(root, "blind/reviews")))[0];
      assert.ok(mappingName !== undefined && reviewName !== undefined);
      const mapping = JSON.parse(
        await readFile(join(root, "blind/mappings", mappingName), "utf8"),
      ) as LocatorBlindCandidateMapping;
      const reviewPath = join(root, "blind/reviews", reviewName);
      const review = JSON.parse(
        await readFile(reviewPath, "utf8"),
      ) as LocatorBlindReview;
      const preferred = mapping.aliases.find(
        ({ originalCandidateId }) => originalCandidateId === "LOCATOR-001",
      )?.blindCandidateId;
      assert.ok(preferred !== undefined);
      const completed: LocatorBlindReview = {
        ...review,
        reviewStatus: "reviewed",
        expectedClassification: "selector-no-match",
        expectedRecommendationStatus: "candidates-available",
        acceptableBlindCandidateIds: [preferred],
        preferredBlindCandidateIds: [preferred],
        forbiddenBlindCandidateIds: review.blindCandidateIds.filter(
          (entry) => entry !== preferred,
        ),
        minimumAcceptableConfidence: "medium",
        reviewerRationale:
          "Independent reviewer selected the unique semantic candidate.",
      };
      await writeFile(
        reviewPath,
        `${JSON.stringify(completed, null, 2)}\n`,
        "utf8",
      );
      const validation = run(validateScript, [
        "--json",
        `--root=${relativeRoot}`,
      ]);
      assert.equal(validation.status, 0, validation.stderr);
      const validationJson = JSON.parse(validation.stdout) as {
        status: string;
        summary: { reviewed: number };
      };
      assert.equal(validationJson.status, "pass");
      assert.equal(validationJson.summary.reviewed, 1);
      const evaluation = run(evaluateScript, [
        "--json",
        `--root=${relativeRoot}`,
      ]);
      assert.equal(evaluation.status, 0, evaluation.stderr);
      const result = JSON.parse(evaluation.stdout) as {
        counts: {
          calibrationPilotReviewed: number;
          blindHoldoutReviewed: number;
        };
        safety: { networkCalls: number; locatorApplications: number };
      };
      assert.equal(result.counts.calibrationPilotReviewed, 0);
      assert.equal(result.counts.blindHoldoutReviewed, 1);
      assert.deepEqual(result.safety, {
        networkCalls: 0,
        locatorApplications: 0,
        automaticHealing: false,
      });
    });
  });

  await it("reports malformed review JSON safely in JSON-only mode", async () => {
    await withFixture(async ({ root, relativeRoot }) => {
      assert.equal(run(prepareScript, [`--root=${relativeRoot}`]).status, 0);
      const reviewName = (await readdir(join(root, "blind/reviews")))[0];
      assert.ok(reviewName !== undefined);
      await writeFile(join(root, "blind/reviews", reviewName), "{\n", "utf8");
      const result = run(validateScript, ["--json", `--root=${relativeRoot}`]);
      assert.equal(result.status, 1);
      const parsed = JSON.parse(result.stdout) as {
        status: string;
        files: { issues: { code: string }[] }[];
      };
      assert.equal(parsed.status, "fail");
      assert.equal(parsed.files[0]?.issues[0]?.code, "BLIND_JSON_INVALID");
      assert.doesNotMatch(result.stdout + result.stderr, /C:\\Users|\/home\//u);
    });
  });

  await it("does not overwrite completed blind artifacts", async () => {
    await withFixture(({ relativeRoot }) => {
      assert.equal(run(prepareScript, [`--root=${relativeRoot}`]).status, 0);
      const second = run(prepareScript, [`--root=${relativeRoot}`]);
      assert.equal(second.status, 0);
      assert.match(second.stdout, /already existing 1/u);
    });
  });

  await it("rejects absolute artifact roots", () => {
    const result = run(validateScript, ["--json", `--root=${repositoryRoot}`]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repository-relative/u);
  });
});
