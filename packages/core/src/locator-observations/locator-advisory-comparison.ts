import {
  createAiClient,
  defaultAiConfiguration,
  MockAiProvider,
  type AiClient,
} from "../ai/index.ts";
import type {
  LocatorAdvisoryExecutionResult,
  LocatorAdvisoryRerankingInput,
} from "../locator-diagnosis/locator-advisory-reranking.ts";
import {
  buildLocatorAdvisoryRerankingInput,
  LOCATOR_ADVISORY_RERANKING_CAPABILITY,
  LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
  LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
  LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
  runLocatorAdvisoryReranking,
} from "../locator-diagnosis/locator-advisory-reranking.ts";
import type {
  LocatorDiagnosisConclusion,
  RankedLocatorCandidate,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorEvaluationExpectedAnswer } from "../locator-evaluation/evaluation-case.ts";
import { calculateLocatorEvaluationMetrics } from "../locator-evaluation/evaluation-metrics.ts";
import type { LocatorEvaluationMetrics } from "../locator-evaluation/evaluation-metrics.ts";
import type {
  LocatorEvaluationCaseResult,
  LocatorEvaluationSafetyResult,
} from "../locator-evaluation/evaluation-runner.ts";
import {
  translateLocatorBlindReview,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReview,
  validateLocatorBlindReviewPacket,
  type LocatorBlindCandidateMapping,
  type LocatorBlindReview,
  type LocatorBlindReviewPacket,
} from "./locator-blind-review.ts";
import {
  createLocatorBlindAggregateMetrics,
  createLocatorBlindHoldoutAggregateSummary,
  runLocatorBlindHoldoutEvaluation,
  type LocatorBlindAggregateMetrics,
  type LocatorBlindHoldoutRecord,
} from "./locator-blind-holdout.ts";
import type { LocatorObservation } from "./locator-observation.ts";
import { validateLocatorObservation } from "./locator-observation-validator.ts";

export const LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION = "1.0.0" as const;
export type LocatorAdvisoryComparisonMode =
  "deterministic-only" | "mock-ai" | "ai-advisory";

export interface LocatorAdvisoryComparisonInputRecord {
  readonly observation: LocatorObservation;
  readonly packet: LocatorBlindReviewPacket;
}

export interface LocatorAdvisoryComparisonAnswerRecord {
  readonly observation: LocatorObservation;
  readonly packet: LocatorBlindReviewPacket;
  readonly mapping: LocatorBlindCandidateMapping;
  readonly review: LocatorBlindReview;
}

export interface LocatorAdvisoryComparisonPhaseCase {
  readonly blindPacketId: string;
  readonly observationId: string;
  readonly deterministic: LocatorDiagnosisConclusion;
  readonly input: LocatorAdvisoryRerankingInput;
  readonly execution?: LocatorAdvisoryExecutionResult;
}

export interface LocatorAdvisoryComparisonPhaseResult {
  readonly schemaVersion: typeof LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION;
  readonly requestedMode: LocatorAdvisoryComparisonMode;
  readonly cases: readonly LocatorAdvisoryComparisonPhaseCase[];
}

export interface LocatorAdvisoryProviderAggregate {
  readonly provider: string;
  readonly requestedModel: string;
  readonly returnedModel: string;
  readonly requestCount: number;
  readonly successfulRequestCount: number;
  readonly failedRequestCount: number;
  readonly invalidStructuredOutputCount: number;
  readonly retryCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly approximateCostUsd: number | null;
  readonly aggregateLatencyMs: number;
  readonly meanLatencyMs: number | null;
  readonly statuses: Readonly<Record<string, number>>;
  readonly failureCodes: Readonly<Record<string, number>>;
  readonly validationIssueCounts: Readonly<Record<string, number>>;
}

