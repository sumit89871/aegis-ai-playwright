import {
  AiError,
  type AiClient,
  type AiTokenUsage,
  untrustedPromptValue,
} from "../ai/index.ts";
import {
  containsSensitiveUrlData,
  redactSensitiveText,
} from "../diagnostics/redaction.ts";
import type {
  BlindLocatorCandidate,
  LocatorBlindReviewPacket,
} from "../locator-observations/locator-blind-review.ts";
import { validateLocatorBlindReviewPacket } from "../locator-observations/locator-blind-review.ts";
import { MAX_LOCATOR_CANDIDATES } from "./locator-candidate.ts";
import {
  LOCATOR_RECOMMENDATION_STATUSES,
  type LocatorDiagnosisConfidence,
  type LocatorRecommendationStatus,
} from "./locator-diagnosis.ts";
import {
  LOCATOR_ADVISORY_RERANKING_PROMPT,
  LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
  LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
} from "./locator-advisory-reranking-prompt.ts";
import {
  createLocatorAdvisoryRerankingJsonSchema,
  LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
  LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
} from "./locator-advisory-reranking-schema.ts";
export { LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION } from "./locator-advisory-reranking-schema.ts";

export const LOCATOR_ADVISORY_RERANKING_CAPABILITY = "ui-locator-reranking";
export const LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS = 2_000;
export const LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS = 15_000;
export const LOCATOR_ADVISORY_RERANKING_MAX_RETRIES = 1;

export interface LocatorAdvisoryRerankingCandidate {
  readonly candidateId: string;
  readonly strategy: BlindLocatorCandidate["strategy"];
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

export interface LocatorAdvisoryRerankingInput {
  readonly schemaVersion: typeof LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION;
  readonly targetIntent: {
    readonly operation: string;
    readonly strategy: string;
    readonly role?: string;
    readonly name?: string;
    readonly value?: string;
    readonly locatorDescription?: string;
  };
  readonly failure: {
    readonly summary: string;
    readonly pageAvailable: boolean;
    readonly pageReady: boolean | null;
    readonly pageReadinessReason?: string;
    readonly candidateCollectionStatus: string;
  };
  readonly candidates: readonly LocatorAdvisoryRerankingCandidate[];
}

export interface LocatorAdvisoryRerankingOutput {
  readonly schemaVersion: typeof LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION;
  readonly recommendationStatus: LocatorRecommendationStatus;
  readonly rankedCandidateIds: readonly string[];
  readonly confidence: LocatorDiagnosisConfidence;
  readonly summary: string;
}

export interface LocatorAdvisoryOutputSafety {
  readonly inventedCandidateCount: number;
  readonly unknownCandidateIdCount: number;
  readonly xpathRecommendationCount: number;
  readonly positionalRepairCount: number;
  readonly forceRecommendationCount: number;
  readonly sourcePatchRecommendationCount: number;
  readonly shellCommandRecommendationCount: number;
}

export interface LocatorAdvisoryOutputInspection {
  readonly valid: boolean;
  readonly issueCodes: readonly LocatorAdvisoryValidationIssueCode[];
  readonly issues: readonly string[];
  readonly safety: LocatorAdvisoryOutputSafety;
  readonly output?: LocatorAdvisoryRerankingOutput;
}

export const LOCATOR_ADVISORY_VALIDATION_ISSUE_CODES = [
  "output-not-object",
  "unsupported-field",
  "unsupported-schema-version",
  "unsupported-recommendation-status",
  "unsupported-confidence",
  "candidate-ids-not-array",
  "candidate-inventory-bound-exceeded",
  "candidate-id-not-string",
  "duplicate-candidate-id",
  "unknown-candidate-id",
  "candidates-available-without-candidate",
  "ranked-candidates-with-abstention",
  "unsafe-summary",
] as const;
export type LocatorAdvisoryValidationIssueCode =
  (typeof LOCATOR_ADVISORY_VALIDATION_ISSUE_CODES)[number];

export type LocatorAdvisoryExecutionStatus =
  | "completed"
  | "disabled"
  | "provider-unavailable"
  | "timeout"
  | "rate-limited"
  | "invalid-output"
  | "failed";

export interface LocatorAdvisoryExecutionResult {
  readonly status: LocatorAdvisoryExecutionStatus;
  readonly output?: LocatorAdvisoryRerankingOutput;
  readonly providerId?: string;
  readonly requestedModel: string;
  readonly returnedModel?: string;
  readonly usage?: AiTokenUsage;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly approximateCostUsd?: number;
  readonly errorCode?: string;
  readonly validationIssueCodes?: readonly LocatorAdvisoryValidationIssueCode[];
  readonly finishReason?: string;
  readonly safety: LocatorAdvisoryOutputSafety;
  readonly promptId: typeof LOCATOR_ADVISORY_RERANKING_PROMPT_ID;
  readonly promptVersion: typeof LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION;
}

const EMPTY_SAFETY: LocatorAdvisoryOutputSafety = Object.freeze({
  inventedCandidateCount: 0,
  unknownCandidateIdCount: 0,
  xpathRecommendationCount: 0,
  positionalRepairCount: 0,
  forceRecommendationCount: 0,
  sourcePatchRecommendationCount: 0,
  shellCommandRecommendationCount: 0,
});

const UNSAFE_TEXT =
  /(?:```|<\/?[a-z][^>]*>|xpath=|\/\/\w|\.(?:nth|first|last)\s*\(|force\s*:\s*true|begin patch|git\s+apply|powershell|cmd\.exe|bash\s+-c|sh\s+-c|rm\s+-|git\s+(?:reset|checkout)|page\.(?:getby|locator)|locator\()/iu;
const ABSOLUTE_PATH =
  /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/[^/\s]+)/u;
const ABSOLUTE_PATH_GLOBAL =
  /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:home|Users)\/[^/\s]+)/gu;
const MARKDOWN_TEXT = /(?:^|\n)\s{0,3}#{1,6}\s|[*_]{2}|`|\[[^\]]+\]\([^)]+\)/u;

