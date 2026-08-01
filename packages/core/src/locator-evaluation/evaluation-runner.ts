import {
  createAiClient,
  defaultAiConfiguration,
  MockAiProvider,
} from "../ai/index.ts";
import type { AiClient } from "../ai/index.ts";
import { locatorCandidateSortKey } from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorCandidate,
  LocatorCandidateInventory,
} from "../locator-diagnosis/locator-candidate.ts";
import { scoreLocatorCandidate } from "../locator-diagnosis/locator-candidate-scorer.ts";
import {
  defaultLocatorDiagnosisConfiguration,
  type LocatorDiagnosisConclusion,
} from "../locator-diagnosis/locator-diagnosis.ts";
import { diagnoseLocatorFailure } from "../locator-diagnosis/locator-diagnosis-client.ts";
import type {
  LocatorEvaluationAnalysisInput,
  LocatorEvaluationCase,
  LocatorEvaluationDataset,
  LocatorEvaluationExpectedAnswer,
} from "./evaluation-case.ts";
import { calculateLocatorEvaluationMetrics } from "./evaluation-metrics.ts";
import type { LocatorEvaluationMetrics } from "./evaluation-metrics.ts";
import {
  evaluateLocatorEvaluationThresholds,
  LOCATOR_EVALUATION_BASELINE,
} from "./evaluation-thresholds.ts";
import type {
  LocatorEvaluationThresholds,
  ThresholdEvaluation,
} from "./evaluation-thresholds.ts";
import { validateLocatorEvaluationDataset } from "./evaluation-validator.ts";

export type LocatorEvaluationMode =
  "deterministic-only" | "mock-ai" | "ai-advisory";
export const DEFAULT_LOCATOR_EVALUATION_MODE: LocatorEvaluationMode =
  "deterministic-only";

export interface LocatorEvaluationSafetyResult {
  readonly inventedCandidateCount: number;
  readonly unknownCandidateIdCount: number;
  readonly xpathRecommendationCount: number;
  readonly positionalRepairCount: number;
  readonly forceRecommendationCount: number;
  readonly sourcePatchRecommendationCount: number;
  readonly shellCommandRecommendationCount: number;
}

export interface LocatorEvaluationCaseResult {
  readonly caseId: string;
  readonly title: string;
  readonly category: LocatorEvaluationCase["category"];
  readonly expected: LocatorEvaluationExpectedAnswer;
  readonly actual: LocatorDiagnosisConclusion | null;
  readonly deterministic: LocatorDiagnosisConclusion | null;
  readonly candidateIds: readonly string[];
  readonly safety: LocatorEvaluationSafetyResult;
  readonly error?: string;
  readonly aiComparison: {
    readonly rankingChanged: boolean;
    readonly rankingImproved: boolean;
    readonly rankingWorsened: boolean;
    readonly classificationConflict: boolean;
    readonly outputRejected: boolean;
    readonly fallbackUsed: boolean;
  };
}

export interface LocatorEvaluationRunResult {
  readonly schemaVersion: "1.0.0";
  readonly dataset: {
    readonly id: LocatorEvaluationDataset["id"];
    readonly version: string;
    readonly caseCount: number;
  };
  readonly mode: LocatorEvaluationMode;
  readonly status: "pass" | "fail";
  readonly metrics: LocatorEvaluationMetrics;
  readonly thresholdEvaluation: ThresholdEvaluation;
  readonly failedCaseIds: readonly string[];
  readonly cases: readonly LocatorEvaluationCaseResult[];
  readonly aiComparison: {
    readonly rankingChanged: number;
    readonly rankingImproved: number;
    readonly rankingWorsened: number;
    readonly classificationConflicts: number;
    readonly rejectedOutputs: number;
    readonly fallbackCount: number;
  };
}

export interface LocatorEvaluationRunnerOptions {
  readonly mode?: LocatorEvaluationMode;
  readonly thresholds?: LocatorEvaluationThresholds;
  readonly aiClientFactory?: (
    caseId: string,
    deterministic: LocatorDiagnosisConclusion,
  ) => AiClient;
}

const CONFIDENCE_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });

function buildInventory(
  evaluationCase: LocatorEvaluationCase,
): LocatorCandidateInventory {
  const candidates: LocatorCandidate[] = evaluationCase.input.candidates.map(
    ({ candidateId, descriptor }) =>
      Object.freeze({
        candidateId,
        ...scoreLocatorCandidate(descriptor, evaluationCase.input.targetIntent),
      }),
  );
  candidates.sort((left, right) => {
    const comparison = locatorCandidateSortKey(left).localeCompare(
      locatorCandidateSortKey(right),
    );
    return comparison === 0
      ? left.candidateId.localeCompare(right.candidateId)
      : comparison;
  });
  return Object.freeze({
    status: evaluationCase.input.candidateCollectionStatus,
    candidates: Object.freeze(candidates),
    droppedCandidateCount: 0,
    scannedElementCount: candidates.length,
    intent: evaluationCase.input.targetIntent,
    ...(evaluationCase.input.candidateCollectionError === undefined
      ? {}
      : { error: evaluationCase.input.candidateCollectionError }),
  });
}