export interface LocatorAdvisoryComparisonResult {
  readonly schemaVersion: typeof LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION;
  readonly requestedMode: LocatorAdvisoryComparisonMode;
  readonly effectiveMode:
    LocatorAdvisoryComparisonMode | "partial-ai-advisory" | "ai-unavailable";
  readonly status:
    "no-reviewed-observations" | "insufficient-sample" | "evaluated";
  readonly meaningful: boolean;
  readonly counts: {
    readonly calibrationPilotReviewed: number;
    readonly blindReviewed: number;
    readonly pendingBlind: number;
    readonly invalidBlind: number;
    readonly ineligible: number;
    readonly advisoryEligible: number;
    readonly advisoryCompleted: number;
    readonly advisoryUnavailable: number;
  };
  readonly deterministicMetrics: LocatorEvaluationMetrics;
  readonly advisoryMetrics: LocatorEvaluationMetrics;
  readonly provider: LocatorAdvisoryProviderAggregate;
  readonly notice: string;
  readonly cases: readonly LocatorEvaluationCaseResult[];
  readonly safety: {
    readonly networkCalls: number;
    readonly locatorApplications: 0;
    readonly sourceMutations: 0;
    readonly automaticHealing: false;
  };
}

export interface LocatorComparisonDelta {
  readonly direction: "higher-is-better" | "lower-is-better";
  readonly deterministic: number | null;
  readonly advisory: number | null;
  readonly percentagePointDelta: number | null;
  readonly outcome: "improved" | "worsened" | "unchanged" | "not-available";
}

export interface LocatorAdvisoryComparisonAggregateSummary {
  readonly schemaVersion: typeof LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION;
  readonly requestedMode: LocatorAdvisoryComparisonMode;
  readonly effectiveMode: LocatorAdvisoryComparisonResult["effectiveMode"];
  readonly status: LocatorAdvisoryComparisonResult["status"];
  readonly meaningful: boolean;
  readonly sampleNotice: string;
  readonly counts: LocatorAdvisoryComparisonResult["counts"];
  readonly deterministic: LocatorBlindAggregateMetrics;
  readonly advisory: LocatorBlindAggregateMetrics;
  readonly deltas: {
    readonly classificationAgreement: LocatorComparisonDelta;
    readonly recommendationAgreement: LocatorComparisonDelta;
    readonly candidatesAvailableAgreement: LocatorComparisonDelta;
    readonly insufficientEvidenceAgreement: LocatorComparisonDelta;
    readonly abstentionCorrectness: LocatorComparisonDelta;
    readonly top1Acceptable: LocatorComparisonDelta;
    readonly top3Acceptable: LocatorComparisonDelta;
    readonly preferredAtTop1: LocatorComparisonDelta;
    readonly forbiddenAtTop1: LocatorComparisonDelta;
    readonly forbiddenWithinTop3: LocatorComparisonDelta;
    readonly unsafeRecommendation: LocatorComparisonDelta;
    readonly confidenceFloor: LocatorComparisonDelta;
  };
  readonly provider: LocatorAdvisoryProviderAggregate;
  readonly isolation: {
    readonly humanLabelsInProviderInput: false;
    readonly originalCandidateIdsInProviderInput: false;
    readonly deterministicScoresInProviderInput: false;
    readonly networkCalls: number;
    readonly apiKeyRequired: boolean;
    readonly locatorApplications: 0;
    readonly sourceMutations: 0;
    readonly automaticHealing: false;
  };
}

const ZERO_SAFETY: LocatorEvaluationSafetyResult = Object.freeze({
  inventedCandidateCount: 0,
  unknownCandidateIdCount: 0,
  xpathRecommendationCount: 0,
  positionalRepairCount: 0,
  forceRecommendationCount: 0,
  sourcePatchRecommendationCount: 0,
  shellCommandRecommendationCount: 0,
});

function mockOutput(
  input: LocatorAdvisoryRerankingInput,
): Readonly<Record<string, unknown>> {
  const ids = input.candidates.map(({ candidateId }) => candidateId);
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
    recommendationStatus:
      ids.length === 0 ? "insufficient-evidence" : "candidates-available",
    rankedCandidateIds: Object.freeze(ids),
    confidence: "low",
    summary:
      ids.length === 0
        ? "The bounded candidate inventory does not contain a replacement."
        : "The supplied neutral candidates are retained for advisory comparison.",
  });
}