function safeText(
  value: string | undefined,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  return redactSensitiveText(value, maximum * 2)
    .replace(/<[^>]{1,500}>/gu, "[DOM_SNIPPET_REMOVED]")
    .replace(ABSOLUTE_PATH_GLOBAL, "[LOCAL_PATH_REMOVED]")
    .slice(0, maximum);
}

function publicCandidate(
  candidate: BlindLocatorCandidate,
): LocatorAdvisoryRerankingCandidate {
  const role = safeText(candidate.role, 80);
  const name = safeText(candidate.name, 120);
  const value = safeText(candidate.value, 120);
  return Object.freeze({
    candidateId: candidate.blindCandidateId,
    strategy: candidate.strategy,
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(value === undefined ? {} : { value }),
    exact: candidate.exact,
    scopeHint: safeText(candidate.scopeHint ?? undefined, 120) ?? null,
    tagName: safeText(candidate.tagName, 40) ?? "unknown",
    matchCount: candidate.matchCount,
    visible: candidate.visible,
    enabled: candidate.enabled,
    editable: candidate.editable,
    hasBoundingBox: candidate.hasBoundingBox,
  });
}

export function buildLocatorAdvisoryRerankingInput(
  packetInput: LocatorBlindReviewPacket,
): LocatorAdvisoryRerankingInput {
  const packet = validateLocatorBlindReviewPacket(packetInput);
  const intent = packet.targetIntent;
  const failure = packet.failure;
  const role = safeText(intent.role, 80);
  const name = safeText(intent.name, 120);
  const value = safeText(intent.value, 120);
  const locatorDescription = safeText(intent.locatorDescription, 300);
  const pageReadinessReason = safeText(failure.pageReadinessReason, 300);
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    targetIntent: Object.freeze({
      operation: intent.operation,
      strategy: intent.strategy,
      ...(role === undefined ? {} : { role }),
      ...(name === undefined ? {} : { name }),
      ...(value === undefined ? {} : { value }),
      ...(locatorDescription === undefined ? {} : { locatorDescription }),
    }),
    failure: Object.freeze({
      summary:
        safeText(failure.errorMessage, 1_000) ?? "Failure summary unavailable.",
      pageAvailable: failure.pageAvailable,
      pageReady: failure.pageReady ?? packet.pageReadinessState,
      ...(pageReadinessReason === undefined ? {} : { pageReadinessReason }),
      candidateCollectionStatus: packet.candidateCollectionStatus,
    }),
    candidates: Object.freeze(packet.candidates.map(publicCandidate)),
  });
}

