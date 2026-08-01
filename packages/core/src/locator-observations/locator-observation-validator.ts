import { containsSensitiveUrlData } from "../diagnostics/redaction.ts";
import { LOCATOR_CANDIDATE_STRATEGIES } from "../locator-diagnosis/locator-candidate.ts";
import type { LocatorCandidate } from "../locator-diagnosis/locator-candidate.ts";
import { validateLocatorDiagnosisConclusion } from "../locator-diagnosis/locator-diagnosis-validator.ts";
import {
  createLocatorObservationId,
  LOCATOR_OBSERVATION_SCHEMA_VERSION,
  LOCATOR_OBSERVATION_SOURCE_TYPES,
  type LocatorObservation,
} from "./locator-observation.ts";

const OBSERVATION_ID = /^LOC-OBS-[A-F0-9]{16}$/u;
const ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CANDIDATE_ID = /^LOCATOR-\d{3}$/u;
const ABSOLUTE_PATH =
  /(?:\b[A-Za-z]:[\\/]|\\\\[^\\\s]+\\[^\\\s]+|(?:^|[\s('"`])\/(?!\/)(?:[^/\s]+\/)+[^\s]*)/u;
const UNSAFE_CONTENT =
  /(?:authorization\s*[:=]|bearer\s+|api[_-]?key\s*[:=]|password\s*[:=]|cookie\s*[:=]|<\/?(?:html|body|input|script|style)\b|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;

function fail(message: string): never {
  throw new Error(`Invalid locator observation: ${message}`);
}

function onlyKeys(
  value: object,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail(`${field}.${unknown} is unsupported.`);
}

function safeText(value: unknown, field: string, maximum = 1_000): string {
  if (typeof value !== "string" || value.length > maximum)
    return fail(`${field} must be bounded text.`);
  const inspected = value
    .replace(
      /\b(?:authorization|api[_-]?key|password|cookie)\s*[:=]\s*\[REDACTED\]/giu,
      "[REDACTED]",
    )
    .replace(
      /\[(?:REDACTED|REDACTED_EMAIL|LOCAL_PATH_REMOVED|DOM_SNIPPET_REMOVED)\]/gu,
      "",
    );
  if (
    ABSOLUTE_PATH.test(inspected) ||
    UNSAFE_CONTENT.test(inspected) ||
    EMAIL.test(inspected) ||
    containsSensitiveUrlData(inspected)
  )
    return fail(`${field} contains private or unsafe content.`);
  return value;
}

function safeStringArray(
  value: unknown,
  field: string,
  maximumEntries = 50,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumEntries)
    return fail(`${field} must be a bounded array.`);
  const values = value.map((entry, index) =>
    safeText(entry, `${field}[${String(index)}]`, 300),
  );
  return Object.freeze([...new Set(values)].sort());
}

export function validateLocatorObservation(value: unknown): LocatorObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail("observation must be a plain object.");
  const clone = structuredClone(value as LocatorObservation);
  onlyKeys(
    clone,
    [
      "observationId",
      "schemaVersion",
      "applicationAlias",
      "sourceType",
      "failure",
      "pageReadinessState",
      "targetIntent",
      "candidateCollectionStatus",
      "candidateInventory",
      "droppedCandidateCount",
      "deterministicDiagnosis",
      "provenance",
      "missingEvidence",
      "collectionLimitations",
    ],
    "observation",
  );
  if (
    (clone as { readonly schemaVersion: string }).schemaVersion !==
    LOCATOR_OBSERVATION_SCHEMA_VERSION
  )
    return fail("schemaVersion is unsupported.");
  if (!OBSERVATION_ID.test(clone.observationId))
    return fail("observationId is invalid.");
  if (!ALIAS.test(clone.applicationAlias) || clone.applicationAlias.length > 60)
    return fail("applicationAlias must be a bounded lowercase slug.");
  if (!LOCATOR_OBSERVATION_SOURCE_TYPES.includes(clone.sourceType))
    return fail("sourceType is unsupported.");
  onlyKeys(
    clone.failure,
    [
      "errorMessage",
      "pageReady",
      "pageReadinessReason",
      "pageAvailable",
      "projectName",
      "retry",
      "testId",
      "feature",
      "requirementIds",
    ],
    "failure",
  );
  onlyKeys(
    clone.targetIntent,
    ["operation", "strategy", "role", "name", "value", "locatorDescription"],
    "targetIntent",
  );
  onlyKeys(
    clone.provenance,
    [
      "mode",
      "deterministicAnalysisUsed",
      "candidateCollectionStatus",
      "candidatesCollected",
      "candidatesDropped",
      "fallbackUsed",
      "conflictDetected",
      "lifecycleOutcome",
    ],
    "provenance",
  );
  safeText(clone.failure.errorMessage ?? "", "failure.errorMessage");
  if (clone.failure.pageUrl !== undefined)
    return fail("application URLs must not be retained.");
  for (const [field, entry] of [
    ["failure.pageReadinessReason", clone.failure.pageReadinessReason],
    ["failure.projectName", clone.failure.projectName],
    ["failure.testId", clone.failure.testId],
    ["failure.feature", clone.failure.feature],
    ["targetIntent.locatorDescription", clone.targetIntent.locatorDescription],
    ["targetIntent.name", clone.targetIntent.name],
    ["targetIntent.value", clone.targetIntent.value],
  ] as const)
    if (entry !== undefined) safeText(entry, field, 300);
  safeStringArray(clone.failure.requirementIds ?? [], "failure.requirementIds");
  if (
    !Array.isArray(clone.candidateInventory) ||
    clone.candidateInventory.length > 100
  )
    return fail("candidateInventory must be bounded.");
  const candidateIds = new Set<string>();
  const candidates: readonly LocatorCandidate[] = clone.candidateInventory;
  for (const candidate of candidates) {
    onlyKeys(
      candidate,
      [
        "candidateId",
        "strategy",
        "role",
        "name",
        "value",
        "exact",
        "scopeHint",
        "tagName",
        "matchCount",
        "visible",
        "enabled",
        "editable",
        "hasBoundingBox",
        "deterministicScore",
        "stability",
        "rationale",
        "countError",
      ],
      "candidate",
    );
    if (!CANDIDATE_ID.test(candidate.candidateId))
      return fail("candidate ID is invalid.");
    if (candidateIds.has(candidate.candidateId))
      return fail("candidate IDs must be unique.");
    candidateIds.add(candidate.candidateId);
    if (!LOCATOR_CANDIDATE_STRATEGIES.includes(candidate.strategy))
      return fail("candidate strategy is unsupported.");
    for (const [field, entry] of Object.entries(candidate)) {
      if (typeof entry === "string") safeText(entry, `candidate.${field}`, 500);
      if (Array.isArray(entry)) safeStringArray(entry, `candidate.${field}`);
    }
  }
  const deterministicDiagnosis = validateLocatorDiagnosisConclusion(
    clone.deterministicDiagnosis,
    [...candidateIds],
  );
  safeStringArray(clone.missingEvidence, "missingEvidence");
  safeStringArray(clone.collectionLimitations, "collectionLimitations");
  if (
    !Number.isInteger(clone.droppedCandidateCount) ||
    clone.droppedCandidateCount < 0
  )
    return fail("droppedCandidateCount must be a non-negative integer.");
  const normalized = { ...clone, deterministicDiagnosis };
  const expectedId = createLocatorObservationId(normalized);
  if (expectedId !== clone.observationId)
    return fail("observationId does not match sanitized content.");
  return Object.freeze(normalized);
}