function defaultMockClient(input: LocatorAdvisoryRerankingInput): AiClient {
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-locator-reranking-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: [LOCATOR_ADVISORY_RERANKING_CAPABILITY],
      requestTimeoutMs: LOCATOR_ADVISORY_RERANKING_TIMEOUT_MS,
      maxRetries: 1,
      maxInputCharacters: 30_000,
      maxOutputTokens: LOCATOR_ADVISORY_RERANKING_MAX_OUTPUT_TOKENS,
      defaultTemperature: 0,
    }),
    {
      providers: [new MockAiProvider({ structuredOutput: mockOutput(input) })],
      environment: Object.freeze({}),
    },
  );
}

export async function runLocatorAdvisoryComparisonPhase(
  recordsInput: readonly LocatorAdvisoryComparisonInputRecord[],
  options: {
    readonly mode?: LocatorAdvisoryComparisonMode;
    readonly aiClientFactory?: (
      input: LocatorAdvisoryRerankingInput,
      index: number,
    ) => AiClient;
  } = {},
): Promise<LocatorAdvisoryComparisonPhaseResult> {
  const mode = options.mode ?? "deterministic-only";
  const records = recordsInput
    .map(({ observation: observationInput, packet: packetInput }) => {
      const observation = validateLocatorObservation(observationInput);
      const packet = validateLocatorBlindReviewPacket(packetInput, observation);
      return Object.freeze({ observation, packet });
    })
    .sort((left, right) =>
      left.packet.blindPacketId.localeCompare(right.packet.blindPacketId),
    );
  const seen = new Set<string>();
  const cases: LocatorAdvisoryComparisonPhaseCase[] = [];
  for (const [index, record] of records.entries()) {
    if (seen.has(record.packet.blindPacketId))
      throw new Error("Advisory comparison packet IDs must be unique.");
    seen.add(record.packet.blindPacketId);
    const input = buildLocatorAdvisoryRerankingInput(record.packet);
    let execution: LocatorAdvisoryExecutionResult | undefined;
    if (mode !== "deterministic-only") {
      const client = options.aiClientFactory?.(input, index);
      if (client === undefined && mode === "ai-advisory")
        throw new Error(
          "Live AI-advisory comparison requires an explicitly supplied AI client.",
        );
      execution = await runLocatorAdvisoryReranking(
        input,
        client ?? defaultMockClient(input),
      );
    }
    cases.push(
      Object.freeze({
        blindPacketId: record.packet.blindPacketId,
        observationId: record.observation.observationId,
        deterministic: Object.freeze(
          structuredClone(record.observation.deterministicDiagnosis),
        ),
        input,
        ...(execution === undefined ? {} : { execution }),
      }),
    );
  }
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION,
    requestedMode: mode,
    cases: Object.freeze(cases),
  });
}

function expectedAnswer(
  review: ReturnType<typeof translateLocatorBlindReview>,
): LocatorEvaluationExpectedAnswer {
  if (
    review.expectedClassification === null ||
    review.expectedRecommendationStatus === null ||
    review.minimumAcceptableConfidence === null
  )
    throw new Error("Only completed blind reviews can enter comparison.");
  return Object.freeze({
    classification: review.expectedClassification,
    recommendationStatus: review.expectedRecommendationStatus,
    acceptableCandidateIds: review.acceptableCandidateIds,
    preferredCandidateIds: review.preferredCandidateIds,
    forbiddenCandidateIds: review.forbiddenCandidateIds,
    locatorChangeAllowed:
      review.expectedRecommendationStatus === "candidates-available",
    minimumConfidence: review.minimumAcceptableConfidence,
  });
}

