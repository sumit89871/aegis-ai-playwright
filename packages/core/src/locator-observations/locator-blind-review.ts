import { createHash } from "node:crypto";

import type { LocatorCandidate } from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorDiagnosisConfidence,
  LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorFailureClassification } from "../locator-diagnosis/locator-failure-classifier.ts";
import {
  inspectLocatorObservationReview,
  LOCATOR_OBSERVATION_REVIEW_VERSION,
  LOCATOR_REVIEW_VALIDATION_CODES,
  type LocatorReviewSafeActualValue,
  type LocatorReviewValidationIssueCategory,
} from "./locator-observation-review-validation.ts";
import {
  canonicalLocatorObservationContent,
  type LocatorObservation,
} from "./locator-observation.ts";
import type {
  LocatorObservationReview,
  LocatorObservationReviewStatus,
} from "./locator-observation-review.ts";
import { validateLocatorObservation } from "./locator-observation-validator.ts";

export const LOCATOR_BLIND_PACKET_SCHEMA_VERSION = "1.0.0" as const;
export const LOCATOR_BLIND_MAPPING_SCHEMA_VERSION = "1.0.0" as const;
export const LOCATOR_BLIND_REVIEW_VERSION = "1.0.0" as const;
export const LOCATOR_BLIND_REVIEW_VALIDATION_CODES = Object.freeze([
  "BLIND_JSON_INVALID",
  "BLIND_LINK_INVALID",
  "BLIND_REVIEW_INVALID",
  "BLIND_REVIEW_UNKNOWN_FIELD",
  "BLIND_REVIEW_PACKET_ID_MISMATCH",
  "BLIND_REVIEW_CANDIDATE_SET_MISMATCH",
  ...LOCATOR_REVIEW_VALIDATION_CODES.map((code) => `BLIND_${code}`),
]);

const PACKET_ID = /^BLIND-PACKET-[A-F0-9]{16}$/u;
const BLIND_CANDIDATE_ID = /^BLIND-CANDIDATE-[0-9]{3}$/u;
const OBSERVATION_ID = /^LOC-OBS-[A-F0-9]{16}$/u;

export interface BlindLocatorCandidate {
  readonly blindCandidateId: string;
  readonly strategy: LocatorCandidate["strategy"];
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
}

export interface LocatorBlindReviewPacket {
  readonly schemaVersion: typeof LOCATOR_BLIND_PACKET_SCHEMA_VERSION;
  readonly blindPacketId: string;
  readonly observationId: string;
  readonly observationIntegrity: string;
  readonly applicationAlias: string;
  readonly sourceType: LocatorObservation["sourceType"];
  readonly failure: LocatorObservation["failure"];
  readonly pageReadinessState: boolean | null;
  readonly targetIntent: LocatorObservation["targetIntent"];
  readonly candidateCollectionStatus: LocatorObservation["candidateCollectionStatus"];
  readonly candidates: readonly BlindLocatorCandidate[];
}

export interface LocatorBlindCandidateMapping {
  readonly schemaVersion: typeof LOCATOR_BLIND_MAPPING_SCHEMA_VERSION;
  readonly blindPacketId: string;
  readonly observationId: string;
  readonly observationIntegrity: string;
  readonly packetIntegrity: string;
  readonly aliases: readonly {
    readonly blindCandidateId: string;
    readonly originalCandidateId: string;
  }[];
}

export interface LocatorBlindReview {
  readonly blindPacketId: string;
  readonly reviewStatus: LocatorObservationReviewStatus;
  readonly blindCandidateIds: readonly string[];
  readonly expectedClassification: LocatorFailureClassification | null;
  readonly expectedRecommendationStatus: LocatorRecommendationStatus | null;
  readonly acceptableBlindCandidateIds: readonly string[];
  readonly preferredBlindCandidateIds: readonly string[];
  readonly forbiddenBlindCandidateIds: readonly string[];
  readonly minimumAcceptableConfidence: LocatorDiagnosisConfidence | null;
  readonly reviewerRationale: string;
  readonly reviewVersion: typeof LOCATOR_BLIND_REVIEW_VERSION;
  readonly reviewNotes?: string;
}

export interface LocatorBlindReviewBundle {
  readonly packet: LocatorBlindReviewPacket;
  readonly mapping: LocatorBlindCandidateMapping;
  readonly review: LocatorBlindReview;
}

