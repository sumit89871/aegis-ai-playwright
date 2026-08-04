import {
  renderCliBanner,
  renderCliNotice,
  renderCliSection,
  type CliKeyValueRow,
  type TerminalCapabilities,
} from "../cli/index.ts";
import type { EvaluationRate } from "../locator-evaluation/evaluation-metrics.ts";
import type { LocatorBlindHoldoutAggregateSummary } from "./locator-blind-holdout.ts";

function formatRate(rate: EvaluationRate): string {
  return rate.value === null
    ? "N/A (0 eligible cases)"
    : `${(rate.value * 100).toFixed(1)}% (${String(rate.numerator)}/${String(rate.denominator)})`;
}

function rateStatus(
  rate: EvaluationRate,
  direction: "higher" | "lower" = "higher",
): NonNullable<CliKeyValueRow["status"]> {
  if (rate.value === null) return "neutral";
  const favorable =
    direction === "higher" ? rate.value === 1 : rate.value === 0;
  return favorable ? "success" : "warning";
}

function countStatus(value: number): NonNullable<CliKeyValueRow["status"]> {
  return value === 0 ? "success" : "danger";
}

export function renderLocatorBlindHoldoutTerminal(
  summary: LocatorBlindHoldoutAggregateSummary,
  capabilities: TerminalCapabilities,
  elapsedMs: number,
): string {
  const metrics = summary.metrics;
  const warning = renderCliNotice(
    summary.meaningful ? "INFO" : "WARNING",
    summary.sampleNotice,
    capabilities,
  );
  const unsafe = metrics.safety.unsafeRecommendation.numerator;
  const interpretation =
    unsafe > 0
      ? renderCliNotice(
          "RISK",
          "One or more aggregate safety signals require investigation. The evaluator remains advisory and applies no locator.",
          capabilities,
        )
      : summary.meaningful
        ? renderCliNotice(
            "SUCCESS",
            "The aggregate sample is evaluable, but its metrics still do not authorize automatic locator application or healing.",
            capabilities,
          )
        : renderCliNotice(
            "WARNING",
            "The sample is useful directional evidence only. Collect more independent blind reviews before drawing production conclusions.",
            capabilities,
          );

  return [
    renderCliBanner("AegisAI · Blind Locator Holdout", capabilities),
    renderCliSection(
      "Run status",
      [
        { label: "Mode", value: summary.mode },
        {
          label: "Sample status",
          value: summary.status.toUpperCase(),
          status: summary.meaningful ? "success" : "warning",
        },
      ],
      capabilities,
    ),
    warning,
    renderCliSection(
      "Review eligibility",
      [
        {
          label: "Pilot/calibration",
          value: String(summary.counts.calibrationPilotReviewed),
        },
        {
          label: "Blind reviewed",
          value: String(summary.counts.blindHoldoutReviewed),
        },
        {
          label: "Pending blind",
          value: String(summary.counts.pendingBlindReviews),
        },
        {
          label: "Invalid blind",
          value: String(summary.counts.invalidBlindReviews),
          status: countStatus(summary.counts.invalidBlindReviews),
        },
        {
          label: "Ineligible",
          value: String(summary.counts.ineligibleReviews),
          status: countStatus(summary.counts.ineligibleReviews),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Diagnosis quality",
      [
        {
          label: "Classification agreement",
          value: formatRate(metrics.classification.agreement),
          status: rateStatus(metrics.classification.agreement),
        },
        {
          label: "Unknown/eval abstention",
          value: formatRate(
            metrics.classification.unknownOrEvaluationAbstention,
          ),
          status: rateStatus(
            metrics.classification.unknownOrEvaluationAbstention,
            "lower",
          ),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Recommendation quality",
      [
        {
          label: "Overall agreement",
          value: formatRate(metrics.recommendation.agreement),
          status: rateStatus(metrics.recommendation.agreement),
        },
        {
          label: "Candidates available",
          value: formatRate(
            metrics.recommendation.candidatesAvailableAgreement,
          ),
          status: rateStatus(
            metrics.recommendation.candidatesAvailableAgreement,
          ),
        },
        {
          label: "No-change precision",
          value: formatRate(metrics.recommendation.noChangePrecision),
          status: rateStatus(metrics.recommendation.noChangePrecision),
        },
        {
          label: "No-change recall",
          value: formatRate(metrics.recommendation.noChangeRecall),
          status: rateStatus(metrics.recommendation.noChangeRecall),
        },
        {
          label: "Not applicable",
          value: formatRate(metrics.recommendation.notApplicableAgreement),
          status: rateStatus(metrics.recommendation.notApplicableAgreement),
        },
        {
          label: "Insufficient evidence",
          value: formatRate(
            metrics.recommendation.insufficientEvidenceAgreement,
          ),
          status: rateStatus(
            metrics.recommendation.insufficientEvidenceAgreement,
          ),
        },
        {
          label: "Collection unavailable",
          value: formatRate(
            metrics.recommendation.collectionUnavailableAgreement,
          ),
          status: rateStatus(
            metrics.recommendation.collectionUnavailableAgreement,
          ),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Candidate ranking",
      [
        {
          label: "Top-1 acceptable",
          value: formatRate(metrics.ranking.top1Acceptable),
          status: rateStatus(metrics.ranking.top1Acceptable),
        },
        {
          label: "Top-3 acceptable",
          value: formatRate(metrics.ranking.top3Acceptable),
          status: rateStatus(metrics.ranking.top3Acceptable),
        },
        {
          label: "Preferred at top 1",
          value: formatRate(metrics.ranking.preferredAtTop1),
          status: rateStatus(metrics.ranking.preferredAtTop1),
        },
        {
          label: "Mean first acceptable rank",
          value:
            metrics.ranking.meanFirstAcceptableRank === null
              ? "N/A"
              : String(metrics.ranking.meanFirstAcceptableRank),
        },
        {
          label: "No acceptable returned",
          value: String(metrics.ranking.noAcceptableCandidateReturned),
          status: countStatus(metrics.ranking.noAcceptableCandidateReturned),
        },
        {
          label: "Forbidden at top 1",
          value: formatRate(metrics.ranking.forbiddenAtTop1),
          status: rateStatus(metrics.ranking.forbiddenAtTop1, "lower"),
        },
        {
          label: "Forbidden within top 3",
          value: formatRate(metrics.ranking.forbiddenWithinTop3),
          status: rateStatus(metrics.ranking.forbiddenWithinTop3, "lower"),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Safety signals",
      [
        {
          label: "Unsafe recommendations",
          value: formatRate(metrics.safety.unsafeRecommendation),
          status: rateStatus(metrics.safety.unsafeRecommendation, "lower"),
        },
        {
          label: "Incorrect locator change",
          value: String(metrics.safety.incorrectLocatorChangeCount),
          status: countStatus(metrics.safety.incorrectLocatorChangeCount),
        },
        {
          label: "Invented / unknown IDs",
          value: `${String(metrics.safety.inventedCandidateCount)} / ${String(metrics.safety.unknownCandidateIdCount)}`,
          status: countStatus(
            metrics.safety.inventedCandidateCount +
              metrics.safety.unknownCandidateIdCount,
          ),
        },
        {
          label: "XPath / positional / force",
          value: `${String(metrics.safety.xpathRecommendationCount)} / ${String(metrics.safety.positionalRepairCount)} / ${String(metrics.safety.forceRecommendationCount)}`,
          status: countStatus(
            metrics.safety.xpathRecommendationCount +
              metrics.safety.positionalRepairCount +
              metrics.safety.forceRecommendationCount,
          ),
        },
        {
          label: "Patch / shell command",
          value: `${String(metrics.safety.sourcePatchRecommendationCount)} / ${String(metrics.safety.shellCommandRecommendationCount)}`,
          status: countStatus(
            metrics.safety.sourcePatchRecommendationCount +
              metrics.safety.shellCommandRecommendationCount,
          ),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Confidence and abstention",
      [
        {
          label: "Confidence floor",
          value: formatRate(metrics.confidence.floorAgreement),
          status: rateStatus(metrics.confidence.floorAgreement),
        },
        {
          label: "High correct / incorrect",
          value: `${String(metrics.confidence.highConfidenceCorrect)} / ${String(metrics.confidence.highConfidenceIncorrect)}`,
          status: countStatus(metrics.confidence.highConfidenceIncorrect),
        },
        {
          label: "High / medium / low",
          value: `${String(metrics.confidence.distribution.high)} / ${String(metrics.confidence.distribution.medium)} / ${String(metrics.confidence.distribution.low)}`,
        },
        {
          label: "Abstention correctness",
          value: formatRate(metrics.abstention.correctness),
          status: rateStatus(metrics.abstention.correctness),
        },
        {
          label: "Appropriate / inappropriate",
          value: `${String(metrics.abstention.appropriateCount)} / ${String(metrics.abstention.inappropriateCount)}`,
          status: countStatus(metrics.abstention.inappropriateCount),
        },
        {
          label: "Expected, recommendation made",
          value: String(metrics.abstention.expectedButRecommendationMadeCount),
          status: countStatus(
            metrics.abstention.expectedButRecommendationMadeCount,
          ),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Execution isolation",
      [
        { label: "Network calls", value: "0", status: "success" },
        { label: "API key required", value: "no", status: "success" },
        { label: "Locator application", value: "absent", status: "success" },
        { label: "Automatic healing", value: "absent", status: "success" },
        {
          label: "Elapsed time",
          value: `${(Math.max(0, elapsedMs) / 1000).toFixed(2)}s`,
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Final interpretation",
      [
        {
          label: "Result",
          value:
            unsafe > 0
              ? "Review aggregate safety signals before considering any new advisory experiment."
              : "Continue collecting independent evidence; no locator is executed or applied.",
          status: unsafe > 0 ? "danger" : "neutral",
        },
      ],
      capabilities,
    ),
    interpretation,
  ].join("\n\n");
}
