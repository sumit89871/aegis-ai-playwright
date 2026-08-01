import type { Page } from "@playwright/test";

import type { AiClient } from "../ai/index.ts";
import { untrustedPromptValue } from "../ai/index.ts";
import { collectLocatorCandidates } from "./locator-candidate-collector.ts";
import type { LocatorCandidateInventory } from "./locator-candidate.ts";
import { diagnoseLocatorDeterministically } from "./deterministic-locator-diagnosis.ts";
import type {
  LocatorDiagnosisConclusion,
  LocatorDiagnosisConfiguration,
  LocatorDiagnosisProvenance,
  LocatorDiagnosisReport,
} from "./locator-diagnosis.ts";
import {
  defaultLocatorDiagnosisConfiguration,
  emptyCandidateInventory,
  validateLocatorDiagnosisConfiguration,
} from "./locator-diagnosis.ts";
import {
  LOCATOR_DIAGNOSIS_PROMPT,
  LOCATOR_DIAGNOSIS_PROMPT_ID,
  LOCATOR_DIAGNOSIS_PROMPT_VERSION,
} from "./locator-diagnosis-prompt.ts";
import {
  isValidLocatorDiagnosisConclusion,
  validateLocatorDiagnosisConclusion,
} from "./locator-diagnosis-validator.ts";
import type { LocatorEvidenceInput } from "./locator-evidence.ts";
import { normalizeLocatorEvidence } from "./locator-evidence.ts";
import { classifyLocatorFailure } from "./locator-failure-classifier.ts";

export interface DiagnoseLocatorFailureOptions {
  readonly evidence: LocatorEvidenceInput;
  readonly page?: Page;
  readonly candidateInventory?: LocatorCandidateInventory;
  readonly configuration?: LocatorDiagnosisConfiguration;
  readonly aiClient?: AiClient;
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Locator diagnosis exceeded its bounded duration."));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function provenance(
  configuration: LocatorDiagnosisConfiguration,
  inventory: LocatorCandidateInventory,
  overrides: Partial<LocatorDiagnosisProvenance> = {},
): LocatorDiagnosisProvenance {
  return Object.freeze({
    mode: configuration.mode,
    deterministicAnalysisUsed: true,
    aiAttempted: false,
    promptId: LOCATOR_DIAGNOSIS_PROMPT_ID,
    promptVersion: LOCATOR_DIAGNOSIS_PROMPT_VERSION,
    candidateCollectionStatus: inventory.status,
    candidatesCollected: inventory.candidates.length,
    candidatesDropped: inventory.droppedCandidateCount,
    aiOutputValidated: false,
    fallbackUsed: true,
    conflictDetected: false,
    lifecycleOutcome: "deterministic-only",
    ...overrides,
  });
}

function report(
  evidence: ReturnType<typeof normalizeLocatorEvidence>,
  inventory: LocatorCandidateInventory,
  deterministic: LocatorDiagnosisConclusion,
  reportProvenance: LocatorDiagnosisProvenance,
  advisory?: LocatorDiagnosisConclusion,
): LocatorDiagnosisReport {
  let conclusion = deterministic;
  let disagreements: readonly string[] = Object.freeze([]);
  if (advisory !== undefined) {
    const conflicts =
      advisory.classification !== deterministic.classification ||
      advisory.recommendationStatus !== deterministic.recommendationStatus;
    if (conflicts) {
      const limitation =
        "AI advisory conflicted with deterministic facts; deterministic classification and recommendation status were retained.";
      conclusion = Object.freeze({
        ...deterministic,
        confidence: deterministic.confidence === "high" ? "medium" : "low",
        limitations: Object.freeze([...deterministic.limitations, limitation]),
      });
      disagreements = Object.freeze([limitation]);
    } else {
      conclusion = Object.freeze({
        ...deterministic,
        rankedCandidates: advisory.rankedCandidates,
        limitations: Object.freeze([
          ...new Set([...deterministic.limitations, ...advisory.limitations]),
        ]),
      });
    }
  }
  return Object.freeze({
    status: "completed",
    conclusion,
    deterministicAnalysis: deterministic,
    ...(advisory === undefined ? {} : { aiAdvisoryAnalysis: advisory }),
    disagreements,
    evidence,
    candidateInventory: inventory.candidates,
    provenance: Object.freeze({
      ...reportProvenance,
      conflictDetected: disagreements.length > 0,
    }),
  });
}