function safetyFrom(
  value: unknown,
  knownIds: ReadonlySet<string>,
): LocatorAdvisoryOutputSafety {
  const serialized = JSON.stringify(value ?? null).slice(0, 20_000);
  const ids =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).rankedCandidateIds)
      ? (
          (value as Record<string, unknown>).rankedCandidateIds as unknown[]
        ).filter((entry): entry is string => typeof entry === "string")
      : [];
  const unknown = ids.filter((id) => !knownIds.has(id)).length;
  const count = (pattern: RegExp): number =>
    [...serialized.matchAll(pattern)].length;
  return Object.freeze({
    inventedCandidateCount: unknown,
    unknownCandidateIdCount: unknown,
    xpathRecommendationCount: count(/xpath=|\/\/\w/giu),
    positionalRepairCount: count(/\.(?:nth|first|last)\s*\(/giu),
    forceRecommendationCount: count(/force\s*:\s*true/giu),
    sourcePatchRecommendationCount: count(/begin patch|git\s+apply/giu),
    shellCommandRecommendationCount: count(
      /powershell|cmd\.exe|bash\s+-c|sh\s+-c|rm\s+-|git\s+(?:reset|checkout)/giu,
    ),
  });
}

export function inspectLocatorAdvisoryRerankingOutput(
  value: unknown,
  suppliedCandidateIds: readonly string[],
): LocatorAdvisoryOutputInspection {
  const known = new Set(suppliedCandidateIds);
  const safety = safetyFrom(value, known);
  const issueCodes: LocatorAdvisoryValidationIssueCode[] = [];
  const issues: string[] = [];
  const addIssue = (
    code: LocatorAdvisoryValidationIssueCode,
    message: string,
  ): void => {
    issueCodes.push(code);
    issues.push(message);
  };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Object.freeze({
      valid: false,
      issueCodes: Object.freeze<LocatorAdvisoryValidationIssueCode[]>([
        "output-not-object",
      ]),
      issues: Object.freeze(["Output must be a plain JSON object."]),
      safety,
    });
  }
  const input = value as Record<string, unknown>;
  const fields = new Set([
    "schemaVersion",
    "recommendationStatus",
    "rankedCandidateIds",
    "confidence",
    "summary",
  ]);
  for (const field of Object.keys(input).sort())
    if (!fields.has(field))
      addIssue(
        "unsupported-field",
        "An unsupported output field was returned.",
      );
  if (input.schemaVersion !== LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION)
    addIssue("unsupported-schema-version", "schemaVersion is unsupported.");
  if (
    !LOCATOR_RECOMMENDATION_STATUSES.includes(
      input.recommendationStatus as never,
    )
  )
    addIssue(
      "unsupported-recommendation-status",
      "recommendationStatus is unsupported.",
    );
  if (!["high", "medium", "low"].includes(input.confidence as string))
    addIssue("unsupported-confidence", "confidence is unsupported.");
  if (!Array.isArray(input.rankedCandidateIds)) {
    addIssue("candidate-ids-not-array", "rankedCandidateIds must be an array.");
  } else {
    if (input.rankedCandidateIds.length > MAX_LOCATOR_CANDIDATES)
      addIssue(
        "candidate-inventory-bound-exceeded",
        "rankedCandidateIds exceeds the candidate inventory bound.",
      );
    const ids = input.rankedCandidateIds.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (ids.length !== input.rankedCandidateIds.length)
      addIssue(
        "candidate-id-not-string",
        "rankedCandidateIds must contain only strings.",
      );
    if (new Set(ids).size !== ids.length)
      addIssue(
        "duplicate-candidate-id",
        "rankedCandidateIds must not contain duplicates.",
      );
    if (ids.some((id) => !known.has(id)))
      addIssue(
        "unknown-candidate-id",
        "rankedCandidateIds contains an unknown candidate ID.",
      );
    if (
      input.recommendationStatus === "candidates-available" &&
      ids.length === 0
    )
      addIssue(
        "candidates-available-without-candidate",
        "candidates-available requires at least one ranked candidate.",
      );
    if (input.recommendationStatus !== "candidates-available" && ids.length > 0)
      addIssue(
        "ranked-candidates-with-abstention",
        "Only candidates-available may return ranked candidates.",
      );
  }
  if (
    typeof input.summary !== "string" ||
    input.summary.trim().length === 0 ||
    input.summary.length > 500 ||
    UNSAFE_TEXT.test(input.summary) ||
    MARKDOWN_TEXT.test(input.summary) ||
    ABSOLUTE_PATH.test(input.summary) ||
    containsSensitiveUrlData(input.summary)
  )
    addIssue(
      "unsafe-summary",
      "summary must be bounded sanitized advisory text.",
    );
  if (issues.length > 0)
    return Object.freeze({
      valid: false,
      issueCodes: Object.freeze(issueCodes),
      issues: Object.freeze(issues),
      safety,
    });
  return Object.freeze({
    valid: true,
    issueCodes: Object.freeze([]),
    issues: Object.freeze([]),
    safety,
    output: Object.freeze({
      schemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
      recommendationStatus:
        input.recommendationStatus as LocatorRecommendationStatus,
      rankedCandidateIds: Object.freeze([
        ...(input.rankedCandidateIds as string[]),
      ]),
      confidence: input.confidence as LocatorDiagnosisConfidence,
      summary: redactSensitiveText(input.summary as string, 500),
    }),
  });
}

