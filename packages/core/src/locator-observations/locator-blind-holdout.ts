import type { LocatorEvaluationMode } from "../locator-evaluation/evaluation-runner.ts";
import type { EvaluationRate } from "../locator-evaluation/evaluation-metrics.ts";
import type { LocatorObservation } from "./locator-observation.ts";
import type { LocatorObservationReview } from "./locator-observation-review.ts";
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
  runLocatorHoldoutEvaluation,
  type LocatorHoldoutResult,
} from "./locator-holdout-runner.ts";

export interface LocatorBlindHoldoutRecord {
  readonly observation: LocatorObservation;
  readonly packet: LocatorBlindReviewPacket;
  readonly mapping: LocatorBlindCandidateMapping;
  readonly review: LocatorBlindReview;
}

export interface LocatorBlindHoldoutResult {
  readonly schemaVersion: "1.0.0";
  readonly mode: LocatorEvaluationMode;
  readonly status: LocatorHoldoutResult["status"];
  readonly meaningful: boolean;
  readonly counts: {
    readonly calibrationPilotReviewed: number;
    readonly blindHoldoutReviewed: number;
    readonly pendingBlindReviews: number;
    readonly invalidBlindReviews: number;
    readonly ineligibleReviews: number;
  };
  readonly holdout: LocatorHoldoutResult;
  readonly notice: string;
  readonly safety: {
    readonly networkCalls: 0;
    readonly locatorApplications: 0;
    readonly automaticHealing: false;
  };
}

export interface LocatorBlindHoldoutAggregateSummary {
  readonly schemaVersion: "1.0.0";
  readonly mode: LocatorEvaluationMode;
  readonly status: LocatorBlindHoldoutResult["status"];
  readonly meaningful: boolean;
  readonly sampleNotice: string;
  readonly counts: {
    readonly calibrationPilotReviewed: number;
    readonly blindHoldoutReviewed: number;
    readonly pendingBlindReviews: number;
    readonly invalidBlindReviews: number;
    readonly ineligibleReviews: number;
  };
  readonly sourceTypeCounts: Readonly<
    Record<LocatorObservation["sourceType"], number>
  >;
  readonly metrics: {
    readonly classification: {
      readonly agreement: EvaluationRate;
      readonly unknownOrEvaluationAbstention: EvaluationRate;
    };
    readonly recommendation: {
      readonly agreement: EvaluationRate;
      readonly candidatesAvailableAgreement: EvaluationRate;
      readonly noChangePrecision: EvaluationRate;
      readonly noChangeRecall: EvaluationRate;
      readonly notApplicableAgreement: EvaluationRate;
      readonly insufficientEvidenceAgreement: EvaluationRate;
      readonly collectionUnavailableAgreement: EvaluationRate;
    };
    readonly ranking: {
      readonly top1Acceptable: EvaluationRate;
      readonly top3Acceptable: EvaluationRate;
      readonly preferredAtTop1: EvaluationRate;
      readonly meanFirstAcceptableRank: number | null;
      readonly noAcceptableCandidateReturned: number;
      readonly forbiddenAtTop1: EvaluationRate;
      readonly forbiddenWithinTop3: EvaluationRate;
    };
    readonly safety: {
      readonly unsafeRecommendation: EvaluationRate;
      readonly incorrectLocatorChangeCount: number;
      readonly inventedCandidateCount: number;
      readonly unknownCandidateIdCount: number;
      readonly xpathRecommendationCount: number;
      readonly positionalRepairCount: number;
      readonly forceRecommendationCount: number;
      readonly sourcePatchRecommendationCount: number;
      readonly shellCommandRecommendationCount: number;
    };
    readonly confidence: {
      readonly distribution: Readonly<
        Record<"high" | "medium" | "low", number>
      >;
      readonly highConfidenceCorrect: number;
      readonly highConfidenceIncorrect: number;
      readonly floorAgreement: EvaluationRate;
    };
    readonly abstention: {
      readonly appropriateCount: number;
      readonly inappropriateCount: number;
      readonly expectedButRecommendationMadeCount: number;
      readonly opportunityCount: number;
      readonly correctness: EvaluationRate;
    };
  };
  readonly isolation: {
    readonly networkCalls: 0;
    readonly apiKeyRequired: false;
    readonly locatorApplications: 0;
    readonly automaticHealing: false;
  };
}

function aggregateRate(input: EvaluationRate): EvaluationRate {
  return Object.freeze({
    numerator: input.numerator,
    denominator: input.denominator,
    value: input.value,
  });
}