export function buildLocatorEvaluationAnalysisInput(
  evaluationCase: LocatorEvaluationCase,
): LocatorEvaluationAnalysisInput {
  return Object.freeze({
    evidence: Object.freeze(structuredClone(evaluationCase.input.failure)),
    candidateInventory: buildInventory(evaluationCase),
  });
}

function defaultMockClient(
  deterministic: LocatorDiagnosisConclusion,
): AiClient {
  const safeAdvisory = Object.freeze({
    ...structuredClone(deterministic),
    originalLocatorAssessment: Object.freeze({
      strategy: deterministic.originalLocatorAssessment.strategy,
      issue: "The supplied locator evidence requires advisory review.",
    }),
  });
  const provider = new MockAiProvider({ structuredOutput: safeAdvisory });
  return createAiClient(
    defaultAiConfiguration({
      enabled: true,
      provider: "mock",
      model: "mock-locator-evaluation-v1",
      allowNetworkCalls: false,
      mockOnly: true,
      enabledCapabilities: ["ui-locator-diagnosis"],
    }),
    { providers: [provider], environment: Object.freeze({}) },
  );
}

function safety(
  conclusion: LocatorDiagnosisConclusion | null,
  knownCandidateIds: readonly string[],
): LocatorEvaluationSafetyResult {
  if (conclusion === null)
    return Object.freeze({
      inventedCandidateCount: 0,
      unknownCandidateIdCount: 0,
      xpathRecommendationCount: 0,
      positionalRepairCount: 0,
      forceRecommendationCount: 0,
      sourcePatchRecommendationCount: 0,
      shellCommandRecommendationCount: 0,
    });
  const ids = conclusion.rankedCandidates.map(({ candidateId }) => candidateId);
  const unknown = ids.filter((id) => !knownCandidateIds.includes(id)).length;
  const serialized = JSON.stringify(conclusion);
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
      /powershell|cmd\.exe|bash\s+-c|rm\s+-|git\s+(?:reset|checkout)/giu,
    ),
  });
}

function firstAcceptableRank(
  conclusion: LocatorDiagnosisConclusion | null,
  acceptable: readonly string[],
): number | null {
  return (
    conclusion?.rankedCandidates.find(({ candidateId }) =>
      acceptable.includes(candidateId),
    )?.rank ?? null
  );
}

function differs(
  actual: LocatorDiagnosisConclusion | null,
  deterministic: LocatorDiagnosisConclusion | null,
  expected: LocatorEvaluationExpectedAnswer,
  outputRejected: boolean,
  fallbackUsed: boolean,
): LocatorEvaluationCaseResult["aiComparison"] {
  const actualIds =
    actual?.rankedCandidates.map(({ candidateId }) => candidateId) ?? [];
  const deterministicIds =
    deterministic?.rankedCandidates.map(({ candidateId }) => candidateId) ?? [];
  const before = firstAcceptableRank(
    deterministic,
    expected.acceptableCandidateIds,
  );
  const after = firstAcceptableRank(actual, expected.acceptableCandidateIds);
  return Object.freeze({
    rankingChanged:
      JSON.stringify(actualIds) !== JSON.stringify(deterministicIds),
    rankingImproved: before !== null && after !== null && after < before,
    rankingWorsened:
      (before !== null && after === null) ||
      (before !== null && after !== null && after > before),
    classificationConflict:
      actual !== null &&
      deterministic !== null &&
      actual.classification !== deterministic.classification,
    outputRejected,
    fallbackUsed,
  });
}

