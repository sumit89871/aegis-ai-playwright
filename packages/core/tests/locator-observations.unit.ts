import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLocatorHoldoutAnalysisInput,
  createLocatorObservationId,
  createLocatorObservationReviewTemplate,
  deduplicateLocatorObservations,
  diagnoseLocatorFailure,
  importLocatorDiagnosisObservation,
  inspectLocatorObservationReview,
  mapRuntimeLocatorCandidateToObservationCandidate,
  rankLocatorCandidates,
  renderLocatorHoldoutMarkdown,
  runLocatorHoldoutEvaluation,
  validateLocatorObservation,
  validateLocatorObservationReview,
} from "../src/index.ts";
import type {
  LocatorCandidate,
  LocatorDiagnosisReport,
  LocatorObservation,
  LocatorObservationReview,
} from "../src/index.ts";

async function report(
  errorMessage = "locator('.old') resolved to no elements",
): Promise<LocatorDiagnosisReport> {
  const candidates = rankLocatorCandidates(
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
        weakAccessibleNameApproximation: true,
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
  return diagnoseLocatorFailure({
    evidence: {
      errorMessage,
      pageReady: true,
      pageAvailable: true,
      projectName: "chromium",
      testId: "TC-SYNTHETIC-001",
    },
    candidateInventory: {
      status: "collected",
      candidates: candidates.candidates,
      droppedCandidateCount: candidates.dropped,
      scannedElementCount: 2,
      intent: { operation: "click", strategy: "css", value: ".old" },
    },
  });
}

async function observation(
  overrides: Partial<
    Pick<LocatorObservation, "applicationAlias" | "sourceType">
  > = {},
): Promise<LocatorObservation> {
  const imported = importLocatorDiagnosisObservation(await report(), {
    applicationAlias: overrides.applicationAlias ?? "consumer-a",
    sourceType: overrides.sourceType ?? "synthetic-test-fixture",
  });
  assert.equal(imported.status, "imported");
  return imported.observation;
}

function reviewed(
  observationValue: LocatorObservation,
  overrides: Partial<LocatorObservationReview> = {},
): LocatorObservationReview {
  return {
    ...createLocatorObservationReviewTemplate(observationValue),
    reviewStatus: "reviewed",
    expectedClassification: "selector-no-match",
    expectedRecommendationStatus: "candidates-available",
    acceptableCandidateIds: ["LOCATOR-001"],
    preferredCandidateIds: ["LOCATOR-001"],
    forbiddenCandidateIds: ["LOCATOR-002"],
    minimumAcceptableConfidence: "medium",
    reviewerRationale:
      "The unique semantic button is the reviewed safe locator candidate.",
    ...overrides,
  };
}

function reidentify(value: LocatorObservation): LocatorObservation {
  const draft = { ...structuredClone(value), observationId: "" };
  return { ...draft, observationId: createLocatorObservationId(draft) };
}

await describe("locator shadow observation validation", async () => {
  await it("imports a valid applicable locator diagnosis", async () => {
    const value = await observation();
    assert.match(value.observationId, /^LOC-OBS-[A-F0-9]{16}$/u);
    assert.equal(value.candidateInventory.length, 2);
    assert.doesNotThrow(() => JSON.stringify(value));
  });

  await it("maps scorer-only runtime fields into the strict public candidate schema", async () => {
    const runtimeReport = await report();
    assert.match(
      JSON.stringify(runtimeReport.candidateInventory[0]),
      /weakAccessibleNameApproximation/u,
    );
    const imported = importLocatorDiagnosisObservation(runtimeReport, {
      applicationAlias: "reference-store",
    });
    assert.equal(imported.status, "imported");
    assert.doesNotMatch(
      JSON.stringify(imported.observation),
      /weakAccessibleNameApproximation/u,
    );
  });

  await it("regresses the controlled real-shadow Search-button failure", async () => {
    const runtimeReport = await report(
      "TimeoutError: locator.click: Timeout 5000ms exceeded. waiting for getByRole('button', { name: 'Search catalog', exact: true })",
    );
    const imported = importLocatorDiagnosisObservation(runtimeReport, {
      applicationAlias: "reference-store",
      sourceType: "real-shadow",
    });
    assert.equal(imported.status, "imported");
    assert.equal(
      imported.observation.deterministicDiagnosis.classification,
      "selector-no-match",
    );
    assert.equal(
      imported.observation.candidateInventory[0]?.candidateId,
      "LOCATOR-001",
    );
    assert.doesNotMatch(
      JSON.stringify(imported.observation),
      /weakAccessibleNameApproximation/u,
    );
  });

  await it("preserves every public candidate field while excluding unknown runtime data", async () => {
    const candidate = (await report()).candidateInventory[0];
    assert.ok(candidate !== undefined);
    const runtimeCandidate = {
      ...candidate,
      value: "Search value",
      scopeHint: "header",
      countError: "Count was unavailable safely.",
      weakAccessibleNameApproximation: true,
      futureRuntimeField: "internal-only",
      unsafeRuntimeHtml: '<input value="private">',
      runtimeSecret: "password=private",
    } as LocatorCandidate;
    const before = structuredClone(runtimeCandidate);
    const first =
      mapRuntimeLocatorCandidateToObservationCandidate(runtimeCandidate);
    const second =
      mapRuntimeLocatorCandidateToObservationCandidate(runtimeCandidate);
    assert.deepEqual(first, second);
    assert.deepEqual(runtimeCandidate, before);
    assert.deepEqual(first, {
      candidateId: candidate.candidateId,
      strategy: candidate.strategy,
      role: candidate.role,
      name: candidate.name,
      value: "Search value",
      exact: candidate.exact,
      scopeHint: "header",
      tagName: candidate.tagName,
      matchCount: candidate.matchCount,
      visible: candidate.visible,
      enabled: candidate.enabled,
      editable: candidate.editable,
      hasBoundingBox: candidate.hasBoundingBox,
      deterministicScore: candidate.deterministicScore,
      stability: candidate.stability,
      rationale: candidate.rationale,
      countError: "Count was unavailable safely.",
    });
    const serialized = JSON.stringify(first);
    assert.doesNotMatch(
      serialized,
      /weakAccessibleNameApproximation|futureRuntimeField|unsafeRuntimeHtml|runtimeSecret|private|<input/iu,
    );
    assert.doesNotThrow(() => JSON.parse(serialized) as unknown);
  });

  await it("preserves candidate IDs, scores, and ordering during import", async () => {
    const runtimeReport = await report();
    const imported = importLocatorDiagnosisObservation(runtimeReport, {
      applicationAlias: "reference-store",
    });
    assert.equal(imported.status, "imported");
    assert.deepEqual(
      imported.observation.candidateInventory.map(
        ({ candidateId, deterministicScore }) => ({
          candidateId,
          deterministicScore,
        }),
      ),
      runtimeReport.candidateInventory.map(
        ({ candidateId, deterministicScore }) => ({
          candidateId,
          deterministicScore,
        }),
      ),
    );
  });

  await it("continues rejecting internal fields supplied directly to the public schema", async () => {
    const base = await observation();
    const draft = {
      ...structuredClone(base),
      observationId: "",
      candidateInventory: [
        {
          ...structuredClone(base.candidateInventory[0]),
          weakAccessibleNameApproximation: true,
        },
        ...structuredClone(base.candidateInventory.slice(1)),
      ],
    };
    const value = {
      ...draft,
      observationId: createLocatorObservationId(draft),
    };
    assert.throws(
      () => validateLocatorObservation(value),
      /candidate\.weakAccessibleNameApproximation is unsupported/u,
    );
  });

  await it("creates deterministic anonymous IDs", async () => {
    const first = await observation();
    const second = await observation();
    assert.equal(first.observationId, second.observationId);
    assert.doesNotMatch(first.observationId, /consumer|user|machine/iu);
  });

  await it("changes identity when sanitized content changes", async () => {
    const first = await observation({ applicationAlias: "consumer-a" });
    const second = await observation({ applicationAlias: "consumer-b" });
    assert.notEqual(first.observationId, second.observationId);
  });

  await it("rejects an unsafe application alias", async () => {
    const value = reidentify({
      ...(await observation()),
      applicationAlias: "Company Name",
    });
    assert.throws(() => validateLocatorObservation(value), /applicationAlias/u);
  });

  await it("rejects absolute Windows paths", async () => {
    const base = await observation();
    const value = reidentify({
      ...base,
      failure: {
        ...base.failure,
        errorMessage: "C:\\Users\\Alice\\secret.txt",
      },
    });
    assert.throws(
      () => validateLocatorObservation(value),
      /private or unsafe/u,
    );
  });

  await it("rejects absolute Unix paths", async () => {
    const base = await observation();
    const value = reidentify({
      ...base,
      failure: { ...base.failure, errorMessage: "/home/alice/secret.txt" },
    });
    assert.throws(
      () => validateLocatorObservation(value),
      /private or unsafe/u,
    );
  });

  await it("rejects arbitrary drive, UNC, and Unix absolute paths", async () => {
    for (const path of [
      "D:\\build\\agent\\failure.ts",
      "\\\\server\\share\\failure.ts",
      "/var/lib/runner/failure.ts",
    ]) {
      const base = await observation();
      const value = reidentify({
        ...base,
        failure: {
          ...base.failure,
          errorMessage: `Failure at ${path}`,
        },
      });
      assert.throws(
        () => validateLocatorObservation(value),
        /private or unsafe content/u,
      );
    }
  });

  await it("rejects HTML and form markup", async () => {
    const base = await observation();
    const value = reidentify({
      ...base,
      failure: { ...base.failure, errorMessage: '<input value="secret">' },
    });
    assert.throws(
      () => validateLocatorObservation(value),
      /private or unsafe/u,
    );
  });

  await it("rejects unexpected value and DOM snapshot fields", async () => {
    const base = await observation();
    const unsafe = {
      ...base,
      inputValue: "must-not-be-retained",
      domSnapshot: "must-not-be-retained",
    };
    const value = {
      ...unsafe,
      observationId: createLocatorObservationId(unsafe),
    };
    assert.throws(() => validateLocatorObservation(value), /unsupported/u);
  });

  await it("redacts secrets, email, paths, and DOM snippets during import", async () => {
    const unsafe = await report(
      "locator('.old') resolved to no elements password=hunter2 alice@example.test C:\\Users\\Alice\\x <input value='x'>",
    );
    const result = importLocatorDiagnosisObservation(unsafe, {
      applicationAlias: "app-001",
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /hunter2|alice@example|C:\\Users\\Alice|<input/iu,
    );
    assert.match(
      serialized,
      /REDACTED|LOCAL_PATH_REMOVED|DOM_SNIPPET_REMOVED/u,
    );
  });

  await it("ignores non-locator failure reports", async () => {
    const result = importLocatorDiagnosisObservation(
      await report("Accessibility color-contrast violation"),
      { applicationAlias: "app-001" },
    );
    assert.equal(result.status, "ignored");
  });

  await it("supports synthetic multiple-match, disabled, obstructed, and insufficient fixtures", async () => {
    const messages = [
      "locator('.item') resolved to multiple elements",
      "locator('.save') element is disabled",
      "locator('.save') another element would receive the click",
    ];
    const classifications: string[] = [];
    for (const message of messages) {
      const imported = importLocatorDiagnosisObservation(
        await report(message),
        {
          applicationAlias: "app-001",
          sourceType: "synthetic-test-fixture",
        },
      );
      assert.equal(imported.status, "imported");
      classifications.push(
        imported.observation.deterministicDiagnosis.classification,
      );
    }
    const unavailable = await diagnoseLocatorFailure({
      evidence: {
        errorMessage: "locator('.missing') resolved to no elements",
        pageAvailable: false,
      },
    });
    const insufficient = importLocatorDiagnosisObservation(unavailable, {
      applicationAlias: "app-001",
      sourceType: "synthetic-test-fixture",
    });
    assert.equal(insufficient.status, "imported");
    assert.deepEqual(classifications, [
      "selector-multiple-match",
      "element-not-enabled",
      "action-obstructed",
    ]);
    assert.equal(
      insufficient.observation.deterministicDiagnosis.recommendationStatus,
      "collection-unavailable",
    );
  });

  await it("deduplicates identical imports", async () => {
    const value = await observation();
    assert.equal(deduplicateLocatorObservations([value, value]).length, 1);
  });

  await it("does not mutate importer input", async () => {
    const source = await report();
    const before = JSON.stringify(source);
    importLocatorDiagnosisObservation(source, { applicationAlias: "app-001" });
    assert.equal(JSON.stringify(source), before);
  });
});

await describe("locator observation human review", async () => {
  function codes(
    value: unknown,
    linked: LocatorObservation,
  ): readonly string[] {
    return inspectLocatorObservationReview(value, linked).issues.map(
      ({ code }) => code,
    );
  }

  await it("creates an empty pending review template", async () => {
    const template = createLocatorObservationReviewTemplate(
      await observation(),
    );
    assert.equal(template.reviewStatus, "pending");
    assert.equal(template.expectedClassification, null);
    assert.equal(template.reviewerRationale, "");
  });

  await it("validates a completed reviewed case", async () => {
    const value = await observation();
    assert.equal(
      validateLocatorObservationReview(reviewed(value), value).reviewStatus,
      "reviewed",
    );
  });

  await it("allows pending reviews without expected answers", async () => {
    const value = await observation();
    assert.equal(
      validateLocatorObservationReview(
        createLocatorObservationReviewTemplate(value),
        value,
      ).reviewStatus,
      "pending",
    );
  });

  await it("allows rejected and needs-more-evidence reviews", async () => {
    const value = await observation();
    for (const reviewStatus of ["rejected", "needs-more-evidence"] as const) {
      const result = inspectLocatorObservationReview(
        {
          ...createLocatorObservationReviewTemplate(value),
          reviewStatus,
        },
        value,
      );
      assert.equal(result.valid, true);
      assert.equal(result.review?.reviewStatus, reviewStatus);
    }
  });

  await it("reports every missing required field", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview({}, value);
    assert.equal(result.valid, false);
    assert.equal(
      result.issues.filter(
        ({ code }) => code === "REVIEW_REQUIRED_FIELD_MISSING",
      ).length,
      11,
    );
  });

  await it("reports every unknown field without making the schema permissive", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...createLocatorObservationReviewTemplate(value),
        unexpectedProperty: true,
      },
      value,
    );
    assert.deepEqual(
      result.issues.map(({ code }) => code),
      ["REVIEW_UNKNOWN_FIELD"],
    );
    assert.equal(result.issues[0]?.fieldPath, "$.unexpectedProperty");
  });

  await it("reports wrong and malformed observation IDs safely", async () => {
    const value = await observation();
    const wrongType = inspectLocatorObservationReview(
      { ...createLocatorObservationReviewTemplate(value), observationId: 42 },
      value,
    );
    const malformed = inspectLocatorObservationReview(
      {
        ...createLocatorObservationReviewTemplate(value),
        observationId: "not-an-observation-id",
      },
      value,
    );
    assert.ok(
      wrongType.issues.some(({ code }) => code === "REVIEW_FIELD_TYPE_INVALID"),
    );
    assert.ok(
      malformed.issues.some(
        ({ code }) => code === "REVIEW_OBSERVATION_ID_INVALID",
      ),
    );
    assert.doesNotMatch(JSON.stringify(malformed), /not-an-observation-id/u);
  });

  await it("reports an unsupported review status and exact allowed values", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...createLocatorObservationReviewTemplate(value),
        reviewStatus: "approved",
      },
      value,
    );
    const found = result.issues.find(
      ({ code }) => code === "REVIEW_STATUS_UNSUPPORTED",
    );
    assert.deepEqual(found?.allowedValues, [
      "pending",
      "reviewed",
      "rejected",
      "needs-more-evidence",
    ]);
  });

  await it("reports unsupported classification, recommendation, and confidence values", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...reviewed(value),
        expectedClassification: "made-up",
        expectedRecommendationStatus: "replace-now",
        minimumAcceptableConfidence: "certain",
      },
      value,
    );
    assert.deepEqual(
      result.issues.map(({ code }) => code),
      [
        "REVIEW_CLASSIFICATION_UNSUPPORTED",
        "REVIEW_RECOMMENDATION_STATUS_UNSUPPORTED",
        "REVIEW_CONFIDENCE_UNSUPPORTED",
      ],
    );
  });

  await it("reports reviewed null expected answers with actionable codes", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...reviewed(value),
        expectedClassification: null,
        expectedRecommendationStatus: null,
        minimumAcceptableConfidence: null,
      },
      value,
    );
    assert.deepEqual(
      result.issues.map(({ code }) => code),
      [
        "REVIEWED_CLASSIFICATION_REQUIRED",
        "REVIEWED_RECOMMENDATION_STATUS_REQUIRED",
        "REVIEWED_CONFIDENCE_REQUIRED",
      ],
    );
    const classification = result.issues[0];
    assert.ok(classification !== undefined);
    assert.equal(classification.fieldPath, "$.expectedClassification");
    assert.equal(classification.actualValue, null);
    assert.ok((classification.allowedValues?.length ?? 0) > 10);
    assert.match(classification.suggestion, /human-reviewed/u);
  });

  await it("distinguishes empty and whitespace-only reviewed rationales", async () => {
    const value = await observation();
    for (const [rationale, actual] of [
      ["", "<empty>"],
      ["   ", "<whitespace-only>"],
    ] as const) {
      const result = inspectLocatorObservationReview(
        reviewed(value, { reviewerRationale: rationale }),
        value,
      );
      const found = result.issues.find(
        ({ code }) => code === "REVIEW_RATIONALE_EMPTY",
      );
      assert.equal(found?.actualValue, actual);
      assert.doesNotMatch(JSON.stringify(found), /unique semantic button/u);
    }
  });

  await it("reports short and oversized reviewed rationales without printing them", async () => {
    const value = await observation();
    const short = inspectLocatorObservationReview(
      reviewed(value, { reviewerRationale: "short" }),
      value,
    );
    const long = inspectLocatorObservationReview(
      reviewed(value, { reviewerRationale: "x".repeat(1_001) }),
      value,
    );
    assert.ok(
      codes(reviewed(value, { reviewerRationale: "short" }), value).includes(
        "REVIEW_RATIONALE_TOO_SHORT",
      ),
    );
    assert.ok(
      long.issues.some(({ code }) => code === "REVIEW_RATIONALE_TOO_LONG"),
    );
    assert.doesNotMatch(JSON.stringify(short), /The unique semantic/u);
    assert.doesNotMatch(JSON.stringify(long), /x{20}/u);
  });

  await it("reports duplicate IDs in every candidate array", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      reviewed(value, {
        candidateIds: ["LOCATOR-001", "LOCATOR-001", "LOCATOR-002"],
        acceptableCandidateIds: ["LOCATOR-001", "LOCATOR-001"],
        preferredCandidateIds: ["LOCATOR-001", "LOCATOR-001"],
        forbiddenCandidateIds: ["LOCATOR-002", "LOCATOR-002"],
      }),
      value,
    );
    assert.equal(
      result.issues.filter(({ code }) => code === "REVIEW_CANDIDATE_DUPLICATE")
        .length,
      4,
    );
  });

  await it("reports malformed candidate IDs and candidate-array types", async () => {
    const value = await observation();
    const malformed = inspectLocatorObservationReview(
      {
        ...reviewed(value),
        acceptableCandidateIds: ["candidate-one"],
      },
      value,
    );
    const wrongType = inspectLocatorObservationReview(
      { ...reviewed(value), forbiddenCandidateIds: "LOCATOR-002" },
      value,
    );
    assert.ok(
      malformed.issues.some(
        ({ code }) => code === "REVIEW_CANDIDATE_ID_INVALID",
      ),
    );
    assert.ok(
      wrongType.issues.some(
        ({ code, fieldPath }) =>
          code === "REVIEW_FIELD_TYPE_INVALID" &&
          fieldPath === "$.forbiddenCandidateIds",
      ),
    );
  });

  await it("reports wrong types for nullable enum fields and review notes", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...reviewed(value),
        expectedClassification: 1,
        expectedRecommendationStatus: [],
        minimumAcceptableConfidence: true,
        reviewNotes: { private: true },
      },
      value,
    );
    assert.equal(
      result.issues.filter(({ code }) => code === "REVIEW_FIELD_TYPE_INVALID")
        .length,
      4,
    );
  });

  await it("reports unknown candidates in acceptable, preferred, and forbidden arrays", async () => {
    const value = await observation();
    for (const field of [
      "acceptableCandidateIds",
      "preferredCandidateIds",
      "forbiddenCandidateIds",
    ] as const) {
      const result = inspectLocatorObservationReview(
        reviewed(value, { [field]: ["LOCATOR-999"] }),
        value,
      );
      assert.ok(
        result.issues.some(
          ({ code, fieldPath }) =>
            code === "REVIEW_CANDIDATE_UNKNOWN" &&
            fieldPath.startsWith(`$.${field}`),
        ),
      );
    }
  });

  await it("reports preferred candidates that are not acceptable", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      reviewed(value, {
        acceptableCandidateIds: ["LOCATOR-002"],
        preferredCandidateIds: ["LOCATOR-001"],
        forbiddenCandidateIds: [],
      }),
      value,
    );
    const found = result.issues.find(
      ({ code }) => code === "REVIEW_PREFERRED_NOT_ACCEPTABLE",
    );
    assert.ok(found !== undefined);
    assert.equal(found.actualValue, "LOCATOR-001");
    assert.match(found.suggestion, /acceptableCandidateIds/u);
  });

  await it("reports acceptable-forbidden and preferred-forbidden overlaps", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      reviewed(value, {
        forbiddenCandidateIds: ["LOCATOR-001"],
      }),
      value,
    );
    assert.ok(
      result.issues.some(
        ({ code }) => code === "REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP",
      ),
    );
    assert.ok(
      result.issues.some(
        ({ code }) => code === "REVIEW_PREFERRED_FORBIDDEN_OVERLAP",
      ),
    );
  });

  await it("requires an acceptable candidate for reviewed candidates-available verdicts", async () => {
    const value = await observation();
    assert.ok(
      codes(
        reviewed(value, {
          acceptableCandidateIds: [],
          preferredCandidateIds: [],
        }),
        value,
      ).includes("REVIEWED_ACCEPTABLE_CANDIDATE_REQUIRED"),
    );
  });

  await it("reports candidate inventory drift against the linked observation", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      reviewed(value, { candidateIds: ["LOCATOR-001", "LOCATOR-999"] }),
      value,
    );
    assert.ok(
      result.issues.some(({ code }) => code === "REVIEW_CANDIDATE_UNKNOWN"),
    );
    assert.ok(
      result.issues.some(
        ({ code }) => code === "REVIEW_CANDIDATE_SET_MISMATCH",
      ),
    );
  });

  await it("reports observation ID mismatch and unsupported review version", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      {
        ...reviewed(value),
        observationId: "LOC-OBS-AAAAAAAAAAAAAAAA",
        reviewVersion: "2.0.0",
      },
      value,
    );
    assert.ok(
      result.issues.some(
        ({ code }) => code === "REVIEW_OBSERVATION_ID_MISMATCH",
      ),
    );
    assert.ok(
      result.issues.some(({ code }) => code === "REVIEW_VERSION_UNSUPPORTED"),
    );
  });

  await it("aggregates independently detectable issues in deterministic order", async () => {
    const value = await observation();
    const invalid = {
      ...reviewed(value),
      reviewStatus: "approved",
      expectedClassification: "invalid-classification",
      acceptableCandidateIds: ["LOCATOR-002"],
      preferredCandidateIds: ["LOCATOR-001"],
      forbiddenCandidateIds: ["LOCATOR-002"],
      reviewerRationale: "",
      unexpectedProperty: true,
    };
    const first = inspectLocatorObservationReview(invalid, value);
    const second = inspectLocatorObservationReview(invalid, value);
    assert.ok(first.issues.length >= 4);
    assert.deepEqual(first.issues, second.issues);
    assert.deepEqual(
      first.issues.map(({ fieldPath, code }) => `${fieldPath}:${code}`),
      [...first.issues]
        .sort(
          (left, right) =>
            left.fieldPath.localeCompare(right.fieldPath) ||
            left.code.localeCompare(right.code),
        )
        .map(({ fieldPath, code }) => `${fieldPath}:${code}`),
    );
  });

  await it("avoids membership cascades when candidateIds is not an array", async () => {
    const value = await observation();
    const result = inspectLocatorObservationReview(
      { ...reviewed(value), candidateIds: "LOCATOR-001" },
      value,
    );
    assert.equal(
      result.issues.filter(({ code }) => code === "REVIEW_FIELD_TYPE_INVALID")
        .length,
      1,
    );
    assert.equal(
      result.issues.filter(({ code }) => code === "REVIEW_CANDIDATE_UNKNOWN")
        .length,
      0,
    );
  });

  await it("does not mutate review input and returns serializable results", async () => {
    const value = await observation();
    const input = reviewed(value);
    const before = structuredClone(input);
    const result = inspectLocatorObservationReview(input, value);
    assert.deepEqual(input, before);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  await it("never exposes full unsafe review text in diagnostics", async () => {
    const value = await observation();
    const secret = "password=do-not-print C:\\Users\\Alice\\review.txt <input>";
    const result = inspectLocatorObservationReview(
      reviewed(value, { reviewerRationale: secret }),
      value,
    );
    const serialized = JSON.stringify(result);
    assert.match(serialized, /REVIEW_TEXT_UNSAFE/u);
    assert.doesNotMatch(serialized, /do-not-print|Alice|<input>/u);
  });

  await it("requires rationale for reviewed observations", async () => {
    const value = await observation();
    assert.throws(
      () =>
        validateLocatorObservationReview(
          reviewed(value, { reviewerRationale: "" }),
          value,
        ),
      /rationale/u,
    );
  });

  await it("rejects unknown candidates", async () => {
    const value = await observation();
    assert.throws(
      () =>
        validateLocatorObservationReview(
          reviewed(value, { acceptableCandidateIds: ["LOCATOR-999"] }),
          value,
        ),
      /REVIEW_CANDIDATE_UNKNOWN/u,
    );
  });

  await it("requires preferred candidates to be acceptable", async () => {
    const value = await observation();
    assert.throws(
      () =>
        validateLocatorObservationReview(
          reviewed(value, {
            acceptableCandidateIds: ["LOCATOR-002"],
            forbiddenCandidateIds: [],
          }),
          value,
        ),
      /REVIEW_PREFERRED_NOT_ACCEPTABLE/u,
    );
  });

  await it("rejects a candidate that is acceptable and forbidden", async () => {
    const value = await observation();
    assert.throws(
      () =>
        validateLocatorObservationReview(
          reviewed(value, { forbiddenCandidateIds: ["LOCATOR-001"] }),
          value,
        ),
      /REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP/u,
    );
  });

  await it("rejects reviewer identity fields", async () => {
    const value = await observation();
    const unsafe = {
      ...reviewed(value),
      reviewerEmail: "reviewer@example.test",
    };
    assert.throws(
      () => validateLocatorObservationReview(unsafe, value),
      /REVIEW_UNKNOWN_FIELD/u,
    );
  });
});

