import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLocatorFailure,
  defaultLocatorDiagnosisConfiguration,
  diagnoseLocatorDeterministically,
  normalizeLocatorEvidence,
  rankLocatorCandidates,
  renderLocatorDiagnosisMarkdown,
  validateLocatorDiagnosisConclusion,
  validateLocatorDiagnosisConfiguration,
} from "../src/index.ts";
import type {
  CandidateScoreInput,
  LocatorCandidateInventory,
  LocatorDiagnosisConclusion,
  LocatorDiagnosisReport,
} from "../src/index.ts";

const syntheticAbsolutePath = ["C:", "Users", "person", "repo", "test.ts"].join(
  "\\",
);

function inventory(
  status: LocatorCandidateInventory["status"] = "collected",
): LocatorCandidateInventory {
  const intent = Object.freeze({
    operation: "click" as const,
    strategy: "css" as const,
    value: ".old",
  });
  const input: CandidateScoreInput = {
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
  };
  return Object.freeze({
    status,
    candidates:
      status === "collected"
        ? rankLocatorCandidates([input], intent).candidates
        : Object.freeze([]),
    droppedCandidateCount: 0,
    scannedElementCount: status === "collected" ? 1 : 0,
    intent,
    ...(status === "unavailable" ? { error: "Page closed safely." } : {}),
  });
}

function conclusion(
  overrides: Partial<LocatorDiagnosisConclusion> = {},
): LocatorDiagnosisConclusion {
  return {
    classification: "selector-no-match",
    confidence: "high",
    recommendationStatus: "candidates-available",
    summary: "A safe candidate is available.",
    originalLocatorAssessment: { strategy: "css", issue: "No match." },
    pageStateAssessment: { ready: true, reason: "Ready." },
    rankedCandidates: [
      {
        candidateId: "LOCATOR-001",
        rank: 1,
        confidence: "high",
        reason: "Unique semantic role.",
      },
    ],
    recommendedNextStep: "Review the candidate manually.",
    missingEvidence: [],
    limitations: ["Advisory only."],
    ...overrides,
  };
}

function deterministic(
  message: string,
  status: LocatorCandidateInventory["status"] = "collected",
): LocatorDiagnosisConclusion {
  const classification = classifyLocatorFailure(message);
  const candidates = inventory(status);
  return diagnoseLocatorDeterministically(
    normalizeLocatorEvidence(
      {
        errorMessage: message,
        pageReady: true,
        pageAvailable: status !== "unavailable",
      },
      classification,
      candidates,
    ),
    candidates,
  );
}

await describe("deterministic locator diagnosis", async () => {
  for (const [message, recommendation] of [
    ["locator('.old') resolved to no elements", "candidates-available"],
    [
      "strict mode violation: locator('.item') resolved to 2 elements",
      "candidates-available",
    ],
    ["locator('button') element is disabled", "no-change-recommended"],
    ["locator('button') element is not visible", "no-change-recommended"],
    ["locator('button') intercepts pointer events", "no-change-recommended"],
    ["Page readiness failed for sample-page: missing", "no-change-recommended"],
    ["Accessibility color-contrast violation", "not-applicable"],
    ["Expected value 1 but received: 2", "not-applicable"],
  ] as const) {
    await it(`returns ${recommendation} for ${message.slice(0, 20)}`, () => {
      assert.equal(deterministic(message).recommendationStatus, recommendation);
    });
  }

  await it("abstains when the strongest candidates have equal scores", () => {
    const classification = classifyLocatorFailure(
      "click locator('.old') resolved to no elements",
    );
    const intent = classification.intent;
    const candidates = rankLocatorCandidates(
      [
        {
          strategy: "role",
          role: "button",
          name: "Approve",
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
          strategy: "role",
          role: "button",
          name: "Reject",
          exact: true,
          scopeHint: null,
          tagName: "button",
          matchCount: 1,
          visible: true,
          enabled: true,
          editable: false,
          hasBoundingBox: true,
        },
      ],
      intent,
    ).candidates;
    const ambiguousInventory: LocatorCandidateInventory = {
      status: "collected",
      candidates,
      droppedCandidateCount: 0,
      scannedElementCount: 2,
      intent,
    };
    const result = diagnoseLocatorDeterministically(
      normalizeLocatorEvidence(
        {
          errorMessage: "click locator('.old') resolved to no elements",
          pageAvailable: true,
        },
        classification,
        ambiguousInventory,
      ),
      ambiguousInventory,
    );
    assert.equal(result.recommendationStatus, "insufficient-evidence");
    assert.equal(result.confidence, "low");
  });

  await it("reports unavailable collection", () => {
    assert.equal(
      deterministic("locator('.old') resolved to no elements", "unavailable")
        .recommendationStatus,
      "collection-unavailable",
    );
  });

  await it("validates safe defaults and immutability", () => {
    const defaults = defaultLocatorDiagnosisConfiguration();
    assert.equal(defaults.mode, "deterministic-only");
    assert.equal(defaults.aiAdvisoryEnabled, false);
    assert.ok(Object.isFrozen(defaults));
  });

  await it("rejects disabling deterministic safeguards", () => {
    assert.throws(
      () =>
        validateLocatorDiagnosisConfiguration({
          ...defaultLocatorDiagnosisConfiguration(),
          deterministicEnabled: false,
        }),
      /must remain true/u,
    );
  });
});