function remapAdvisory(
  phaseCase: LocatorAdvisoryComparisonPhaseCase,
  mapping: LocatorBlindCandidateMapping,
): LocatorDiagnosisConclusion | null {
  const execution = phaseCase.execution;
  if (execution?.status !== "completed" || execution.output === undefined)
    return null;
  const aliases = new Map(
    mapping.aliases.map(({ blindCandidateId, originalCandidateId }) => [
      blindCandidateId,
      originalCandidateId,
    ]),
  );
  const ranked: RankedLocatorCandidate[] =
    execution.output.rankedCandidateIds.map((blindId, index) => {
      const original = aliases.get(blindId);
      if (original === undefined)
        throw new Error("Validated advisory alias is not privately mapped.");
      return Object.freeze({
        candidateId: original,
        rank: index + 1,
        confidence: execution.output?.confidence ?? "low",
        reason: "Advisory AI ranked a supplied neutral candidate.",
      });
    });
  const deterministic = phaseCase.deterministic;
  return Object.freeze({
    ...structuredClone(deterministic),
    classification: deterministic.classification,
    recommendationStatus: execution.output.recommendationStatus,
    confidence: execution.output.confidence,
    summary: execution.output.summary,
    rankedCandidates: Object.freeze(ranked),
    recommendedNextStep:
      "Review the advisory ordering manually; do not apply or execute a locator.",
    limitations: Object.freeze([
      ...deterministic.limitations,
      "AI advisory output is a comparison result, not authorization to heal or retry.",
    ]),
  });
}

function executionSafety(
  execution: LocatorAdvisoryExecutionResult | undefined,
): LocatorEvaluationSafetyResult {
  return execution?.safety ?? ZERO_SAFETY;
}

function addRejectedSafety(
  metrics: LocatorEvaluationMetrics,
  phaseCases: readonly LocatorAdvisoryComparisonPhaseCase[],
): LocatorEvaluationMetrics {
  const rejected = phaseCases.filter(
    ({ execution }) => execution?.status !== "completed",
  );
  const sum = (field: keyof LocatorEvaluationSafetyResult): number =>
    rejected.reduce(
      (total, entry) => total + (entry.execution?.safety[field] ?? 0),
      0,
    );
  return Object.freeze({
    ...metrics,
    safety: Object.freeze({
      ...metrics.safety,
      inventedCandidateCount:
        metrics.safety.inventedCandidateCount + sum("inventedCandidateCount"),
      unknownCandidateIdCount:
        metrics.safety.unknownCandidateIdCount + sum("unknownCandidateIdCount"),
      xpathRecommendationCount:
        metrics.safety.xpathRecommendationCount +
        sum("xpathRecommendationCount"),
      positionalRepairCount:
        metrics.safety.positionalRepairCount + sum("positionalRepairCount"),
      forceRecommendationCount:
        metrics.safety.forceRecommendationCount +
        sum("forceRecommendationCount"),
      sourcePatchRecommendationCount:
        metrics.safety.sourcePatchRecommendationCount +
        sum("sourcePatchRecommendationCount"),
      shellCommandRecommendationCount:
        metrics.safety.shellCommandRecommendationCount +
        sum("shellCommandRecommendationCount"),
    }),
  });
}

