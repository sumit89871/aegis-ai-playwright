import { truncateText } from "../diagnostics/redaction.ts";
import { formatLocatorCandidate } from "./locator-candidate.ts";
import type { LocatorDiagnosisReport } from "./locator-diagnosis.ts";

function safe(value: string): string {
  return value
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/```/gu, "''' ")
    .replace(/\r?\n/gu, " ");
}

export function renderLocatorDiagnosisMarkdown(
  report: LocatorDiagnosisReport,
  maximumLength = 20_000,
): string {
  const candidates = new Map(
    report.candidateInventory.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const ranked =
    report.conclusion.rankedCandidates.length === 0
      ? "- None."
      : report.conclusion.rankedCandidates
          .map((entry) => {
            const candidate = candidates.get(entry.candidateId);
            const expression =
              candidate === undefined
                ? "unavailable"
                : formatLocatorCandidate(candidate);
            return `- ${String(entry.rank)}. ${entry.candidateId} (${entry.confidence}): ${safe(entry.reason)} Suggested expression for manual review: \`${safe(expression).replaceAll("`", "'")}\``;
          })
          .join("\n");
  const list = (values: readonly string[]): string =>
    values.length === 0
      ? "- None."
      : values.map((value) => `- ${safe(value)}`).join("\n");
  const markdown = [
    "# Locator diagnosis (advisory only)",
    "",
    "This report does not modify source, retry an action, or mark a failed test as passed.",
    "",
    "## Locator failure summary",
    "",
    safe(report.conclusion.summary),
    "",
    "## Failure classification",
    "",
    `- Classification: ${report.conclusion.classification}`,
    `- Confidence: ${report.conclusion.confidence}`,
    `- Recommendation: ${report.conclusion.recommendationStatus}`,
    "",
    "## Page-state assessment",
    "",
    `- Ready: ${String(report.conclusion.pageStateAssessment.ready)}`,
    `- Reason: ${safe(report.conclusion.pageStateAssessment.reason)}`,
    "",
    "## Original locator assessment",
    "",
    `- Strategy: ${safe(report.conclusion.originalLocatorAssessment.strategy)}`,
    `- Issue: ${safe(report.conclusion.originalLocatorAssessment.issue)}`,
    "",
    "## Ranked candidate suggestions",
    "",
    ranked,
    "",
    "## Recommended next step",
    "",
    safe(report.conclusion.recommendedNextStep),
    "",
    "## Missing evidence",
    "",
    list(report.conclusion.missingEvidence),
    "",
    "## Limitations",
    "",
    list(report.conclusion.limitations),
    "",
    "## Provenance",
    "",
    `- Mode: ${report.provenance.mode}`,
    `- Candidate collection: ${report.provenance.candidateCollectionStatus}`,
    `- Candidates retained/dropped: ${String(report.provenance.candidatesCollected)}/${String(report.provenance.candidatesDropped)}`,
    `- AI attempted: ${String(report.provenance.aiAttempted)}`,
    `- AI validated: ${String(report.provenance.aiOutputValidated)}`,
    `- Prompt: ${report.provenance.promptId} ${report.provenance.promptVersion}`,
    `- Conflict detected: ${String(report.provenance.conflictDetected)}`,
    "",
    "## Safety notice",
    "",
    "Suggestions require human review. No candidate was executed or applied.",
    "",
  ].join("\n");
  return truncateText(markdown, maximumLength);
}