export interface LocatorBlindReviewInspection {
  readonly valid: boolean;
  readonly issues: readonly LocatorBlindReviewValidationIssue[];
  readonly review?: LocatorBlindReview;
}

export interface LocatorBlindReviewValidationIssue {
  readonly code: string;
  readonly category: LocatorReviewValidationIssueCategory;
  readonly fieldPath: string;
  readonly message: string;
  readonly suggestion: string;
  readonly line?: number;
  readonly column?: number;
  readonly actualValue?: LocatorReviewSafeActualValue;
  readonly allowedValues?: readonly string[];
}

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry === null || typeof entry !== "object") return entry;
    return Object.fromEntries(
      Object.entries(entry)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function createLocatorObservationIntegrity(
  observation: LocatorObservation,
): string {
  return createHash("sha256")
    .update(canonicalLocatorObservationContent(observation), "utf8")
    .digest("hex");
}

export function createLocatorBlindPacketIntegrity(
  packet: LocatorBlindReviewPacket,
): string {
  return digest(packet);
}

function publicCandidate(
  candidate: LocatorCandidate,
): Omit<BlindLocatorCandidate, "blindCandidateId"> {
  return Object.freeze({
    strategy: candidate.strategy,
    ...(candidate.role === undefined ? {} : { role: candidate.role }),
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
    exact: candidate.exact,
    scopeHint: candidate.scopeHint,
    tagName: candidate.tagName,
    matchCount: candidate.matchCount,
    visible: candidate.visible,
    enabled: candidate.enabled,
    editable: candidate.editable,
    hasBoundingBox: candidate.hasBoundingBox,
  });
}

function neutralCandidateOrder(
  observation: LocatorObservation,
): readonly LocatorCandidate[] {
  const source = [...observation.candidateInventory];
  const ordered = source.sort((left, right) => {
    const leftKey = digest({
      observationId: observation.observationId,
      candidate: publicCandidate(left),
    });
    const rightKey = digest({
      observationId: observation.observationId,
      candidate: publicCandidate(right),
    });
    return (
      leftKey.localeCompare(rightKey) ||
      left.candidateId.localeCompare(right.candidateId)
    );
  });
  if (
    ordered.length > 1 &&
    ordered.every(
      ({ candidateId }, index) =>
        candidateId === observation.candidateInventory[index]?.candidateId,
    )
  ) {
    const shifted = ordered.shift();
    if (shifted !== undefined) ordered.push(shifted);
  }
  return Object.freeze(ordered);
}

function failureEvidence(
  failure: LocatorObservation["failure"],
): LocatorObservation["failure"] {
  return Object.freeze({
    ...(failure.errorMessage === undefined
      ? {}
      : { errorMessage: failure.errorMessage }),
    ...(failure.pageUrl === undefined ? {} : { pageUrl: failure.pageUrl }),
    ...(failure.pageReady === undefined
      ? {}
      : { pageReady: failure.pageReady }),
    ...(failure.pageReadinessReason === undefined
      ? {}
      : { pageReadinessReason: failure.pageReadinessReason }),
    pageAvailable: failure.pageAvailable,
    ...(failure.projectName === undefined
      ? {}
      : { projectName: failure.projectName }),
    ...(failure.retry === undefined ? {} : { retry: failure.retry }),
    ...(failure.testId === undefined ? {} : { testId: failure.testId }),
    ...(failure.feature === undefined ? {} : { feature: failure.feature }),
    ...(failure.requirementIds === undefined
      ? {}
      : { requirementIds: Object.freeze([...failure.requirementIds]) }),
  });
}

function targetIntent(
  intent: LocatorObservation["targetIntent"],
): LocatorObservation["targetIntent"] {
  return Object.freeze({
    operation: intent.operation,
    strategy: intent.strategy,
    ...(intent.role === undefined ? {} : { role: intent.role }),
    ...(intent.name === undefined ? {} : { name: intent.name }),
    ...(intent.value === undefined ? {} : { value: intent.value }),
    ...(intent.locatorDescription === undefined
      ? {}
      : { locatorDescription: intent.locatorDescription }),
  });
}

export function createLocatorBlindReviewArtifacts(
  observationInput: LocatorObservation,
): LocatorBlindReviewBundle {
  const observation = validateLocatorObservation(observationInput);
  const observationIntegrity = createLocatorObservationIntegrity(observation);
  const ordered = neutralCandidateOrder(observation);
  const candidates = ordered.map((candidate, index) =>
    Object.freeze({
      blindCandidateId: `BLIND-CANDIDATE-${String(index + 1).padStart(3, "0")}`,
      ...publicCandidate(candidate),
    }),
  );
  const packetSeed = {
    schemaVersion: LOCATOR_BLIND_PACKET_SCHEMA_VERSION,
    observationId: observation.observationId,
    observationIntegrity,
    applicationAlias: observation.applicationAlias,
    sourceType: observation.sourceType,
    failure: failureEvidence(observation.failure),
    pageReadinessState: observation.pageReadinessState,
    targetIntent: targetIntent(observation.targetIntent),
    candidateCollectionStatus: observation.candidateCollectionStatus,
    candidates: Object.freeze(candidates),
  };
  const blindPacketId = `BLIND-PACKET-${digest(packetSeed).slice(0, 16).toUpperCase()}`;
  const packet: LocatorBlindReviewPacket = Object.freeze({
    ...packetSeed,
    blindPacketId,
  });
  const aliases = Object.freeze(
    ordered.map((candidate, index) =>
      Object.freeze({
        blindCandidateId: candidates[index]?.blindCandidateId as string,
        originalCandidateId: candidate.candidateId,
      }),
    ),
  );
  const mapping: LocatorBlindCandidateMapping = Object.freeze({
    schemaVersion: LOCATOR_BLIND_MAPPING_SCHEMA_VERSION,
    blindPacketId,
    observationId: observation.observationId,
    observationIntegrity,
    packetIntegrity: createLocatorBlindPacketIntegrity(packet),
    aliases,
  });
  const review: LocatorBlindReview = Object.freeze({
    blindPacketId,
    reviewStatus: "pending",
    blindCandidateIds: Object.freeze(
      candidates.map(({ blindCandidateId }) => blindCandidateId),
    ),
    expectedClassification: null,
    expectedRecommendationStatus: null,
    acceptableBlindCandidateIds: Object.freeze([]),
    preferredBlindCandidateIds: Object.freeze([]),
    forbiddenBlindCandidateIds: Object.freeze([]),
    minimumAcceptableConfidence: null,
    reviewerRationale: "",
    reviewVersion: LOCATOR_BLIND_REVIEW_VERSION,
  });
  return Object.freeze({ packet, mapping, review });
}

const PACKET_FIELDS = new Set([
  "schemaVersion",
  "blindPacketId",
  "observationId",
  "observationIntegrity",
  "applicationAlias",
  "sourceType",
  "failure",
  "pageReadinessState",
  "targetIntent",
  "candidateCollectionStatus",
  "candidates",
]);
const CANDIDATE_FIELDS = new Set([
  "blindCandidateId",
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
]);

function plain(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const firstUnknown = unknown.sort()[0];
  if (firstUnknown !== undefined)
    throw new Error(`${label} contains unsupported field ${firstUnknown}.`);
  const missing = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  const firstMissing = missing[0];
  if (firstMissing !== undefined)
    throw new Error(`${label} is missing required field ${firstMissing}.`);
}

export function validateLocatorBlindReviewPacket(
  value: unknown,
  observationInput?: LocatorObservation,
): LocatorBlindReviewPacket {
  if (!plain(value))
    throw new Error("Blind review packet must be a JSON object.");
  exactFields(value, PACKET_FIELDS, [...PACKET_FIELDS], "Blind review packet");
  if (value.schemaVersion !== LOCATOR_BLIND_PACKET_SCHEMA_VERSION)
    throw new Error("Blind review packet schema version is unsupported.");
  if (
    typeof value.blindPacketId !== "string" ||
    !PACKET_ID.test(value.blindPacketId)
  )
    throw new Error("Blind review packet ID is invalid.");
  if (
    typeof value.observationId !== "string" ||
    !OBSERVATION_ID.test(value.observationId)
  )
    throw new Error("Blind review packet observation ID is invalid.");
  if (
    typeof value.observationIntegrity !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.observationIntegrity)
  )
    throw new Error("Blind review packet observation integrity is invalid.");
  if (!Array.isArray(value.candidates) || value.candidates.length > 50)
    throw new Error("Blind review packet candidate inventory is invalid.");
  const aliases: string[] = [];
  for (const entry of value.candidates) {
    if (!plain(entry))
      throw new Error("Blind candidate must be a JSON object.");
    exactFields(
      entry,
      CANDIDATE_FIELDS,
      [
        "blindCandidateId",
        "strategy",
        "exact",
        "scopeHint",
        "tagName",
        "matchCount",
        "visible",
        "enabled",
        "editable",
        "hasBoundingBox",
      ],
      "Blind candidate",
    );
    if (
      typeof entry.blindCandidateId !== "string" ||
      !BLIND_CANDIDATE_ID.test(entry.blindCandidateId)
    )
      throw new Error("Blind candidate alias is invalid.");
    aliases.push(entry.blindCandidateId);
    for (const forbidden of [
      "candidateId",
      "deterministicScore",
      "stability",
      "rationale",
      "rankedCandidates",
    ])
      if (Object.prototype.hasOwnProperty.call(entry, forbidden))
        throw new Error(
          `Blind candidate exposes forbidden field ${forbidden}.`,
        );
  }
  if (new Set(aliases).size !== aliases.length)
    throw new Error("Blind candidate aliases must be unique.");
  const packet = structuredClone(value) as unknown as LocatorBlindReviewPacket;
  if (observationInput !== undefined) {
    const observation = validateLocatorObservation(observationInput);
    if (packet.observationId !== observation.observationId)
      throw new Error(
        "Blind packet does not link to the supplied observation.",
      );
    if (
      packet.observationIntegrity !==
      createLocatorObservationIntegrity(observation)
    )
      throw new Error(
        "Blind packet is stale because the source observation changed.",
      );
    const expected = createLocatorBlindReviewArtifacts(observation).packet;
    if (canonical(packet) !== canonical(expected))
      throw new Error(
        "Blind packet does not match its sanitized source observation.",
      );
  }
  return Object.freeze(packet);
}

