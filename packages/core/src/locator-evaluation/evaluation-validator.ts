import { containsSensitiveUrlData } from "../diagnostics/redaction.ts";
import {
  LOCATOR_CANDIDATE_STRATEGIES,
  MAX_LOCATOR_CANDIDATES,
} from "../locator-diagnosis/locator-candidate.ts";
import { LOCATOR_RECOMMENDATION_STATUSES } from "../locator-diagnosis/locator-diagnosis.ts";
import { LOCATOR_FAILURE_CLASSIFICATIONS } from "../locator-diagnosis/locator-failure-classifier.ts";
import {
  LOCATOR_EVALUATION_CATEGORIES,
  LOCATOR_EVALUATION_SOURCE_TYPES,
} from "./evaluation-case.ts";
import type {
  LocatorEvaluationCase,
  LocatorEvaluationDataset,
} from "./evaluation-case.ts";

const VERSION = /^\d+\.\d+\.\d+$/u;
const CASE_ID = /^LOC-EVAL-(?:CAL|VAL)-\d{3}$/u;
const CANDIDATE_ID = /^LOCATOR-\d{3}$/u;
const ABSOLUTE_PATH =
  /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/[^/\s]+)/u;
const SECRET_OR_HTML =
  /(?:authorization\s*:|bearer\s+|api[_-]?key\s*[=:]|password\s*[=:]|<\/?(?:html|body|input|button|script)\b)/iu;

function fail(message: string): never {
  throw new Error(`Invalid locator-evaluation data: ${message}`);
}

function boundedText(value: unknown, field: string, maximum = 1_000): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  )
    return fail(`${field} must be bounded non-empty text.`);
  if (
    ABSOLUTE_PATH.test(value) ||
    SECRET_OR_HTML.test(value) ||
    containsSensitiveUrlData(value)
  )
    return fail(`${field} contains unsafe content.`);
  return value;
}

function uniqueStrings(
  value: unknown,
  field: string,
  maximum = 30,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum)
    return fail(`${field} must be a bounded array.`);
  const entries = value.map((entry, index) =>
    boundedText(entry, `${field}[${String(index)}]`, 160),
  );
  if (new Set(entries).size !== entries.length)
    return fail(`${field} must contain unique values.`);
  return Object.freeze([...entries].sort());
}

function isBoundedArray(value: unknown, maximum: number): boolean {
  return Array.isArray(value) && value.length <= maximum;
}

