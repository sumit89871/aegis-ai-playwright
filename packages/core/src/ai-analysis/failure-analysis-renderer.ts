import { truncateText } from "../diagnostics/redaction.ts";
import type { FailureAnalysisReport } from "./failure-analysis.ts";

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([*_`#])/gu, "\\$1")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function list(values: readonly string[]): string {
  return values.length === 0
    ? "- None"
    : values.map((value) => `- ${escapeMarkdown(value)}`).join("\n");
}

export function renderFailureAnalysisMarkdown(
  report: FailureAnalysisReport,
  maximumLength = 20_000,
): string {
  const conclusion = report.conclusion;
  const causes = conclusion.probableCauses.map(
    (cause) =>
      `${cause.cause} (${cause.confidence}; evidence: ${cause.evidenceIds.join(", ")})`,
  );
  const actions = conclusion.recommendedActions.map(
    (action) =>
      `${action.priority} priority for ${action.owner}: ${action.action}`,
  );
  const provenance = [
    `Mode: ${report.provenance.mode}`,
    `AI attempted: ${report.provenance.aiAttempted ? "yes" : "no"}`,
    `AI response validated: ${report.provenance.aiResponseValidated ? "yes" : "no"}`,
    `Deterministic fallback retained: ${report.provenance.fallbackUsed ? "yes" : "no"}`,
    `Prompt: ${report.provenance.promptId} ${report.provenance.promptVersion}`,
    `Lifecycle outcome: ${report.provenance.lifecycleOutcome}`,
    ...(report.provenance.providerId === undefined
      ? []
      : [`Provider: ${report.provenance.providerId}`]),
    ...(report.provenance.model === undefined
      ? []
      : [`Model: ${report.provenance.model}`]),
  ];
  const markdown = [
    "# Advisory UI failure analysis",
    "",
    "## Failure summary",
    "",
    escapeMarkdown(conclusion.summary),
    "",
    "## Classification",
    "",
    `- Category: ${conclusion.primaryCategory}`,
    `- Confidence: ${conclusion.confidence}`,
    "",
    "## Probable causes",
    "",
    list(causes),
    "",
    "## Evidence used",
    "",
    list([
      ...new Set(
        conclusion.probableCauses.flatMap((cause) => cause.evidenceIds),
      ),
    ]),
    "",
    "## Recommended actions",
    "",
    list(actions),
    "",
    "## Locator assessment",
    "",
    `- Status: ${conclusion.locatorAssessment.status}`,
    `- Reason: ${escapeMarkdown(conclusion.locatorAssessment.reason)}`,
    "",
    "## Missing evidence",
    "",
    list(conclusion.missingEvidence),
    "",
    "## Limitations",
    "",
    list(conclusion.limitations),
    "",
    "## Analysis provenance",
    "",
    list(provenance),
    "",
  ].join("\n");
  return truncateText(markdown, maximumLength);
}