export function createLocatorBlindHoldoutAggregateSummary(
  result: LocatorBlindHoldoutResult,
): LocatorBlindHoldoutAggregateSummary {
  const metrics = result.holdout.metrics;
  const sampleNotice =
    result.counts.blindHoldoutReviewed === 0
      ? "Zero eligible blind holdout reviews are available. Pilot/calibration reviews remain separate and are not accuracy evidence."
      : result.meaningful
        ? "Aggregate metrics describe independently reviewed blind holdout cases; sample size alone never authorizes locator application or automatic healing."
        : `${String(result.counts.blindHoldoutReviewed)} independently reviewed blind holdout case(s) are available. This sample is insufficient for a production-accuracy claim and never authorizes locator application or automatic healing.`;
  return Object.freeze({
    schemaVersion: "1.0.0",
    mode: result.mode,
    status: result.status,
    meaningful: result.meaningful,
    sampleNotice,
    counts: Object.freeze({
      calibrationPilotReviewed: result.counts.calibrationPilotReviewed,
      blindHoldoutReviewed: result.counts.blindHoldoutReviewed,
      pendingBlindReviews: result.counts.pendingBlindReviews,
      invalidBlindReviews: result.counts.invalidBlindReviews,
      ineligibleReviews: result.counts.ineligibleReviews,
    }),
    sourceTypeCounts: Object.freeze({
      "real-shadow": result.holdout.sourceCounts["real-shadow"],
      "controlled-browser": result.holdout.sourceCounts["controlled-browser"],
      "imported-sanitized": result.holdout.sourceCounts["imported-sanitized"],
      "synthetic-test-fixture":
        result.holdout.sourceCounts["synthetic-test-fixture"],
    }),
    metrics: Object.freeze({
      classification: Object.freeze({
        agreement: aggregateRate(metrics.classification.accuracy),
        unknownOrEvaluationAbstention: aggregateRate(
          metrics.classification.abstentionRate,
        ),
      }),
      recommendation: Object.freeze({
        agreement: aggregateRate(metrics.recommendation.accuracy),
        candidatesAvailableAgreement: aggregateRate(
          metrics.recommendation.candidatesAvailableAccuracy,
        ),
        noChangePrecision: aggregateRate(
          metrics.recommendation.noChangePrecision,
        ),
        noChangeRecall: aggregateRate(metrics.recommendation.noChangeRecall),
        notApplicableAgreement: aggregateRate(
          metrics.recommendation.notApplicableAccuracy,
        ),
        insufficientEvidenceAgreement: aggregateRate(
          metrics.recommendation.insufficientEvidenceAccuracy,
        ),
        collectionUnavailableAgreement: aggregateRate(
          metrics.recommendation.collectionUnavailableAccuracy,
        ),
      }),
      ranking: Object.freeze({
        top1Acceptable: aggregateRate(metrics.ranking.top1AcceptableRate),
        top3Acceptable: aggregateRate(metrics.ranking.top3AcceptableRate),
        preferredAtTop1: aggregateRate(metrics.ranking.preferredTop1Rate),
        meanFirstAcceptableRank: metrics.ranking.meanFirstAcceptableRank,
        noAcceptableCandidateReturned:
          metrics.ranking.noAcceptableCandidateReturned,
        forbiddenAtTop1: aggregateRate(
          metrics.ranking.forbiddenCandidatePromotionRate,
        ),
        forbiddenWithinTop3: aggregateRate(
          metrics.ranking.forbiddenCandidateTop3PromotionRate,
        ),
      }),
      safety: Object.freeze({
        unsafeRecommendation: aggregateRate(
          metrics.safety.unsafeRecommendationRate,
        ),
        incorrectLocatorChangeCount: metrics.safety.incorrectLocatorChangeCount,
        inventedCandidateCount: metrics.safety.inventedCandidateCount,
        unknownCandidateIdCount: metrics.safety.unknownCandidateIdCount,
        xpathRecommendationCount: metrics.safety.xpathRecommendationCount,
        positionalRepairCount: metrics.safety.positionalRepairCount,
        forceRecommendationCount: metrics.safety.forceRecommendationCount,
        sourcePatchRecommendationCount:
          metrics.safety.sourcePatchRecommendationCount,
        shellCommandRecommendationCount:
          metrics.safety.shellCommandRecommendationCount,
      }),
      confidence: Object.freeze({
        distribution: Object.freeze({
          high: metrics.confidence.distribution.high,
          medium: metrics.confidence.distribution.medium,
          low: metrics.confidence.distribution.low,
        }),
        highConfidenceCorrect: metrics.confidence.highConfidenceCorrect,
        highConfidenceIncorrect: metrics.confidence.highConfidenceIncorrect,
        floorAgreement: aggregateRate(metrics.confidence.floorAgreement),
      }),
      abstention: Object.freeze({
        appropriateCount: metrics.abstention.appropriateCount,
        inappropriateCount: metrics.abstention.inappropriateCount,
        expectedButRecommendationMadeCount:
          metrics.abstention.expectedButRecommendationMadeCount,
        opportunityCount: metrics.abstention.opportunityCount,
        correctness: aggregateRate(metrics.abstention.correctness),
      }),
    }),
    isolation: Object.freeze({
      networkCalls: 0,
      apiKeyRequired: false,
      locatorApplications: 0,
      automaticHealing: false,
    }),
  });
}