export function validateLocatorAdvisoryRerankingOutput(
  value: unknown,
  suppliedCandidateIds: readonly string[],
): LocatorAdvisoryRerankingOutput {
  const inspection = inspectLocatorAdvisoryRerankingOutput(
    value,
    suppliedCandidateIds,
  );
  if (!inspection.valid || inspection.output === undefined)
    throw new Error(
      inspection.issues[0] ?? "Locator advisory output is invalid.",
    );
  return inspection.output;
}

function statusFromError(error: unknown): LocatorAdvisoryExecutionStatus {
  if (!(error instanceof AiError)) return "failed";
  if (error.code === "provider-timeout") return "timeout";
  if (error.code === "rate-limited") return "rate-limited";
  if (error.code === "structured-output-invalid") return "invalid-output";
  if (
    [
      "provider-unavailable",
      "provider-parameters-unsupported",
      "network-disabled",
      "secret-missing",
    ].includes(error.code)
  )
    return "provider-unavailable";
  return "failed";
}

export async function runLocatorAdvisoryReranking(
  input: LocatorAdvisoryRerankingInput,
  aiClient: AiClient,
): Promise<LocatorAdvisoryExecutionResult> {
  const startedAt = Date.now();
  const candidateIds = input.candidates.map(({ candidateId }) => candidateId);
  let latestInspection: LocatorAdvisoryOutputInspection | undefined;
  try {
    const result = await aiClient.generate({
      template: LOCATOR_ADVISORY_RERANKING_PROMPT,
      variables: Object.freeze({
        rerankingEvidence: untrustedPromptValue(
          JSON.stringify(input),
          "locator-reranking-evidence",
          25_000,
        ),
      }),
      responseFormat: Object.freeze({
        type: "json_schema" as const,
        name: LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME,
        strict: true,
        schema: createLocatorAdvisoryRerankingJsonSchema(candidateIds),
        validatorId: "locator-advisory-reranking-v1",
        validator: (value) => {
          latestInspection = inspectLocatorAdvisoryRerankingOutput(
            value,
            candidateIds,
          );
          return Object.freeze({
            valid: latestInspection.valid,
            errors: latestInspection.issueCodes,
          });
        },
      }),
      capability: LOCATOR_ADVISORY_RERANKING_CAPABILITY,
      requestTimeoutMs: Math.min(
        LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
        aiClient.configuration.requestTimeoutMs,
      ),
      maxRetries: Math.min(
        LOCATOR_ADVISORY_RERANKING_MAX_RETRIES,
        aiClient.configuration.maxRetries,
      ),
      maxOutputTokens: Math.min(
        LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
        aiClient.configuration.maxOutputTokens,
      ),
      temperature: 0,
    });
    if (result.status === "disabled")
      return Object.freeze({
        status: "disabled",
        requestedModel: aiClient.configuration.model,
        durationMs: Math.max(Date.now() - startedAt, 0),
        retryCount: 0,
        errorCode: result.reason,
        safety: EMPTY_SAFETY,
        promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
        promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
      });
    if (result.structuredOutput === undefined)
      return Object.freeze({
        status: "invalid-output",
        providerId: result.providerId,
        requestedModel: aiClient.configuration.model,
        returnedModel: result.model,
        durationMs: result.durationMs,
        retryCount: result.retryCount,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(result.approximateCostUsd === undefined
          ? {}
          : { approximateCostUsd: result.approximateCostUsd }),
        errorCode: "structured-output-missing",
        validationIssueCodes: latestInspection?.issueCodes ?? Object.freeze([]),
        safety: latestInspection?.safety ?? EMPTY_SAFETY,
        promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
        promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
      });
    const output = validateLocatorAdvisoryRerankingOutput(
      result.structuredOutput,
      candidateIds,
    );
    return Object.freeze({
      status: "completed",
      output,
      providerId: result.providerId,
      requestedModel: aiClient.configuration.model,
      returnedModel: result.model,
      durationMs: result.durationMs,
      retryCount: result.retryCount,
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      ...(result.approximateCostUsd === undefined
        ? {}
        : { approximateCostUsd: result.approximateCostUsd }),
      safety: latestInspection?.safety ?? EMPTY_SAFETY,
      finishReason: result.finishReason,
      promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
      promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
    });
  } catch (error) {
    const status = statusFromError(error);
    return Object.freeze({
      status,
      providerId: aiClient.configuration.provider,
      requestedModel: aiClient.configuration.model,
      ...(error instanceof AiError &&
      error.responseMetadata?.returnedModel !== undefined
        ? { returnedModel: error.responseMetadata.returnedModel }
        : {}),
      durationMs: Math.max(Date.now() - startedAt, 0),
      retryCount: 0,
      errorCode: error instanceof AiError ? error.code : "advisory-failure",
      ...(error instanceof AiError &&
      error.responseMetadata?.finishReason !== undefined
        ? { finishReason: error.responseMetadata.finishReason }
        : {}),
      validationIssueCodes:
        latestInspection?.issueCodes ??
        (error instanceof AiError
          ? (error.validationErrors?.filter(
              (entry): entry is LocatorAdvisoryValidationIssueCode =>
                LOCATOR_ADVISORY_VALIDATION_ISSUE_CODES.includes(
                  entry as LocatorAdvisoryValidationIssueCode,
                ),
            ) ?? Object.freeze([]))
          : Object.freeze([])),
      safety: latestInspection?.safety ?? EMPTY_SAFETY,
      promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
      promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
    });
  }
}