export function validateLocatorBlindCandidateMapping(
  value: unknown,
  packetInput: LocatorBlindReviewPacket,
  observationInput: LocatorObservation,
): LocatorBlindCandidateMapping {
  const packet = validateLocatorBlindReviewPacket(
    packetInput,
    observationInput,
  );
  const observation = validateLocatorObservation(observationInput);
  if (!plain(value))
    throw new Error("Blind candidate mapping must be a JSON object.");
  const fields = new Set([
    "schemaVersion",
    "blindPacketId",
    "observationId",
    "observationIntegrity",
    "packetIntegrity",
    "aliases",
  ]);
  exactFields(value, fields, [...fields], "Blind candidate mapping");
  if (value.schemaVersion !== LOCATOR_BLIND_MAPPING_SCHEMA_VERSION)
    throw new Error("Blind candidate mapping schema version is unsupported.");
  if (
    value.blindPacketId !== packet.blindPacketId ||
    value.observationId !== observation.observationId ||
    value.observationIntegrity !==
      createLocatorObservationIntegrity(observation) ||
    value.packetIntegrity !== createLocatorBlindPacketIntegrity(packet)
  )
    throw new Error("Blind candidate mapping integrity link is invalid.");
  if (!Array.isArray(value.aliases))
    throw new Error("Blind candidate mapping aliases must be an array.");
  const aliasFields = new Set(["blindCandidateId", "originalCandidateId"]);
  const aliases = value.aliases.map((entry) => {
    if (!plain(entry))
      throw new Error("Blind candidate mapping entry is invalid.");
    exactFields(
      entry,
      aliasFields,
      [...aliasFields],
      "Blind candidate mapping entry",
    );
    if (
      typeof entry.blindCandidateId !== "string" ||
      !BLIND_CANDIDATE_ID.test(entry.blindCandidateId)
    )
      throw new Error("Blind candidate mapping alias is invalid.");
    if (
      typeof entry.originalCandidateId !== "string" ||
      !/^LOCATOR-[0-9]{3}$/u.test(entry.originalCandidateId)
    )
      throw new Error(
        "Blind candidate mapping original candidate ID is invalid.",
      );
    return Object.freeze({
      blindCandidateId: entry.blindCandidateId,
      originalCandidateId: entry.originalCandidateId,
    });
  });
  const packetAliases = packet.candidates
    .map(({ blindCandidateId }) => blindCandidateId)
    .sort();
  const mappedAliases = aliases
    .map(({ blindCandidateId }) => blindCandidateId)
    .sort();
  const originalIds = observation.candidateInventory
    .map(({ candidateId }) => candidateId)
    .sort();
  const mappedOriginalIds = aliases
    .map(({ originalCandidateId }) => originalCandidateId)
    .sort();
  if (
    new Set(mappedAliases).size !== mappedAliases.length ||
    new Set(mappedOriginalIds).size !== mappedOriginalIds.length ||
    canonical(packetAliases) !== canonical(mappedAliases) ||
    canonical(originalIds) !== canonical(mappedOriginalIds)
  )
    throw new Error(
      "Blind candidate mapping is not a one-to-one inventory mapping.",
    );
  return Object.freeze({
    schemaVersion: LOCATOR_BLIND_MAPPING_SCHEMA_VERSION,
    blindPacketId: value.blindPacketId,
    observationId: value.observationId,
    observationIntegrity: value.observationIntegrity,
    packetIntegrity: value.packetIntegrity,
    aliases: Object.freeze(aliases),
  });
}

