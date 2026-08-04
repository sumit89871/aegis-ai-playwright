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

export const LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION = "1.0.0" as const;
export const LOCATOR_ADVISORY_RERANKING_CAPABILITY = "ui-locator-reranking";
export const LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS = 512;
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
  readonly issues: readonly string[];
  readonly safety: LocatorAdvisoryOutputSafety;
  readonly output?: LocatorAdvisoryRerankingOutput;
}

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
  const issues: string[] = [];
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Object.freeze({
      valid: false,
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
    if (!fields.has(field)) issues.push(`Unsupported output field ${field}.`);
  if (input.schemaVersion !== LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION)
    issues.push("schemaVersion is unsupported.");
  if (
    !LOCATOR_RECOMMENDATION_STATUSES.includes(
      input.recommendationStatus as never,
    )
  )
    issues.push("recommendationStatus is unsupported.");
  if (!["high", "medium", "low"].includes(input.confidence as string))
    issues.push("confidence is unsupported.");
  if (!Array.isArray(input.rankedCandidateIds)) {
    issues.push("rankedCandidateIds must be an array.");
  } else {
    if (input.rankedCandidateIds.length > MAX_LOCATOR_CANDIDATES)
      issues.push("rankedCandidateIds exceeds the candidate inventory bound.");
    const ids = input.rankedCandidateIds.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (ids.length !== input.rankedCandidateIds.length)
      issues.push("rankedCandidateIds must contain only strings.");
    if (new Set(ids).size !== ids.length)
      issues.push("rankedCandidateIds must not contain duplicates.");
    if (ids.some((id) => !known.has(id)))
      issues.push("rankedCandidateIds contains an unknown candidate ID.");
    if (
      input.recommendationStatus === "candidates-available" &&
      ids.length === 0
    )
      issues.push(
        "candidates-available requires at least one ranked candidate.",
      );
    if (input.recommendationStatus !== "candidates-available" && ids.length > 0)
      issues.push("Only candidates-available may return ranked candidates.");
  }
  if (
    typeof input.summary !== "string" ||
    input.summary.trim().length === 0 ||
    input.summary.length > 500 ||
    UNSAFE_TEXT.test(input.summary) ||
    ABSOLUTE_PATH.test(input.summary) ||
    containsSensitiveUrlData(input.summary)
  )
    issues.push("summary must be bounded sanitized advisory text.");
  if (issues.length > 0)
    return Object.freeze({
      valid: false,
      issues: Object.freeze(issues),
      safety,
    });
  return Object.freeze({
    valid: true,
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
    ["provider-unavailable", "network-disabled", "secret-missing"].includes(
      error.code,
    )
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
        type: "json_object" as const,
        validatorId: "locator-advisory-reranking-v1",
        validator: (value) => {
          latestInspection = inspectLocatorAdvisoryRerankingOutput(
            value,
            candidateIds,
          );
          return latestInspection.valid;
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
      promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
      promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
    });
  } catch (error) {
    const status = statusFromError(error);
    return Object.freeze({
      status,
      requestedModel: aiClient.configuration.model,
      durationMs: Math.max(Date.now() - startedAt, 0),
      retryCount: 0,
      errorCode: error instanceof AiError ? error.code : "advisory-failure",
      safety: latestInspection?.safety ?? EMPTY_SAFETY,
      promptId: LOCATOR_ADVISORY_RERANKING_PROMPT_ID,
      promptVersion: LOCATOR_ADVISORY_RERANKING_PROMPT_VERSION,
    });
  }
}
