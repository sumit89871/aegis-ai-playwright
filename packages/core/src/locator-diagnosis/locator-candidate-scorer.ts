import { redactSensitiveText } from "../diagnostics/redaction.ts";
import type {
  CandidateScoreInput,
  LocatorCandidate,
  LocatorCandidateStrategy,
} from "./locator-candidate.ts";
import {
  locatorCandidateSortKey,
  MAX_LOCATOR_CANDIDATES,
  operationRequiresEnabled,
} from "./locator-candidate.ts";
import type { LocatorTargetIntent } from "./locator-failure-classifier.ts";

const BASE_SCORE: Readonly<Record<LocatorCandidateStrategy, number>> =
  Object.freeze({
    role: 68,
    label: 66,
    "test-id": 63,
    placeholder: 56,
    "alt-text": 54,
    title: 50,
    text: 43,
    "stable-id": 48,
    "scoped-css": 24,
    unsupported: 0,
  });

function comparable(value: string | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function intentMatches(
  candidate: CandidateScoreInput,
  intent: LocatorTargetIntent,
): boolean {
  const target = comparable(intent.name ?? intent.value);
  if (target.length < 2) return false;
  const candidateValue = comparable(candidate.name ?? candidate.value);
  return (
    candidateValue === target ||
    candidateValue.includes(target) ||
    target.includes(candidateValue)
  );
}

export function scoreLocatorCandidate(
  candidate: CandidateScoreInput,
  intent: LocatorTargetIntent,
): Omit<LocatorCandidate, "candidateId"> {
  let score = BASE_SCORE[candidate.strategy];
  const rationale: string[] = [`Uses ${candidate.strategy} locator strategy.`];
  if (candidate.matchCount === 1) {
    score += 15;
    rationale.push("Locator is unique on the current page.");
  } else if (candidate.matchCount !== null && candidate.matchCount > 1) {
    score -= Math.min(25, 8 + candidate.matchCount);
    rationale.push(
      `Locator currently matches ${String(candidate.matchCount)} elements.`,
    );
  } else if (candidate.matchCount === 0) {
    score -= 35;
    rationale.push("Locator does not match the current page.");
  } else {
    score -= 5;
    rationale.push("Locator uniqueness could not be measured.");
  }
  if (candidate.visible) {
    score += 5;
    rationale.push("Element is visible.");
  } else {
    score -= 20;
    rationale.push("Element is hidden.");
  }
  if (operationRequiresEnabled(intent.operation)) {
    if (candidate.enabled) {
      score += 4;
      rationale.push("Element is enabled for the attempted operation.");
    } else {
      score -= 18;
      rationale.push("Element is disabled for the attempted operation.");
    }
  }
  if (intent.operation === "fill") {
    if (candidate.editable) score += 5;
    else score -= 18;
  }
  if (intentMatches(candidate, intent)) {
    score += 10;
    rationale.push("Candidate meaning matches the inferred target hint.");
  }
  if (candidate.weakAccessibleNameApproximation === true) {
    score -= 5;
    rationale.push("Accessible name is a bounded approximation.");
  }
  const candidateText = candidate.name ?? candidate.value ?? "";
  if (candidateText.length > 80) {
    score -= 8;
    rationale.push("Candidate text is long and may be less stable.");
  }
  score = Math.max(0, Math.min(100, score));
  return Object.freeze({
    ...candidate,
    deterministicScore: score,
    stability: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
    rationale: Object.freeze(
      rationale.map((entry) => redactSensitiveText(entry, 200)),
    ),
  });
}

export function rankLocatorCandidates(
  candidates: readonly CandidateScoreInput[],
  intent: LocatorTargetIntent,
  maximumCandidates: number = MAX_LOCATOR_CANDIDATES,
): {
  readonly candidates: readonly LocatorCandidate[];
  readonly dropped: number;
} {
  if (
    !Number.isInteger(maximumCandidates) ||
    maximumCandidates < 1 ||
    maximumCandidates > MAX_LOCATOR_CANDIDATES
  )
    throw new Error(
      `maximumCandidates must be between 1 and ${String(MAX_LOCATOR_CANDIDATES)}.`,
    );
  const scored = candidates.map((candidate) =>
    scoreLocatorCandidate(candidate, intent),
  );
  const unique = new Map<string, Omit<LocatorCandidate, "candidateId">>();
  for (const candidate of scored) {
    const key = `${candidate.strategy}\u0000${candidate.role ?? ""}\u0000${candidate.name ?? candidate.value ?? ""}`;
    const existing = unique.get(key);
    if (
      existing === undefined ||
      candidate.deterministicScore > existing.deterministicScore
    )
      unique.set(key, candidate);
  }
  const ordered = [...unique.values()].sort((left, right) =>
    locatorCandidateSortKey(left).localeCompare(locatorCandidateSortKey(right)),
  );
  const retained = ordered.slice(0, maximumCandidates).map((candidate, index) =>
    Object.freeze({
      candidateId: `LOCATOR-${String(index + 1).padStart(3, "0")}`,
      ...candidate,
    }),
  );
  return Object.freeze({
    candidates: Object.freeze(retained),
    dropped: Math.max(0, ordered.length - retained.length),
  });
}
