import {
  renderCliBanner,
  renderCliNotice,
  renderCliSection,
  type CliKeyValueRow,
  type TerminalCapabilities,
} from "../cli/index.ts";
import type { EvaluationRate } from "../locator-evaluation/evaluation-metrics.ts";
import type {
  LocatorAdvisoryComparisonAggregateSummary,
  LocatorComparisonDelta,
} from "./locator-advisory-comparison.ts";

function formatRate(rate: EvaluationRate): string {
  return rate.value === null
    ? "N/A (0 eligible cases)"
    : `${(rate.value * 100).toFixed(1)}% (${String(rate.numerator)}/${String(rate.denominator)})`;
}

function formatDelta(delta: LocatorComparisonDelta): string {
  if (delta.percentagePointDelta === null) return "N/A";
  const sign = delta.percentagePointDelta > 0 ? "+" : "";
  return `${sign}${delta.percentagePointDelta.toFixed(1)} pp · ${delta.outcome}`;
}

function deltaStatus(
  delta: LocatorComparisonDelta,
): NonNullable<CliKeyValueRow["status"]> {
  if (delta.outcome === "improved") return "success";
  if (delta.outcome === "worsened") return "danger";
  return "neutral";
}

function comparisonValue(
  baseline: EvaluationRate,
  advisory: EvaluationRate,
  delta: LocatorComparisonDelta,
): string {
  return `det ${formatRate(baseline)} | AI ${formatRate(advisory)} | ${formatDelta(delta)}`;
}

function numberOrNA(value: number | null, decimals = 2): string {
  return value === null ? "N/A" : value.toFixed(decimals);
}

function aggregateCategories(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values);
  return entries.length === 0
    ? "none"
    : entries.map(([name, count]) => `${name}: ${String(count)}`).join(", ");
}