await describe("blind locator holdout evaluation", async () => {
  await it("reports zero reviewed observations without misleading accuracy", async () => {
    const result = await runLocatorHoldoutEvaluation([], []);
    assert.equal(result.status, "no-reviewed-observations");
    assert.equal(result.metrics.classification.accuracy.value, null);
    assert.match(result.notice, /not yet meaningful/u);
  });

  await it("evaluates one reviewed observation as an insufficient sample", async () => {
    const value = await observation();
    const result = await runLocatorHoldoutEvaluation(
      [value],
      [reviewed(value)],
    );
    assert.equal(result.status, "insufficient-sample");
    assert.equal(result.reviewedObservationCount, 1);
    assert.equal(result.metrics.classification.accuracy.value, 1);
    assert.equal(result.metrics.safety.unsafeRecommendationRate.value, 0);
  });

  await it("excludes pending observations", async () => {
    const value = await observation();
    const result = await runLocatorHoldoutEvaluation(
      [value],
      [createLocatorObservationReviewTemplate(value)],
    );
    assert.equal(result.reviewedObservationCount, 0);
    assert.equal(result.excluded.pending, 1);
  });

  await it("excludes rejected observations", async () => {
    const value = await observation();
    const review = {
      ...createLocatorObservationReviewTemplate(value),
      reviewStatus: "rejected" as const,
    };
    const result = await runLocatorHoldoutEvaluation([value], [review]);
    assert.equal(result.reviewedObservationCount, 0);
    assert.equal(result.excluded.rejected, 1);
  });

  await it("runs mock AI without network access", async () => {
    const value = await observation();
    const result = await runLocatorHoldoutEvaluation(
      [value],
      [reviewed(value)],
      { mode: "mock-ai" },
    );
    assert.equal(result.mode, "mock-ai");
    assert.equal(result.cases[0]?.aiComparison.outputRejected, false);
  });

  await it("strips expected answers and rationale from analyser input", async () => {
    const value = await observation();
    const input = buildLocatorHoldoutAnalysisInput(value);
    const serialized = JSON.stringify(input);
    assert.doesNotMatch(
      serialized,
      /expectedClassification|acceptableCandidateIds|reviewerRationale|threshold/iu,
    );
    assert.equal(input.candidateInventory.candidates.length, 2);
  });

  await it("keeps analyser runtime input serializable", async () => {
    const input = buildLocatorHoldoutAnalysisInput(await observation());
    assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
  });

  await it("produces deterministic JSON and Markdown", async () => {
    const value = await observation();
    const first = await runLocatorHoldoutEvaluation([value], [reviewed(value)]);
    const second = await runLocatorHoldoutEvaluation(
      [value],
      [reviewed(value)],
    );
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(
      renderLocatorHoldoutMarkdown(first),
      renderLocatorHoldoutMarkdown(second),
    );
  });

  await it("renders no raw HTML, secrets, absolute paths, or command blocks", async () => {
    const value = await observation();
    const markdown = renderLocatorHoldoutMarkdown(
      await runLocatorHoldoutEvaluation([value], [reviewed(value)]),
    );
    assert.doesNotMatch(
      markdown,
      /<\/?\w+|bearer\s+|C:\\Users|```(?:sh|bash|powershell)/iu,
    );
    assert.match(markdown, /not real-world accuracy evidence/u);
  });
});