export async function runLocatorBlindHoldoutEvaluation(
  records: readonly LocatorBlindHoldoutRecord[],
  options: {
    readonly mode?: "deterministic-only" | "mock-ai";
    readonly calibrationPilotReviewed?: number;
    readonly invalidBlindReviews?: number;
  } = {},
): Promise<LocatorBlindHoldoutResult> {
  const reviewed: LocatorObservationReview[] = [];
  const observations: LocatorObservation[] = [];
  let pending = 0;
  let ineligible = 0;
  for (const record of [...records].sort((left, right) =>
    left.packet.blindPacketId.localeCompare(right.packet.blindPacketId),
  )) {
    const packet = validateLocatorBlindReviewPacket(
      record.packet,
      record.observation,
    );
    validateLocatorBlindCandidateMapping(
      record.mapping,
      packet,
      record.observation,
    );
    const review = validateLocatorBlindReview(record.review, packet);
    if (review.reviewStatus === "pending") {
      pending += 1;
      continue;
    }
    if (review.reviewStatus !== "reviewed") {
      ineligible += 1;
      continue;
    }
    observations.push(record.observation);
    reviewed.push(
      translateLocatorBlindReview(
        record.observation,
        packet,
        record.mapping,
        review,
      ),
    );
  }
  const holdout = await runLocatorHoldoutEvaluation(
    observations,
    reviewed,
    options.mode === undefined ? {} : { mode: options.mode },
  );
  const blindCount = reviewed.length;
  const notice =
    blindCount === 0
      ? "Zero eligible blind holdout reviews are available. Pilot/calibration reviews are reported separately and are not accuracy evidence."
      : `${String(blindCount)} blind holdout review(s) were evaluated independently. Sample size alone never authorizes locator replay or automatic healing.`;
  return Object.freeze({
    schemaVersion: "1.0.0",
    mode: options.mode ?? "deterministic-only",
    status: holdout.status,
    meaningful: holdout.meaningful,
    counts: Object.freeze({
      calibrationPilotReviewed: options.calibrationPilotReviewed ?? 0,
      blindHoldoutReviewed: blindCount,
      pendingBlindReviews: pending,
      invalidBlindReviews: options.invalidBlindReviews ?? 0,
      ineligibleReviews: ineligible,
    }),
    holdout,
    notice,
    safety: Object.freeze({
      networkCalls: 0,
      locatorApplications: 0,
      automaticHealing: false,
    }),
  });
}

function formatAggregateRate(rate: EvaluationRate): string {
  return rate.value === null
    ? "N/A (0 eligible cases)"
    : `${(rate.value * 100).toFixed(1)}% (${String(rate.numerator)}/${String(rate.denominator)})`;
}

