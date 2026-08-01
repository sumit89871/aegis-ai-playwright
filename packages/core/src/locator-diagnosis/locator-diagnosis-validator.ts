import { containsSensitiveUrlData } from "../diagnostics/redaction.ts";
import { LOCATOR_RECOMMENDATION_STATUSES } from "./locator-diagnosis.ts";
import type { LocatorDiagnosisConclusion } from "./locator-diagnosis.ts";
import { LOCATOR_FAILURE_CLASSIFICATIONS } from "./locator-failure-classifier.ts";

const SAFE_TEXT_LIMIT = 1_000;
const UNSAFE =
  /(?:```|<\/?[a-z][^>]*>|\b(?:powershell|cmd\.exe|bash|sh\s+-c|git\s+(?:apply|checkout|reset)|rm\s+-|del\s+\/|force\s*:\s*true|page\.getby|page\.locator|locator\(|\.nth\(|\.first\(|\.last\(|xpath=|\/\/\w|eval\(|child_process|begin patch|authorization\s*:|bearer\s+))/iu;
const ABSOLUTE_PATH =
  /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/[^/\s]+)/u;

function fail(reason: string): never {
  throw new Error(`Invalid locator-diagnosis result: ${reason}`);
}
function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > SAFE_TEXT_LIMIT
  )
    return fail(`${field} must be bounded non-empty text.`);
  if (
    UNSAFE.test(value) ||
    ABSOLUTE_PATH.test(value) ||
    containsSensitiveUrlData(value)
  )
    return fail(`${field} contains unsafe content.`);
  return value;
}
function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 50)
    return fail(`${field} must be a bounded array.`);
  return value;
}

export function validateLocatorDiagnosisConclusion(
  value: unknown,
  candidateIds: readonly string[],
): LocatorDiagnosisConclusion {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail("result must be a plain object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "classification",
    "confidence",
    "recommendationStatus",
    "summary",
    "originalLocatorAssessment",
    "pageStateAssessment",
    "rankedCandidates",
    "recommendedNextStep",
    "missingEvidence",
    "limitations",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    return fail("unsupported fields were returned.");
  if (!LOCATOR_FAILURE_CLASSIFICATIONS.includes(input.classification as never))
    return fail("classification is unsupported.");
  if (!["high", "medium", "low"].includes(input.confidence as string))
    return fail("confidence is unsupported.");
  if (
    !LOCATOR_RECOMMENDATION_STATUSES.includes(
      input.recommendationStatus as never,
    )
  )
    return fail("recommendationStatus is unsupported.");
  text(input.summary, "summary");
  text(input.recommendedNextStep, "recommendedNextStep");
  const original = input.originalLocatorAssessment as
    Record<string, unknown> | undefined;
  const page = input.pageStateAssessment as Record<string, unknown> | undefined;
  if (original === undefined || typeof original !== "object")
    return fail("originalLocatorAssessment is required.");
  text(original.strategy, "originalLocatorAssessment.strategy");
  text(original.issue, "originalLocatorAssessment.issue");
  if (
    page === undefined ||
    typeof page !== "object" ||
    ![true, false, null].includes(page.ready as never)
  )
    return fail("pageStateAssessment is invalid.");
  text(page.reason, "pageStateAssessment.reason");
  const known = new Set(candidateIds);
  const ranks = new Set<number>();
  const rankedCandidates = array(
    input.rankedCandidates,
    "rankedCandidates",
  ).map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      return fail(`rankedCandidates[${String(index)}] is invalid.`);
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.candidateId !== "string" ||
      !known.has(candidate.candidateId)
    )
      return fail("ranked candidate references an unknown candidate ID.");
    if (
      typeof candidate.rank !== "number" ||
      !Number.isInteger(candidate.rank) ||
      candidate.rank < 1 ||
      ranks.has(candidate.rank)
    )
      return fail("candidate ranks must be unique positive integers.");
    ranks.add(candidate.rank);
    if (!["high", "medium", "low"].includes(candidate.confidence as string))
      return fail("candidate confidence is unsupported.");
    return Object.freeze({
      candidateId: candidate.candidateId,
      rank: candidate.rank,
      confidence: candidate.confidence as "high" | "medium" | "low",
      reason: text(candidate.reason, "candidate.reason"),
    });
  });
  const safeStrings = (
    field: "missingEvidence" | "limitations",
  ): readonly string[] =>
    Object.freeze(
      array(input[field], field).map((entry, index) =>
        text(entry, `${field}[${String(index)}]`),
      ),
    );
  return Object.freeze({
    classification:
      input.classification as LocatorDiagnosisConclusion["classification"],
    confidence: input.confidence as LocatorDiagnosisConclusion["confidence"],
    recommendationStatus:
      input.recommendationStatus as LocatorDiagnosisConclusion["recommendationStatus"],
    summary: input.summary as string,
    originalLocatorAssessment: Object.freeze({
      strategy: original.strategy as string,
      issue: original.issue as string,
    }),
    pageStateAssessment: Object.freeze({
      ready: page.ready as boolean | null,
      reason: page.reason as string,
    }),
    rankedCandidates: Object.freeze(
      rankedCandidates.sort((left, right) => left.rank - right.rank),
    ),
    recommendedNextStep: input.recommendedNextStep as string,
    missingEvidence: safeStrings("missingEvidence"),
    limitations: safeStrings("limitations"),
  });
}

export function isValidLocatorDiagnosisConclusion(
  value: unknown,
  candidateIds: readonly string[],
): boolean {
  try {
    validateLocatorDiagnosisConclusion(value, candidateIds);
    return true;
  } catch {
    return false;
  }
}