export async function diagnoseLocatorFailure(
  options: DiagnoseLocatorFailureOptions,
): Promise<LocatorDiagnosisReport> {
  const configuration = validateLocatorDiagnosisConfiguration(
    options.configuration ?? defaultLocatorDiagnosisConfiguration(),
  );
  const classification = classifyLocatorFailure(options.evidence.errorMessage);
  let inventory =
    options.candidateInventory ??
    emptyCandidateInventory(classification.intent);
  if (
    classification.collectCandidates &&
    options.candidateInventory === undefined
  ) {
    inventory =
      options.page === undefined || !options.evidence.pageAvailable
        ? emptyCandidateInventory(
            classification.intent,
            "unavailable",
            "The page was unavailable for safe candidate collection.",
          )
        : await within(
            collectLocatorCandidates(
              options.page,
              classification.intent,
              configuration,
            ),
            configuration.maximumDurationMs,
          ).catch(() =>
            emptyCandidateInventory(
              classification.intent,
              "unavailable",
              "Candidate collection exceeded its bounded duration.",
            ),
          );
  }
  const evidence = normalizeLocatorEvidence(
    options.evidence,
    classification,
    inventory,
  );
  const deterministic = diagnoseLocatorDeterministically(evidence, inventory);
  if (
    !configuration.enabled ||
    configuration.mode === "disabled" ||
    !configuration.aiAdvisoryEnabled ||
    configuration.mode === "deterministic-only" ||
    options.aiClient === undefined ||
    deterministic.recommendationStatus !== "candidates-available"
  ) {
    return report(
      evidence,
      inventory,
      deterministic,
      provenance(configuration, inventory, {
        lifecycleOutcome: configuration.enabled
          ? "deterministic-only"
          : "locator-diagnosis-disabled",
      }),
    );
  }
  const candidateIds = inventory.candidates.map(
    ({ candidateId }) => candidateId,
  );
  try {
    const result = await within(
      options.aiClient.generate({
        template: LOCATOR_DIAGNOSIS_PROMPT,
        variables: Object.freeze({
          locatorEvidence: untrustedPromptValue(
            JSON.stringify({ evidence, candidates: inventory.candidates }),
            "locator-evidence",
            30_000,
          ),
        }),
        responseFormat: Object.freeze({
          type: "json_object" as const,
          validatorId: "ui-locator-diagnosis-v1",
          validator: (value) =>
            isValidLocatorDiagnosisConclusion(value, candidateIds),
        }),
        capability: configuration.aiCapability,
        correlationId: evidence.testId ?? "unregistered-test",
        requestTimeoutMs: configuration.maximumDurationMs,
        maxRetries: 0,
      }),
      configuration.maximumDurationMs,
    );
    if (result.status === "disabled" || result.structuredOutput === undefined)
      return report(
        evidence,
        inventory,
        deterministic,
        provenance(configuration, inventory, {
          aiAttempted: true,
          lifecycleOutcome:
            result.status === "disabled" ? result.reason : "ai-output-missing",
        }),
      );
    const advisory = validateLocatorDiagnosisConclusion(
      result.structuredOutput,
      candidateIds,
    );
    return report(
      evidence,
      inventory,
      deterministic,
      provenance(configuration, inventory, {
        aiAttempted: true,
        providerId: result.providerId,
        model: result.model,
        aiOutputValidated: true,
        fallbackUsed: false,
        lifecycleOutcome: result.events.at(-1)?.type ?? "request-completed",
        ...(result.approximateCostUsd === undefined
          ? {}
          : { approximateCostUsd: result.approximateCostUsd }),
      }),
      advisory,
    );
  } catch {
    return report(
      evidence,
      inventory,
      deterministic,
      provenance(configuration, inventory, {
        aiAttempted: true,
        lifecycleOutcome: "ai-advisory-failed",
      }),
    );
  }
}