function safeMarkdown(value: string): string {
  return value
    .replace(/[<>]/gu, "")
    .replace(/[`|]/gu, "\\$&")
    .replace(/\r?\n/gu, " ")
    .slice(0, 500);
}

export function renderLocatorBlindHoldoutHumanSummary(
  summary: LocatorBlindHoldoutAggregateSummary,
): string {
  const metrics = summary.metrics;
  return [
    `Blind locator holdout: ${summary.status.toUpperCase()}`,
    `Warning: ${summary.sampleNotice}`,
    `Pilot/calibration reviewed ${String(summary.counts.calibrationPilotReviewed)} | blind reviewed ${String(summary.counts.blindHoldoutReviewed)} | pending blind ${String(summary.counts.pendingBlindReviews)} | invalid blind ${String(summary.counts.invalidBlindReviews)} | ineligible ${String(summary.counts.ineligibleReviews)}`,
    `Classification agreement: ${formatAggregateRate(metrics.classification.agreement)}`,
    `Recommendation agreement: ${formatAggregateRate(metrics.recommendation.agreement)}`,
    `Candidates-available agreement: ${formatAggregateRate(metrics.recommendation.candidatesAvailableAgreement)}`,
    `No-change precision/recall: ${formatAggregateRate(metrics.recommendation.noChangePrecision)} / ${formatAggregateRate(metrics.recommendation.noChangeRecall)}`,
    `Insufficient-evidence agreement: ${formatAggregateRate(metrics.recommendation.insufficientEvidenceAgreement)}`,
    `Top-1/top-3 acceptable: ${formatAggregateRate(metrics.ranking.top1Acceptable)} / ${formatAggregateRate(metrics.ranking.top3Acceptable)}`,
    `Preferred at top 1: ${formatAggregateRate(metrics.ranking.preferredAtTop1)}`,
    `Forbidden at top 1/within top 3: ${formatAggregateRate(metrics.ranking.forbiddenAtTop1)} / ${formatAggregateRate(metrics.ranking.forbiddenWithinTop3)}`,
    `Mean first acceptable rank: ${metrics.ranking.meanFirstAcceptableRank === null ? "N/A" : String(metrics.ranking.meanFirstAcceptableRank)} | no acceptable candidate returned: ${String(metrics.ranking.noAcceptableCandidateReturned)}`,
    `Unsafe recommendations: ${formatAggregateRate(metrics.safety.unsafeRecommendation)} | incorrect locator-change recommendations: ${String(metrics.safety.incorrectLocatorChangeCount)}`,
    `Prohibited output counts (invented/unknown/XPath/positional/force/patch/command): ${String(metrics.safety.inventedCandidateCount)}/${String(metrics.safety.unknownCandidateIdCount)}/${String(metrics.safety.xpathRecommendationCount)}/${String(metrics.safety.positionalRepairCount)}/${String(metrics.safety.forceRecommendationCount)}/${String(metrics.safety.sourcePatchRecommendationCount)}/${String(metrics.safety.shellCommandRecommendationCount)}`,
    `Confidence floor: ${formatAggregateRate(metrics.confidence.floorAgreement)} | high-confidence correct/incorrect: ${String(metrics.confidence.highConfidenceCorrect)}/${String(metrics.confidence.highConfidenceIncorrect)}`,
    `Confidence distribution (high/medium/low): ${String(metrics.confidence.distribution.high)}/${String(metrics.confidence.distribution.medium)}/${String(metrics.confidence.distribution.low)}`,
    `Abstention correctness: ${formatAggregateRate(metrics.abstention.correctness)} | appropriate ${String(metrics.abstention.appropriateCount)} | inappropriate ${String(metrics.abstention.inappropriateCount)} | expected but recommendation made ${String(metrics.abstention.expectedButRecommendationMadeCount)}`,
    "Pilot/calibration cases are excluded from every blind quality denominator.",
    "Network calls: 0 | API key required: no | locator application: absent | healing: absent",
  ].join("\n");
}

export function renderLocatorBlindHoldoutAggregateMarkdown(
  summary: LocatorBlindHoldoutAggregateSummary,
): string {
  const metrics = summary.metrics;
  const lines = [
    "# Blind locator holdout evaluation",
    "",
    `- Status: ${summary.status}`,
    `- Meaningful sample: ${summary.meaningful ? "yes" : "no"}`,
    `- Warning: ${safeMarkdown(summary.sampleNotice)}`,
    `- Blind holdout cases: ${String(summary.counts.blindHoldoutReviewed)}`,
    `- Deterministic mode: ${summary.mode}`,
    "- Pilot/calibration cases are excluded from every blind quality denominator.",
    `- The ${String(summary.counts.blindHoldoutReviewed)}-case blind sample cannot establish production accuracy.`,
    "",
    "## Review eligibility",
    "",
    `- Pilot/calibration reviewed: ${String(summary.counts.calibrationPilotReviewed)}`,
    `- Blind holdout reviewed: ${String(summary.counts.blindHoldoutReviewed)}`,
    `- Pending blind reviews: ${String(summary.counts.pendingBlindReviews)}`,
    `- Invalid blind reviews: ${String(summary.counts.invalidBlindReviews)}`,
    `- Ineligible reviews: ${String(summary.counts.ineligibleReviews)}`,
    "",
    "## Classification and recommendation",
    "",
    `- Classification agreement: ${formatAggregateRate(metrics.classification.agreement)}`,
    `- Unknown/evaluation abstention rate: ${formatAggregateRate(metrics.classification.unknownOrEvaluationAbstention)}`,
    `- Recommendation agreement: ${formatAggregateRate(metrics.recommendation.agreement)}`,
    `- Candidates-available agreement: ${formatAggregateRate(metrics.recommendation.candidatesAvailableAgreement)}`,
    `- No-change precision: ${formatAggregateRate(metrics.recommendation.noChangePrecision)}`,
    `- No-change recall: ${formatAggregateRate(metrics.recommendation.noChangeRecall)}`,
    `- Not-applicable agreement: ${formatAggregateRate(metrics.recommendation.notApplicableAgreement)}`,
    `- Insufficient-evidence agreement: ${formatAggregateRate(metrics.recommendation.insufficientEvidenceAgreement)}`,
    `- Collection-unavailable agreement: ${formatAggregateRate(metrics.recommendation.collectionUnavailableAgreement)}`,
    "",
    "## Candidate ranking",
    "",
    `- Top-1 acceptable: ${formatAggregateRate(metrics.ranking.top1Acceptable)}`,
    `- Top-3 acceptable: ${formatAggregateRate(metrics.ranking.top3Acceptable)}`,
    `- Preferred at top 1: ${formatAggregateRate(metrics.ranking.preferredAtTop1)}`,
    `- Mean first acceptable rank: ${metrics.ranking.meanFirstAcceptableRank === null ? "N/A" : String(metrics.ranking.meanFirstAcceptableRank)}`,
    `- No acceptable candidate returned: ${String(metrics.ranking.noAcceptableCandidateReturned)}`,
    `- Forbidden at top 1: ${formatAggregateRate(metrics.ranking.forbiddenAtTop1)}`,
    `- Forbidden within top 3: ${formatAggregateRate(metrics.ranking.forbiddenWithinTop3)}`,
    "",
    "## Safety",
    "",
    `- Unsafe recommendation rate: ${formatAggregateRate(metrics.safety.unsafeRecommendation)}`,
    `- Incorrect locator-change recommendations: ${String(metrics.safety.incorrectLocatorChangeCount)}`,
    `- Invented candidates: ${String(metrics.safety.inventedCandidateCount)}`,
    `- Unknown candidate IDs: ${String(metrics.safety.unknownCandidateIdCount)}`,
    `- XPath/positional/force detections: ${String(metrics.safety.xpathRecommendationCount)}/${String(metrics.safety.positionalRepairCount)}/${String(metrics.safety.forceRecommendationCount)}`,
    `- Patch/command detections: ${String(metrics.safety.sourcePatchRecommendationCount)}/${String(metrics.safety.shellCommandRecommendationCount)}`,
    "",
    "## Confidence and abstention",
    "",
    `- Confidence-floor agreement: ${formatAggregateRate(metrics.confidence.floorAgreement)}`,
    `- High-confidence correct: ${String(metrics.confidence.highConfidenceCorrect)}`,
    `- High-confidence incorrect: ${String(metrics.confidence.highConfidenceIncorrect)}`,
    `- Confidence distribution (high/medium/low): ${String(metrics.confidence.distribution.high)}/${String(metrics.confidence.distribution.medium)}/${String(metrics.confidence.distribution.low)}`,
    `- Abstention correctness: ${formatAggregateRate(metrics.abstention.correctness)}`,
    `- Appropriate abstentions: ${String(metrics.abstention.appropriateCount)}`,
    `- Inappropriate abstentions: ${String(metrics.abstention.inappropriateCount)}`,
    `- Expected abstention but recommendation returned: ${String(metrics.abstention.expectedButRecommendationMadeCount)}`,
    `- Abstention opportunities: ${String(metrics.abstention.opportunityCount)}`,
    "",
    "## Isolation",
    "",
    "- Expected answers are loaded only after deterministic diagnosis input is built.",
    "- Neutral aliases are translated only after review validation.",
    "- Network calls: 0",
    "- API key required: no",
    "- Locator applications: 0",
    "- Automatic healing: absent",
  ];
  return lines.join("\n");
}

export function renderLocatorBlindHoldoutMarkdown(
  result: LocatorBlindHoldoutResult,
): string {
  return renderLocatorBlindHoldoutAggregateMarkdown(
    createLocatorBlindHoldoutAggregateSummary(result),
  );
}
