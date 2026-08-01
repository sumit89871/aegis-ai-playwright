import type {
  LocatorOperation,
  LocatorTargetIntent,
} from "./locator-failure-classifier.ts";

export const LOCATOR_CANDIDATE_STRATEGIES = [
  "role",
  "label",
  "placeholder",
  "test-id",
  "text",
  "alt-text",
  "title",
  "stable-id",
  "scoped-css",
  "unsupported",
] as const;
export type LocatorCandidateStrategy =
  (typeof LOCATOR_CANDIDATE_STRATEGIES)[number];
export type LocatorCandidateStability = "high" | "medium" | "low";

export interface LocatorCandidate {
  readonly candidateId: string;
  readonly strategy: LocatorCandidateStrategy;
  readonly role?: string;
  readonly name?: string;
  readonly value?: string;
  readonly exact: boolean;
  readonly scopeHint: string | null;
  readonly tagName: string;
  readonly matchCount: number | null;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly editable: boolean;
  readonly hasBoundingBox: boolean;
  readonly deterministicScore: number;
  readonly stability: LocatorCandidateStability;
  readonly rationale: readonly string[];
  readonly countError?: string;
}

export interface LocatorCandidateInventory {
  readonly status: "collected" | "unavailable" | "not-requested";
  readonly candidates: readonly LocatorCandidate[];
  readonly droppedCandidateCount: number;
  readonly scannedElementCount: number;
  readonly intent: LocatorTargetIntent;
  readonly error?: string;
}

export interface CandidateScoreInput extends Omit<
  LocatorCandidate,
  "candidateId" | "deterministicScore" | "stability" | "rationale"
> {
  readonly weakAccessibleNameApproximation?: boolean;
}

const STRATEGY_ORDER: Readonly<Record<LocatorCandidateStrategy, number>> =
  Object.freeze({
    role: 0,
    label: 1,
    "test-id": 2,
    placeholder: 3,
    "alt-text": 4,
    title: 5,
    text: 6,
    "stable-id": 7,
    "scoped-css": 8,
    unsupported: 9,
  });

export function locatorCandidateSortKey(
  candidate: Omit<LocatorCandidate, "candidateId">,
): string {
  return `${String(999 - candidate.deterministicScore).padStart(3, "0")}\u0000${String(STRATEGY_ORDER[candidate.strategy]).padStart(2, "0")}\u0000${candidate.role ?? ""}\u0000${candidate.name ?? candidate.value ?? ""}`;
}

export function formatLocatorCandidate(candidate: LocatorCandidate): string {
  const literal = (value: string): string => JSON.stringify(value);
  const unsafe = (value: string | undefined): boolean =>
    value !== undefined &&
    (/(?:xpath=|\/\/\w|\.nth\(|\.first\(|\.last\()/iu.test(value) ||
      value.length > 300);
  if (
    candidate.strategy === "unsupported" ||
    unsafe(candidate.name) ||
    unsafe(candidate.value) ||
    unsafe(candidate.role)
  ) {
    throw new Error(
      "Unsupported or unsafe locator strategies cannot be formatted.",
    );
  }
  switch (candidate.strategy) {
    case "role":
      return `page.getByRole(${literal(candidate.role ?? "")}, { name: ${literal(candidate.name ?? "")}, exact: true })`;
    case "label":
      return `page.getByLabel(${literal(candidate.value ?? "")}, { exact: true })`;
    case "placeholder":
      return `page.getByPlaceholder(${literal(candidate.value ?? "")}, { exact: true })`;
    case "test-id":
      return `page.getByTestId(${literal(candidate.value ?? "")})`;
    case "text":
      return `page.getByText(${literal(candidate.value ?? "")}, { exact: true })`;
    case "alt-text":
      return `page.getByAltText(${literal(candidate.value ?? "")}, { exact: true })`;
    case "title":
      return `page.getByTitle(${literal(candidate.value ?? "")}, { exact: true })`;
    case "stable-id":
      return `page.locator(${literal(`[id=${JSON.stringify(candidate.value ?? "")}]`)})`;
    case "scoped-css":
      return `page.locator(${literal(candidate.value ?? "")})`;
  }
}

export function operationRequiresEnabled(operation: LocatorOperation): boolean {
  return ["click", "fill", "check", "select"].includes(operation);
}
