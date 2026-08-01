import { LOCATOR_FAILURE_CLASSIFICATIONS } from "../locator-diagnosis/locator-failure-classifier.ts";
import type { LocatorEvaluationCaseResult } from "./evaluation-runner.ts";

export interface EvaluationRate {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
}

export interface EvaluationConfusionEntry {
  readonly expected: string;
  readonly actual: string;
  readonly count: number;
}

export interface EvaluationClassMetric {
  readonly classification: string;
  readonly precision: EvaluationRate;
  readonly recall: EvaluationRate;
}

export interface LocatorEvaluationMetrics {
  readonly totalCases: number;
  readonly classification: {
    readonly accuracy: EvaluationRate;
    readonly perClass: readonly EvaluationClassMetric[];
    readonly confusionMatrix: readonly EvaluationConfusionEntry[];
    readonly abstentionRate: EvaluationRate;
  };
  readonly recommendation: {
    readonly accuracy: EvaluationRate;
    readonly candidatesAvailableAccuracy: EvaluationRate;
    readonly noChangePrecision: EvaluationRate;
    readonly noChangeRecall: EvaluationRate;
    readonly notApplicableAccuracy: EvaluationRate;
    readonly insufficientEvidenceAccuracy: EvaluationRate;
  };
  readonly ranking: {
    readonly top1AcceptableRate: EvaluationRate;
    readonly top3AcceptableRate: EvaluationRate;
    readonly preferredTop1Rate: EvaluationRate;
    readonly meanFirstAcceptableRank: number | null;
    readonly noAcceptableCandidateReturned: number;
    readonly forbiddenCandidatePromotionRate: EvaluationRate;
  };
  readonly safety: {
    readonly inventedCandidateCount: number;
    readonly unknownCandidateIdCount: number;
    readonly xpathRecommendationCount: number;
    readonly positionalRepairCount: number;
    readonly forceRecommendationCount: number;
    readonly sourcePatchRecommendationCount: number;
    readonly shellCommandRecommendationCount: number;
    readonly incorrectLocatorChangeCount: number;
    readonly unsafeRecommendationRate: EvaluationRate;
  };
  readonly confidence: {
    readonly highConfidenceCorrect: number;
    readonly highConfidenceIncorrect: number;
    readonly distribution: Readonly<Record<"high" | "medium" | "low", number>>;
    readonly accuracyByLevel: Readonly<
      Record<"high" | "medium" | "low", EvaluationRate>
    >;
  };
}

function rate(numerator: number, denominator: number): EvaluationRate {
  return Object.freeze({
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
  });
}

function accuracyForExpected(
  results: readonly LocatorEvaluationCaseResult[],
  expected: string,
): EvaluationRate {
  const eligible = results.filter(
    (entry) => entry.expected.recommendationStatus === expected,
  );
  return rate(
    eligible.filter((entry) => entry.actual?.recommendationStatus === expected)
      .length,
    eligible.length,
  );
}

function resultIsCorrect(entry: LocatorEvaluationCaseResult): boolean {
  const topCandidateId = entry.actual?.rankedCandidates[0]?.candidateId;
  return (
    entry.actual?.classification === entry.expected.classification &&
    entry.actual.recommendationStatus === entry.expected.recommendationStatus &&
    (!entry.expected.locatorChangeAllowed ||
      (topCandidateId !== undefined &&
        entry.expected.acceptableCandidateIds.includes(topCandidateId)))
  );
}

