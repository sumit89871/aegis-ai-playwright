import {
  AiError,
  type AiJsonSchema,
  validateAiJsonSchema,
} from "../ai/index.ts";
import { MAX_LOCATOR_CANDIDATES } from "./locator-candidate.ts";
import { LOCATOR_RECOMMENDATION_STATUSES } from "./locator-diagnosis.ts";

export const LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION = "1.0.0" as const;
export const LOCATOR_ADVISORY_RERANKING_JSON_SCHEMA_NAME =
  "locator_advisory_reranking_v1";

export function createLocatorAdvisoryRerankingJsonSchema(
  suppliedCandidateIds: readonly string[],
): AiJsonSchema {
  if (suppliedCandidateIds.length > MAX_LOCATOR_CANDIDATES)
    throw new AiError({
      code: "request-invalid",
      message: "Locator advisory candidate inventory exceeds the safe bound.",
    });
  if (new Set(suppliedCandidateIds).size !== suppliedCandidateIds.length)
    throw new AiError({
      code: "request-invalid",
      message: "Locator advisory candidate inventory contains duplicates.",
    });
  if (
    suppliedCandidateIds.some(
      (candidateId) =>
        !/^BLIND-CANDIDATE-\d{3}$/u.test(candidateId) ||
        candidateId.length > 40,
    )
  )
    throw new AiError({
      code: "request-invalid",
      message: "Locator advisory candidate inventory contains an unsafe alias.",
    });

  const candidateItems =
    suppliedCandidateIds.length === 0
      ? Object.freeze({ type: "string" })
      : Object.freeze({
          type: "string",
          enum: Object.freeze([...suppliedCandidateIds]),
        });
  return validateAiJsonSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: {
        type: "string",
        const: LOCATOR_ADVISORY_RERANKING_SCHEMA_VERSION,
        description: "The required Aegis locator advisory output version.",
      },
      recommendationStatus: {
        type: "string",
        enum: [...LOCATOR_RECOMMENDATION_STATUSES],
        description:
          "The advisory decision using only the supported Aegis recommendation statuses.",
      },
      rankedCandidateIds: {
        type: "array",
        items: candidateItems,
        uniqueItems: true,
        maxItems:
          suppliedCandidateIds.length === 0 ? 0 : MAX_LOCATOR_CANDIDATES,
        description:
          "A ranking containing only supplied neutral candidate aliases.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Advisory confidence supported by the bounded evidence.",
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description:
          "A short sanitized explanation with no code, selectors, commands or private data.",
      },
    },
    required: [
      "schemaVersion",
      "recommendationStatus",
      "rankedCandidateIds",
      "confidence",
      "summary",
    ],
  });
}