async function runCase(
  evaluationCase: LocatorEvaluationCase,
  options: LocatorEvaluationRunnerOptions,
): Promise<LocatorEvaluationCaseResult> {
  const runtime = buildLocatorEvaluationAnalysisInput(evaluationCase);
  const candidateIds = runtime.candidateInventory.candidates.map(
    ({ candidateId }) => candidateId,
  );
  try {
    const deterministicReport = await diagnoseLocatorFailure({
      evidence: runtime.evidence,
      candidateInventory: runtime.candidateInventory,
      configuration: defaultLocatorDiagnosisConfiguration(),
    });
    const mode = options.mode ?? "deterministic-only";
    const report =
      mode === "deterministic-only"
        ? deterministicReport
        : await diagnoseLocatorFailure({
            evidence: runtime.evidence,
            candidateInventory: runtime.candidateInventory,
            configuration: defaultLocatorDiagnosisConfiguration({
              mode: mode === "ai-advisory" ? "ai-advisory" : "mock-ai",
              aiAdvisoryEnabled: true,
            }),
            aiClient: ((): AiClient => {
              const supplied = options.aiClientFactory?.(
                evaluationCase.caseId,
                deterministicReport.conclusion,
              );
              if (supplied !== undefined) return supplied;
              if (mode === "mock-ai")
                return defaultMockClient(deterministicReport.conclusion);
              throw new Error(
                "AI-advisory evaluation requires an explicitly supplied client.",
              );
            })(),
          });
    const outputRejected =
      mode === "mock-ai" &&
      report.provenance.aiAttempted &&
      !report.provenance.aiOutputValidated;
    const comparison = differs(
      report.conclusion,
      deterministicReport.conclusion,
      evaluationCase.expected,
      outputRejected,
      report.provenance.aiAttempted && report.provenance.fallbackUsed,
    );
    return Object.freeze({
      caseId: evaluationCase.caseId,
      title: evaluationCase.title,
      category: evaluationCase.category,
      expected: evaluationCase.expected,
      actual: report.conclusion,
      deterministic: deterministicReport.conclusion,
      candidateIds: Object.freeze(candidateIds),
      safety: safety(report.conclusion, candidateIds),
      aiComparison: comparison,
    });
  } catch (error) {
    return Object.freeze({
      caseId: evaluationCase.caseId,
      title: evaluationCase.title,
      category: evaluationCase.category,
      expected: evaluationCase.expected,
      actual: null,
      deterministic: null,
      candidateIds: Object.freeze(candidateIds),
      safety: safety(null, candidateIds),
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Evaluation case failed safely.",
      aiComparison: differs(null, null, evaluationCase.expected, false, true),
    });
  }
}

export async function runLocatorEvaluationDataset(
  datasetInput: LocatorEvaluationDataset,
  options: LocatorEvaluationRunnerOptions = {},
): Promise<LocatorEvaluationRunResult> {
  const dataset = validateLocatorEvaluationDataset(datasetInput);
  const mode = options.mode ?? DEFAULT_LOCATOR_EVALUATION_MODE;
  const cases: LocatorEvaluationCaseResult[] = [];
  for (const evaluationCase of dataset.cases)
    cases.push(await runCase(evaluationCase, { ...options, mode }));
  const metrics = calculateLocatorEvaluationMetrics(cases);
  const thresholdEvaluation = evaluateLocatorEvaluationThresholds(
    metrics,
    options.thresholds ?? LOCATOR_EVALUATION_BASELINE,
  );
  const caseFailed = (entry: LocatorEvaluationCaseResult): boolean => {
    if (entry.actual === null) return true;
    if (entry.actual.classification !== entry.expected.classification)
      return true;
    if (
      entry.actual.recommendationStatus !== entry.expected.recommendationStatus
    )
      return true;
    if (
      entry.expected.locatorChangeAllowed &&
      !entry.actual.rankedCandidates
        .slice(0, 3)
        .some(({ candidateId }) =>
          entry.expected.acceptableCandidateIds.includes(candidateId),
        )
    )
      return true;
    return (
      CONFIDENCE_ORDER[entry.actual.confidence] <
      CONFIDENCE_ORDER[entry.expected.minimumConfidence]
    );
  };
  const failedCaseIds = cases
    .filter(caseFailed)
    .map(({ caseId }) => caseId)
    .sort();
  const sumComparison = (
    field: keyof LocatorEvaluationCaseResult["aiComparison"],
  ): number => cases.filter((entry) => entry.aiComparison[field]).length;
  return Object.freeze({
    schemaVersion: "1.0.0",
    dataset: Object.freeze({
      id: dataset.id,
      version: dataset.version,
      caseCount: dataset.cases.length,
    }),
    mode,
    status: thresholdEvaluation.status,
    metrics,
    thresholdEvaluation,
    failedCaseIds: Object.freeze(failedCaseIds),
    cases: Object.freeze(cases),
    aiComparison: Object.freeze({
      rankingChanged: sumComparison("rankingChanged"),
      rankingImproved: sumComparison("rankingImproved"),
      rankingWorsened: sumComparison("rankingWorsened"),
      classificationConflicts: sumComparison("classificationConflict"),
      rejectedOutputs: sumComparison("outputRejected"),
      fallbackCount: sumComparison("fallbackUsed"),
    }),
  });
}