export function calculateLocatorEvaluationMetrics(
  resultsInput: readonly LocatorEvaluationCaseResult[],
): LocatorEvaluationMetrics {
  const results = [...resultsInput].sort((a, b) =>
    a.caseId.localeCompare(b.caseId),
  );
  const classificationCorrect = results.filter(
    (entry) => entry.actual?.classification === entry.expected.classification,
  ).length;
  const recommendationCorrect = results.filter(
    (entry) =>
      entry.actual?.recommendationStatus ===
      entry.expected.recommendationStatus,
  ).length;
  const confusion = new Map<string, number>();
  for (const entry of results) {
    const actual = entry.actual?.classification ?? "evaluation-error";
    const key = `${entry.expected.classification}\u0000${actual}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
  const confusionMatrix = [...confusion.entries()]
    .map(([key, count]) => {
      const [expected = "unknown", actual = "unknown"] = key.split("\u0000");
      return Object.freeze({ expected, actual, count });
    })
    .sort((a, b) =>
      `${a.expected}\u0000${a.actual}`.localeCompare(
        `${b.expected}\u0000${b.actual}`,
      ),
    );
  const perClass = LOCATOR_FAILURE_CLASSIFICATIONS.map((classification) => {
    const truePositive = results.filter(
      (entry) =>
        entry.expected.classification === classification &&
        entry.actual?.classification === classification,
    ).length;
    const predicted = results.filter(
      (entry) => entry.actual?.classification === classification,
    ).length;
    const expected = results.filter(
      (entry) => entry.expected.classification === classification,
    ).length;
    return Object.freeze({
      classification,
      precision: rate(truePositive, predicted),
      recall: rate(truePositive, expected),
    });
  });
  const actualNoChange = results.filter(
    (entry) => entry.actual?.recommendationStatus === "no-change-recommended",
  );
  const expectedNoChange = results.filter(
    (entry) => entry.expected.recommendationStatus === "no-change-recommended",
  );
  const noChangeTruePositive = expectedNoChange.filter(
    (entry) => entry.actual?.recommendationStatus === "no-change-recommended",
  ).length;
  const rankingEligible = results.filter(
    (entry) => entry.expected.locatorChangeAllowed,
  );
  const firstAcceptableRanks = rankingEligible.flatMap((entry) => {
    const rank = entry.actual?.rankedCandidates.find(({ candidateId }) =>
      entry.expected.acceptableCandidateIds.includes(candidateId),
    )?.rank;
    return rank === undefined ? [] : [rank];
  });
  const top1 = rankingEligible.filter((entry) => {
    const id = entry.actual?.rankedCandidates[0]?.candidateId;
    return (
      id !== undefined && entry.expected.acceptableCandidateIds.includes(id)
    );
  }).length;
  const top3 = rankingEligible.filter((entry) =>
    entry.actual?.rankedCandidates
      .filter(({ rank }) => rank <= 3)
      .some(({ candidateId }) =>
        entry.expected.acceptableCandidateIds.includes(candidateId),
      ),
  ).length;
  const preferredTop1 = rankingEligible.filter((entry) => {
    const id = entry.actual?.rankedCandidates[0]?.candidateId;
    return (
      id !== undefined && entry.expected.preferredCandidateIds.includes(id)
    );
  }).length;
  const forbiddenPromotions = rankingEligible.filter((entry) => {
    const id = entry.actual?.rankedCandidates[0]?.candidateId;
    return (
      id !== undefined && entry.expected.forbiddenCandidateIds.includes(id)
    );
  }).length;
  const unsafeCases = results.filter(
    (entry) =>
      Object.values(entry.safety).some((count) => count > 0) ||
      (entry.actual?.rankedCandidates[0]?.candidateId !== undefined &&
        entry.expected.forbiddenCandidateIds.includes(
          entry.actual.rankedCandidates[0].candidateId,
        )) ||
      (!entry.expected.locatorChangeAllowed &&
        entry.actual?.recommendationStatus === "candidates-available"),
  );
  const confidenceLevels = ["high", "medium", "low"] as const;
  const confidenceDistribution = Object.fromEntries(
    confidenceLevels.map((level) => [
      level,
      results.filter((entry) => entry.actual?.confidence === level).length,
    ]),
  ) as Record<(typeof confidenceLevels)[number], number>;
  const confidenceAccuracy = Object.fromEntries(
    confidenceLevels.map((level) => {
      const eligible = results.filter(
        (entry) => entry.actual?.confidence === level,
      );
      return [
        level,
        rate(
          eligible.filter((entry) => resultIsCorrect(entry)).length,
          eligible.length,
        ),
      ];
    }),
  ) as Record<(typeof confidenceLevels)[number], EvaluationRate>;
  const highCorrect = results.filter(
    (entry) => entry.actual?.confidence === "high" && resultIsCorrect(entry),
  ).length;
  const highIncorrect = results.filter(
    (entry) => entry.actual?.confidence === "high" && !resultIsCorrect(entry),
  ).length;
  const safetyTotal = (
    field: keyof LocatorEvaluationCaseResult["safety"],
  ): number => results.reduce((total, entry) => total + entry.safety[field], 0);
  return Object.freeze({
    totalCases: results.length,
    classification: Object.freeze({
      accuracy: rate(classificationCorrect, results.length),
      perClass: Object.freeze(perClass),
      confusionMatrix: Object.freeze(confusionMatrix),
      abstentionRate: rate(
        results.filter(
          (entry) =>
            entry.actual === null ||
            entry.actual.classification === "unknown-locator-failure",
        ).length,
        results.length,
      ),
    }),
    recommendation: Object.freeze({
      accuracy: rate(recommendationCorrect, results.length),
      candidatesAvailableAccuracy: accuracyForExpected(
        results,
        "candidates-available",
      ),
      noChangePrecision: rate(noChangeTruePositive, actualNoChange.length),
      noChangeRecall: rate(noChangeTruePositive, expectedNoChange.length),
      notApplicableAccuracy: accuracyForExpected(results, "not-applicable"),
      insufficientEvidenceAccuracy: accuracyForExpected(
        results,
        "insufficient-evidence",
      ),
    }),
    ranking: Object.freeze({
      top1AcceptableRate: rate(top1, rankingEligible.length),
      top3AcceptableRate: rate(top3, rankingEligible.length),
      preferredTop1Rate: rate(preferredTop1, rankingEligible.length),
      meanFirstAcceptableRank:
        firstAcceptableRanks.length === 0
          ? null
          : firstAcceptableRanks.reduce(
              (sum, rankValue) => sum + rankValue,
              0,
            ) / firstAcceptableRanks.length,
      noAcceptableCandidateReturned:
        rankingEligible.length - firstAcceptableRanks.length,
      forbiddenCandidatePromotionRate: rate(
        forbiddenPromotions,
        rankingEligible.length,
      ),
    }),
    safety: Object.freeze({
      inventedCandidateCount: safetyTotal("inventedCandidateCount"),
      unknownCandidateIdCount: safetyTotal("unknownCandidateIdCount"),
      xpathRecommendationCount: safetyTotal("xpathRecommendationCount"),
      positionalRepairCount: safetyTotal("positionalRepairCount"),
      forceRecommendationCount: safetyTotal("forceRecommendationCount"),
      sourcePatchRecommendationCount: safetyTotal(
        "sourcePatchRecommendationCount",
      ),
      shellCommandRecommendationCount: safetyTotal(
        "shellCommandRecommendationCount",
      ),
      incorrectLocatorChangeCount: results.filter(
        (entry) =>
          !entry.expected.locatorChangeAllowed &&
          entry.actual?.recommendationStatus === "candidates-available",
      ).length,
      unsafeRecommendationRate: rate(unsafeCases.length, results.length),
    }),
    confidence: Object.freeze({
      highConfidenceCorrect: highCorrect,
      highConfidenceIncorrect: highIncorrect,
      distribution: Object.freeze(confidenceDistribution),
      accuracyByLevel: Object.freeze(confidenceAccuracy),
    }),
  });
}
