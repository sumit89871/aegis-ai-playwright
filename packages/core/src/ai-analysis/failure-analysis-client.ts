import type { AiClient } from "../ai/index.ts";
import { untrustedPromptValue } from "../ai/index.ts";
import type {
  FailureAnalysisConclusion,
  FailureAnalysisConfiguration,
  FailureAnalysisProvenance,
  FailureAnalysisReport,
} from "./failure-analysis.ts";
import {
  defaultFailureAnalysisConfiguration,
  validateFailureAnalysisConfiguration,
} from "./failure-analysis.ts";
import {
  FAILURE_ANALYSIS_PROMPT,
  FAILURE_ANALYSIS_PROMPT_ID,
  FAILURE_ANALYSIS_PROMPT_VERSION,
} from "./failure-analysis-prompt.ts";
import {
  isValidFailureAnalysisConclusion,
  validateFailureAnalysisConclusion,
} from "./failure-analysis-validator.ts";
import { analyseFailureDeterministically } from "./deterministic-failure-analysis.ts";
import type {
  FailureEvidence,
  FailureEvidenceInput,
} from "./failure-evidence.ts";
import {
  failureEvidenceIds,
  normalizeFailureEvidence,
} from "./failure-evidence.ts";

export interface AnalyseUiFailureOptions {
  readonly evidence: FailureEvidenceInput;
  readonly configuration?: FailureAnalysisConfiguration;
  readonly aiClient?: AiClient;
}

function filterEvidence(
  evidence: FailureEvidence,
  configuration: FailureAnalysisConfiguration,
): FailureEvidence {
  const excluded = new Set<string>();
  if (!configuration.includeAccessibilitySummary) excluded.add("accessibility");
  if (!configuration.includeReadinessResult) excluded.add("readiness");
  if (!configuration.includeNetworkEvidence) {
    excluded.add("failed-request");
    excluded.add("http-response");
  }
  if (!configuration.includeConsoleEvidence) {
    excluded.add("console");
    excluded.add("page-error");
  }
  if (excluded.size === 0) return evidence;
  const retained = { ...evidence.counts.retained };
  for (const category of excluded) {
    retained[category as keyof typeof retained] = 0;
  }
  return Object.freeze({
    ...evidence,
    records: Object.freeze(
      evidence.records.filter((record) => !excluded.has(record.category)),
    ),
    counts: Object.freeze({
      retained: Object.freeze(retained),
      dropped: evidence.counts.dropped,
    }),
    unavailableCategories: Object.freeze(
      [...new Set([...evidence.unavailableCategories, ...excluded])].sort(),
    ) as FailureEvidence["unavailableCategories"],
  });
}

function deduplicate<T>(
  values: readonly T[],
  key: (value: T) => string,
): readonly T[] {
  const unique = new Map<string, T>();
  for (const value of values) unique.set(key(value), value);
  return Object.freeze([...unique.values()]);
}

function mergeAnalyses(
  deterministic: FailureAnalysisConclusion,
  advisory: FailureAnalysisConclusion,
  evidenceIds: readonly string[],
): {
  readonly conclusion: FailureAnalysisConclusion;
  readonly disagreements: readonly string[];
} {
  if (deterministic.primaryCategory !== advisory.primaryCategory) {
    const limitation = `AI advisory category ${advisory.primaryCategory} differed from deterministic category ${deterministic.primaryCategory}; deterministic facts were retained.`;
    return Object.freeze({
      conclusion: validateFailureAnalysisConclusion(
        {
          ...deterministic,
          confidence: deterministic.confidence === "high" ? "medium" : "low",
          limitations: [...deterministic.limitations, limitation],
        },
        evidenceIds,
      ),
      disagreements: Object.freeze([limitation]),
    });
  }
  return Object.freeze({
    conclusion: validateFailureAnalysisConclusion(
      {
        ...deterministic,
        probableCauses: deduplicate(
          [...deterministic.probableCauses, ...advisory.probableCauses],
          (cause) => `${cause.cause}\u0000${cause.evidenceIds.join(",")}`,
        ),
        recommendedActions: deduplicate(
          [...deterministic.recommendedActions, ...advisory.recommendedActions],
          (action) => `${action.owner}\u0000${action.action}`,
        ),
        missingEvidence: deduplicate(
          [...deterministic.missingEvidence, ...advisory.missingEvidence],
          (value) => value,
        ),
        limitations: deduplicate(
          [...deterministic.limitations, ...advisory.limitations],
          (value) => value,
        ),
      },
      evidenceIds,
    ),
    disagreements: Object.freeze([]),
  });
}