function providerAggregate(
  phase: LocatorAdvisoryComparisonPhaseResult,
): LocatorAdvisoryProviderAggregate {
  const executions = phase.cases.flatMap(({ execution }) =>
    execution === undefined ? [] : [execution],
  );
  const completed = executions.filter(({ status }) => status === "completed");
  const sumOptional = (
    select: (entry: LocatorAdvisoryExecutionResult) => number | undefined,
  ): number | null => {
    const values = executions.flatMap((entry) => {
      const value = select(entry);
      return value === undefined ? [] : [value];
    });
    return values.length === 0
      ? null
      : values.reduce((total, value) => total + value, 0);
  };
  const statuses = new Map<string, number>();
  const failureCodes = new Map<string, number>();
  const validationIssueCounts = new Map<string, number>();
  for (const execution of executions)
    statuses.set(execution.status, (statuses.get(execution.status) ?? 0) + 1);
  for (const { errorCode } of executions)
    if (errorCode !== undefined)
      failureCodes.set(errorCode, (failureCodes.get(errorCode) ?? 0) + 1);
  for (const { validationIssueCodes } of executions)
    for (const issueCode of validationIssueCodes ?? [])
      validationIssueCounts.set(
        issueCode,
        (validationIssueCounts.get(issueCode) ?? 0) + 1,
      );
  const returnedModels = [
    ...new Set(
      completed.flatMap(({ returnedModel }) =>
        returnedModel === undefined ? [] : [returnedModel],
      ),
    ),
  ].sort();
  const providers = [
    ...new Set(
      completed.flatMap(({ providerId }) =>
        providerId === undefined ? [] : [providerId],
      ),
    ),
  ].sort();
  const requestedModels = [
    ...new Set(executions.map(({ requestedModel }) => requestedModel)),
  ].sort();
  const aggregateLatencyMs = executions.reduce(
    (total, { durationMs }) => total + durationMs,
    0,
  );
  return Object.freeze({
    provider:
      executions.length === 0
        ? "none"
        : providers.length === 1
          ? (providers[0] ?? "unavailable")
          : providers.length > 1
            ? "mixed"
            : "unavailable",
    requestedModel:
      requestedModels.length === 0
        ? "none"
        : requestedModels.length === 1
          ? (requestedModels[0] ?? "unavailable")
          : "mixed",
    returnedModel:
      returnedModels.length === 0
        ? "unavailable"
        : returnedModels.length === 1
          ? (returnedModels[0] ?? "unavailable")
          : "mixed",
    requestCount: executions.length,
    successfulRequestCount: completed.length,
    failedRequestCount: executions.length - completed.length,
    invalidStructuredOutputCount: executions.filter(
      ({ status }) => status === "invalid-output",
    ).length,
    retryCount: executions.reduce(
      (total, { retryCount }) => total + retryCount,
      0,
    ),
    inputTokens: sumOptional(({ usage }) => usage?.inputTokens),
    outputTokens: sumOptional(({ usage }) => usage?.outputTokens),
    approximateCostUsd: sumOptional(
      ({ approximateCostUsd }) => approximateCostUsd,
    ),
    aggregateLatencyMs,
    meanLatencyMs:
      executions.length === 0 ? null : aggregateLatencyMs / executions.length,
    statuses: Object.freeze(
      Object.fromEntries(
        [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
    failureCodes: Object.freeze(
      Object.fromEntries(
        [...failureCodes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
    validationIssueCounts: Object.freeze(
      Object.fromEntries(
        [...validationIssueCounts.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
    ),
  });
}

export async function completeLocatorAdvisoryComparison(
  phase: LocatorAdvisoryComparisonPhaseResult,
  answersInput: readonly LocatorAdvisoryComparisonAnswerRecord[],
  options: {
    readonly calibrationPilotReviewed?: number;
    readonly invalidBlindReviews?: number;
  } = {},
): Promise<LocatorAdvisoryComparisonResult> {
  const answers = answersInput.map((record) => {
    const observation = validateLocatorObservation(record.observation);
    const packet = validateLocatorBlindReviewPacket(record.packet, observation);
    const mapping = validateLocatorBlindCandidateMapping(
      record.mapping,
      packet,
      observation,
    );
    const review = validateLocatorBlindReview(record.review, packet);
    return Object.freeze({ observation, packet, mapping, review });
  });
  const baselineRecords: LocatorBlindHoldoutRecord[] = answers.map((entry) => ({
    observation: entry.observation,
    packet: entry.packet,
    mapping: entry.mapping,
    review: entry.review,
  }));
  const baseline = await runLocatorBlindHoldoutEvaluation(baselineRecords, {
    mode: "deterministic-only",
    calibrationPilotReviewed: options.calibrationPilotReviewed ?? 0,
    invalidBlindReviews: options.invalidBlindReviews ?? 0,
  });
  const phaseByPacket = new Map(
    phase.cases.map((entry) => [entry.blindPacketId, entry]),
  );
  const baselineByObservation = new Map(
    baseline.holdout.cases.map((entry) => [entry.observationId, entry]),
  );
  const advisoryCases: LocatorEvaluationCaseResult[] = [];
  for (const answer of answers) {
    if (answer.review.reviewStatus !== "reviewed") continue;
    const phaseCase = phaseByPacket.get(answer.packet.blindPacketId);
    const deterministicCase = baselineByObservation.get(
      answer.observation.observationId,
    );
    if (phaseCase === undefined || deterministicCase === undefined)
      throw new Error(
        "Advisory comparison phase and answer records are inconsistent.",
      );
    const actual = remapAdvisory(phaseCase, answer.mapping);
    if (actual === null) continue;
    const translated = translateLocatorBlindReview(
      answer.observation,
      answer.packet,
      answer.mapping,
      answer.review,
    );
    const expected = expectedAnswer(translated);
    advisoryCases.push(
      Object.freeze({
        caseId: deterministicCase.caseId,
        title: "Independent blind advisory comparison case",
        category: deterministicCase.category,
        expected,
        actual,
        deterministic: deterministicCase.actual,
        candidateIds: deterministicCase.candidateIds,
        safety: executionSafety(phaseCase.execution),
        aiComparison: Object.freeze({
          rankingChanged:
            JSON.stringify(actual.rankedCandidates) !==
            JSON.stringify(deterministicCase.actual?.rankedCandidates ?? []),
          rankingImproved: false,
          rankingWorsened: false,
          classificationConflict: false,
          outputRejected: false,
          fallbackUsed: false,
        }),
      }),
    );
  }
  const advisoryMetrics = addRejectedSafety(
    calculateLocatorEvaluationMetrics(advisoryCases),
    phase.cases,
  );
  const provider = providerAggregate(phase);
  const advisoryEligible = baseline.counts.blindHoldoutReviewed;
  const advisoryCompleted = advisoryCases.length;
  const advisoryUnavailable = Math.max(advisoryEligible - advisoryCompleted, 0);
  const effectiveMode =
    phase.requestedMode === "deterministic-only"
      ? "deterministic-only"
      : advisoryCompleted === 0
        ? "ai-unavailable"
        : advisoryUnavailable > 0
          ? "partial-ai-advisory"
          : phase.requestedMode;
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION,
    requestedMode: phase.requestedMode,
    effectiveMode,
    status: baseline.status,
    meaningful: baseline.meaningful,
    counts: Object.freeze({
      calibrationPilotReviewed: baseline.counts.calibrationPilotReviewed,
      blindReviewed: baseline.counts.blindHoldoutReviewed,
      pendingBlind: baseline.counts.pendingBlindReviews,
      invalidBlind: baseline.counts.invalidBlindReviews,
      ineligible: baseline.counts.ineligibleReviews,
      advisoryEligible,
      advisoryCompleted,
      advisoryUnavailable,
    }),
    deterministicMetrics: baseline.holdout.metrics,
    advisoryMetrics,
    provider,
    notice:
      baseline.counts.blindHoldoutReviewed < 30
        ? `${String(baseline.counts.blindHoldoutReviewed)} independent blind case(s) remain an insufficient sample; comparison metrics are directional only.`
        : "The comparison sample is aggregate evidence only and never authorizes locator application or healing.",
    cases: Object.freeze(advisoryCases),
    safety: Object.freeze({
      networkCalls:
        phase.requestedMode === "ai-advisory" ? provider.requestCount : 0,
      locatorApplications: 0,
      sourceMutations: 0,
      automaticHealing: false,
    }),
  });
}

function delta(
  deterministic: number | null,
  advisory: number | null,
  direction: LocatorComparisonDelta["direction"],
): LocatorComparisonDelta {
  const difference =
    deterministic === null || advisory === null
      ? null
      : (advisory - deterministic) * 100;
  const outcome =
    difference === null
      ? "not-available"
      : Math.abs(difference) < Number.EPSILON
        ? "unchanged"
        : direction === "higher-is-better"
          ? difference > 0
            ? "improved"
            : "worsened"
          : difference < 0
            ? "improved"
            : "worsened";
  return Object.freeze({
    direction,
    deterministic,
    advisory,
    percentagePointDelta: difference,
    outcome,
  });
}

export function createLocatorAdvisoryComparisonAggregateSummary(
  result: LocatorAdvisoryComparisonResult,
): LocatorAdvisoryComparisonAggregateSummary {
  const deterministic = createLocatorBlindAggregateMetrics(
    result.deterministicMetrics,
  );
  const advisory = createLocatorBlindAggregateMetrics(result.advisoryMetrics);
  const higher = "higher-is-better" as const;
  const lower = "lower-is-better" as const;
  return Object.freeze({
    schemaVersion: LOCATOR_ADVISORY_COMPARISON_SCHEMA_VERSION,
    requestedMode: result.requestedMode,
    effectiveMode: result.effectiveMode,
    status: result.status,
    meaningful: result.meaningful,
    sampleNotice: result.notice,
    counts: Object.freeze({ ...result.counts }),
    deterministic,
    advisory,
    deltas: Object.freeze({
      classificationAgreement: delta(
        deterministic.classification.agreement.value,
        advisory.classification.agreement.value,
        higher,
      ),
      recommendationAgreement: delta(
        deterministic.recommendation.agreement.value,
        advisory.recommendation.agreement.value,
        higher,
      ),
      candidatesAvailableAgreement: delta(
        deterministic.recommendation.candidatesAvailableAgreement.value,
        advisory.recommendation.candidatesAvailableAgreement.value,
        higher,
      ),
      insufficientEvidenceAgreement: delta(
        deterministic.recommendation.insufficientEvidenceAgreement.value,
        advisory.recommendation.insufficientEvidenceAgreement.value,
        higher,
      ),
      abstentionCorrectness: delta(
        deterministic.abstention.correctness.value,
        advisory.abstention.correctness.value,
        higher,
      ),
      top1Acceptable: delta(
        deterministic.ranking.top1Acceptable.value,
        advisory.ranking.top1Acceptable.value,
        higher,
      ),
      top3Acceptable: delta(
        deterministic.ranking.top3Acceptable.value,
        advisory.ranking.top3Acceptable.value,
        higher,
      ),
      preferredAtTop1: delta(
        deterministic.ranking.preferredAtTop1.value,
        advisory.ranking.preferredAtTop1.value,
        higher,
      ),
      forbiddenAtTop1: delta(
        deterministic.ranking.forbiddenAtTop1.value,
        advisory.ranking.forbiddenAtTop1.value,
        lower,
      ),
      forbiddenWithinTop3: delta(
        deterministic.ranking.forbiddenWithinTop3.value,
        advisory.ranking.forbiddenWithinTop3.value,
        lower,
      ),
      unsafeRecommendation: delta(
        deterministic.safety.unsafeRecommendation.value,
        advisory.safety.unsafeRecommendation.value,
        lower,
      ),
      confidenceFloor: delta(
        deterministic.confidence.floorAgreement.value,
        advisory.confidence.floorAgreement.value,
        higher,
      ),
    }),
    provider: Object.freeze({ ...result.provider }),
    isolation: Object.freeze({
      humanLabelsInProviderInput: false,
      originalCandidateIdsInProviderInput: false,
      deterministicScoresInProviderInput: false,
      networkCalls: result.safety.networkCalls,
      apiKeyRequired: result.requestedMode === "ai-advisory",
      locatorApplications: 0,
      sourceMutations: 0,
      automaticHealing: false,
    }),
  });
}

export function createDeterministicComparisonBaselineSummary(
  result: Awaited<ReturnType<typeof runLocatorBlindHoldoutEvaluation>>,
): ReturnType<typeof createLocatorBlindHoldoutAggregateSummary> {
  return createLocatorBlindHoldoutAggregateSummary(result);
}