export function renderLocatorAdvisoryComparisonTerminal(
  summary: LocatorAdvisoryComparisonAggregateSummary,
  capabilities: TerminalCapabilities,
  elapsedMs: number,
): string {
  const deterministic = summary.deterministic;
  const advisory = summary.advisory;
  const deltas = summary.deltas;
  const providerFailures = summary.provider.failedRequestCount;
  const unsafe = advisory.safety.unsafeRecommendation.numerator;
  return [
    renderCliBanner("AegisAI · Locator Reranking Comparison", capabilities),
    renderCliSection(
      "Run status",
      [
        { label: "Requested mode", value: summary.requestedMode },
        { label: "Effective mode", value: summary.effectiveMode },
        {
          label: "Sample status",
          value: summary.status.toUpperCase(),
          status: summary.meaningful ? "success" : "warning",
        },
      ],
      capabilities,
    ),
    renderCliNotice(
      summary.meaningful ? "INFO" : "WARNING",
      summary.sampleNotice,
      capabilities,
    ),
    renderCliSection(
      "Review and advisory coverage",
      [
        {
          label: "Pilot / blind reviewed",
          value: `${String(summary.counts.calibrationPilotReviewed)} / ${String(summary.counts.blindReviewed)}`,
        },
        {
          label: "Pending / invalid / ineligible",
          value: `${String(summary.counts.pendingBlind)} / ${String(summary.counts.invalidBlind)} / ${String(summary.counts.ineligible)}`,
        },
        {
          label: "AI completed / eligible",
          value: `${String(summary.counts.advisoryCompleted)} / ${String(summary.counts.advisoryEligible)}`,
          status:
            summary.counts.advisoryUnavailable === 0 ? "success" : "warning",
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Recommendation quality · deterministic versus AI advisory",
      [
        {
          label: "Classification agreement",
          value: comparisonValue(
            deterministic.classification.agreement,
            advisory.classification.agreement,
            deltas.classificationAgreement,
          ),
          status: deltaStatus(deltas.classificationAgreement),
        },
        {
          label: "Overall agreement",
          value: comparisonValue(
            deterministic.recommendation.agreement,
            advisory.recommendation.agreement,
            deltas.recommendationAgreement,
          ),
          status: deltaStatus(deltas.recommendationAgreement),
        },
        {
          label: "Candidates available",
          value: comparisonValue(
            deterministic.recommendation.candidatesAvailableAgreement,
            advisory.recommendation.candidatesAvailableAgreement,
            deltas.candidatesAvailableAgreement,
          ),
          status: deltaStatus(deltas.candidatesAvailableAgreement),
        },
        {
          label: "No-change precision / recall",
          value: `det ${formatRate(deterministic.recommendation.noChangePrecision)} / ${formatRate(deterministic.recommendation.noChangeRecall)} | AI ${formatRate(advisory.recommendation.noChangePrecision)} / ${formatRate(advisory.recommendation.noChangeRecall)}`,
        },
        {
          label: "Insufficient evidence",
          value: comparisonValue(
            deterministic.recommendation.insufficientEvidenceAgreement,
            advisory.recommendation.insufficientEvidenceAgreement,
            deltas.insufficientEvidenceAgreement,
          ),
          status: deltaStatus(deltas.insufficientEvidenceAgreement),
        },
        {
          label: "Abstention correctness",
          value: comparisonValue(
            deterministic.abstention.correctness,
            advisory.abstention.correctness,
            deltas.abstentionCorrectness,
          ),
          status: deltaStatus(deltas.abstentionCorrectness),
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Candidate ranking",
      [
        {
          label: "Top-1 acceptable",
          value: comparisonValue(
            deterministic.ranking.top1Acceptable,
            advisory.ranking.top1Acceptable,
            deltas.top1Acceptable,
          ),
          status: deltaStatus(deltas.top1Acceptable),
        },
        {
          label: "Top-3 acceptable",
          value: comparisonValue(
            deterministic.ranking.top3Acceptable,
            advisory.ranking.top3Acceptable,
            deltas.top3Acceptable,
          ),
          status: deltaStatus(deltas.top3Acceptable),
        },
        {
          label: "Preferred at top 1",
          value: comparisonValue(
            deterministic.ranking.preferredAtTop1,
            advisory.ranking.preferredAtTop1,
            deltas.preferredAtTop1,
          ),
          status: deltaStatus(deltas.preferredAtTop1),
        },
        {
          label: "Forbidden at top 1",
          value: comparisonValue(
            deterministic.ranking.forbiddenAtTop1,
            advisory.ranking.forbiddenAtTop1,
            deltas.forbiddenAtTop1,
          ),
          status: deltaStatus(deltas.forbiddenAtTop1),
        },
        {
          label: "Forbidden within top 3",
          value: comparisonValue(
            deterministic.ranking.forbiddenWithinTop3,
            advisory.ranking.forbiddenWithinTop3,
            deltas.forbiddenWithinTop3,
          ),
          status: deltaStatus(deltas.forbiddenWithinTop3),
        },
        {
          label: "Mean first acceptable rank",
          value: `det ${numberOrNA(deterministic.ranking.meanFirstAcceptableRank, 2)} | AI ${numberOrNA(advisory.ranking.meanFirstAcceptableRank, 2)}`,
        },
        {
          label: "No acceptable returned",
          value: `det ${String(deterministic.ranking.noAcceptableCandidateReturned)} | AI ${String(advisory.ranking.noAcceptableCandidateReturned)}`,
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Safety and confidence",
      [
        {
          label: "Unsafe recommendations",
          value: comparisonValue(
            deterministic.safety.unsafeRecommendation,
            advisory.safety.unsafeRecommendation,
            deltas.unsafeRecommendation,
          ),
          status: deltaStatus(deltas.unsafeRecommendation),
        },
        {
          label: "Invented / unknown IDs",
          value: `${String(advisory.safety.inventedCandidateCount)} / ${String(advisory.safety.unknownCandidateIdCount)}`,
          status:
            advisory.safety.inventedCandidateCount +
              advisory.safety.unknownCandidateIdCount ===
            0
              ? "success"
              : "danger",
        },
        {
          label: "Incorrect locator change",
          value: `det ${String(deterministic.safety.incorrectLocatorChangeCount)} | AI ${String(advisory.safety.incorrectLocatorChangeCount)}`,
        },
        {
          label: "XPath / positional / force",
          value: `${String(advisory.safety.xpathRecommendationCount)} / ${String(advisory.safety.positionalRepairCount)} / ${String(advisory.safety.forceRecommendationCount)}`,
        },
        {
          label: "Patch / shell command",
          value: `${String(advisory.safety.sourcePatchRecommendationCount)} / ${String(advisory.safety.shellCommandRecommendationCount)}`,
        },
        {
          label: "Confidence-floor agreement",
          value: comparisonValue(
            deterministic.confidence.floorAgreement,
            advisory.confidence.floorAgreement,
            deltas.confidenceFloor,
          ),
          status: deltaStatus(deltas.confidenceFloor),
        },
        {
          label: "High correct / incorrect",
          value: `det ${String(deterministic.confidence.highConfidenceCorrect)} / ${String(deterministic.confidence.highConfidenceIncorrect)} | AI ${String(advisory.confidence.highConfidenceCorrect)} / ${String(advisory.confidence.highConfidenceIncorrect)}`,
        },
        {
          label: "AI confidence high / med / low",
          value: `${String(advisory.confidence.distribution.high)} / ${String(advisory.confidence.distribution.medium)} / ${String(advisory.confidence.distribution.low)}`,
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Provider execution",
      [
        { label: "Provider", value: summary.provider.provider },
        { label: "Requested model", value: summary.provider.requestedModel },
        { label: "Returned model", value: summary.provider.returnedModel },
        {
          label: "Requests success / failure",
          value: `${String(summary.provider.requestCount)} · ${String(summary.provider.successfulRequestCount)} / ${String(providerFailures)}`,
          status: providerFailures === 0 ? "success" : "warning",
        },
        {
          label: "Invalid output / retries",
          value: `${String(summary.provider.invalidStructuredOutputCount)} / ${String(summary.provider.retryCount)}`,
        },
        {
          label: "Failure categories",
          value: aggregateCategories(summary.provider.failureCodes),
          status: providerFailures === 0 ? "neutral" : "warning",
        },
        {
          label: "Input / output tokens",
          value: `${summary.provider.inputTokens === null ? "N/A" : String(summary.provider.inputTokens)} / ${summary.provider.outputTokens === null ? "N/A" : String(summary.provider.outputTokens)}`,
        },
        {
          label: "Approximate cost USD",
          value: numberOrNA(summary.provider.approximateCostUsd, 6),
        },
        {
          label: "Aggregate / mean latency",
          value: `${summary.provider.aggregateLatencyMs.toFixed(0)} ms / ${numberOrNA(summary.provider.meanLatencyMs, 1)} ms`,
        },
      ],
      capabilities,
    ),
    renderCliSection(
      "Execution isolation",
      [
        { label: "Human labels sent to AI", value: "no", status: "success" },
        { label: "Original IDs sent to AI", value: "no", status: "success" },
        { label: "Deterministic scores sent", value: "no", status: "success" },
        {
          label: "Network calls",
          value: String(summary.isolation.networkCalls),
        },
        { label: "Locator application", value: "absent", status: "success" },
        { label: "Source mutation", value: "absent", status: "success" },
        { label: "Automatic healing", value: "absent", status: "success" },
        {
          label: "Elapsed time",
          value: `${(Math.max(0, elapsedMs) / 1_000).toFixed(2)}s`,
        },
      ],
      capabilities,
    ),
    renderCliNotice(
      unsafe > 0 ? "RISK" : "WARNING",
      unsafe > 0
        ? "AI advisory safety signals require investigation. No candidate was executed, applied, or used to heal a test."
        : "Comparison results remain advisory. Sample size and metric improvements never authorize locator application or healing.",
      capabilities,
    ),
  ].join("\n\n");
}

function markdownRate(rate: EvaluationRate): string {
  return formatRate(rate).replace(" · ", " - ");
}

export function renderLocatorAdvisoryComparisonMarkdown(
  summary: LocatorAdvisoryComparisonAggregateSummary,
): string {
  const d = summary.deterministic;
  const a = summary.advisory;
  const row = (
    label: string,
    deterministic: EvaluationRate,
    advisory: EvaluationRate,
    delta: LocatorComparisonDelta,
  ): string =>
    `| ${label} | ${markdownRate(deterministic)} | ${markdownRate(advisory)} | ${formatDelta(delta)} |`;
  return [
    "# Locator reranking comparison",
    "",
    `- Requested mode: ${summary.requestedMode}`,
    `- Effective mode: ${summary.effectiveMode}`,
    `- Status: ${summary.status}`,
    `- Warning: ${summary.sampleNotice}`,
    `- Blind reviewed: ${String(summary.counts.blindReviewed)}`,
    `- Advisory coverage: ${String(summary.counts.advisoryCompleted)}/${String(summary.counts.advisoryEligible)}`,
    "- Pilot/calibration cases are excluded from comparison denominators.",
    "- No metric authorizes locator application, retry, source mutation, or healing.",
    "",
    "## Side-by-side quality",
    "",
    "| Metric | Deterministic | AI advisory | Delta |",
    "| --- | ---: | ---: | ---: |",
    row(
      "Classification agreement",
      d.classification.agreement,
      a.classification.agreement,
      summary.deltas.classificationAgreement,
    ),
    row(
      "Recommendation agreement",
      d.recommendation.agreement,
      a.recommendation.agreement,
      summary.deltas.recommendationAgreement,
    ),
    row(
      "Candidates available",
      d.recommendation.candidatesAvailableAgreement,
      a.recommendation.candidatesAvailableAgreement,
      summary.deltas.candidatesAvailableAgreement,
    ),
    row(
      "Insufficient evidence",
      d.recommendation.insufficientEvidenceAgreement,
      a.recommendation.insufficientEvidenceAgreement,
      summary.deltas.insufficientEvidenceAgreement,
    ),
    row(
      "Abstention correctness",
      d.abstention.correctness,
      a.abstention.correctness,
      summary.deltas.abstentionCorrectness,
    ),
    row(
      "Top-1 acceptable",
      d.ranking.top1Acceptable,
      a.ranking.top1Acceptable,
      summary.deltas.top1Acceptable,
    ),
    row(
      "Top-3 acceptable",
      d.ranking.top3Acceptable,
      a.ranking.top3Acceptable,
      summary.deltas.top3Acceptable,
    ),
    row(
      "Preferred at top 1",
      d.ranking.preferredAtTop1,
      a.ranking.preferredAtTop1,
      summary.deltas.preferredAtTop1,
    ),
    row(
      "Forbidden at top 1",
      d.ranking.forbiddenAtTop1,
      a.ranking.forbiddenAtTop1,
      summary.deltas.forbiddenAtTop1,
    ),
    row(
      "Forbidden within top 3",
      d.ranking.forbiddenWithinTop3,
      a.ranking.forbiddenWithinTop3,
      summary.deltas.forbiddenWithinTop3,
    ),
    row(
      "Unsafe recommendations",
      d.safety.unsafeRecommendation,
      a.safety.unsafeRecommendation,
      summary.deltas.unsafeRecommendation,
    ),
    row(
      "Confidence floor",
      d.confidence.floorAgreement,
      a.confidence.floorAgreement,
      summary.deltas.confidenceFloor,
    ),
    `| Mean first acceptable rank | ${numberOrNA(d.ranking.meanFirstAcceptableRank, 2)} | ${numberOrNA(a.ranking.meanFirstAcceptableRank, 2)} | N/A |`,
    `| No acceptable returned | ${String(d.ranking.noAcceptableCandidateReturned)} | ${String(a.ranking.noAcceptableCandidateReturned)} | N/A |`,
    `| Incorrect locator change | ${String(d.safety.incorrectLocatorChangeCount)} | ${String(a.safety.incorrectLocatorChangeCount)} | N/A |`,
    "",
    "Higher is better for agreement, acceptable ranking, preferred ranking, and confidence-floor metrics. Lower is better for forbidden promotion and unsafe recommendations.",
    "",
    "## Provider execution",
    "",
    `- Provider: ${summary.provider.provider}`,
    `- Requested model: ${summary.provider.requestedModel}`,
    `- Returned model: ${summary.provider.returnedModel}`,
    `- Requests/success/failure: ${String(summary.provider.requestCount)}/${String(summary.provider.successfulRequestCount)}/${String(summary.provider.failedRequestCount)}`,
    `- Invalid structured output: ${String(summary.provider.invalidStructuredOutputCount)}`,
    `- Failure categories: ${aggregateCategories(summary.provider.failureCodes)}`,
    `- Retries: ${String(summary.provider.retryCount)}`,
    `- Aggregate input/output tokens: ${summary.provider.inputTokens === null ? "N/A" : String(summary.provider.inputTokens)}/${summary.provider.outputTokens === null ? "N/A" : String(summary.provider.outputTokens)}`,
    `- Approximate aggregate cost USD: ${numberOrNA(summary.provider.approximateCostUsd, 6)}`,
    `- Aggregate/mean latency ms: ${summary.provider.aggregateLatencyMs.toFixed(0)}/${numberOrNA(summary.provider.meanLatencyMs, 1)}`,
    "",
    "## Privacy and isolation",
    "",
    "- Provider input contains no human answer key, rationale, private alias data, original candidate ID, deterministic score, or deterministic ranking.",
    "- Public output contains aggregate information only; prompts and raw responses are not retained.",
    `- Network calls: ${String(summary.isolation.networkCalls)}`,
    "- Locator applications: 0",
    "- Source mutations: 0",
    "- Automatic healing: absent",
  ].join("\n");
}
