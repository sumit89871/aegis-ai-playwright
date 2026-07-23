import type {
  FailureAnalysisConclusion,
  FailureAnalysisConfidence,
  FailureRecommendationOwner,
} from "./failure-analysis.ts";
import type {
  FailureEvidence,
  FailureEvidenceRecord,
} from "./failure-evidence.ts";
import { validateFailureAnalysisConclusion } from "./failure-analysis-validator.ts";

function records(
  evidence: FailureEvidence,
  category: string,
): readonly FailureEvidenceRecord[] {
  return evidence.records.filter((record) => record.category === category);
}

function hasStatus500(record: FailureEvidenceRecord): boolean {
  const status = record.details.status;
  return typeof status === "number" && status >= 500;
}

function conclusion(
  evidence: FailureEvidence,
  options: {
    readonly summary: string;
    readonly category: FailureAnalysisConclusion["primaryCategory"];
    readonly confidence: FailureAnalysisConfidence;
    readonly cause: string;
    readonly evidenceIds: readonly string[];
    readonly action: string;
    readonly owner: FailureRecommendationOwner;
    readonly locatorStatus?: "no-change-recommended" | "review-recommended";
    readonly locatorReason?: string;
    readonly limitations?: readonly string[];
  },
): FailureAnalysisConclusion {
  return validateFailureAnalysisConclusion(
    {
      summary: options.summary,
      primaryCategory: options.category,
      confidence: options.confidence,
      probableCauses: [
        {
          cause: options.cause,
          confidence: options.confidence,
          evidenceIds: options.evidenceIds,
        },
      ],
      recommendedActions: [
        { priority: "high", action: options.action, owner: options.owner },
      ],
      locatorAssessment: {
        status: options.locatorStatus ?? "no-change-recommended",
        reason:
          options.locatorReason ??
          "The supplied evidence does not justify changing a locator.",
      },
      missingEvidence: evidence.unavailableCategories.map(
        (category) => `${category} evidence was unavailable.`,
      ),
      limitations: options.limitations ?? [
        "This deterministic classification is advisory and is limited to supplied evidence.",
      ],
    },
    evidence.records.map((record) => record.id),
  );
}

export function analyseFailureDeterministically(
  evidence: FailureEvidence,
): FailureAnalysisConclusion {
  const accessibility = records(evidence, "accessibility").filter(
    (record) => record.details.action === "fail",
  );
  if (accessibility.length > 0) {
    return conclusion(evidence, {
      summary:
        "The test failed because the accessibility policy found a critical or serious violation.",
      category: "accessibility-failure",
      confidence: "high",
      cause:
        "A policy-failing accessibility rule is present in the scanned page content.",
      evidenceIds: accessibility.map((record) => record.id),
      action:
        "Review the cited accessibility rule and update the application design or theme while preserving the test policy.",
      owner: "accessibility-owner",
    });
  }
  const readiness = records(evidence, "readiness").filter(
    (record) => record.details.status === "fail",
  );
  if (readiness.length > 0) {
    return conclusion(evidence, {
      summary: "The page did not reach its declared business-ready state.",
      category: "page-readiness-failure",
      confidence: "high",
      cause:
        "A declared page-readiness criterion failed before the business assertion completed.",
      evidenceIds: readiness.map((record) => record.id),
      action:
        "Investigate the page state and the cited readiness criterion before reviewing business assertions.",
      owner: "developer",
    });
  }
  const assertions = records(evidence, "assertion");
  const errorText = assertions.map((record) => record.summary).join(" ");
  const networkAligned =
    assertions.length === 0 ||
    /network|request|response|server|http|navigation|fetch|connection/iu.test(
      errorText,
    );
  const http500 = records(evidence, "http-response").filter(hasStatus500);
  if (http500.length > 0 && networkAligned) {
    return conclusion(evidence, {
      summary:
        "The application returned one or more server error responses during the failed test.",
      category: "application-defect",
      confidence: "medium",
      cause: "An HTTP server error aligns with the failed browser journey.",
      evidenceIds: http500.map((record) => record.id),
      action:
        "Investigate the cited server responses and application service health without weakening the assertion.",
      owner: "developer",
    });
  }
  const requests = records(evidence, "failed-request");
  if (requests.length > 0 && networkAligned) {
    return conclusion(evidence, {
      summary:
        "One or more browser requests failed to complete during the test.",
      category: "network-failure",
      confidence: "medium",
      cause:
        "A failed network request may have prevented the expected UI state.",
      evidenceIds: requests.map((record) => record.id),
      action:
        "Investigate the cited request failure and target service availability.",
      owner: "environment",
    });
  }
  const pageErrors = records(evidence, "page-error");
  if (pageErrors.length > 0) {
    return conclusion(evidence, {
      summary:
        "An unhandled browser page error occurred during the failed test.",
      category: "browser-error",
      confidence: "medium",
      cause:
        "An uncaught page error may have interrupted the expected UI behavior.",
      evidenceIds: pageErrors.map((record) => record.id),
      action:
        "Investigate the cited browser error and the application code path that produced it.",
      owner: "developer",
    });
  }
  if (
    /strict mode violation|waiting for (?:getBy|locator)|element (?:was )?not found|locator.+(?:not found|resolved to)/iu.test(
      errorText,
    )
  ) {
    return conclusion(evidence, {
      summary: "Playwright could not resolve the expected UI element reliably.",
      category: "locator-failure",
      confidence: "medium",
      cause: "The Playwright error reports an unresolved or ambiguous locator.",
      evidenceIds: assertions.map((record) => record.id),
      action:
        "Review the page state and semantic locator contract; change a locator only after confirming the application behavior.",
      owner: "tester",
      locatorStatus: "review-recommended",
      locatorReason:
        "The Playwright error directly identifies locator resolution as the failed operation.",
    });
  }
  if (assertions.length > 0) {
    return conclusion(evidence, {
      summary:
        "A Playwright assertion did not match the observed application state.",
      category: "assertion-failure",
      confidence: "low",
      cause:
        "The assertion failed, but the supplied evidence does not establish a more specific cause.",
      evidenceIds: assertions.map((record) => record.id),
      action:
        "Compare the cited assertion with the application state and supporting diagnostics before changing test code.",
      owner: "tester",
    });
  }
  const metadata = records(evidence, "metadata");
  return conclusion(evidence, {
    summary: "The supplied evidence is insufficient to classify the failure.",
    category: "unknown",
    confidence: "low",
    cause:
      "No assertion, readiness, network, browser, or accessibility failure record was available.",
    evidenceIds: metadata.map((record) => record.id),
    action:
      "Collect the missing structured evidence and investigate the original Playwright result.",
    owner: "unknown",
  });
}