export function validateLocatorEvaluationCase(
  value: LocatorEvaluationCase,
): LocatorEvaluationCase {
  const clone = structuredClone(value);
  if (!CASE_ID.test(clone.caseId)) return fail("caseId is invalid.");
  boundedText(clone.title, "title", 200);
  boundedText(clone.description, "description", 500);
  if (!LOCATOR_EVALUATION_CATEGORIES.includes(clone.category))
    return fail("category is unsupported.");
  if (!LOCATOR_EVALUATION_SOURCE_TYPES.includes(clone.sourceType))
    return fail("sourceType is unsupported.");
  if (!VERSION.test(clone.datasetVersion))
    return fail("datasetVersion must be semantic version text.");
  if (!LOCATOR_FAILURE_CLASSIFICATIONS.includes(clone.expected.classification))
    return fail("expected classification is unsupported.");
  if (
    !LOCATOR_RECOMMENDATION_STATUSES.includes(
      clone.expected.recommendationStatus,
    )
  )
    return fail("expected recommendation status is unsupported.");
  if (!["high", "medium", "low"].includes(clone.expected.minimumConfidence))
    return fail("expected minimum confidence is unsupported.");
  if (!isBoundedArray(clone.input.candidates, MAX_LOCATOR_CANDIDATES))
    return fail(
      `input candidates must contain at most ${String(MAX_LOCATOR_CANDIDATES)} entries.`,
    );
  const candidateIds = clone.input.candidates.map(({ candidateId }) => {
    if (!CANDIDATE_ID.test(candidateId)) return fail("candidateId is invalid.");
    return candidateId;
  });
  if (new Set(candidateIds).size !== candidateIds.length)
    return fail("candidate IDs must be unique within a case.");
  for (const candidate of clone.input.candidates) {
    if (!LOCATOR_CANDIDATE_STRATEGIES.includes(candidate.descriptor.strategy))
      return fail("candidate strategy is unsupported.");
    if (["unsupported"].includes(candidate.descriptor.strategy))
      return fail("unsupported candidates cannot enter an evaluation pack.");
    const serialized = JSON.stringify(candidate);
    if (/(?:xpath=|\/\/\w|\.nth\(|\.first\(|\.last\()/iu.test(serialized))
      return fail("XPath and positional candidates are prohibited.");
    if (SECRET_OR_HTML.test(serialized) || ABSOLUTE_PATH.test(serialized))
      return fail("candidate data contains unsafe content.");
  }
  const acceptable = uniqueStrings(
    clone.expected.acceptableCandidateIds,
    "acceptableCandidateIds",
    MAX_LOCATOR_CANDIDATES,
  );
  const preferred = uniqueStrings(
    clone.expected.preferredCandidateIds,
    "preferredCandidateIds",
    MAX_LOCATOR_CANDIDATES,
  );
  const forbidden = uniqueStrings(
    clone.expected.forbiddenCandidateIds,
    "forbiddenCandidateIds",
    MAX_LOCATOR_CANDIDATES,
  );
  for (const id of [...acceptable, ...forbidden])
    if (!candidateIds.includes(id))
      return fail("expected candidate IDs must exist in the inventory.");
  for (const id of preferred)
    if (!acceptable.includes(id))
      return fail("preferred candidates must also be acceptable.");
  if (acceptable.some((id) => forbidden.includes(id)))
    return fail("a candidate cannot be acceptable and forbidden.");
  if (
    clone.expected.locatorChangeAllowed &&
    clone.expected.recommendationStatus !== "candidates-available"
  )
    return fail("locator-change cases must expect candidates-available.");
  if (!clone.expected.locatorChangeAllowed && acceptable.length > 0)
    return fail("no-change cases cannot define acceptable replacements.");
  boundedText(clone.input.failure.errorMessage, "input.failure.errorMessage");
  if (clone.input.originalLocatorDescription !== undefined)
    boundedText(
      clone.input.originalLocatorDescription,
      "input.originalLocatorDescription",
      300,
    );
  for (const [field, text] of Object.entries(clone.humanReview))
    boundedText(text, `humanReview.${field}`, 600);
  const tags = uniqueStrings(clone.tags, "tags");
  return Object.freeze({
    ...clone,
    tags,
    input: Object.freeze({
      ...clone.input,
      candidates: Object.freeze(clone.input.candidates),
    }),
    expected: Object.freeze({
      ...clone.expected,
      acceptableCandidateIds: acceptable,
      preferredCandidateIds: preferred,
      forbiddenCandidateIds: forbidden,
    }),
    humanReview: Object.freeze(clone.humanReview),
  });
}

export function validateLocatorEvaluationDataset(
  value: LocatorEvaluationDataset,
): LocatorEvaluationDataset {
  if (!["calibration", "validation"].includes(value.id))
    return fail("dataset id is unsupported.");
  if (!VERSION.test(value.version)) return fail("dataset version is invalid.");
  boundedText(value.description, "dataset.description", 500);
  if (!Array.isArray(value.cases) || value.cases.length < 1)
    return fail("dataset must contain reviewed cases.");
  const cases = value.cases.map(validateLocatorEvaluationCase);
  const ids = cases.map(({ caseId }) => caseId);
  if (new Set(ids).size !== ids.length)
    return fail("dataset case IDs must be unique.");
  if (cases.some(({ datasetVersion }) => datasetVersion !== value.version))
    return fail("case datasetVersion must match its dataset.");
  return Object.freeze({
    ...structuredClone(value),
    cases: Object.freeze(
      [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId)),
    ),
  });
}