const BLIND_REVIEW_FIELDS = new Set([
  "blindPacketId",
  "reviewStatus",
  "blindCandidateIds",
  "expectedClassification",
  "expectedRecommendationStatus",
  "acceptableBlindCandidateIds",
  "preferredBlindCandidateIds",
  "forbiddenBlindCandidateIds",
  "minimumAcceptableConfidence",
  "reviewerRationale",
  "reviewVersion",
  "reviewNotes",
]);

function blindIssue(
  code: string,
  fieldPath: string,
  message: string,
  suggestion: string,
): LocatorBlindReviewValidationIssue {
  return Object.freeze({
    code,
    category: "relationship",
    fieldPath,
    message,
    suggestion,
  });
}

export function inspectLocatorBlindReview(
  value: unknown,
  packetInput: LocatorBlindReviewPacket,
): LocatorBlindReviewInspection {
  const packet = validateLocatorBlindReviewPacket(packetInput);
  if (!plain(value))
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        blindIssue(
          "BLIND_REVIEW_INVALID",
          "$",
          "The blind review must be a plain JSON object.",
          "Regenerate the blind review template.",
        ),
      ]),
    });
  const issues: LocatorBlindReviewValidationIssue[] = [];
  for (const field of Object.keys(value).sort())
    if (!BLIND_REVIEW_FIELDS.has(field))
      issues.push(
        blindIssue(
          "BLIND_REVIEW_UNKNOWN_FIELD",
          `$.${field}`,
          `This property is not part of blind review schema ${LOCATOR_BLIND_REVIEW_VERSION}.`,
          "Remove the property or regenerate the blind review template.",
        ),
      );
  if (value.blindPacketId !== packet.blindPacketId)
    issues.push(
      blindIssue(
        "BLIND_REVIEW_PACKET_ID_MISMATCH",
        "$.blindPacketId",
        "The review does not identify the linked blind packet.",
        `Set blindPacketId to ${packet.blindPacketId}.`,
      ),
    );
  const legacyId = (value: unknown): unknown =>
    typeof value === "string" && BLIND_CANDIDATE_ID.test(value)
      ? value.replace("BLIND-CANDIDATE-", "LOCATOR-")
      : value;
  const legacyIds = (value: unknown): readonly string[] =>
    Array.isArray(value)
      ? (value.map(legacyId) as readonly string[])
      : (value as readonly string[]);
  const pseudoReview: LocatorObservationReview = {
    observationId: packet.observationId,
    reviewStatus: value.reviewStatus as LocatorObservationReviewStatus,
    candidateIds: legacyIds(value.blindCandidateIds),
    expectedClassification:
      value.expectedClassification as LocatorFailureClassification | null,
    expectedRecommendationStatus:
      value.expectedRecommendationStatus as LocatorRecommendationStatus | null,
    acceptableCandidateIds: legacyIds(value.acceptableBlindCandidateIds),
    preferredCandidateIds: legacyIds(value.preferredBlindCandidateIds),
    forbiddenCandidateIds: legacyIds(value.forbiddenBlindCandidateIds),
    minimumAcceptableConfidence:
      value.minimumAcceptableConfidence as LocatorDiagnosisConfidence | null,
    reviewerRationale: value.reviewerRationale as string,
    reviewVersion: value.reviewVersion as string,
    ...(value.reviewNotes === undefined
      ? {}
      : { reviewNotes: value.reviewNotes as string }),
  };
  const legacy = inspectLocatorObservationReview(pseudoReview);
  const replacements: Readonly<Record<string, string>> = {
    candidateIds: "blindCandidateIds",
    acceptableCandidateIds: "acceptableBlindCandidateIds",
    preferredCandidateIds: "preferredBlindCandidateIds",
    forbiddenCandidateIds: "forbiddenBlindCandidateIds",
  };
  for (const entry of legacy.issues) {
    if (entry.fieldPath === "$.observationId") continue;
    let fieldPath = entry.fieldPath;
    let message = entry.message.replaceAll("LOCATOR-", "BLIND-CANDIDATE-");
    let suggestion = entry.suggestion.replaceAll(
      "LOCATOR-",
      "BLIND-CANDIDATE-",
    );
    for (const [legacyName, blindName] of Object.entries(replacements)) {
      fieldPath = fieldPath.replace(legacyName, blindName);
      message = message.replaceAll(legacyName, blindName);
      suggestion = suggestion.replaceAll(legacyName, blindName);
    }
    issues.push(
      Object.freeze({
        ...entry,
        code: `BLIND_${entry.code}`,
        fieldPath,
        message,
        suggestion,
        ...(typeof entry.actualValue === "string"
          ? {
              actualValue: entry.actualValue.replaceAll(
                "LOCATOR-",
                "BLIND-CANDIDATE-",
              ),
            }
          : {}),
      }),
    );
  }
  if (Array.isArray(value.blindCandidateIds)) {
    const supplied = [...new Set(value.blindCandidateIds)].sort();
    const expected = packet.candidates
      .map(({ blindCandidateId }) => blindCandidateId)
      .sort();
    if (canonical(supplied) !== canonical(expected))
      issues.push(
        blindIssue(
          "BLIND_REVIEW_CANDIDATE_SET_MISMATCH",
          "$.blindCandidateIds",
          "blindCandidateIds does not exactly match the linked blind packet inventory.",
          "Regenerate the blind review template from the linked packet.",
        ),
      );
  }
  const ordered = Object.freeze(
    issues.sort(
      (left, right) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.code.localeCompare(right.code),
    ),
  );
  if (ordered.length > 0)
    return Object.freeze({ valid: false, issues: ordered });
  return Object.freeze({
    valid: true,
    review: Object.freeze(
      structuredClone(value as unknown as LocatorBlindReview),
    ),
    issues: Object.freeze([]),
  });
}

