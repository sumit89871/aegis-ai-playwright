import type { LocatorCandidateInventory } from "./locator-candidate.ts";
import type {
  LocatorDiagnosisConclusion,
  RankedLocatorCandidate,
} from "./locator-diagnosis.ts";
import type { LocatorFailureEvidence } from "./locator-evidence.ts";

const NO_CHANGE = new Set([
  "element-not-visible",
  "element-not-enabled",
  "element-not-editable",
  "element-detached",
  "element-not-stable",
  "action-obstructed",
  "page-not-ready",
  "page-closed",
  "action-timeout",
]);

function ranked(
  inventory: LocatorCandidateInventory,
): readonly RankedLocatorCandidate[] {
  return Object.freeze(
    inventory.candidates.slice(0, 10).map((candidate, index) =>
      Object.freeze({
        candidateId: candidate.candidateId,
        rank: index + 1,
        confidence:
          candidate.deterministicScore >= 80
            ? "high"
            : candidate.deterministicScore >= 55
              ? "medium"
              : "low",
        reason: candidate.rationale.join(" "),
      }),
    ),
  );
}

export function diagnoseLocatorDeterministically(
  evidence: LocatorFailureEvidence,
  inventory: LocatorCandidateInventory,
): LocatorDiagnosisConclusion {
  const base = {
    classification: evidence.classification,
    originalLocatorAssessment: Object.freeze({
      strategy: evidence.originalLocatorStrategy,
      issue: evidence.errorMessage,
    }),
    pageStateAssessment: Object.freeze({
      ready: evidence.pageReady,
      reason:
        evidence.pageReadinessReason ??
        (evidence.pageReady === false
          ? "Page readiness did not pass."
          : "No page-readiness failure was supplied."),
    }),
  } as const;
  if (evidence.classification === "not-a-locator-failure")
    return Object.freeze({
      ...base,
      confidence: "high",
      recommendationStatus: "not-applicable",
      summary: "The failure is not locator-related.",
      rankedCandidates: Object.freeze([]),
      recommendedNextStep: "Investigate the original non-locator failure.",
      missingEvidence: Object.freeze([]),
      limitations: Object.freeze([
        "Locator diagnosis intentionally did not inspect the page.",
      ]),
    });
  if (NO_CHANGE.has(evidence.classification))
    return Object.freeze({
      ...base,
      confidence: evidence.confidence,
      recommendationStatus: "no-change-recommended",
      summary:
        "The evidence indicates application state, readiness, or lifecycle rather than a selector replacement.",
      rankedCandidates: Object.freeze([]),
      recommendedNextStep:
        evidence.classification === "action-obstructed"
          ? "Investigate overlays, animations, and application state; do not force the action."
          : "Investigate the application state or readiness condition before changing the locator.",
      missingEvidence: Object.freeze([]),
      limitations: Object.freeze([
        "No replacement locator is recommended from this evidence.",
      ]),
    });
  if (inventory.status === "unavailable")
    return Object.freeze({
      ...base,
      confidence: "low",
      recommendationStatus: "collection-unavailable",
      summary:
        "Locator evidence was detected, but the page inventory could not be collected.",
      rankedCandidates: Object.freeze([]),
      recommendedNextStep:
        "Review the original failure and collect candidates while the page remains open.",
      missingEvidence: Object.freeze(["candidate inventory"]),
      limitations: Object.freeze([
        inventory.error ?? "Candidate collection was unavailable.",
      ]),
    });
  const suggestions = ranked(inventory);
  if (suggestions.length === 0)
    return Object.freeze({
      ...base,
      confidence: "low",
      recommendationStatus: "insufficient-evidence",
      summary: "No safe locator candidates were available.",
      rankedCandidates: suggestions,
      recommendedNextStep:
        "Inspect page readiness and the intended element semantics manually.",
      missingEvidence: Object.freeze(["safe matching candidates"]),
      limitations: Object.freeze(["No candidate is known to be correct."]),
    });
  const [firstCandidate, secondCandidate] = inventory.candidates;
  if (
    secondCandidate !== undefined &&
    firstCandidate?.deterministicScore === secondCandidate.deterministicScore
  )
    return Object.freeze({
      ...base,
      confidence: "low",
      recommendationStatus: "insufficient-evidence",
      summary:
        "The strongest locator candidates are equally ranked, so no replacement can be preferred safely.",
      rankedCandidates: suggestions,
      recommendedNextStep:
        "Add business intent or a meaningful scope before selecting a replacement locator.",
      missingEvidence: Object.freeze(["disambiguating target intent"]),
      limitations: Object.freeze([
        "Equal deterministic scores do not establish which element is correct.",
      ]),
    });
  return Object.freeze({
    ...base,
    confidence: suggestions[0]?.confidence ?? "low",
    recommendationStatus: "candidates-available",
    summary:
      evidence.classification === "strict-mode-violation" ||
      evidence.classification === "selector-multiple-match"
        ? "The original locator is ambiguous; unique semantic alternatives are ranked for review."
        : "Safe semantic alternatives are ranked for manual review.",
    rankedCandidates: suggestions,
    recommendedNextStep:
      "Review the highest-ranked semantic candidate in the Page Object; do not apply it automatically.",
    missingEvidence: Object.freeze([]),
    limitations: Object.freeze([
      "A ranked candidate is advisory and is not proof of business intent.",
    ]),
  });
}