await describe("locator diagnosis validation and rendering", async () => {
  await it("sanitizes paths, secrets, and DOM snippets without mutating input", () => {
    const candidates = inventory();
    const input = {
      errorMessage: `Authorization: Bearer synthetic-secret at ${syntheticAbsolutePath} <button value='private'>Save</button>`,
      pageAvailable: true,
      requirementIds: ["REQ-SAFE-001"],
    };
    const before = structuredClone(input);
    const normalized = normalizeLocatorEvidence(
      input,
      classifyLocatorFailure("locator('.old') resolved to no elements"),
      candidates,
    );
    const serialized = JSON.stringify(normalized);
    assert.doesNotMatch(
      serialized,
      /synthetic-secret|C:\\\\Users|<button|private/u,
    );
    assert.deepEqual(input, before);
    assert.doesNotThrow(() => JSON.parse(serialized));
  });

  await it("accepts a valid supplied candidate", () => {
    assert.equal(
      validateLocatorDiagnosisConclusion(conclusion(), ["LOCATOR-001"])
        .rankedCandidates.length,
      1,
    );
  });

  for (const [label, mutation] of [
    [
      "unknown candidate",
      {
        rankedCandidates: [
          {
            candidateId: "LOCATOR-999",
            rank: 1,
            confidence: "high",
            reason: "Unknown.",
          },
        ],
      },
    ],
    [
      "duplicate rank",
      {
        rankedCandidates: [
          {
            candidateId: "LOCATOR-001",
            rank: 1,
            confidence: "high",
            reason: "One.",
          },
          {
            candidateId: "LOCATOR-002",
            rank: 1,
            confidence: "high",
            reason: "Two.",
          },
        ],
      },
    ],
    ["XPath", { recommendedNextStep: "Use xpath=//button." }],
    ["nth", { recommendedNextStep: "Use locator.nth(1)." }],
    ["force", { recommendedNextStep: "Click with force: true." }],
    [
      "invented locator",
      { recommendedNextStep: "Use page.getByRole for the repair." },
    ],
    ["shell", { recommendedNextStep: "Run PowerShell now." }],
    ["patch", { recommendedNextStep: "BEGIN PATCH to update source." }],
    ["raw HTML", { summary: "Use <button>Save</button>." }],
    ["secret", { summary: "Authorization: Bearer example-secret." }],
    ["absolute path", { summary: `Inspect ${syntheticAbsolutePath}.` }],
  ] as const) {
    await it(`rejects ${label}`, () => {
      assert.throws(
        () =>
          validateLocatorDiagnosisConclusion({ ...conclusion(), ...mutation }, [
            "LOCATOR-001",
            "LOCATOR-002",
          ]),
        /Invalid locator-diagnosis/u,
      );
    });
  }

  await it("renders bounded stable Markdown without raw HTML", () => {
    const candidates = inventory();
    const validated = validateLocatorDiagnosisConclusion(conclusion(), [
      "LOCATOR-001",
    ]);
    const report: LocatorDiagnosisReport = {
      status: "completed",
      conclusion: validated,
      deterministicAnalysis: validated,
      disagreements: [],
      evidence: normalizeLocatorEvidence(
        {
          errorMessage: "locator('.old') resolved to no elements",
          pageReady: true,
          pageAvailable: true,
        },
        classifyLocatorFailure("locator('.old') resolved to no elements"),
        candidates,
      ),
      candidateInventory: candidates.candidates,
      provenance: {
        mode: "deterministic-only",
        deterministicAnalysisUsed: true,
        aiAttempted: false,
        promptId: "ui-locator-diagnosis",
        promptVersion: "1.0.0",
        candidateCollectionStatus: "collected",
        candidatesCollected: 1,
        candidatesDropped: 0,
        aiOutputValidated: false,
        fallbackUsed: true,
        conflictDetected: false,
        lifecycleOutcome: "deterministic-only",
      },
    };
    const first = renderLocatorDiagnosisMarkdown(report);
    assert.equal(first, renderLocatorDiagnosisMarkdown(report));
    assert.doesNotMatch(first, /<button>/u);
    assert.match(first, /advisory only/u);
  });
});