export function validateLocatorBlindReview(
  value: unknown,
  packet: LocatorBlindReviewPacket,
): LocatorBlindReview {
  const result = inspectLocatorBlindReview(value, packet);
  if (!result.valid || result.review === undefined)
    throw new Error(
      result.issues[0]?.message ?? "Blind locator review is invalid.",
    );
  return result.review;
}

export function translateLocatorBlindReview(
  observationInput: LocatorObservation,
  packetInput: LocatorBlindReviewPacket,
  mappingInput: LocatorBlindCandidateMapping,
  reviewInput: LocatorBlindReview,
): LocatorObservationReview {
  const observation = validateLocatorObservation(observationInput);
  const packet = validateLocatorBlindReviewPacket(packetInput, observation);
  const mapping = validateLocatorBlindCandidateMapping(
    mappingInput,
    packet,
    observation,
  );
  const review = validateLocatorBlindReview(reviewInput, packet);
  const lookup = new Map(
    mapping.aliases.map(({ blindCandidateId, originalCandidateId }) => [
      blindCandidateId,
      originalCandidateId,
    ]),
  );
  const remap = (ids: readonly string[]): readonly string[] =>
    Object.freeze(
      ids.map((id) => {
        const original = lookup.get(id);
        if (original === undefined)
          throw new Error(`Blind candidate alias ${id} is not mapped.`);
        return original;
      }),
    );
  return Object.freeze({
    observationId: observation.observationId,
    reviewStatus: review.reviewStatus,
    candidateIds: remap(review.blindCandidateIds),
    expectedClassification: review.expectedClassification,
    expectedRecommendationStatus: review.expectedRecommendationStatus,
    acceptableCandidateIds: remap(review.acceptableBlindCandidateIds),
    preferredCandidateIds: remap(review.preferredBlindCandidateIds),
    forbiddenCandidateIds: remap(review.forbiddenBlindCandidateIds),
    minimumAcceptableConfidence: review.minimumAcceptableConfidence,
    reviewerRationale: review.reviewerRationale,
    reviewVersion: LOCATOR_OBSERVATION_REVIEW_VERSION,
    ...(review.reviewNotes === undefined
      ? {}
      : { reviewNotes: review.reviewNotes }),
  });
}