function provenance(
  evidence: FailureEvidence,
  configuration: FailureAnalysisConfiguration,
  overrides: Partial<FailureAnalysisProvenance>,
): FailureAnalysisProvenance {
  return Object.freeze({
    mode: configuration.mode,
    aiAttempted: false,
    promptId: FAILURE_ANALYSIS_PROMPT_ID,
    promptVersion: FAILURE_ANALYSIS_PROMPT_VERSION,
    aiResponseValidated: false,
    fallbackUsed: true,
    evidenceCategories: Object.freeze(
      [...new Set(evidence.records.map((record) => record.category))].sort(),
    ),
    missingEvidence: Object.freeze([...evidence.unavailableCategories]),
    lifecycleOutcome: "deterministic-only",
    ...overrides,
  });
}

function createReport(
  evidence: FailureEvidence,
  deterministic: FailureAnalysisConclusion,
  reportProvenance: FailureAnalysisProvenance,
  advisory?: FailureAnalysisConclusion,
): FailureAnalysisReport {
  const merged =
    advisory === undefined
      ? { conclusion: deterministic, disagreements: Object.freeze([]) }
      : mergeAnalyses(deterministic, advisory, failureEvidenceIds(evidence));
  return Object.freeze({
    status: "completed",
    conclusion: merged.conclusion,
    deterministicAnalysis: deterministic,
    ...(advisory === undefined ? {} : { aiAdvisoryAnalysis: advisory }),
    disagreements: merged.disagreements,
    evidence,
    provenance: reportProvenance,
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("AI advisory analysis exceeded its time limit."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function analyseUiFailure(
  options: AnalyseUiFailureOptions,
): Promise<FailureAnalysisReport> {
  const configuration = validateFailureAnalysisConfiguration(
    options.configuration ?? defaultFailureAnalysisConfiguration(),
  );
  const evidence = filterEvidence(
    normalizeFailureEvidence(options.evidence, {
      maximumEntriesPerCategory: configuration.maximumEvidenceEntries,
    }),
    configuration,
  );
  const deterministic = analyseFailureDeterministically(evidence);
  if (
    !configuration.enabled ||
    configuration.mode === "disabled" ||
    configuration.mode === "deterministic-only" ||
    options.aiClient === undefined
  ) {
    const outcome =
      !configuration.enabled || configuration.mode === "disabled"
        ? "analysis-disabled-deterministic-fallback"
        : options.aiClient === undefined &&
            configuration.mode !== "deterministic-only"
          ? "ai-client-unavailable"
          : "deterministic-only";
    return createReport(
      evidence,
      deterministic,
      provenance(evidence, configuration, { lifecycleOutcome: outcome }),
    );
  }

  const ids = failureEvidenceIds(evidence);
  try {
    const result = await withTimeout(
      options.aiClient.generate({
        template: FAILURE_ANALYSIS_PROMPT,
        variables: Object.freeze({
          evidence: untrustedPromptValue(
            JSON.stringify(evidence),
            "failure-evidence",
            30_000,
          ),
        }),
        responseFormat: Object.freeze({
          type: "json_object" as const,
          validatorId: "ui-failure-analysis-v1",
          validator: (value) => isValidFailureAnalysisConclusion(value, ids),
        }),
        capability: configuration.aiCapability,
        correlationId: evidence.test.testId ?? "unregistered-test",
        requestTimeoutMs: configuration.maximumAnalysisDurationMs,
        maxRetries: 0,
      }),
      configuration.maximumAnalysisDurationMs,
    );
    if (result.status === "disabled" || result.structuredOutput === undefined) {
      return createReport(
        evidence,
        deterministic,
        provenance(evidence, configuration, {
          aiAttempted: true,
          lifecycleOutcome:
            result.status === "disabled" ? result.reason : "ai-output-missing",
        }),
      );
    }
    const advisory = validateFailureAnalysisConclusion(
      result.structuredOutput,
      ids,
    );
    return createReport(
      evidence,
      deterministic,
      provenance(evidence, configuration, {
        aiAttempted: true,
        providerId: result.providerId,
        model: result.model,
        aiResponseValidated: true,
        lifecycleOutcome: result.events.at(-1)?.type ?? "request-completed",
        ...(result.approximateCostUsd === undefined
          ? {}
          : { approximateCostUsd: result.approximateCostUsd }),
      }),
      advisory,
    );
  } catch {
    return createReport(
      evidence,
      deterministic,
      provenance(evidence, configuration, {
        aiAttempted: true,
        lifecycleOutcome: "ai-advisory-failed",
      }),
    );
  }
}
