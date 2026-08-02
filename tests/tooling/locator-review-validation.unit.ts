import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  createLocatorObservationReviewTemplate,
  diagnoseLocatorFailure,
  importLocatorDiagnosisObservation,
  rankLocatorCandidates,
} from "@aegis/core";
import type {
  LocatorDiagnosisReport,
  LocatorObservation,
  LocatorObservationReview,
} from "@aegis/core";
import type { LocatorReviewDirectoryValidationResult } from "../../scripts/locator-observation-review-validation.ts";

import {
  locatorReviewValidationExitCode,
  renderLocatorReviewValidationHuman,
  renderLocatorReviewValidationJson,
  validateLocatorObservationReviewDirectories,
} from "../../scripts/locator-observation-review-validation.ts";

const repositoryRoot = resolve(
  new URL("../../", import.meta.url).pathname.slice(1),
);
const temporaryRoot = resolve(repositoryRoot, "tmp");

async function report(): Promise<LocatorDiagnosisReport> {
  const candidates = rankLocatorCandidates(
    [
      {
        strategy: "role",
        role: "button",
        name: "Search",
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
        value: "Search",
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
    { operation: "click", strategy: "role", role: "button", name: "Search" },
  );
  return diagnoseLocatorFailure({
    evidence: {
      errorMessage:
        "getByRole('button', { name: 'Search catalog' }) resolved to no elements",
      pageReady: true,
      pageAvailable: true,
      projectName: "chromium",
    },
    candidateInventory: {
      status: "collected",
      candidates: candidates.candidates,
      droppedCandidateCount: candidates.dropped,
      scannedElementCount: 2,
      intent: {
        operation: "click",
        strategy: "role",
        role: "button",
        name: "Search catalog",
      },
    },
  });
}

async function observation(
  applicationAlias = "test-app",
): Promise<LocatorObservation> {
  const imported = importLocatorDiagnosisObservation(await report(), {
    applicationAlias,
    sourceType: "synthetic-test-fixture",
  });
  assert.equal(imported.status, "imported");
  return imported.observation;
}

function reviewed(value: LocatorObservation): LocatorObservationReview {
  return {
    ...createLocatorObservationReviewTemplate(value),
    reviewStatus: "reviewed",
    expectedClassification: "selector-no-match",
    expectedRecommendationStatus: "candidates-available",
    acceptableCandidateIds: ["LOCATOR-001"],
    preferredCandidateIds: ["LOCATOR-001"],
    forbiddenCandidateIds: ["LOCATOR-002"],
    minimumAcceptableConfidence: "medium",
    reviewerRationale:
      "The semantic Search button is the human-approved locator candidate.",
  };
}

interface FixtureDirectories {
  readonly root: string;
  readonly observations: string;
  readonly reviews: string;
}

async function withFixture(
  run: (
    directories: FixtureDirectories,
    value: LocatorObservation,
  ) => Promise<void>,
): Promise<void> {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(resolve(temporaryRoot, "review-validation-"));
  const observations = resolve(root, "pending");
  const reviews = resolve(root, "review");
  await mkdir(observations);
  await mkdir(reviews);
  const value = await observation();
  await writeFile(
    resolve(observations, `${value.observationId}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  try {
    await run({ root, observations, reviews }, value);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function validate(
  directories: FixtureDirectories,
): Promise<LocatorReviewDirectoryValidationResult> {
  return validateLocatorObservationReviewDirectories({
    repositoryRoot,
    observationsDirectory: directories.observations,
    reviewsDirectory: directories.reviews,
  });
}

await describe("locator review validation CLI support", async () => {
  await it("reports malformed JSON with safe line and column diagnostics", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        "{}\ninvalid\n",
      );
      const result = await validate(directories);
      const found = result.files[0]?.issues[0];
      assert.ok(found !== undefined);
      assert.equal(found.code, "REVIEW_JSON_INVALID");
      assert.equal(found.fieldPath, "$");
      assert.ok((found.line ?? 0) > 0);
      assert.ok((found.column ?? 0) > 0);
      assert.doesNotMatch(JSON.stringify(found), /reviewStatus|broken/u);
    });
  });

  await it("reports a missing linked observation", async () => {
    await withFixture(async (directories, value) => {
      await rm(
        resolve(directories.observations, `${value.observationId}.json`),
      );
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify(reviewed(value)),
      );
      const result = await validate(directories);
      assert.ok(
        result.files[0]?.issues.some(
          ({ code }) => code === "REVIEW_OBSERVATION_NOT_FOUND",
        ),
      );
    });
  });

  await it("reports an invalid linked observation", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.observations, `${value.observationId}.json`),
        '{"unsafe":"observation"}',
      );
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify(reviewed(value)),
      );
      const result = await validate(directories);
      assert.ok(
        result.files[0]?.issues.some(
          ({ code }) => code === "REVIEW_OBSERVATION_INVALID",
        ),
      );
    });
  });

  await it("reports review filename and observation ID mismatch", async () => {
    await withFixture(async (directories, value) => {
      const otherId = "LOC-OBS-AAAAAAAAAAAAAAAA";
      await writeFile(
        resolve(directories.reviews, `${otherId}.review.json`),
        JSON.stringify(reviewed(value)),
      );
      const result = await validate(directories);
      assert.ok(
        result.files[0]?.issues.some(
          ({ code }) => code === "REVIEW_FILENAME_ID_MISMATCH",
        ),
      );
    });
  });

  await it("continues across multiple invalid review files", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        "{ invalid",
      );
      await writeFile(
        resolve(directories.reviews, "LOC-OBS-AAAAAAAAAAAAAAAA.review.json"),
        JSON.stringify({
          ...reviewed(value),
          observationId: "LOC-OBS-AAAAAAAAAAAAAAAA",
          expectedClassification: "unsupported-value",
        }),
      );
      const result = await validate(directories);
      assert.equal(result.summary.invalid, 2);
      assert.equal(result.files.length, 2);
    });
  });

  await it("keeps aggregate counts for every valid review status", async () => {
    await withFixture(async (directories, value) => {
      for (const [alias, reviewStatus] of [
        ["test-app", "reviewed"],
        ["pending-app", "pending"],
        ["rejected-app", "rejected"],
        ["evidence-app", "needs-more-evidence"],
      ] as const) {
        const linked = alias === "test-app" ? value : await observation(alias);
        if (alias !== "test-app") {
          await writeFile(
            resolve(directories.observations, `${linked.observationId}.json`),
            JSON.stringify(linked),
          );
        }
        const review =
          reviewStatus === "reviewed"
            ? reviewed(linked)
            : {
                ...createLocatorObservationReviewTemplate(linked),
                reviewStatus,
              };
        await writeFile(
          resolve(directories.reviews, `${linked.observationId}.review.json`),
          JSON.stringify(review),
        );
      }
      const result = await validate(directories);
      assert.equal(result.summary.reviewed, 1);
      assert.equal(result.summary.pending, 1);
      assert.equal(result.summary.rejected, 1);
      assert.equal(result.summary.needsMoreEvidence, 1);
      assert.equal(result.summary.invalid, 0);
      assert.equal(result.summary.issues, 0);
    });
  });

  await it("renders actionable human output using only relative paths", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify({
          ...reviewed(value),
          expectedClassification: null,
        }),
      );
      const output = renderLocatorReviewValidationHuman(
        await validate(directories),
      );
      assert.match(output, /Observation review validation failed/u);
      assert.match(output, /REVIEWED_CLASSIFICATION_REQUIRED/u);
      assert.match(output, /\$\.expectedClassification/u);
      assert.match(output, /Problem:/u);
      assert.match(output, /Fix:/u);
      assert.match(output, /Actual: null/u);
      assert.doesNotMatch(output, /C:\\Users|OneDrive/u);
    });
  });

  await it("renders deterministic parseable JSON without human prose", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify({
          ...reviewed(value),
          expectedClassification: null,
        }),
      );
      const result = await validate(directories);
      const first = renderLocatorReviewValidationJson(result);
      const second = renderLocatorReviewValidationJson(result);
      assert.equal(first, second);
      assert.deepEqual(JSON.parse(first), result);
      assert.doesNotMatch(first, /Observation review validation failed/u);
    });
  });

  await it("uses success and failure exit semantics", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify(reviewed(value)),
      );
      assert.equal(
        locatorReviewValidationExitCode(await validate(directories)),
        0,
      );
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        "{ invalid",
      );
      assert.equal(
        locatorReviewValidationExitCode(await validate(directories)),
        1,
      );
    });
  });

  await it("executes the real CLI in JSON-only mode with a failing exit code", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify({
          ...reviewed(value),
          expectedClassification: null,
        }),
      );
      const observations = directories.observations
        .slice(repositoryRoot.length + 1)
        .replaceAll("\\", "/");
      const reviews = directories.reviews
        .slice(repositoryRoot.length + 1)
        .replaceAll("\\", "/");
      const run = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/locator-observations-validate-reviews.ts",
          "--json",
          `--observations=${observations}`,
          `--reviews=${reviews}`,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(run.status, 1);
      const parsed = JSON.parse(run.stdout) as { status: string };
      assert.equal(parsed.status, "fail");
      assert.equal(run.stderr, "");
    });
  });

  await it("executes the real CLI with a successful exit code for a valid review", async () => {
    await withFixture(async (directories, value) => {
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify(reviewed(value)),
      );
      const observations = directories.observations
        .slice(repositoryRoot.length + 1)
        .replaceAll("\\", "/");
      const reviews = directories.reviews
        .slice(repositoryRoot.length + 1)
        .replaceAll("\\", "/");
      const run = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/locator-observations-validate-reviews.ts",
          "--json",
          `--observations=${observations}`,
          `--reviews=${reviews}`,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(run.status, 0);
      assert.equal(
        (JSON.parse(run.stdout) as { status: string }).status,
        "pass",
      );
      assert.equal(run.stderr, "");
    });
  });

  await it("does not print full rationale or sensitive content", async () => {
    await withFixture(async (directories, value) => {
      const secret =
        "password=do-not-print C:\\Users\\Alice\\review.txt <input>";
      await writeFile(
        resolve(directories.reviews, `${value.observationId}.review.json`),
        JSON.stringify({ ...reviewed(value), reviewerRationale: secret }),
      );
      const result = await validate(directories);
      const outputs = `${renderLocatorReviewValidationHuman(result)}${renderLocatorReviewValidationJson(result)}`;
      assert.match(outputs, /REVIEW_TEXT_UNSAFE/u);
      assert.doesNotMatch(outputs, /do-not-print|Alice|<input>/u);
    });
  });
});
